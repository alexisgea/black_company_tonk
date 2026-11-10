'use strict';
const tonk = require('./tonk');

const MAX_LOG = 60;

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
  }

  get joinable() {
    return this.status !== 'playing' && this.players.length < tonk.MAX_PLAYERS;
  }

  addLog(event) {
    this.log.push(event);
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  join(user) {
    if (!this.joinable) throw new tonk.GameError('That game cannot be joined right now');
    this.players.push(user);
    this.scores[user.id] = 0;
    if (!this.hostId) this.hostId = user.id;
    user.room = this;
    this.addLog({ type: 'join', pid: user.id, name: user.name });
  }

  leave(user) {
    const idx = this.players.indexOf(user);
    if (idx === -1) return;
    this.addLog({ type: 'leave', pid: user.id, name: user.name });
    if (this.status === 'playing') {
      tonk.removePlayer(this.round, user.id);
      if (this.round.result) this.settle();
    }
    this.players.splice(idx, 1);
    delete this.scores[user.id];
    user.room = null;
    if (this.hostId === user.id) this.hostId = this.players.length ? this.players[0].id : null;
  }

  startHand(user) {
    if (this.status === 'playing') throw new tonk.GameError('A hand is already in progress');
    if (this.status === 'waiting' && user.id !== this.hostId) {
      throw new tonk.GameError('Only the host can start the game');
    }
    if (this.players.length < tonk.MIN_PLAYERS) throw new tonk.GameError('Need at least 2 players');
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
    if (this.round.result) this.settle();
  }

  act(user, action) {
    if (this.status !== 'playing') throw new tonk.GameError('No hand in progress');
    const events = tonk.applyAction(this.round, user.id, action);
    events.forEach((e) => this.addLog(e));
    if (this.round.result) this.settle();
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
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          score: this.scores[p.id],
          connected: !!p.conn,
        })),
        round: this.round ? tonk.viewRound(this.round, user.id) : null,
        log: this.log,
      },
    };
  }
}

module.exports = { Room };
