'use strict';
const crypto = require('crypto');
const { Room } = require('./room');
const { GameError } = require('./tonk');
const { chooseAction, fallbackAction } = require('./bot');
const { isReservedName } = require('./botnames');

const { RateLimiter } = require('./limits');

const OPEN = 1; // ws.OPEN
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_NAME = 20;
const CHAT_BURST = 5; // messages allowed per window
const CHAT_WINDOW_MS = 5000;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || null;
}

function requireRoom(room) {
  if (!room) throw new GameError('Not at a table');
}

function requireHost(room, user, what) {
  requireRoom(room);
  if (room.hostId !== user.id) throw new GameError(`Only the host can ${what}`);
}

// A seat the server plays itself: a bot, a human who is disconnected (they get the seat back when they
// reconnect, and are removed once the hand is over and the grace period has passed), or a human who took too long
// on their turn (`away`, they get the seat back by acting or pressing "take back control").
const isAuto = (p) => p.isBot || !p.conn || !!p.away;

const DEVICE_ID = /^[\w-]{8,64}$/;
const cleanDevice = (raw) => (typeof raw === 'string' && DEVICE_ID.test(raw) ? raw : undefined);

// Tracks connected users and rooms, and routes protocol messages. Transport-agnostic:
// a "conn" only needs send(string), close() and a readyState.
class Lobby {
  // botDelayMs: pause before a bot moves. maxRooms / createsPerMinute: abuse limits.
  // roomIdleMs: a game nobody has touched for this long is closed (warning idleWarningMs before).
  // turnTimeoutMs: a connected player who takes longer than this on their turn is replaced by a bot (0 = never).
  // It only applies when at least two humans play; a lone human with bots is covered by roomIdleMs instead.
  // turnWarningMs: only the last part of the turn timeout is shown to the player as a countdown.
  constructor({
    graceMs = 60000,
    rng = Math.random,
    botDelayMs = 1200,
    maxRooms = 100,
    createsPerMinute = 5,
    roomIdleMs = 30 * 60000,
    idleWarningMs = 2 * 60000,
    tonkTimeoutMs = 15000,
    turnTimeoutMs = 120000,
    turnWarningMs = 60000,
  } = {}) {
    this.tonkTimeoutMs = tonkTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.turnWarningMs = Math.min(turnWarningMs, turnTimeoutMs);
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

  // Humans with a live connection (seats held for disconnected players do not count).
  onlineCount() {
    let n = 0;
    for (const user of this.users.values()) if (user.conn) n++;
    return n;
  }

  broadcastLobby() {
    const msg = { t: 'lobby', games: this.gameList(), online: this.onlineCount() };
    for (const user of this.users.values()) if (!user.room) this.send(user.conn, msg);
  }

  broadcastRoom(room) {
    if (this.dropAbsentPlayers(room)) return;
    if (this.handleBroke(room)) return;
    this.scheduleBot(room); // first, so the views below already carry the new turn deadline
    for (const user of room.audience) this.send(user.conn, room.view(user));
  }

  // Tells the humans who just lost their last coin that they are guests now. If no human is left
  // playing, the table is closed. Returns true if it was closed.
  handleBroke(room) {
    const broke = room.takeBroke();
    if (broke.length && room.humans.length === 0) {
      this.closeRoom(room, 'Every player at this table is flat broke. The Company has taken the last coin and the table is closed.');
      return true;
    }
    for (const user of broke) {
      if (user.isBot) continue;
      this.send(user.conn, {
        t: 'broke',
        message:
          'You are out of coins! The Company has no more use for you at the table, so you are a guest now. Watch and chat from the shadows.',
      });
    }
    return false;
  }

  // Disconnected players whose grace period ran out during a hand stay seated (a bot plays for
  // them) and are removed once the hand is over. Returns true if anyone was removed, in which
  // case leaveRoom has already updated the table.
  dropAbsentPlayers(room) {
    if (room.status === 'playing') return false;
    const absent = [...room.players, ...room.spectators].filter((p) => !p.isBot && !p.conn && p.dropAfterHand);
    for (const user of absent) {
      this.leaveRoom(user);
      this.users.delete(user.token);
    }
    return absent.length > 0;
  }

  // For changes that also alter the game list (players or status): update the table and the lobby.
  broadcastAll(room) {
    this.broadcastRoom(room);
    this.broadcastLobby();
  }

  // Timer callbacks run outside the message handler's try/catch, so a bug in one must not take the process
  // (and every other table) down.
  guarded(label, fn) {
    return () => {
      try {
        fn();
      } catch (err) {
        console.error(`${label} failed:`, err);
      }
    };
  }

  // If it is a bot's turn, play it after a short pause; if it is a connected human's turn, start (or keep) the
  // turn timer. Every state change flows through broadcastRoom, so this is the only hook needed.
  // At most one pending move per room.
  scheduleBot(room) {
    if (room.paused) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
      this.clearTonkTimer(room);
      this.clearTurnTimer(room);
      return;
    }
    if (room.status === 'playing' && room.round.phase === 'tonk') {
      this.clearTurnTimer(room);
      this.scheduleTonk(room);
      return;
    }
    this.clearTonkTimer(room);
    if (room.status !== 'playing') {
      this.clearTurnTimer(room);
      return;
    }
    const turnId = room.round.order[room.round.turn];
    const seat = room.players.find((p) => p.id === turnId);
    if (!seat) {
      this.clearTurnTimer(room);
      return;
    }
    if (!isAuto(seat)) {
      this.scheduleTurnTimer(room, seat);
      return;
    }
    this.clearTurnTimer(room);
    if (room.botTimer) return;
    room.botTimer = setTimeout(
      this.guarded('Bot turn', () => {
        room.botTimer = null;
        const bot = room.players.find((p) => isAuto(p) && p.id === turnId);
        if (
          !bot ||
          room.paused ||
          room.status !== 'playing' ||
          room.round.phase === 'tonk' ||
          room.round.order[room.round.turn] !== turnId
        ) {
          this.scheduleBot(room);
          return;
        }
        if (!this.botMove(room, bot)) {
          this.closeRoom(room, 'This table was closed because of a server error. Sorry!');
          return;
        }
        this.broadcastRoom(room);
        if (room.status !== 'playing') this.broadcastLobby();
      }),
      this.botDelayMs,
    );
    room.botTimer.unref?.();
  }

