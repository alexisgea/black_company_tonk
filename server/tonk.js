'use strict';
// Pure rules engine for Tonk (Black Company). No I/O, no networking.
// Card ids and the set/run rules live in ../shared/cards.js (also used by the browser).
const { rankOf, suitOf, cardValue, handTotal, isCard, classifyMeld, layoffEnd } = require('../shared/cards');

const HAND_SIZE = 5;
const TONK_LOW = 15; // total <= 15 is Tonk
const TONK_HIGH = 49; // total >= 49 is Tonk
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 5;

class GameError extends Error {}

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
  round.result = { hands, totals, ...result };
}

// Deals a new hand and immediately resolves Tonk. `dealerIdx` indexes into playerIds.
function startRound(playerIds, dealerIdx, rng = Math.random) {
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new GameError(`Tonk needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
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
    phase: 'draw', // 'draw': go down or take a card; 'play': meld / lay off / discard
    result: null,
  };

  const tonkers = playerIds.filter((id) => {
    const total = handTotal(hands[id]);
    return total <= TONK_LOW || total >= TONK_HIGH;
  });
  if (tonkers.length === 1) {
    const winner = tonkers[0];
    const deltas = zeroDeltas(playerIds);
    for (const id of playerIds) if (id !== winner) pay(deltas, id, winner, 2);
    finish(round, { type: 'tonk', winners: [winner], deltas });
  } else if (tonkers.length > 1) {
    finish(round, { type: 'tonkDraw', winners: tonkers, deltas: zeroDeltas(playerIds) });
  }
  return round;
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
  round.phase = 'draw';
}

function winByEmptyHand(round, pid) {
  const deltas = zeroDeltas(round.order);
  for (const id of round.order) if (id !== pid) pay(deltas, id, pid, 1);
  finish(round, { type: 'empty', actor: pid, winners: [pid], deltas });
}

function takeFromHand(round, pid, cards) {
  const hand = round.hands[pid];
  if (!cards.every(isCard) || new Set(cards).size !== cards.length) throw new GameError('Invalid cards');
  if (!cards.every((c) => hand.includes(c))) throw new GameError('You do not hold those cards');
  round.hands[pid] = hand.filter((c) => !cards.includes(c));
}

// Applies one player action. Returns an array of event objects describing what happened.
// Throws GameError for anything illegal, leaving the round unchanged.
function applyAction(round, pid, action) {
  if (round.result) throw new GameError('This hand is over');
  if (round.order[round.turn] !== pid) throw new GameError('Not your turn');
  if (!action || typeof action !== 'object') throw new GameError('Bad action');
  const events = [];

  switch (action.type) {
    case 'goDown': {
      if (round.phase !== 'draw') throw new GameError('You can only go down at the start of your turn');
      events.push({ type: 'goDown', pid, total: handTotal(round.hands[pid]) });
      goDown(round, pid);
      break;
    }
    case 'draw': {
      if (round.phase !== 'draw') throw new GameError('You already took a card');
      const reshuffled = refillDeck(round);
      if (round.deck.length === 0) throw new GameError('The draw pile is empty; take the discard instead');
      round.hands[pid].push(round.deck.pop());
      round.phase = 'play';
      if (reshuffled) events.push({ type: 'reshuffle' });
      events.push({ type: 'draw', pid });
      break;
    }
    case 'takeDiscard': {
      if (round.phase !== 'draw') throw new GameError('You already took a card');
      if (round.discard.length === 0) throw new GameError('The discard pile is empty');
      const card = round.discard.pop();
      round.hands[pid].push(card);
      round.phase = 'play';
      events.push({ type: 'takeDiscard', pid, card });
      break;
    }
    case 'meld': {
      if (round.phase !== 'play') throw new GameError('Take a card first');
      const cards = action.cards;
      if (!Array.isArray(cards)) throw new GameError('Invalid cards');
      const meld = classifyMeld(cards);
      if (!meld) throw new GameError('Not a valid set or run');
      takeFromHand(round, pid, cards);
      round.melds.push({ id: round.nextMeldId++, owner: pid, ...meld });
      events.push({ type: 'meld', pid, kind: meld.type, cards: meld.cards });
      if (round.hands[pid].length === 0) winByEmptyHand(round, pid);
      break;
    }
    case 'layoff': {
      if (round.phase !== 'play') throw new GameError('Take a card first');
      const meld = round.melds.find((m) => m.id === action.meldId);
      if (!meld) throw new GameError('No such spread');
      const card = action.card;
      if (!isCard(card) || !round.hands[pid].includes(card)) throw new GameError('You do not hold that card');
      const end = layoffEnd(meld, card);
      if (!end) throw new GameError('That card does not extend this spread');
      takeFromHand(round, pid, [card]);
      if (end === 'low') meld.cards.unshift(card);
      else meld.cards.push(card);
      events.push({ type: 'layoff', pid, card, meldId: meld.id });
      if (round.hands[pid].length === 0) winByEmptyHand(round, pid);
      break;
    }
    case 'discard': {
      if (round.phase !== 'play') throw new GameError('Take a card first');
      const card = action.card;
      if (!isCard(card) || !round.hands[pid].includes(card)) throw new GameError('You do not hold that card');
      takeFromHand(round, pid, [card]);
      round.discard.push(card);
      events.push({ type: 'discard', pid, card });
      if (round.hands[pid].length === 0) winByEmptyHand(round, pid);
      else advanceTurn(round);
      break;
    }
    default:
      throw new GameError('Unknown action');
  }
  return events;
}

// Players may reorder their own hand at any time; it never affects the game state.
function reorderHand(round, pid, cards) {
  if (round.result || !round.hands[pid]) throw new GameError('No hand to reorder');
  const hand = round.hands[pid];
  if (
    !Array.isArray(cards) ||
    cards.length !== hand.length ||
    new Set(cards).size !== cards.length ||
    !cards.every((c) => hand.includes(c))
  ) {
    throw new GameError('Invalid card order');
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

  if (round.order.length < MIN_PLAYERS) {
    finish(round, { type: 'aborted', winners: [], deltas: zeroDeltas(round.order) });
  } else if (idx < round.turn) {
    round.turn--;
  } else if (idx === round.turn) {
    round.turn %= round.order.length;
    round.phase = 'draw';
  }
}

// Snapshot for one viewer: own hand in full, opponents' hands only as counts until the hand ends.
function viewRound(round, viewerId) {
  const over = !!round.result;
  const players = {};
  for (const id of round.order) {
    const visible = over || id === viewerId;
    players[id] = {
      count: round.hands[id].length,
      total: visible ? handTotal(round.hands[id]) : null,
      hand: visible ? [...round.hands[id]] : null,
    };
  }
  return {
    order: [...round.order],
    turn: over ? null : round.order[round.turn],
    phase: round.phase,
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
  applyAction,
  reorderHand,
  removePlayer,
  viewRound,
};
