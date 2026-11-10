'use strict';
const crypto = require('crypto');
const { Room } = require('./room');
const { GameError } = require('./tonk');

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
  constructor({ graceMs = 60000, rng = Math.random } = {}) {
    this.graceMs = graceMs;
    this.rng = rng;
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
  }

  newRoomId() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 4; i++) id += ID_ALPHABET[Math.floor(this.rng() * ID_ALPHABET.length)];
      if (!this.rooms.has(id)) return id;
    }
  }

  // Detaches `user` from their room, tidying up the room and notifying everyone affected.
  leaveRoom(user) {
    const room = user.room;
    if (!room) return;
    room.leave(user);
    if (room.players.length === 0) this.rooms.delete(room.id);
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
    switch (msg.t) {
      case 'createGame': {
        if (room) throw new GameError('Already in a game');
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
        this.broadcastRoom(r);
        this.broadcastLobby();
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
