'use strict';
// Pure rules engine for Tonk (Black Company). No I/O, no networking.
// Card ids and the set/run rules live in ../shared/cards.js (also used by the browser).
const { rankOf, suitOf, cardValue, handTotal, isCard, classifyMeld, layoffEnd, cheatLayoffEnd } = require('../shared/cards');
const { text } = require('./i18n');

const HAND_SIZE = 5;
const TONK_LOW = 15; // total <= 15 is Tonk
const TONK_HIGH = 49; // total >= 49 is Tonk
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const PAY_CAUGHT_CHEATING = 2; // a caught cheater pays every other player this much; a wrong accuser pays the accused the same
// Cheats are moves a computer player may make besides the honest ones. They leave no entry in the log (only the
// ordinary ones for what physically happened), so the table can only notice them. See applyAction.
const CHEAT_ACTIONS = new Set(['cheatPalm', 'cheatLayoff', 'cheatTakeUnder', 'cheatMeld']);

// An illegal move or request. `code` names the English message under "err." in public/locales/en.json; the
// client translates it from the code and `params`, and shows `message` (English) when it does not know the code.
class GameError extends Error {
  constructor(code, params) {
    super(text(`err.${code}`, params));
    this.code = code;
    if (params) this.params = params;
  }
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const newDeck = (rng) => shuffle([...Array(52).keys()], rng);

function pay(deltas, payer, payee, amount) {
  deltas[payer] = (deltas[payer] || 0) - amount;
  deltas[payee] = (deltas[payee] || 0) + amount;
}

function zeroDeltas(order) {
  return Object.fromEntries(order.map((id) => [id, 0]));
}

function finish(round, result) {
  const totals = {};
  const hands = {};
  for (const id of round.order) {
    hands[id] = [...round.hands[id]];
    totals[id] = handTotal(round.hands[id]);
  }
  // Every cheat of the hand is revealed once it is over, caught or not.
  round.result = { hands, totals, cheats: (round.cheats ?? []).map((cheat) => ({ ...cheat })), ...result };
}

const recordCheat = (round, pid, kind, extra = {}) => {
  (round.cheats ??= []).push({ pid, kind, ...extra });
  round.cheatedThisTurn = true;
};

const findTonkers = (round) =>
  round.order.filter((id) => {
    const total = handTotal(round.hands[id]);
    return total <= TONK_LOW || total >= TONK_HIGH;
  });

function resolveTonk(round) {
  const tonkers = findTonkers(round);
  if (tonkers.length === 1) {
    const winner = tonkers[0];
    const deltas = zeroDeltas(round.order);
    for (const id of round.order) if (id !== winner) pay(deltas, id, winner, 2);
    finish(round, { type: 'tonk', winners: [winner], deltas });
  } else if (tonkers.length > 1) {
    finish(round, { type: 'tonkDraw', winners: tonkers, deltas: zeroDeltas(round.order) });
  }
}

// Deals a new hand. `dealerIdx` indexes into playerIds. A Tonk is resolved immediately, unless
// `deferTonk` is set: then the round waits in the 'tonk' phase until every tonker calls declareTonk.
function startRound(playerIds, dealerIdx, rng = Math.random, { deferTonk = false } = {}) {
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new GameError('playerCount', { min: MIN_PLAYERS, max: MAX_PLAYERS });
  }
  const deck = newDeck(rng);
  const hands = {};
  for (const id of playerIds) hands[id] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    for (const id of playerIds) hands[id].push(deck.pop());
  }
  const round = {
    order: [...playerIds],
    hands,
    deck,
    discard: [deck.pop()],
    melds: [],
    nextMeldId: 1,
    turn: (dealerIdx + 1) % playerIds.length,
    dealer: playerIds[dealerIdx % playerIds.length], // who dealt, and who plays first: kept as ids because seats come and go
    first: playerIds[(dealerIdx + 1) % playerIds.length],
    turnNo: 0, // counts turn changes, so a timer can tell "the same turn" from "the same player's next turn"
    // 'tonk': waiting for the tonkers to declare; 'draw': go down or take a card; 'play': spread / lay off / discard
    phase: 'draw',
    tonkers: [], // who must declare (only in the 'tonk' phase)
    declared: [], // who already has
    cheats: [], // { pid, kind, ... } every cheat played this hand; only revealed in the result
    cheatedThisTurn: false,
    result: null,
  };

  const tonkers = findTonkers(round);
  if (deferTonk && tonkers.length) {
    round.phase = 'tonk';
    round.tonkers = tonkers;
  } else {
    resolveTonk(round);
  }
  return round;
}