  // Plays one move for an auto-played seat. If the bot logic fails, a plain legal move is used instead so the
  // table never freezes. Returns false only if even that fails.
  botMove(room, bot) {
    for (const choose of [chooseAction, fallbackAction]) {
      try {
        room.act(bot, choose(room.round, bot.id));
        return true;
      } catch (err) {
        console.error(`Bot move failed (${choose.name}):`, err);
      }
    }
    return false;
  }

  // A connected human gets turnTimeoutMs for their turn; after that a bot takes over their seat (see isAuto).
  // The countdown restarts for each new turn, and when a returning player picks the seat back up mid-turn.
  // After a pause the turn carries on with the time it had left.
  scheduleTurnTimer(room, seat) {
    if (!this.turnTimeoutMs || room.humans.length < 2) {
      this.clearTurnTimer(room);
      return;
    }
    const key = `${room.handNo}:${room.round.turnNo}:${seat.id}`;
    if (room.turnKey === key && room.turnTimer) return;
    clearTimeout(room.turnTimer);
    const ms = room.turnResume?.key === key ? room.turnResume.ms : this.turnTimeoutMs;
    room.turnResume = null;
    room.turnKey = key;
    room.turnDeadline = Date.now() + ms;
    room.turnTimer = setTimeout(
      this.guarded('Turn timeout', () => this.onTurnTimeout(room, key)),
      ms,
    );
    room.turnTimer.unref?.();
  }

  onTurnTimeout(room, key) {
    room.turnTimer = null;
    if (!this.rooms.has(room.id) || room.turnKey !== key || room.status !== 'playing' || room.paused) return;
    const seat = room.players.find((p) => p.id === room.round.order[room.round.turn]);
    if (!seat || isAuto(seat)) return;
    seat.away = true;
    room.addLog({ type: 'timeout', pid: seat.id, name: seat.name });
    this.broadcastRoom(room);
  }

  clearTurnTimer(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnKey = null;
    room.turnDeadline = null;
  }

  // The player takes their seat back from the bot (by acting, or with the "take back control" button).
  // Returns true if they were away.
  resumeSeat(user) {
    if (!user.away) return false;
    user.away = false;
    user.room?.addLog({ type: 'back', pid: user.id, name: user.name });
    return true;
  }

  // Runs a player's own move. If they just came back but the move is refused (say it is not their turn),
  // the table still needs to hear that they are back before the error goes to them.
  actAndShowResume(room, resumed, move) {
    try {
      move();
    } catch (err) {
      if (resumed) this.broadcastRoom(room);
      throw err;
    }
  }

