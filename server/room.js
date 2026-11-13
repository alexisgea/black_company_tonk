'use strict';
const crypto = require('crypto');
const tonk = require('./tonk');
const { pickBotName } = require('./botnames');

// Fields of each log event that every viewer (including guests) may see. Anything else is dropped,
// so a hidden card can never leak through the log. A draw from the pile deliberately has no card.
const PUBLIC_LOG_FIELDS = {
  join: ['pid', 'name'],
  leave: ['pid', 'name'],
  kick: ['pid', 'name'],
  deal: ['pid', 'hand'],
  draw: ['pid'],
  takeDiscard: ['pid', 'card'],
  discard: ['pid', 'card'],
  meld: ['pid', 'kind', 'cards'],
  layoff: ['pid', 'card', 'meldId'],
  goDown: ['pid', 'total'],
  broke: ['pid', 'name', 'bot'],
  reshuffle: [],
};
// What the host can change in the waiting room. `bet` is what one payoff unit is worth in coins
// (a plain win is 1 bet, a Tonk or a failed go-down is 2).
const DEFAULT_SETTINGS = { startingCoins: 50, bet: 1 };
const SETTING_LIMITS = {
  startingCoins: { min: 10, max: 10000, label: 'Starting coins' },
  bet: { min: 1, max: 1000, label: 'Bet' },
};
// A turn ends with a discard (or going down, which ends the hand).
const TURN_END_EVENTS = new Set(['discard', 'goDown']);
const MAX_LOG = 200; // hard cap for the waiting room, where there are no hands to trim by
const MAX_CHAT = 50;
const MAX_CHAT_LENGTH = 200;
const MAX_SPECTATORS = 20;
const DEFAULT_TONK_TIMEOUT_MS = 15000;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// Checks table settings from a client. Unknown fields are ignored; anything invalid is an error.
function validateSettings(raw) {
  if (!raw || typeof raw !== 'object') throw new tonk.GameError('Bad settings');
  const settings = {};
  for (const [key, { min, max, label }] of Object.entries(SETTING_LIMITS)) {
    const value = raw[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new tonk.GameError(`${label} must be a whole number from ${min} to ${max}`);
    }
    settings[key] = value;
  }
  if (settings.bet > settings.startingCoins) throw new tonk.GameError('The bet cannot be more than the starting coins');
  return settings;
}

