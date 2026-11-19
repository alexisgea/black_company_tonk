'use strict';
// The dev table: bots only, one move at a time, with everybody's cards face up and the thinking behind every move.
// This is the engine; table.js serves it to a browser page.
const { Room } = require('../server/room');
const { smartThink, label } = require('../server/botsmart');
const { legacyAction, fallbackAction } = require('../server/bot');
const { PROFILES, BASE } = require('../server/botprofiles');
const { seeded, withSeededRandom, botName } = require('./sim');

const MAX_ENTRIES = 400;
const KNOBS = ['memory', 'calculating', 'tunnelVision', 'sloppiness', 'riskTaker', 'moodSwing'];
const cards = (list) => (list.length ? list.map(label).join(' ') : 'nothing');
const signed = (n) => (n > 0 ? `+${n}` : String(n));

class DevTable {
  // bots: character ids (each at most once, 2 to 5 of them).
  constructor({ bots, seed = Math.floor(Math.random() * 1e6), coins = 50, bet = 5 }) {
    if (new Set(bots).size !== bots.length) throw new Error('Each bot can sit at the table only once.');
    this.options = { bots: [...bots], seed, coins, bet };
    this.rng = seeded(seed);
    this.room = new Room('DEV', 'Dev table', this.rng, { settings: { startingCoins: coins, bet, cheating: true } });
    this.users = bots.map((botId) => ({ id: botId, botId, name: botName(botId), isBot: true, conn: null, room: null }));
    this.entries = [];
    this.seq = 0;
    withSeededRandom(this.rng, () => this.users.forEach((u) => this.room.join(u)));
  }