// A player with Tonk puts their cards down. Once every tonker has, the hand is resolved.
function declareTonk(round, pid) {
  if (round.result || round.phase !== 'tonk') throw new GameError('noTonkNeeded');
  if (!round.tonkers.includes(pid)) throw new GameError('notTonker');
  if (round.declared.includes(pid)) throw new GameError('alreadyDeclared');
  round.declared.push(pid);
  if (round.declared.length === round.tonkers.length) resolveTonk(round);
}

// After a player left during the 'tonk' phase: drop them from the pending tonkers.
function syncTonk(round) {
  round.tonkers = findTonkers(round);
  round.declared = round.declared.filter((id) => round.tonkers.includes(id));
  if (round.tonkers.length === 0) round.phase = 'draw';
  else if (round.declared.length === round.tonkers.length) resolveTonk(round);
  else round.phase = 'tonk';
}

function goDown(round, pid) {
  const totals = {};
  for (const id of round.order) totals[id] = handTotal(round.hands[id]);
  const mine = totals[pid];
  const others = round.order.filter((id) => id !== pid);
  const deltas = zeroDeltas(round.order);
  const success = others.every((id) => totals[id] > mine);
  if (success) {
    for (const id of others) pay(deltas, id, pid, 1);
  } else {
    // Goer pays double to everyone at or below their total; everyone else pays the lowest hand(s).
    const lowest = Math.min(...others.map((id) => totals[id]));
    const lowestIds = others.filter((id) => totals[id] === lowest);
    for (const id of others) {
      if (totals[id] <= mine) pay(deltas, pid, id, 2);
      else for (const w of lowestIds) pay(deltas, id, w, 1);
    }
  }
  const winners = success ? [pid] : others.filter((id) => totals[id] <= mine);
  finish(round, { type: 'down', actor: pid, success, winners, deltas });
}

function refillDeck(round) {
  if (round.deck.length === 0 && round.discard.length > 1) {
    const top = round.discard.pop();
    round.deck = shuffle(round.discard);
    round.discard = [top];
    return true;
  }
  return false;
}

function advanceTurn(round) {
  round.turn = (round.turn + 1) % round.order.length;
  round.turnNo++;
  round.phase = 'draw';
  round.cheatedThisTurn = false;
}

function winByEmptyHand(round, pid) {
  const deltas = zeroDeltas(round.order);
  for (const id of round.order) if (id !== pid) pay(deltas, id, pid, 2);
  finish(round, { type: 'empty', actor: pid, winners: [pid], deltas });
}

function takeFromHand(round, pid, cards) {
  const hand = round.hands[pid];
  if (!cards.every(isCard) || new Set(cards).size !== cards.length) throw new GameError('invalidCards');
  if (!cards.every((c) => hand.includes(c))) throw new GameError('cardsNotHeld');
  round.hands[pid] = hand.filter((c) => !cards.includes(c));
}