// One table of players: seating, coins and the current hand.
class Room {
  constructor(id, name, rng = Math.random, { tonkTimeoutMs = DEFAULT_TONK_TIMEOUT_MS, settings = DEFAULT_SETTINGS } = {}) {
    this.id = id;
    this.name = name;
    this.rng = rng;
    this.settings = { ...settings };
    this.tonkTimeoutMs = tonkTimeoutMs; // how long a player has to press TONK! before it is done for them
    this.tonkDeadline = null; // epoch ms, only while a hand waits for TONK!
    this.players = []; // users, in seating order
    this.spectators = []; // guests who only watch and chat; they never see hidden cards
    this.hostId = null;
    this.status = 'waiting'; // 'waiting' (never dealt) | 'playing' | 'between' (hand finished)
    this.round = null;
    this.handNo = 0;
    this.dealerIdx = 0;
    this.coins = {}; // player id -> coins left
    this.newlyBroke = [];
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

  // Everyone with a connection to this table: human players and spectators.
  get audience() {
    return [...this.humans, ...this.spectators];
  }

  get watchable() {
    return this.spectators.length < MAX_SPECTATORS;
  }

  requirePlayer(user) {
    if (!this.players.includes(user)) throw new tonk.GameError('Spectators cannot do that');
  }

  // Adds a computer player. It has no connection; the lobby plays its turns.
  addBot() {
    const bot = {
      id: crypto.randomBytes(4).toString('hex'),
      name: pickBotName(new Set(this.players.map((p) => p.name)), this.rng),
      isBot: true,
      conn: null,
      room: null,
    };
    this.join(bot);
    return bot;
  }

  // Only between hands (or before the first one), so a hand is never cut short or changed under the players.
  removeBot(id) {
    const bot = this.players.find((p) => p.id === id && p.isBot);
    if (!bot) throw new tonk.GameError('No such bot');
    if (this.status === 'playing') throw new tonk.GameError('Bots can only be removed between hands');
    this.leave(bot);
  }

  // The log only needs to cover what a player could have missed by looking away: the current hand,
  // limited to the last full round (one turn per player) plus the turn in progress.
  addLog(event) {
    const pub = { seq: ++this.logSeq, type: event.type };
    for (const field of PUBLIC_LOG_FIELDS[event.type] ?? []) {
      pub[field] = Array.isArray(event[field]) ? [...event[field]] : event[field];
    }
    this.log.push(pub);
    this.trimLog();
  }

  trimLog() {
    let start = this.log.findLastIndex((e) => e.type === 'deal');
    let turnEnds = 0;
    for (let i = this.log.length - 1; i >= Math.max(start, 0); i--) {
      if (TURN_END_EVENTS.has(this.log[i].type) && ++turnEnds > this.players.length) {
        start = i + 1;
        break;
      }
    }
    if (start > 0) this.log.splice(0, start);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  join(user) {
    if (this.bannedIds.has(user.id)) throw new tonk.GameError('You were removed from this table by the host');
    if (!this.joinable) throw new tonk.GameError('That table cannot be joined right now');
    this.players.push(user);
    this.coins[user.id] = this.settings.startingCoins;
    if (!this.hostId) this.hostId = user.id;
    user.room = this;
    this.addLog({ type: 'join', pid: user.id, name: user.name });
  }

  watch(user) {
    if (this.bannedIds.has(user.id)) throw new tonk.GameError('You were removed from this table by the host');
    if (!this.watchable) throw new tonk.GameError('This table has too many spectators');
    this.spectators.push(user);
    user.room = this;
  }

  // `reason` is the log event type: 'leave' normally, 'kick' when the host removes a player.
  leave(user, reason = 'leave') {
    const spectatorIdx = this.spectators.indexOf(user);
    if (spectatorIdx !== -1) {
      this.spectators.splice(spectatorIdx, 1);
      user.room = null;
      return;
    }
    const idx = this.players.indexOf(user);
    if (idx === -1) return;
    this.addLog({ type: reason, pid: user.id, name: user.name });
    this.players.splice(idx, 1);
    delete this.coins[user.id];
    user.room = null;
    if (this.hostId === user.id) this.hostId = this.humans[0]?.id ?? null;
    if (this.status === 'playing') {
      tonk.removePlayer(this.round, user.id);
      if (this.round.result) this.settle();
    }
  }

  // The host can change the settings until the first hand is dealt. Everyone's coins are reset to the new pool.
  updateSettings(user, raw) {
    this.requirePlayer(user);
    if (this.status !== 'waiting') throw new tonk.GameError('Settings can only be changed before the game starts');
    this.settings = validateSettings(raw);
    for (const p of this.players) this.coins[p.id] = this.settings.startingCoins;
  }

  startHand(user) {
    this.requirePlayer(user);
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
      { deferTonk: true },
    );
    this.status = 'playing';
    this.addLog({ type: 'deal', pid: this.players[this.dealerIdx].id, hand: this.handNo });
    this.tonkDeadline = this.round.phase === 'tonk' ? Date.now() + this.tonkTimeoutMs : null;
  }

  // Players who still have to press TONK! (everyone who holds a Tonk and has not declared yet).
  get pendingTonkers() {
    if (this.status !== 'playing' || this.round.phase !== 'tonk') return [];
    return this.players.filter((p) => this.round.tonkers.includes(p.id) && !this.round.declared.includes(p.id));
  }

  // Puts the player's cards down and shouts it in the chat. Called by the button, or automatically
  // for bots and when the timer runs out.
  declareTonk(user) {
    this.requirePlayer(user);
    if (this.status !== 'playing') throw new tonk.GameError('No hand in progress');
    tonk.declareTonk(this.round, user.id);
    this.pushChat(user, 'TONK!');
    if (this.round.result) this.settle();
  }

  act(user, action) {
    this.requirePlayer(user);
    if (this.status !== 'playing') throw new tonk.GameError('No hand in progress');
    const events = tonk.applyAction(this.round, user.id, action);
    events.forEach((e) => this.addLog(e));
    if (this.round.result) this.settle();
  }

  addChat(user, raw) {
    if (!this.players.includes(user) && !this.spectators.includes(user)) throw new tonk.GameError('Not at this table');
    const text = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH) : '';
    if (!text) throw new tonk.GameError('Message is empty');
    return this.pushChat(user, text);
  }