  push(entry) {
    this.entries.push({ id: ++this.seq, hand: this.room.handNo, ...entry });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  nameOf(id) {
    return this.users.find((u) => u.id === id)?.name ?? id;
  }

  // Does the next step: deal a hand, call a TONK, or let the player whose turn it is make its move.
  next() {
    return withSeededRandom(this.rng, () => {
      const { room } = this;
      if (room.status !== 'playing') this.deal();
      else if (room.round.phase === 'tonk') this.declareTonks();
      else this.move();
    });
  }

  deal() {
    const { room } = this;
    const returned = this.users.filter((u) => !room.players.includes(u));
    for (const user of returned) room.join(user);
    if (returned.length) {
      room.players.sort((a, b) => this.users.indexOf(a) - this.users.indexOf(b));
      this.push({ kind: 'note', text: `${returned.map((u) => u.name).join(', ')} came back with fresh coins after going broke.` });
    }
    room.startHand(room.players[0]);
    const dealer = room.players[room.dealerIdx];
    const first = room.players.find((p) => p.id === room.round.order[room.round.turn]);
    this.push({ kind: 'deal', text: `Hand ${room.handNo}: ${dealer.name} deals, ${first.name} plays first.` });
    for (const p of room.players) this.push({ kind: 'cards', text: `${p.name} is dealt: ${cards(room.round.hands[p.id])}` });
  }

  declareTonks() {
    const { room } = this;
    for (const p of room.pendingTonkers) {
      this.push({ kind: 'tonk', text: `${p.name} shouts TONK! with ${cards(room.round.hands[p.id])}.` });
      room.declareTonk(p);
    }
    if (room.status !== 'playing') this.pushResult();
  }

  move() {
    const { room } = this;
    const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
    const phase = room.round.phase;
    const before = [...room.round.hands[user.id]];
    const { view, mind } = room.botSight(user);
    const thinking = [];
    let action;
    let effort = null;
    const attempts = [
      () => {
        const think = smartThink(view, user.id, mind, thinking);
        effort = think.effort;
        return think.action;
      },
      () => legacyAction(room.round, user.id),
      () => fallbackAction(room.round, user.id),
    ];
    for (const [i, choose] of attempts.entries()) {
      try {
        action = choose();
        room.act(user, action);
        if (i > 0) thinking.push(`Played the ${i === 1 ? 'simple' : 'plain'} fallback move instead.`);
        break;
      } catch (err) {
        thinking.push(`${i === 0 ? 'THE SMART PLAYER FAILED' : 'The fallback failed too'}: ${err.message}`);
        if (i === attempts.length - 1) throw err;
      }
    }
    this.push({
      kind: 'move',
      player: user.id,
      name: user.name,
      phase,
      handBefore: before,
      action: this.describe(action, user, before),
      effort,
      thinking,
    });
    if (room.status !== 'playing') this.pushResult();
  }

  describe(action, user, before) {
    const hand = this.room.round.hands[user.id];
    switch (action.type) {
      case 'draw':
        return `draws ${label(hand.find((c) => !before.includes(c)))} from the pile`;
      case 'takeDiscard':
        return `takes ${label(hand.find((c) => !before.includes(c)) ?? this.room.round.discard.at(-1))} from the discard pile`;
      case 'goDown':
        return `GOES DOWN with ${this.room.round.result.totals[user.id]}`;
      case 'meld':
        return `puts down ${cards(action.cards)}`;
      case 'layoff':
        return `adds ${label(action.card)} to spread #${action.meldId}`;
      case 'discard':
        return `discards ${label(action.card)}`;
      case 'cheatPalm':
        return `CHEATS: palms ${label(action.card)}`;
      case 'cheatDiscard':
        return `CHEATS: discards ${cards(action.cards)} in one turn`;
      case 'cheatLayoff':
        return `CHEATS: adds ${label(action.card)} to spread #${action.meldId}, where it does not belong`;
      case 'cheatTakeUnder':
        return `CHEATS: takes ${label(hand.find((c) => !before.includes(c)))} from under the top discard`;
      default:
        return JSON.stringify(action);
    }
  }

  pushResult() {
    const { result } = this.room.round;
    const bits = this.users.map(
      (u) =>
        `${u.name} ${signed(result.deltas[u.id] ?? 0)} (${result.hands[u.id] ? `${cards(result.hands[u.id])} = ${result.totals[u.id]}` : 'broke'})`,
    );
    const how = {
      down: `${this.nameOf(result.actor)} went down and ${result.success ? 'won' : 'LOST'}`,
      empty: `${this.nameOf(result.actor)} emptied the hand`,
      tonk: `${this.nameOf(result.winners[0])} won with TONK`,
      tonkDraw: 'several Tonks: a draw',
      aborted: 'the hand was aborted',
      caught: `${this.nameOf(result.actor)} caught ${this.nameOf(result.cheater)} cheating`,
    }[result.type];
    this.push({ kind: 'result', text: `Hand over: ${how}. Coins: ${bits.join('; ')}.` });
  }

  // What the Next button will do, in words.
  upNext() {
    const { room } = this;
    if (room.status !== 'playing') return room.handNo === 0 ? 'Deal the first hand' : 'Deal the next hand';
    if (room.round.phase === 'tonk') return `${room.pendingTonkers.map((p) => p.name).join(', ')} declare TONK!`;
    const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
    return `${user.name} ${room.round.phase === 'draw' ? 'draws (or goes down)' : 'plays and discards'}`;
  }

  // Everything the page shows. Nothing is hidden: this is a developer's view.
  state() {
    const { room } = this;
    const round = room.round;
    const turn = room.status === 'playing' && round.phase !== 'tonk' ? round.order[round.turn] : null;
    const players = this.users.map((u) => {
      const seated = room.players.includes(u);
      const hand = round?.hands[u.id] ?? null;
      return {
        id: u.id,
        name: u.name,
        botId: u.botId,
        seated,
        coins: seated ? room.coins[u.id] : 0,
        hand,
        total: hand ? hand.reduce((sum, c) => sum + Math.min((c % 13) + 1, 10), 0) : null,
        turn: u.id === turn,
        knobs: Object.fromEntries(KNOBS.map((k) => [k, { ...BASE, ...(PROFILES[u.botId] ?? {}) }[k]])),
        boldness: room.minds.get(u.id)?.boldness ?? null,
        confidence: room.moods.get(u.id)?.confidence ?? 0,
      };
    });
    return {
      options: this.options,
      status: room.status,
      handNo: room.handNo,
      phase: round?.phase ?? null,
      deck: round?.deck.length ?? 0,
      discard: round?.discard ?? [],
      melds: (round?.melds ?? []).map((m) => ({ id: m.id, owner: this.nameOf(m.owner), type: m.type, cards: m.cards })),
      players,
      upNext: this.upNext(),
      entries: this.entries,
    };
  }
}

module.exports = { DevTable };
