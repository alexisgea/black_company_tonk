'use strict';
const crypto = require('crypto');
const { Room, validatePassword } = require('./room');
const { GameError } = require('./tonk');
const { legacyAction, fallbackAction } = require('./bot');
const { profileFor, botCatalog } = require('./botprofiles');
const { THINK_DRAW, THINK_PLAY, THINK_JITTER_MIN, THINK_JITTER_SPREAD, THINK_EFFORT_MIN, THINK_EFFORT_MAX } = require('./bottuning');
const { isReservedName } = require('./botnames');
const { describe } = require('./i18n');

const { RateLimiter } = require('./limits');
const { EMOTES, EMOTE_COOLDOWN_MS } = require('./emotes');

const OPEN = 1; // ws.OPEN
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_NAME = 20;
const CHAT_BURST = 5; // messages allowed per window
const CHAT_WINDOW_MS = 5000;
const PASSWORD_GUESSES = 5; // wrong table passwords allowed per window
const PASSWORD_WINDOW_MS = 60000;
const MAX_NUDGES = 3; // times the bots hurry a player along in one turn
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || null;
}

function requireRoom(room) {
  if (!room) throw new GameError('notAtTable');
}

// `code` is the error to raise for anyone but the host, one per action (e.g. 'hostOnlyLock'), so each reads naturally.
function requireHost(room, user, code) {
  requireRoom(room);
  if (room.hostId !== user.id) throw new GameError(code);
}

const DEVICE_ID = /^[\w-]{8,64}$/;
const cleanDevice = (raw) => (typeof raw === 'string' && DEVICE_ID.test(raw) ? raw : undefined);

// Tracks connected users and rooms, and routes protocol messages. Transport-agnostic:
// a "conn" only needs send(string), close() and a readyState.
class Lobby {
  // botDelayMs: base pause before a bot moves (divided by the character's thinkSpeed, see thinkMs). maxRooms / createsPerMinute: abuse limits.
  // dealMs: how long the clients take to show a deal (the cards fly out); bots wait for it before their first move.
  // roomIdleMs: a game nobody has touched for this long is closed (warning idleWarningMs before).
  // turnTimeoutMs: a connected player who takes longer than this on their turn is replaced by a bot (0 = never).
  // It only applies when at least two humans play; a lone human with bots is covered by roomIdleMs instead.
  // turnWarningMs: only the last part of the turn timeout is shown to the player as a countdown.
  // restartMs: when the last human player goes broke, the table stays open this long so they can restart it (0 = close at once).
  // nudgeMs: a connected human who has not moved after this long gets hurried along by a bot (0 = never).
  constructor({
    graceMs = 60000,
    rng = Math.random,
    botDelayMs = 1200,
    dealMs = botDelayMs * 3,
    maxRooms = 100,
    createsPerMinute = 5,
    roomIdleMs = 30 * 60000,
    idleWarningMs = 2 * 60000,
    tonkTimeoutMs = 15000,
    turnTimeoutMs = 120000,
    turnWarningMs = 60000,
    restartMs = 60000,
    nudgeMs = 25000,
  } = {}) {
    this.nudgeMs = nudgeMs;
    this.restartMs = restartMs;
    this.tonkTimeoutMs = tonkTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.turnWarningMs = Math.min(turnWarningMs, turnTimeoutMs);
    this.graceMs = graceMs;
    this.rng = rng;
    this.botDelayMs = botDelayMs;
    this.dealMs = dealMs;
    this.maxRooms = maxRooms;
    this.createsPerMinute = createsPerMinute;
    this.roomIdleMs = roomIdleMs;
    this.idleWarningMs = idleWarningMs;
    this.users = new Map(); // private token -> user
    this.rooms = new Map(); // room id -> Room
  }

  // Whether the turn timer runs at this table (see the constructor).
  turnTimerApplies(room) {
    return !!this.turnTimeoutMs && room.humans.length >= 2;
  }

