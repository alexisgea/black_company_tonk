'use strict';
const crypto = require('crypto');
const { Room } = require('./room');
const { GameError } = require('./tonk');
const { chooseAction } = require('./bot');

const { RateLimiter } = require('./limits');

const OPEN = 1; // ws.OPEN
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_NAME = 20;
const CHAT_BURST = 5; // messages allowed per window
const CHAT_WINDOW_MS = 5000;

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || null;
}

// Tracks connected users and rooms, and routes protocol messages. Transport-agnostic:
// a "conn" only needs send(string), close() and a readyState.
class Lobby {
  // botDelayMs: pause before a bot moves. maxRooms / createsPerMinute: abuse limits.
  // roomIdleMs: a game nobody has touched for this long is closed (warning idleWarningMs before).
  constructor({
    graceMs = 60000,
    rng = Math.random,
    botDelayMs = 1200,
    maxRooms = 100,
    createsPerMinute = 5,
    roomIdleMs = 30 * 60000,
    idleWarningMs = 2 * 60000,
  } = {}) {
    this.graceMs = graceMs;
    this.rng = rng;
    this.botDelayMs = botDelayMs;
    this.maxRooms = maxRooms;
    this.createsPerMinute = createsPerMinute;
    this.roomIdleMs = roomIdleMs;
    this.idleWarningMs = idleWarningMs;
    this.users = new Map(); // private token -> user
    this.rooms = new Map(); // room id -> Room
  }

  send(conn, obj) {
    if (conn && conn.readyState === OPEN) conn.send(JSON.stringify(obj));
  }

  sendError(conn, message) {
    this.send(conn, { t: 'error', message });
  }

  gameList() {
    return [...this.rooms.values()].map((r) => r.summary());
  }

  broadcastLobby() {
    const msg = { t: 'lobby', games: this.gameList() };
    for (const user of this.users.values()) if (!user.room) this.send(user.conn, msg);
  }

  broadcastRoom(room) {
    for (const user of room.players) this.send(user.conn, room.view(user));
    this.scheduleBot(room);
  }