// Applies one player action. Returns an array of event objects describing what happened.
// Throws GameError for anything illegal, leaving the round unchanged.
function applyAction(round, pid, action) {
  if (round.result) throw new GameError('handOver');
  if (round.phase === 'tonk') throw new GameError('waitingForTonk');
  if (round.order[round.turn] !== pid) throw new GameError('notYourTurn');
  if (!action || typeof action !== 'object') throw new GameError('badAction');
  const events = [];

  switch (action.type) {
    case 'goDown': {
      if (round.phase !== 'draw') throw new GameError('goDownTiming');
      if (round.cheatedThisTurn) throw new GameError('goDownAfterCheat');
      events.push({ type: 'goDown', pid, total: handTotal(round.hands[pid]) });
      goDown(round, pid);
      break;
    }
    case 'draw': {
      if (round.phase !== 'draw') throw new GameError('alreadyDrew');
      const reshuffled = refillDeck(round);
      if (round.deck.length === 0) throw new GameError('drawPileEmpty');
      round.hands[pid].push(round.deck.pop());
      round.phase = 'play';
      if (reshuffled) events.push({ type: 'reshuffle' });
      events.push({ type: 'draw', pid });
      break;
    }
    case 'takeDiscard': {
      if (round.phase !== 'draw') throw new GameError('alreadyDrew');
      if (round.discard.length === 0) throw new GameError('discardPileEmpty');
      const card = round.discard.pop();
      round.hands[pid].push(card);
      round.phase = 'play';
      events.push({ type: 'takeDiscard', pid, card });
      break;
    }
    case 'meld': {
      if (round.phase !== 'play') throw new GameError('drawFirst');
      const cards = action.cards;
      if (!Array.isArray(cards)) throw new GameError('invalidCards');
      const meld = classifyMeld(cards);
      if (!meld) throw new GameError('invalidMeld');
      takeFromHand(round, pid, cards);
      round.melds.push({ id: round.nextMeldId++, owner: pid, ...meld });
      events.push({ type: 'meld', pid, kind: meld.type, cards: meld.cards });
      if (round.hands[pid].length === 0) winByEmptyHand(round, pid);
      break;
    }
    case 'layoff': {
      if (round.phase !== 'play') throw new GameError('drawFirst');
      const meld = round.melds.find((m) => m.id === action.meldId);
      if (!meld) throw new GameError('noSuchMeld');
      const card = action.card;
      if (!isCard(card) || !round.hands[pid].includes(card)) throw new GameError('cardNotHeld');
      const end = layoffEnd(meld, card);
      if (!end) throw new GameError('layoffMismatch');
      takeFromHand(round, pid, [card]);
      if (end === 'low') meld.cards.unshift(card);
      else meld.cards.push(card);
      events.push({ type: 'layoff', pid, card, meldId: meld.id });
      if (round.hands[pid].length === 0) winByEmptyHand(round, pid);
      break;
    }
    case 'discard': {
      if (round.phase !== 'play') throw new GameError('drawFirst');
      const card = action.card;
      if (!isCard(card) || !round.hands[pid].includes(card)) throw new GameError('cardNotHeld');
      takeFromHand(round, pid, [card]);
      round.discard.push(card);
      events.push({ type: 'discard', pid, card });
      if (round.hands[pid].length === 0) winByEmptyHand(round, pid);
      else advanceTurn(round);
      break;
    }
    case 'cheatPalm': {
      // Slips the card up a sleeve, before or after drawing: it is out of the game, and the hand is one card short with
      // nothing on the table to show for it.
      const card = action.card;
      if (!isCard(card) || !round.hands[pid].includes(card)) throw new GameError('cardNotHeld');
      if (round.hands[pid].length < 3) throw new GameError('badAction');
      if (!round.order.some((id) => id !== pid && round.hands[id].length === round.hands[pid].length - 1)) throw new GameError('badAction');
      takeFromHand(round, pid, [card]);
      recordCheat(round, pid, 'palm', { card });
      break;
    }
    case 'cheatMeld': {
      if (round.phase !== 'play') throw new GameError('drawFirst');
      const { cards, card } = action;
      if (!Array.isArray(cards) || cards.length !== 2 || !isCard(card)) throw new GameError('invalidCards');
      const meld = classifyMeld([...cards, card]);
      if (!meld) throw new GameError('invalidMeld');
      if (round.hands[pid].length < 3) throw new GameError('badAction');
      takeFromHand(round, pid, cards);
      round.melds.push({ id: round.nextMeldId++, owner: pid, ...meld });
      events.push({ type: 'meld', pid, kind: meld.type, cards: meld.cards });
      recordCheat(round, pid, 'meld', { card });
      break;
    }
    case 'cheatLayoff': {
      // Adds a card that does not belong to a run (see cheatLayoffEnd), and it stays there for everybody to see.
      if (round.phase !== 'play') throw new GameError('drawFirst');
      const meld = round.melds.find((m) => m.id === action.meldId);
      if (!meld) throw new GameError('noSuchMeld');
      const card = action.card;
      if (!isCard(card) || !round.hands[pid].includes(card)) throw new GameError('cardNotHeld');
      const cheat = cheatLayoffEnd(meld, card);
      if (!cheat || round.hands[pid].length < 2) throw new GameError('layoffMismatch');
      takeFromHand(round, pid, [card]);
      if (cheat.end === 'low') meld.cards.unshift(card);
      else meld.cards.push(card);
      events.push({ type: 'layoff', pid, card, meldId: meld.id });
      recordCheat(round, pid, cheat.kind === 'suit' ? 'layoffSuit' : 'layoffGap', { card });
      break;
    }
    case 'cheatTakeUnder': {
      // Takes the card under the top of the discard pile; the top card stays where it is.
      if (round.phase !== 'draw') throw new GameError('alreadyDrew');
      if (round.discard.length < 2) throw new GameError('discardPileEmpty');
      const [card] = round.discard.splice(round.discard.length - 2, 1);
      round.hands[pid].push(card);
      round.phase = 'play';
      events.push({ type: 'takeDiscard', pid, card });
      recordCheat(round, pid, 'takeUnder', { card });
      break;
    }
    default:
      throw new GameError('unknownAction');
  }
  return events;
}