  // While a hand waits for TONK!, bots declare after a short pause and humans are given
  // room.tonkTimeoutMs to press the button before it is pressed for them.
  scheduleTonk(room) {
    const pending = room.pendingTonkers;
    if (!pending.some(isAuto)) {
      clearTimeout(room.tonkBotTimer);
      room.tonkBotTimer = null;
    } else if (!room.tonkBotTimer) {
      room.tonkBotTimer = setTimeout(
        this.guarded('Bot TONK', () => {
          room.tonkBotTimer = null;
          this.autoDeclare(room, isAuto);
        }),
        this.botDelayMs,
      );
      room.tonkBotTimer.unref?.();
    }
    if (!pending.some((p) => !isAuto(p))) {
      clearTimeout(room.tonkTimer);
      room.tonkTimer = null;
    } else if (!room.tonkTimer) {
      room.tonkTimer = setTimeout(
        this.guarded('TONK timeout', () => {
          room.tonkTimer = null;
          this.autoDeclare(room, (p) => !p.isBot);
        }),
        Math.max(0, room.tonkDeadline - Date.now()),
      );
      room.tonkTimer.unref?.();
    }
  }

  autoDeclare(room, which) {
    if (!this.rooms.has(room.id) || room.paused) return;
    for (const player of room.pendingTonkers.filter(which)) room.declareTonk(player);
    this.broadcastRoom(room);
    if (room.status !== 'playing') this.broadcastLobby();
  }

  clearTonkTimer(room) {
    clearTimeout(room.tonkTimer);
    clearTimeout(room.tonkBotTimer);
    room.tonkTimer = null;
    room.tonkBotTimer = null;
  }

  deleteRoom(room) {
    clearTimeout(room.botTimer);
    this.clearTonkTimer(room);
    this.clearTurnTimer(room);
    this.rooms.delete(room.id);
  }

  // Closes a game and sends everyone in it back to the lobby with an explanation. Members who are
  // disconnected have nowhere to come back to, so they are forgotten instead of lingering in this.users.
  closeRoom(room, message) {
    const members = room.audience;
    this.deleteRoom(room);
    for (const user of members) {
      room.restoreName(user);
      user.room = null;
      user.away = false;
      if (user.conn) {
        this.send(user.conn, { t: 'closed', message });
      } else {
        clearTimeout(user.timer);
        this.users.delete(user.token);
      }
    }
    this.broadcastLobby();
  }