  // If it is a bot's turn, play it after a short pause. Every state change flows through
  // broadcastRoom, so this is the only hook needed. At most one pending move per room.
  scheduleBot(room) {
    if (room.botTimer || room.status !== 'playing') return;
    const turnId = room.round.order[room.round.turn];
    if (!room.players.some((p) => p.isBot && p.id === turnId)) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      const bot = room.players.find((p) => p.isBot && p.id === turnId);
      if (!bot || room.status !== 'playing' || room.round.order[room.round.turn] !== turnId) {
        this.scheduleBot(room);
        return;
      }
      const wasPlaying = room.status === 'playing';
      try {
        room.act(bot, chooseAction(room.round, bot.id));
      } catch (err) {
        console.error('Bot move failed:', err);
        return;
      }
      this.broadcastRoom(room);
      if (wasPlaying && room.status !== 'playing') this.broadcastLobby();
    }, this.botDelayMs);
    room.botTimer.unref?.();
  }

  deleteRoom(room) {
    clearTimeout(room.botTimer);
    this.rooms.delete(room.id);
  }

  // Closes a game and sends everyone in it back to the lobby with an explanation.
  closeRoom(room, message) {
    const members = room.humans;
    this.deleteRoom(room);
    for (const user of members) {
      user.room = null;
      this.send(user.conn, { t: 'closed', message });
    }
    this.broadcastLobby();
  }

  // Called periodically. Games nobody has touched for roomIdleMs are closed, after one warning.
  sweepIdleRooms(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      const idle = now - room.lastActivity;
      if (idle >= this.roomIdleMs) {
        this.closeRoom(room, 'This game was closed because nobody did anything for a while.');
      } else if (!room.idleWarned && this.roomIdleMs > this.idleWarningMs && idle >= this.roomIdleMs - this.idleWarningMs) {
        room.idleWarned = true;
        const minutes = Math.max(1, Math.ceil((this.roomIdleMs - idle) / 60000));
        for (const user of room.humans) {
          this.send(user.conn, { t: 'notice', message: `This game will close in about ${minutes} min if nobody does anything.` });
        }
      }
    }
  }

  newRoomId() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 4; i++) id += ID_ALPHABET[Math.floor(this.rng() * ID_ALPHABET.length)];
      if (!this.rooms.has(id)) return id;
    }
  }

  // Detaches `user` from their room, tidying up the room and notifying everyone affected.
  leaveRoom(user, reason = 'leave') {
    const room = user.room;
    if (!room) return;
    room.leave(user, reason);
    if (room.humans.length === 0) this.deleteRoom(room);
    else this.broadcastRoom(room);
    this.broadcastLobby();
  }

  handle(conn, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.sendError(conn, 'Malformed message');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      return this.sendError(conn, 'Malformed message');
    }
    try {
      if (msg.t === 'hello') return this.onHello(conn, msg);
      if (!conn.user) return this.sendError(conn, 'Say hello first');
      this.onMessage(conn.user, msg);
    } catch (err) {
      if (err instanceof GameError) this.sendError(conn, err.message);
      else {
        console.error(err);
        this.sendError(conn, 'Server error');
      }
    }
  }

  onHello(conn, msg) {
    const name = cleanName(msg.name);
    if (!name) throw new GameError('Please enter a name');
    let user = typeof msg.token === 'string' ? this.users.get(msg.token) : undefined;
    if (user) {
      clearTimeout(user.timer);
      if (user.conn && user.conn !== conn) {
        this.send(user.conn, { t: 'replaced' });
        user.conn.user = null;
        user.conn.close();
      }
    } else {
      user = {
        token: crypto.randomBytes(16).toString('hex'),
        id: crypto.randomBytes(4).toString('hex'),
        name,
        conn: null,
        room: null,
        timer: null,
        chatTimes: [],
        createLimiter: new RateLimiter(this.createsPerMinute, 60000),
      };
      this.users.set(user.token, user);
    }
    if (!user.room) user.name = name;
    user.conn = conn;
    conn.user = user;
    this.send(conn, { t: 'welcome', token: user.token, id: user.id, name: user.name });
    if (user.room) this.broadcastRoom(user.room);
    else this.send(conn, { t: 'lobby', games: this.gameList() });
  }

  onMessage(user, msg) {
    const room = user.room;
    room?.touch(); // anything a player sends counts as using the game
    switch (msg.t) {
      case 'createGame': {
        if (room) throw new GameError('Already in a game');
        if (this.rooms.size >= this.maxRooms) throw new GameError('The server is full right now. Please try again later.');
        if (!user.createLimiter.hit()) throw new GameError('You are creating games too quickly.');
        const r = new Room(this.newRoomId(), `${user.name}'s game`, this.rng);
        this.rooms.set(r.id, r);
        r.join(user);
        this.broadcastRoom(r);
        this.broadcastLobby();
        break;
      }
      case 'joinGame': {
        if (room) throw new GameError('Already in a game');
        const r = typeof msg.gameId === 'string' ? this.rooms.get(msg.gameId.toUpperCase()) : null;
        if (!r) throw new GameError('That game no longer exists');
        r.join(user);
        r.touch();
        this.broadcastRoom(r);
        this.broadcastLobby();
        break;
      }
      case 'kick': {
        if (!room) throw new GameError('Not in a game');
        if (room.hostId !== user.id) throw new GameError('Only the host can remove players');
        const target = room.players.find((p) => p.id === msg.id && !p.isBot);
        if (!target) throw new GameError('No such player');
        if (target === user) throw new GameError('You cannot remove yourself');
        room.bannedIds.add(target.id);
        this.send(target.conn, { t: 'kicked' });
        this.leaveRoom(target, 'kick'); // also updates the table and sends the lobby list to the kicked player
        break;
      }
      case 'leaveGame': {
        if (!room) throw new GameError('Not in a game');
        this.leaveRoom(user);
        this.send(user.conn, { t: 'lobby', games: this.gameList() });
        break;
      }
      case 'startGame': {
        if (!room) throw new GameError('Not in a game');
        room.startHand(user);
        this.broadcastRoom(room);
        this.broadcastLobby();
        break;
      }
      case 'action': {
        if (!room) throw new GameError('Not in a game');
        const wasPlaying = room.status === 'playing';
        room.act(user, msg.action);
        this.broadcastRoom(room);
        if (wasPlaying && room.status !== 'playing') this.broadcastLobby();
        break;
      }
      case 'reorder': {
        if (!room) throw new GameError('Not in a game');
        room.reorder(user, msg.cards);
        this.send(user.conn, room.view(user)); // only the owner can see their hand order
        break;
      }
      case 'addBot': {
        if (!room) throw new GameError('Not in a game');
        if (room.hostId !== user.id) throw new GameError('Only the host can add bots');
        room.addBot();
        this.broadcastRoom(room);
        this.broadcastLobby();
        break;
      }
      case 'removeBot': {
        if (!room) throw new GameError('Not in a game');
        if (room.hostId !== user.id) throw new GameError('Only the host can remove bots');
        room.removeBot(msg.id);
        this.broadcastRoom(room);
        this.broadcastLobby();
        break;
      }
      case 'chat': {
        if (!room) throw new GameError('Not in a game');
        const now = Date.now();
        user.chatTimes = user.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
        if (user.chatTimes.length >= CHAT_BURST) throw new GameError('You are sending messages too fast');
        const message = room.addChat(user, msg.text);
        user.chatTimes.push(now);
        for (const p of room.players) this.send(p.conn, { t: 'chat', message });
        break;
      }
      default:
        throw new GameError('Unknown message');
    }
  }

  disconnect(conn) {
    const user = conn.user;
    if (!user || user.conn !== conn) return;
    user.conn = null;
    conn.user = null;
    if (!user.room) {
      this.users.delete(user.token);
      return;
    }
    this.broadcastRoom(user.room);
    user.timer = setTimeout(() => {
      this.leaveRoom(user);
      this.users.delete(user.token);
    }, this.graceMs);
    user.timer.unref?.();
  }
}

module.exports = { Lobby, cleanName };