// `accuser` says `target` has cheated during this hand. Right: the hand ends and the cheater pays every other player
// double. Wrong: nothing happens to the hand here (the room makes the accuser pay). Returns whether the accusation was right.
function accuse(round, accuser, target) {
  if (round.result) throw new GameError('handOver');
  if (round.phase === 'tonk') throw new GameError('waitingForTonk');
  if (accuser === target || !round.order.includes(accuser) || !round.order.includes(target)) throw new GameError('badAccusation');
  if (!(round.cheats ?? []).some((cheat) => cheat.pid === target)) return false;
  const deltas = zeroDeltas(round.order);
  const others = round.order.filter((id) => id !== target);
  for (const id of others) pay(deltas, target, id, PAY_CAUGHT_CHEATING);
  finish(round, { type: 'caught', actor: accuser, cheater: target, winners: others, deltas });
  return true;
}

// Players may reorder their own hand at any time; it never affects the game state.
function reorderHand(round, pid, cards) {
  if (!round.hands[pid]) throw new GameError('noHandToReorder');
  const hand = round.hands[pid];
  if (
    !Array.isArray(cards) ||
    cards.length !== hand.length ||
    new Set(cards).size !== cards.length ||
    !cards.every((c) => hand.includes(c))
  ) {
    throw new GameError('invalidOrder');
  }
  round.hands[pid] = [...cards];
}

// Removes a player mid-hand. Their cards go to the bottom of the draw pile.
// With fewer than two players left the hand is aborted with no payoff.
function removePlayer(round, pid) {
  const idx = round.order.indexOf(pid);
  if (idx === -1 || round.result) return;
  round.deck.unshift(...round.hands[pid]);
  delete round.hands[pid];
  round.order.splice(idx, 1);
  if (round.cheats) round.cheats = round.cheats.filter((cheat) => cheat.pid !== pid);

  if (round.order.length < MIN_PLAYERS) {
    finish(round, { type: 'aborted', winners: [], deltas: zeroDeltas(round.order) });
    return;
  }
  const wasTonk = round.phase === 'tonk';
  if (idx < round.turn) {
    round.turn--;
  } else if (idx === round.turn) {
    round.turn %= round.order.length;
    round.turnNo++;
    round.phase = 'draw';
    round.cheatedThisTurn = false;
  }
  if (wasTonk) syncTonk(round);
}

// Hands a seat to someone else mid-hand: same cards, same place in the turn order, new id.
function renamePlayer(round, oldId, newId) {
  if (!round.hands[oldId]) return;
  const swap = (ids) => ids.map((id) => (id === oldId ? newId : id));
  round.order = swap(round.order);
  round.tonkers = swap(round.tonkers);
  round.declared = swap(round.declared);
  if (round.dealer === oldId) round.dealer = newId;
  if (round.first === oldId) round.first = newId;
  round.hands[newId] = round.hands[oldId];
  delete round.hands[oldId];
  for (const meld of round.melds) if (meld.owner === oldId) meld.owner = newId;
  for (const cheat of round.cheats ?? []) if (cheat.pid === oldId) cheat.pid = newId;
}

// Snapshot for one viewer: own hand in full, opponents' hands only as counts until the hand ends
// (or until they declare TONK and put their cards down).
function viewRound(round, viewerId) {
  const over = !!round.result;
  const players = {};
  for (const id of round.order) {
    const visible = over || id === viewerId || round.declared.includes(id);
    players[id] = {
      count: round.hands[id].length,
      total: visible ? handTotal(round.hands[id]) : null,
      hand: visible ? [...round.hands[id]] : null,
    };
  }
  const tonkPhase = !over && round.phase === 'tonk';
  return {
    order: [...round.order],
    dealer: round.order.includes(round.dealer) ? round.dealer : null,
    first: round.order.includes(round.first) ? round.first : null,
    turn: over ? null : round.order[round.turn],
    phase: round.phase,
    mustDeclareTonk: tonkPhase && round.tonkers.includes(viewerId) && !round.declared.includes(viewerId),
    deckCount: round.deck.length,
    discardTop: round.discard.length ? round.discard[round.discard.length - 1] : null,
    melds: round.melds.map((m) => ({ id: m.id, owner: m.owner, type: m.type, cards: [...m.cards] })),
    players,
    result: round.result,
  };
}

module.exports = {
  HAND_SIZE,
  MIN_PLAYERS,
  MAX_PLAYERS,
  GameError,
  rankOf,
  suitOf,
  cardValue,
  handTotal,
  classifyMeld,
  layoffEnd,
  startRound,
  declareTonk,
  applyAction,
  accuse,
  CHEAT_ACTIONS,
  PAY_CAUGHT_CHEATING,
  reorderHand,
  removePlayer,
  renamePlayer,
  viewRound,
};
