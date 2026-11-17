'use strict';
// What one computer player remembers about the current hand. It is fed only the public log events (the same ones a
// human reads in the log) plus the starting discard, so it can never know more than a human at the table could.
//
// Memory works like this: everything from the last full round (one turn per player) is remembered perfectly; any
// older fact (a discard, or a card someone took from the pile) is kept or forgotten by a single roll of the bot's
// memory, made the first time the bot looks at it, so a forgotten card stays forgotten.

const { BLUR_SPOTS, OWN_MISS_RATIO, PANIC_PER_MOOD_SWING } = require('./bottuning');

class Mind {
  // `profile` is the character as profileFor (botprofiles.js) gives it: memory, calculating, focus, observant, boldness, moodSwing.
  constructor(id, profile, rng = Math.random) {
    this.id = id;
    this.profile = profile;
    this.boldness = profile.boldness; // how bold it feels right now: its character plus its mood (set by the room)
    this.rng = rng;
    this.start({ order: [], discardTop: null });
  }

  // What the character's numbers mean for one specific slip or habit:
  get sloppiness() {
    return 1 - this.profile.observant; // noise on the discard scores
  }

  get ownMiss() {
    return (1 - this.profile.observant) * OWN_MISS_RATIO; // the chance of overlooking a card for its own spread
  }

  get blur() {
    return 1 - this.profile.memory; // the chance that an old memory has the wrong suit
  }

  get panic() {
    return this.profile.moodSwing * PANIC_PER_MOOD_SWING; // the chance of panicking when an opponent is nearly out
  }

  // Is it looking at what the others are doing this turn? (A tunnel-vision bot often is not.) Rolled once per turn.
  watching() {
    return this.decide('focus', 'others');
  }

  // A new hand: forget everything. `view` is what a human sees at the deal (the starting discard counts as a discard).
  start(view) {
    this.order = [...view.order];
    this.turnEnds = 0; // finished turns so far; ages everything else
    this.reshuffles = 0; // how often the draw pile has run out and been refilled
    this.drops = []; // every discard of this hand, in order: { card, pid, t, onPile, passedBy, remembered }
    this.held = new Map(); // player id -> { card, t, remembered } for cards they took from the pile and have not put down
    this.rolls = new Map(); // this turn's skill rolls, so a bot does not re-roll the same question within a turn
    if (view.discardTop !== null) this.drops.push(this.drop(view.discardTop, null));
  }

  drop(card, pid) {
    return { card, pid, t: this.turnEnds, onPile: true, passedBy: new Set(), remembered: undefined };
  }

  get pile() {
    return this.drops.filter((d) => d.onPile);
  }

  get pileSize() {
    return this.pile.length;
  }

  top() {
    return this.drops.findLast((d) => d.onPile);
  }

  observe(event) {
    switch (event.type) {
      case 'draw': {
        // Drawing from the draw pile means they did not want the discard they could have taken.
        if (event.pid !== this.id) this.top()?.passedBy.add(event.pid);
        break;
      }
      case 'takeDiscard': {
        const top = this.top();
        if (top) top.onPile = false;
        if (event.pid !== this.id) this.holding(event.pid).push({ card: event.card, t: this.turnEnds, remembered: undefined });
        break;
      }
      case 'discard': {
        this.release(event.pid, event.card);
        this.turnEnds++;
        this.rolls.clear();
        this.drops.push(this.drop(event.card, event.pid));
        break;
      }
      case 'meld':
        for (const card of event.cards) this.release(event.pid, card);
        break;
      case 'layoff':
        this.release(event.pid, event.card);
        break;
      case 'reshuffle': {
        // The discards go back into the draw pile: only the top card stays on the pile.
        const top = this.top();
        for (const d of this.drops) d.onPile = d === top;
        this.reshuffles++;
        break;
      }
      case 'leave':
      case 'kick':
        this.held.delete(event.pid);
        this.order = this.order.filter((id) => id !== event.pid);
        break;
    }
  }

  // A seat changed hands (a guest took over a bot): the same cards, a new id.
  rename(oldId, newId) {
    if (this.id === oldId) this.id = newId;
    this.order = this.order.map((id) => (id === oldId ? newId : id));
    if (this.held.has(oldId)) {
      this.held.set(newId, this.held.get(oldId));
      this.held.delete(oldId);
    }
    for (const d of this.drops) {
      if (d.pid === oldId) d.pid = newId;
      if (d.passedBy.delete(oldId)) d.passedBy.add(newId);
    }
  }

  holding(pid) {
    if (!this.held.has(pid)) this.held.set(pid, []);
    return this.held.get(pid);
  }

  release(pid, card) {
    const cards = this.held.get(pid);
    const idx = cards?.findIndex((h) => h.card === card) ?? -1;
    if (idx !== -1) cards.splice(idx, 1);
  }

  // Is this fact still in the bot's head? (A fact is anything with `t` and `remembered`.)
  recalls(fact) {
    if (this.turnEnds - fact.t < this.order.length) return true;
    if (fact.remembered === undefined) fact.remembered = this.rng() < this.profile.memory;
    return fact.remembered;
  }

  // What the bot thinks `fact` was. Now and then an old fact is half remembered: it knows a king went by, but gets the suit wrong.
  shown(fact) {
    if (!this.blur || this.turnEnds - fact.t < this.order.length) return fact.card;
    if (fact.blurred === undefined) {
      const suit = Math.floor(this.rng() * BLUR_SPOTS);
      fact.blurred = this.rng() < this.blur ? suit * 13 + (fact.card % 13) : null;
    }
    return fact.blurred ?? fact.card;
  }

  // Cards the bot knows lie in the discard pile (the top card is always in view).
  pileCards() {
    const pile = this.pile;
    const top = pile[pile.length - 1];
    return pile.filter((d) => d === top || this.recalls(d)).map((d) => (d === top ? d.card : this.shown(d)));
  }

  // Cards it knows a player took from the pile and still holds.
  heldBy(pid) {
    return (this.held.get(pid) ?? []).filter((h) => this.recalls(h)).map((h) => this.shown(h));
  }

  // Cards a player has thrown away or turned down (drew from the draw pile instead of taking them): what they do not collect.
  evidenceAgainst(pid) {
    return this.drops.filter((d) => (d.pid === pid || d.passedBy.has(pid)) && this.recalls(d)).map((d) => this.shown(d));
  }

  // Rolls a profile value (a probability from 0 to 1: calculating, focus...) for something, once per turn per `key`.
  decide(quality, key = '') {
    const k = `${quality}:${key}`;
    if (!this.rolls.has(k)) this.rolls.set(k, this.rng() < this.profile[quality]);
    return this.rolls.get(k);
  }

  // The same for a plain probability (a habit or a slip), rolled once per turn per `key`. Zero never happens and costs no roll.
  chance(key, probability) {
    if (!(probability > 0)) return false;
    const k = `chance:${key}`;
    if (!this.rolls.has(k)) this.rolls.set(k, this.rng() < probability);
    return this.rolls.get(k);
  }
}

module.exports = { Mind };