  // A seat the server plays itself: a bot, a human who took too long on their turn (`away`, they get the seat back
  // by acting or pressing "take back control"), or a disconnected human (they keep the seat and get it back when
  // they reconnect; only the host can remove them). A disconnected human gets the full turn timer first, like a
  // connected one, so a dropped connection (say, a phone switching apps) does not cost them their turn at once.
  // Without a turn timer the server cannot wait, so a disconnected seat is played right away.
  isAuto(room, p) {
    return p.isBot || !!p.away || (!p.conn && !this.turnTimerApplies(room));
  }

  send(conn, obj) {
    if (conn && conn.readyState === OPEN) conn.send(JSON.stringify(obj));
  }

  sendError(conn, code, params) {
    this.send(conn, { t: 'error', ...describe('err', code, params) });
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
    if (this.handleBroke(room)) return;
    if (room.restartDeadline && room.humans.length > 0) this.endRestartWindow(room); // somebody sat down again
    this.scheduleBot(room); // first, so the views below already carry the new turn deadline
    for (const user of room.audience) this.send(user.conn, room.view(user));
  }

  // Tells the humans who just lost their last coin that they are guests now. If no human is left playing, the
  // table is closed, or kept open for restartMs for the ones who just lost. Returns true if it was closed.
  handleBroke(room) {
    const broke = room.takeBroke();
    if (broke.length && room.humans.length === 0) {
      // The last human player is out. Whoever is still connected gets a moment to see the last hand and restart the table.
      const staying = broke.filter((u) => !u.isBot && u.conn);
      if (!staying.length || !this.restartMs) {
        this.closeRoom(room, 'closedAllBroke');
        return true;
      }
      this.openRestartWindow(room, staying);
    }
    for (const user of broke) {
      if (user.isBot) continue;
      if (!user.conn) {
        // A disconnected player who lost their last coin has no grace timer running and nothing to come back to.
        this.leaveRoom(user);
        this.users.delete(user.token);
        continue;
      }
      this.send(user.conn, { t: 'broke', ...describe('notice', 'youAreBroke') });
    }
    return false;
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
    if (!this.isAuto(room, seat)) {
      this.scheduleNudge(room, seat);
      this.scheduleTurnTimer(room, seat);
      return;
    }
    this.clearTurnTimer(room);
    if (room.botTimer) return;
    room.botTimer = setTimeout(
      this.guarded('Bot turn', () => {
        room.botTimer = null;
        const bot = room.players.find((p) => this.isAuto(room, p) && p.id === turnId);
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
        const turnNo = room.round.turnNo;
        if (!this.botMove(room, bot)) {
          this.closeRoom(room, 'closedServerError');
          return;
        }
        // A bot only talks once its turn is over, and at most once per turn.
        const said = room.status === 'playing' && room.round.turnNo !== turnNo ? room.banter(bot) : null;
        if (said) for (const p of room.audience) this.send(p.conn, { t: 'chat', message: said });
        this.broadcastRoom(room);
        if (room.status !== 'playing') this.broadcastLobby();
      }),
      this.dealWaitMs(room) + this.thinkMs(room, seat, this.thinkEffort(room, seat)),
    );
    room.botTimer.unref?.();
  }

  // How long the clients are still busy showing the deal.
  dealWaitMs(room) {
    return Math.max(0, room.dealEndsAt - Date.now());
  }

  // How hard the seat's coming move is to decide (0 = obvious, 1 = a close call), so a bot ponders a marginal go-down
  // and fires off an obvious draw. The move itself is kept (see Room.botThink) and played when the pause is over.
  thinkEffort(room, seat) {
    try {
      return room.botThink(seat).effort;
    } catch {
      return 0.5; // the move itself is worked out (and its failure handled) when the pause is over
    }
  }

  // How long a computer player takes over this move: each character has its own pace, a draw takes a little
  // longer to think about than putting cards down, a close call takes longer than an obvious move, and no two
  // moves take exactly the same time.
  thinkMs(room, seat, effort = 0.5) {
    const pace = (room.round.phase === 'draw' ? THINK_DRAW : THINK_PLAY) / profileFor(seat).thinkSpeed;
    const ponder = THINK_EFFORT_MIN + effort * (THINK_EFFORT_MAX - THINK_EFFORT_MIN);
    return Math.round(this.botDelayMs * pace * ponder * (THINK_JITTER_MIN + Math.random() * THINK_JITTER_SPREAD));
  }

