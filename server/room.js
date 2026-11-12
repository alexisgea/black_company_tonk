'use strict';
const crypto = require('crypto');
const tonk = require('./tonk');

const MAX_LOG = 60;
const MAX_CHAT = 50;
const MAX_CHAT_LENGTH = 200;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// One table of players: seating, running scores and the current hand.
class Room {
  constructor(id, name, rng = Math.random) {
    this.id = id;
    this.name = name;
    this.rng = rng;
    this.players = []; // users, in seating order
    this.hostId = null;
    this.status = 'waiting'; // 'waiting' (never dealt) | 'playing' | 'between' (hand finished)
    this.round = null;
    this.handNo = 0;
    this.dealerIdx = 0;
    this.scores = {};
    this.log = [];
    this.logSeq = 0; // lets clients tell which events are new
    this.chat = [];
    this.chatSeq = 1;
    this.bannedIds = new Set(); // players the host removed; they cannot rejoin this game
    this.lastActivity = Date.now(); // last time a human did anything here (drives the idle timeout)
    this.idleWarned = false;
  }

  touch(now = Date.now()) {
    this.lastActivity = now;
    this.idleWarned = false;
  }

  get joinable() {
    return this.status !== 'playing' && this.players.length < tonk.MAX_PLAYERS;
  }

  get humans() {
    return this.players.filter((p) => !p.isBot);
  }

  // Adds a computer player. It has no connection; the lobby plays its turns.
  addBot() {
    const bots = this.players.filter((p) => p.isBot).length;
    const bot = {
      id: crypto.randomBytes(4).toString('hex'),
      name: `Bot ${bots + 1}`,
      isBot: true,
      conn: null,
      room: null,
    };
    this.join(bot);
    return bot;
  }

  // Allowed mid-hand too: the bot's cards leave play and the turn moves on (the hand is
  // cancelled with no payoff if fewer than two players would remain).
  removeBot(id) {
    const bot = this.players.find((p) => p.id === id && p.isBot);
    if (!bot) throw new tonk.GameError('No such bot');
    this.leave(bot);
  }

  addLog(event) {
    this.log.push({ seq: ++this.logSeq, ...event });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  join(user) {
    if (this.bannedIds.has(user.id)) throw new tonk.GameError('You were removed from this game by the host');
    if (!this.joinable) throw new tonk.GameError('That game cannot be joined right now');
    this.players.push(user);
    this.scores[user.id] = 0;
    if (!this.hostId) this.hostId = user.id;
    user.room = this;
    this.addLog({ type: 'join', pid: user.id, name: user.name });
  }

  // `reason` is the log event type: 'leave' normally, 'kick' when the host removes a player.
  leave(user, reason = 'leave') {
    const idx = this.players.indexOf(user);
    if (idx === -1) return;
    this.addLog({ type: reason, pid: user.id, name: user.name });
    if (this.status === 'playing') {
      tonk.removePlayer(this.round, user.id);
      if (this.round.result) this.settle();
    }
    this.players.splice(idx, 1);
    delete this.scores[user.id];
    user.room = null;
    if (this.hostId === user.id) this.hostId = this.humans[0]?.id ?? null;
  }

  startHand(user) {
    if (this.status === 'playing') throw new tonk.GameError('A hand is already in progress');
    if (this.status === 'waiting' && user.id !== this.hostId) {
      throw new tonk.GameError('Only the host can start the game');
    }
    if (this.players.length < tonk.MIN_PLAYERS) throw new tonk.GameError(`Need at least ${tonk.MIN_PLAYERS} players`);
    const n = this.players.length;
    this.dealerIdx = this.handNo === 0 ? Math.floor(this.rng() * n) : (this.dealerIdx + 1) % n;
    this.handNo++;
    this.round = tonk.startRound(
      this.players.map((p) => p.id),
      this.dealerIdx,
      this.rng,
    );
    this.status = 'playing';
    this.addLog({ type: 'deal', pid: this.players[this.dealerIdx].id, hand: this.handNo });
    if (this.round.result) {
      // Whoever was dealt a Tonk shouts it in the chat automatically.
      for (const id of this.round.result.winners) {
        const player = this.players.find((p) => p.id === id);
        if (player) this.pushChat(player, 'TONK!');
      }
      this.settle();
    }
  }

  act(user, action) {
    if (this.status !== 'playing') throw new tonk.GameError('No hand in progress');
    const events = tonk.applyAction(this.round, user.id, action);
    events.forEach((e) => this.addLog(e));
    if (this.round.result) this.settle();
  }

  addChat(user, raw) {
    if (!this.players.includes(user)) throw new tonk.GameError('Not in this game');
    const text = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH) : '';
    if (!text) throw new tonk.GameError('Message is empty');
    return this.pushChat(user, text);
  }

  pushChat(user, text) {
    const message = { id: this.chatSeq++, pid: user.id, name: user.name, text };
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return message;
  }

  reorder(user, cards) {
    if (this.status !== 'playing') throw new tonk.GameError('No hand in progress');
    tonk.reorderHand(this.round, user.id, cards);
  }

  settle() {
    for (const [id, delta] of Object.entries(this.round.result.deltas)) {
      if (id in this.scores) this.scores[id] += delta;
    }
    this.status = 'between';
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.map((p) => p.name),
      max: tonk.MAX_PLAYERS,
      status: this.status,
      joinable: this.joinable,
    };
  }

  view(user) {
    return {
      t: 'room',
      you: user.id,
      room: {
        id: this.id,
        name: this.name,
        hostId: this.hostId,
        status: this.status,
        handNo: this.handNo,
        dealerId: this.players[this.dealerIdx % this.players.length]?.id ?? null,
        minPlayers: tonk.MIN_PLAYERS,
        maxPlayers: tonk.MAX_PLAYERS,
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          score: this.scores[p.id],
          connected: p.isBot || !!p.conn,
          isBot: !!p.isBot,
        })),
        round: this.round ? tonk.viewRound(this.round, user.id) : null,
        log: this.log,
        chat: this.chat,
      },
    };
  }
}

module.exports = { Room };