  // Called periodically. Games nobody has touched for roomIdleMs are closed, after one warning.
  sweepIdleRooms(now = Date.now()) {
    // Safety net: a user with no connection and no table has nothing left to resume.
    for (const [token, user] of this.users) {
      if (!user.conn && !user.room) {
        clearTimeout(user.timer);
        this.users.delete(token);
      }
    }
    for (const room of [...this.rooms.values()]) {
      const idle = now - room.lastActivity;
      if (idle >= this.roomIdleMs) {
        this.closeRoom(room, 'This table was closed because nobody did anything for a while.');
      } else if (!room.idleWarned && this.roomIdleMs > this.idleWarningMs && idle >= this.roomIdleMs - this.idleWarningMs) {
        room.idleWarned = true;
        const minutes = Math.max(1, Math.ceil((this.roomIdleMs - idle) / 60000));
        for (const user of room.audience) {
          this.send(user.conn, { t: 'notice', message: `This table will close in about ${minutes} min if nobody does anything.` });
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
    user.away = false;
    if (room.humans.length === 0 && room.spectators.length > 0) {
      this.closeRoom(room, 'This table was closed because all the players left.');
      return;
    }
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
    if (isReservedName(name)) throw new GameError('That name is reserved for the bots, please pick another');
    let user = typeof msg.token === 'string' ? this.users.get(msg.token) : undefined;
    // A connection is one player. Another hello on it can only rename that player; it must not conjure up
    // extra users that stay behind (and count as "online") after the connection closes.
    if (conn.user && user && user !== conn.user) throw new GameError('This connection already belongs to another player');
    user ??= conn.user ?? undefined;
    if (user) {
      clearTimeout(user.timer);
      user.dropAfterHand = false;
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
        chatLimiter: new RateLimiter(CHAT_BURST, CHAT_WINDOW_MS),
        createLimiter: new RateLimiter(this.createsPerMinute, 60000),
      };
      this.users.set(user.token, user);
    }
    user.device = cleanDevice(msg.device) ?? user.device;
    if (!user.room) user.name = name;
    user.conn = conn;
    conn.user = user;
    this.send(conn, { t: 'welcome', token: user.token, id: user.id, name: user.name });
    if (user.room) this.broadcastRoom(user.room);
    this.broadcastLobby(); // also tells everyone else in the lobby about the new head count
  }

  onMessage(user, msg) {
    const room = user.room;
    if (room && !room.spectators.includes(user)) room.touch(); // anything a player sends counts as using the game (watching does not)
    switch (msg.t) {
      case 'createGame': {
        if (room) throw new GameError('Already at a table');
        if (this.rooms.size >= this.maxRooms) throw new GameError('The server is full right now. Please try again later.');
        if (!user.createLimiter.hit()) throw new GameError('You are creating tables too quickly.');
        const r = new Room(this.newRoomId(), `${user.name}'s table`, this.rng, {
          tonkTimeoutMs: this.tonkTimeoutMs,
          turnWarningMs: this.turnWarningMs,
        });
        this.rooms.set(r.id, r);
        r.join(user);
        this.broadcastAll(r);
        break;
      }
      case 'joinGame': {
        if (room) throw new GameError('Already at a table');
        const r = typeof msg.gameId === 'string' ? this.rooms.get(msg.gameId.toUpperCase()) : null;
        if (!r) throw new GameError('That table no longer exists');
        r.join(user);
        r.touch();
        this.broadcastAll(r);
        break;
      }
      case 'watchGame': {
        if (room) throw new GameError('Already at a table');
        const r = typeof msg.gameId === 'string' ? this.rooms.get(msg.gameId.toUpperCase()) : null;
        if (!r) throw new GameError('That table no longer exists');
        r.watch(user);
        this.broadcastAll(r);
        break;
      }
      case 'kick': {
        requireHost(room, user, 'remove players');
        const target = room.players.find((p) => p.id === msg.id && !p.isBot) ?? room.spectators.find((s) => s.id === msg.id);
        if (!target) throw new GameError('No such player');
        if (target === user) throw new GameError('You cannot remove yourself');
        room.ban(target);
        this.send(target.conn, { t: 'kicked' });
        this.leaveRoom(target, 'kick'); // also updates the table and sends the lobby list to the kicked player
        if (!target.conn) {
          clearTimeout(target.timer);
          this.users.delete(target.token);
        }
        break;
      }
      case 'leaveGame': {
        requireRoom(room);
        this.leaveRoom(user);
        this.send(user.conn, { t: 'lobby', games: this.gameList(), online: this.onlineCount() });
        break;
      }
      case 'startGame': {
        requireRoom(room);
        room.startHand(user);
        this.broadcastAll(room);
        break;
      }
      case 'action': {
        requireRoom(room);
        const resumed = this.resumeSeat(user);
        const wasPlaying = room.status === 'playing';
        this.actAndShowResume(room, resumed, () => room.act(user, msg.action));
        this.broadcastRoom(room);
        if (wasPlaying && room.status !== 'playing') this.broadcastLobby();
        break;
      }
      case 'declareTonk': {
        requireRoom(room);
        const resumed = this.resumeSeat(user);
        this.actAndShowResume(room, resumed, () => room.declareTonk(user));
        this.broadcastRoom(room);
        if (room.status !== 'playing') this.broadcastLobby();
        break;
      }
      case 'pause':
      case 'unpause': {
        requireHost(room, user, msg.t === 'pause' ? 'pause the game' : 'resume the game');
        if (msg.t === 'pause') room.pause(user);
        else room.unpause(user);
        this.broadcastRoom(room);
        break;
      }
      case 'resume': {
        requireRoom(room);
        this.resumeSeat(user);
        this.broadcastRoom(room);
        break;
      }
      case 'reorder': {
        requireRoom(room);
        room.reorder(user, msg.cards);
        this.send(user.conn, room.view(user)); // only the owner can see their hand order
        break;
      }
      case 'updateSettings': {
        requireHost(room, user, 'change the table rules');
        room.updateSettings(user, msg.settings);
        this.broadcastAll(room);
        break;
      }
      case 'addBot': {
        requireHost(room, user, 'add bots');
        room.addBot();
        this.broadcastAll(room);
        break;
      }
      case 'removeBot': {
        requireHost(room, user, 'remove bots');
        room.removeBot(msg.id);
        this.broadcastAll(room);
        break;
      }
      case 'chat': {
        requireRoom(room);
        if (!user.chatLimiter.hit()) throw new GameError('You are sending messages too fast');
        const message = room.addChat(user, msg.text);
        for (const p of room.audience) this.send(p.conn, { t: 'chat', message });
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
      this.broadcastLobby();
      return;
    }
    this.broadcastRoom(user.room);
    this.broadcastLobby();
    user.timer = setTimeout(() => {
      const room = user.room;
      if (room && room.status === 'playing' && room.players.includes(user)) {
        user.dropAfterHand = true; // a bot keeps their seat until the hand is over
        return;
      }
      this.leaveRoom(user);
      this.users.delete(user.token);
    }, this.graceMs);
    user.timer.unref?.();
  }
}

module.exports = { Lobby, cleanName };