  // Plays one move for an auto-played seat: the smart player first, then the original simple one, then a plain
  // legal move, so a bug in the bot logic never freezes the table. Returns false only if all of them fail.
  botMove(room, bot) {
    const attempts = [() => room.botThink(bot).action, () => legacyAction(room.round, bot.id), () => fallbackAction(room.round, bot.id)];
    for (const choose of attempts) {
      try {
        room.act(bot, choose());
        return true;
      } catch (err) {
        console.error('Bot move failed:', err);
      }
    }
    return false;
  }

  // A human (connected or not) gets turnTimeoutMs for their turn; after that a bot takes over their seat (see isAuto).
  // The countdown restarts for each new turn, and when a returning player picks the seat back up mid-turn.
  // After a pause the turn carries on with the time it had left.
  scheduleTurnTimer(room, seat) {
    if (!this.turnTimerApplies(room)) {
      this.clearCountdown(room);
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
    if (!seat || this.isAuto(room, seat)) return;
    seat.away = true;
    room.addLog({ type: 'timeout', pid: seat.id, name: seat.name });
    this.broadcastRoom(room);
  }

  clearTurnTimer(room) {
    this.clearCountdown(room);
    this.clearNudge(room);
  }

  clearCountdown(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnKey = null;
    room.turnDeadline = null;
  }

  clearNudge(room) {
    clearTimeout(room.nudgeTimer);
    room.nudgeTimer = null;
    room.nudgeKey = null;
  }

  // While a connected human takes their turn, the bots grow impatient: every nudgeMs one of them says so, up to
  // MAX_NUDGES times a turn. Applies with or without the turn timer.
  scheduleNudge(room, seat) {
    if (!this.nudgeMs || !room.players.some((p) => p.isBot)) return;
    const key = `${room.handNo}:${room.round.turnNo}:${seat.id}`;
    if (room.nudgeKey === key) return;
    clearTimeout(room.nudgeTimer);
    room.nudgeKey = key;
    const wait = (count) => {
      room.nudgeTimer = setTimeout(
        this.guarded('Nudge', () => {
          room.nudgeTimer = null;
          if (!this.rooms.has(room.id) || room.nudgeKey !== key || room.paused) return;
          const said = room.nudge(this.rng);
          if (said) for (const p of room.audience) this.send(p.conn, { t: 'chat', message: said });
          if (count + 1 < MAX_NUDGES) wait(count + 1);
        }),
        this.nudgeMs,
      );
      room.nudgeTimer.unref?.();
    };
    wait(0);
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
    const auto = (p) => this.isAuto(room, p);
    if (!pending.some(auto)) {
      clearTimeout(room.tonkBotTimer);
      room.tonkBotTimer = null;
    } else if (!room.tonkBotTimer) {
      room.tonkBotTimer = setTimeout(
        this.guarded('Bot TONK', () => {
          room.tonkBotTimer = null;
          this.autoDeclare(room, auto);
        }),
        this.dealWaitMs(room) + this.botDelayMs,
      );
      room.tonkBotTimer.unref?.();
    }
    if (!pending.some((p) => !auto(p))) {
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

  // Keeps the table open for restartMs after its last human player went broke (see handleBroke).
  openRestartWindow(room, users) {
    room.restartIds = new Set(users.map((u) => u.id));
    room.restartDeadline = Date.now() + this.restartMs;
    clearTimeout(room.restartTimer);
    room.restartTimer = setTimeout(
      this.guarded('Restart window', () => {
        room.restartTimer = null;
        if (this.rooms.has(room.id) && room.restartDeadline) this.closeRoom(room, 'closedAllBroke');
      }),
      this.restartMs,
    );
    room.restartTimer.unref?.();
  }

  endRestartWindow(room) {
    clearTimeout(room.restartTimer);
    room.restartTimer = null;
    room.clearRestart();
  }

  deleteRoom(room) {
    clearTimeout(room.botTimer);
    clearTimeout(room.restartTimer);
    room.restartTimer = null;
    this.clearTonkTimer(room);
    this.clearTurnTimer(room);
    this.rooms.delete(room.id);
  }

  // Closes a game and sends everyone in it back to the lobby with an explanation (`code`: a "notice." message).
  // Members who are disconnected have nowhere to come back to, so they are forgotten instead of lingering in this.users.
  closeRoom(room, code) {
    const members = room.audience;
    this.deleteRoom(room);
    for (const user of members) {
      room.restoreName(user);
      user.room = null;
      user.away = false;
      if (user.conn) {
        this.send(user.conn, { t: 'closed', ...describe('notice', code) });
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
        this.closeRoom(room, 'closedIdle');
      } else if (!room.idleWarned && this.roomIdleMs > this.idleWarningMs && idle >= this.roomIdleMs - this.idleWarningMs) {
        room.idleWarned = true;
        const minutes = Math.max(1, Math.ceil((this.roomIdleMs - idle) / 60000));
        for (const user of room.audience) {
          this.send(user.conn, { t: 'notice', ...describe('notice', 'closeSoon', { minutes }) });
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
    room.restartIds.delete(user.id);
    // With nobody left who could restart the table, it is over (while someone can, the restart timer decides).
    if (room.humans.length === 0 && room.restartIds.size === 0 && room.spectators.length > 0) {
      this.closeRoom(room, 'closedEmpty');
      return;
    }
    if (room.humans.length === 0 && room.restartIds.size === 0) this.deleteRoom(room);
    else this.broadcastRoom(room);
    this.broadcastLobby();
  }

  handle(conn, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.sendError(conn, 'malformed');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      return this.sendError(conn, 'malformed');
    }
    try {
      if (msg.t === 'hello') return this.onHello(conn, msg);
      if (!conn.user) return this.sendError(conn, 'sayHello');
      this.onMessage(conn.user, msg);
    } catch (err) {
      if (err instanceof GameError) this.sendError(conn, err.code, err.params);
      else {
        console.error(err);
        this.sendError(conn, 'serverError');
      }
    }
  }

  onHello(conn, msg) {
    const name = cleanName(msg.name);
    if (!name) throw new GameError('nameRequired');
    if (isReservedName(name)) throw new GameError('nameReserved');
    let user = typeof msg.token === 'string' ? this.users.get(msg.token) : undefined;
    // A connection is one player. Another hello on it can only rename that player; it must not conjure up
    // extra users that stay behind (and count as "online") after the connection closes.
    if (conn.user && user && user !== conn.user) throw new GameError('connectionTaken');
    user ??= conn.user ?? undefined;
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
        chatLimiter: new RateLimiter(CHAT_BURST, CHAT_WINDOW_MS),
        emoteLimiter: new RateLimiter(1, EMOTE_COOLDOWN_MS),
        createLimiter: new RateLimiter(this.createsPerMinute, 60000),
        passwordLimiter: new RateLimiter(PASSWORD_GUESSES, PASSWORD_WINDOW_MS),
      };
      this.users.set(user.token, user);
    }
    user.device = cleanDevice(msg.device) ?? user.device;
    if (!user.room) user.name = name;
    user.conn = conn;
    conn.user = user;
    this.send(conn, {
      t: 'welcome',
      token: user.token,
      id: user.id,
      name: user.name,
      bots: botCatalog(),
      emotes: EMOTES,
      emoteCooldownMs: EMOTE_COOLDOWN_MS,
    });
    if (user.room) this.broadcastRoom(user.room);
    this.broadcastLobby(); // also tells everyone else in the lobby about the new head count
  }

  findRoom(gameId) {
    const r = typeof gameId === 'string' ? this.rooms.get(gameId.toUpperCase()) : null;
    if (!r) throw new GameError('tableGone');
    return r;
  }

  // Wrong guesses are rate limited per player so a locked table cannot be brute-forced (the limit applies to
  // right guesses too, otherwise "it still answers" would reveal the password).
  checkPassword(user, room, given) {
    if (room.locked && typeof given === 'string' && given !== '' && !user.passwordLimiter.hit()) {
      throw new GameError('tooManyPasswordTries');
    }
    room.checkPassword(given);
  }

  onMessage(user, msg) {
    const room = user.room;
    if (room && !room.spectators.includes(user)) room.touch(); // anything a player sends counts as using the game (watching does not)
    switch (msg.t) {
      case 'createGame': {
        if (room) throw new GameError('alreadySeated');
        if (this.rooms.size >= this.maxRooms) throw new GameError('serverFull');
        if (!user.createLimiter.hit()) throw new GameError('tooManyTables');
        const r = new Room(this.newRoomId(), `${user.name}'s table`, this.rng, {
          tonkTimeoutMs: this.tonkTimeoutMs,
          turnWarningMs: this.turnWarningMs,
          dealMs: this.dealMs,
          owner: user.name,
        });
        r.password = validatePassword(msg.password);
        this.rooms.set(r.id, r);
        r.join(user);
        this.broadcastAll(r);
        break;
      }
      case 'joinGame': {
        if (room) throw new GameError('alreadySeated');
        const r = this.findRoom(msg.gameId);
        this.checkPassword(user, r, msg.password);
        r.join(user);
        r.touch();
        this.broadcastAll(r);
        break;
      }
      case 'watchGame': {
        if (room) throw new GameError('alreadySeated');
        const r = this.findRoom(msg.gameId);
        this.checkPassword(user, r, msg.password);
        r.watch(user);
        this.broadcastAll(r);
        break;
      }
      case 'takeSeat': {
        requireRoom(room);
        room.takeSeat(user, msg.id);
        room.touch();
        this.broadcastAll(room);
        break;
      }
      case 'setPassword': {
        requireHost(room, user, 'hostOnlyLock');
        room.setPassword(user, msg.password);
        this.broadcastAll(room);
        break;
      }
      case 'kick': {
        requireHost(room, user, 'hostOnlyKick');
        const target = room.players.find((p) => p.id === msg.id && !p.isBot) ?? room.spectators.find((s) => s.id === msg.id);
        if (!target) throw new GameError('noSuchPlayer');
        if (target === user) throw new GameError('cannotKickSelf');
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
      case 'restartTable': {
        requireRoom(room);
        room.restart(user);
        this.endRestartWindow(room);
        room.touch();
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
      case 'accuse': {
        requireRoom(room);
        const resumed = this.resumeSeat(user);
        const wasPlaying = room.status === 'playing';
        this.actAndShowResume(room, resumed, () => room.accuse(user, msg.target));
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
        requireHost(room, user, msg.t === 'pause' ? 'hostOnlyPause' : 'hostOnlyResume');
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
        requireHost(room, user, 'hostOnlySettings');
        room.updateSettings(user, msg.settings);
        this.broadcastAll(room);
        break;
      }
      case 'addBot': {
        requireHost(room, user, 'hostOnlyAddBot');
        if (msg.botId === undefined || msg.botId === null) room.addRandomBot();
        else room.addBot(msg.botId);
        this.broadcastAll(room);
        break;
      }
      case 'removeBot': {
        requireHost(room, user, 'hostOnlyRemoveBot');
        room.removeBot(msg.id);
        this.broadcastAll(room);
        break;
      }
      case 'chat': {
        requireRoom(room);
        if (!user.chatLimiter.hit()) throw new GameError('chatTooFast');
        const message = room.addChat(user, msg.text);
        for (const p of room.audience) this.send(p.conn, { t: 'chat', message });
        break;
      }
      case 'emote': {
        requireRoom(room);
        if (!user.emoteLimiter.hit()) throw new GameError('emoteTooFast');
        const message = room.addEmote(user, msg.id);
        for (const p of room.audience) this.send(p.conn, { t: 'chat', message });
        break;
      }
      default:
        throw new GameError('unknownMessage');
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
      // Once the game has started a disconnected player keeps their seat (a bot plays for them), so they have
      // every chance to come back. Only the host removing them, or the table closing, ends it.
      if (room && room.status !== 'waiting' && room.players.includes(user)) return;
      this.leaveRoom(user);
      this.users.delete(user.token);
    }, this.graceMs);
    user.timer.unref?.();
  }
}

module.exports = { Lobby, cleanName };