  pushChat(user, text) {
    const message = { id: this.chatSeq++, pid: user.id, name: user.name, text };
    if (this.spectators.includes(user)) message.spectator = true;
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return message;
  }

  reorder(user, cards) {
    this.requirePlayer(user);
    if (this.status !== 'playing') throw new tonk.GameError('No hand in progress');
    tonk.reorderHand(this.round, user.id, cards);
  }

  // Turns the payoff units of a finished hand into coins. Nobody can pay more than they have, so when
  // a loser is short the winners split what that loser could actually pay, in proportion to their wins.
  payout(units) {
    const raw = {};
    for (const [id, delta] of Object.entries(units)) if (id in this.coins) raw[id] = delta * this.settings.bet;
    const entries = Object.entries(raw);
    const losers = entries.filter(([, d]) => d < 0);
    const winners = entries.filter(([, d]) => d > 0);
    const owed = losers.reduce((sum, [, d]) => sum - d, 0);
    const paid = losers.reduce((sum, [id, d]) => sum + Math.min(-d, this.coins[id]), 0);
    if (paid === owed) return raw;
    const deltas = { ...raw };
    for (const [id, d] of losers) deltas[id] = -Math.min(-d, this.coins[id]);
    const wonTotal = winners.reduce((sum, [, d]) => sum + d, 0);
    let left = paid;
    for (const [id, d] of winners) {
      deltas[id] = Math.floor((d * paid) / wonTotal);
      left -= deltas[id];
    }
    for (let i = 0; left > 0; i = (i + 1) % winners.length, left--) deltas[winners[i][0]]++; // spread the rounding leftovers
    return deltas;
  }

  settle() {
    const result = this.round.result;
    result.deltas = this.payout(result.deltas);
    for (const [id, delta] of Object.entries(result.deltas)) this.coins[id] += delta;
    result.names = Object.fromEntries(this.round.order.map((id) => [id, this.nameOfPlayer(id)]));
    const broke = this.players.filter((p) => this.coins[p.id] <= 0);
    result.broke = broke.map((p) => ({ id: p.id, bot: !!p.isBot }));
    this.status = 'between';
    for (const user of broke) this.sendBroke(user);
    this.newlyBroke.push(...broke);
  }

  // The players the last hand left without coins, once; the lobby uses this to tell them.
  takeBroke() {
    return this.newlyBroke.splice(0);
  }

  nameOfPlayer(id) {
    return this.players.find((p) => p.id === id)?.name ?? this.spectators.find((s) => s.id === id)?.name ?? 'Someone';
  }

  // A player with no coins left cannot play on: bots are sent away, humans keep watching as guests.
  sendBroke(user) {
    this.addLog({ type: 'broke', pid: user.id, name: user.name, bot: !!user.isBot });
    this.players.splice(this.players.indexOf(user), 1);
    delete this.coins[user.id];
    if (user.isBot) {
      user.room = null;
    } else {
      this.spectators.push(user);
      if (this.hostId === user.id) this.hostId = this.humans[0]?.id ?? null;
    }
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.map((p) => p.name),
      max: tonk.MAX_PLAYERS,
      status: this.status,
      joinable: this.joinable,
      watchable: this.watchable,
      spectators: this.spectators.length,
      startingCoins: this.settings.startingCoins,
      bet: this.settings.bet,
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
        settings: { ...this.settings },
        settingLimits: SETTING_LIMITS,
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          coins: this.coins[p.id],
          connected: p.isBot || !!p.conn,
          isBot: !!p.isBot,
        })),
        spectators: this.spectators.map((s) => ({ id: s.id, name: s.name, connected: !!s.conn })),
        round: this.round ? tonk.viewRound(this.round, user.id) : null,
        tonkMsLeft: this.pendingTonkers.length ? Math.max(0, this.tonkDeadline - Date.now()) : null,
        log: this.log,
        chat: this.chat,
      },
    };
  }
}

module.exports = { Room, DEFAULT_SETTINGS, SETTING_LIMITS, validateSettings };
