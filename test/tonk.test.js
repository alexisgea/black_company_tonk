'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/tonk');

// card id helper: rank 1-13, suit 'C' | 'D' | 'H' | 'S'
const c = (rank, suit) => 'CDHS'.indexOf(suit) * 13 + rank - 1;

// Builds a round in a known state, skipping the random deal.
function makeRound({ hands, deck = [c(2, 'S'), c(3, 'S'), c(4, 'S')], discard = [c(9, 'C')], melds = [], turn = 0, phase = 'draw' }) {
  const order = Object.keys(hands);
  return { order, hands, deck: [...deck], discard: [...discard], melds, nextMeldId: 10, turn, phase, result: null };
}

test('card values', () => {
  assert.equal(T.cardValue(c(1, 'S')), 1);
  assert.equal(T.cardValue(c(10, 'H')), 10);
  assert.equal(T.cardValue(c(13, 'D')), 10);
  assert.equal(T.handTotal([c(1, 'C'), c(5, 'D'), c(12, 'S')]), 16);
});

test('classifyMeld: sets and runs', () => {
  assert.equal(T.classifyMeld([c(8, 'C'), c(8, 'D'), c(8, 'H')]).type, 'set');
  assert.equal(T.classifyMeld([c(8, 'C'), c(8, 'D'), c(8, 'H'), c(8, 'S')]).type, 'set');
  const run = T.classifyMeld([c(11, 'S'), c(9, 'S'), c(10, 'S')]);
  assert.equal(run.type, 'run');
  assert.deepEqual(run.cards, [c(9, 'S'), c(10, 'S'), c(11, 'S')]);
  assert.equal(T.classifyMeld([c(1, 'S'), c(2, 'S'), c(3, 'S')]).type, 'run'); // ace low
  assert.equal(T.classifyMeld([c(12, 'S'), c(13, 'S'), c(1, 'S')]), null); // no wrap-around
  assert.equal(T.classifyMeld([c(8, 'C'), c(8, 'D')]), null); // too short
  assert.equal(T.classifyMeld([c(8, 'C'), c(9, 'D'), c(10, 'C')]), null); // mixed suits
  assert.equal(T.classifyMeld([c(8, 'C'), c(8, 'C'), c(8, 'D')]), null); // duplicates
  assert.equal(T.classifyMeld([c(8, 'C'), c(9, 'C'), c(11, 'C')]), null); // gap
  assert.equal(T.classifyMeld([c(8, 'C'), c(8, 'D'), 99]), null);
});

test('deal: 5 cards each, one discard, remaining deck, play starts left of dealer', () => {
  const round = T.startRound(['a', 'b', 'c'], 0);
  for (const id of round.order) assert.equal(round.hands[id].length, 5);
  assert.equal(round.discard.length, 1);
  assert.equal(round.deck.length, 52 - 15 - 1);
  assert.equal(round.turn, 1);
});

test('drawn and taken cards are appended on the right of the hand', () => {
  const r = makeRound({ hands: { a: [c(9, 'S'), c(2, 'C'), c(5, 'H')], b: [c(5, 'C')] }, deck: [c(1, 'C')], discard: [c(13, 'D')] });
  T.applyAction(r, 'a', { type: 'draw' });
  assert.deepEqual(r.hands.a, [c(9, 'S'), c(2, 'C'), c(5, 'H'), c(1, 'C')]);
  T.applyAction(r, 'a', { type: 'discard', card: c(2, 'C') });
  T.applyAction(r, 'b', { type: 'takeDiscard' });
  assert.deepEqual(r.hands.b, [c(5, 'C'), c(2, 'C')]);
});

test('reorderHand: accepts permutations only, any time during the hand, without touching the turn', () => {
  const r = makeRound({ hands: { a: [c(9, 'S'), c(2, 'C'), c(5, 'H')], b: [c(5, 'C'), c(6, 'C')] } });
  T.reorderHand(r, 'b', [c(6, 'C'), c(5, 'C')]); // not b's turn, still allowed
  assert.deepEqual(r.hands.b, [c(6, 'C'), c(5, 'C')]);
  assert.equal(r.order[r.turn], 'a');
  assert.equal(r.phase, 'draw');
  T.reorderHand(r, 'a', [c(5, 'H'), c(9, 'S'), c(2, 'C')]);
  assert.deepEqual(r.hands.a, [c(5, 'H'), c(9, 'S'), c(2, 'C')]);
  const before = [...r.hands.a];
  assert.throws(() => T.reorderHand(r, 'a', [c(5, 'H'), c(9, 'S')]), T.GameError); // missing card
  assert.throws(() => T.reorderHand(r, 'a', [c(5, 'H'), c(9, 'S'), c(3, 'C')]), T.GameError); // foreign card
  assert.throws(() => T.reorderHand(r, 'a', [c(5, 'H'), c(5, 'H'), c(9, 'S')]), T.GameError); // duplicate
  assert.throws(() => T.reorderHand(r, 'a', 'nope'), T.GameError);
  assert.deepEqual(r.hands.a, before);
  assert.throws(() => T.reorderHand(r, 'zzz', []), T.GameError);
});

test('tonk at deal: single tonker wins double, multiple tonkers is a draw', () => {
  // Rig the rng so the deal is deterministic: search seeds for each outcome.
  let single = null;
  let multi = null;
  for (let seed = 1; seed < 200000 && !(single && multi); seed++) {
    let s = seed;
    const rng = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const round = T.startRound(['a', 'b', 'c'], 0, rng);
    if (round.result?.type === 'tonk' && !single) single = round;
    if (round.result?.type === 'tonkDraw' && !multi) multi = round;
  }
  assert.ok(single, 'found a single-tonk deal');
  const w = single.result.winners[0];
  const total = T.handTotal(single.hands[w]);
  assert.ok(total <= 15 || total >= 49);
  assert.equal(single.result.deltas[w], 4);
  assert.equal(
    Object.values(single.result.deltas).reduce((a, b) => a + b, 0),
    0,
  );
  if (multi) assert.ok(Object.values(multi.result.deltas).every((d) => d === 0));
});

test('go down: lowest strictly wins, others pay 1', () => {
  const round = makeRound({ hands: { a: [c(2, 'C'), c(3, 'D')], b: [c(10, 'C'), c(10, 'D')], c: [c(5, 'S'), c(6, 'S')] } });
  T.applyAction(round, 'a', { type: 'goDown' });
  assert.equal(round.result.success, true);
  assert.deepEqual(round.result.deltas, { a: 2, b: -1, c: -1 });
});

test('go down: a tie loses; goer pays double to equal/lower, higher players pay the lowest', () => {
  const round = makeRound({
    hands: {
      a: [c(5, 'C'), c(5, 'D')], // 10
      b: [c(5, 'H'), c(5, 'S')], // 10 (tie)
      c: [c(2, 'H'), c(3, 'H')], // 5 (lowest)
      d: [c(10, 'H'), c(10, 'S')], // 20
    },
  });
  T.applyAction(round, 'a', { type: 'goDown' });
  const r = round.result;
  assert.equal(r.success, false);
  assert.deepEqual(r.winners.sort(), ['b', 'c']);
  assert.deepEqual(r.deltas, { a: -4, b: 2, c: 3, d: -1 });
  assert.equal(
    Object.values(r.deltas).reduce((x, y) => x + y, 0),
    0,
  );
});

test('draw then discard advances the turn; cannot act out of order or phase', () => {
  const round = makeRound({ hands: { a: [c(2, 'C'), c(9, 'D')], b: [c(5, 'C'), c(6, 'D')] } });
  assert.throws(() => T.applyAction(round, 'b', { type: 'draw' }), T.GameError);
  assert.throws(() => T.applyAction(round, 'a', { type: 'discard', card: c(2, 'C') }), T.GameError);
  T.applyAction(round, 'a', { type: 'draw' });
  assert.equal(round.hands.a.length, 3);
  assert.throws(() => T.applyAction(round, 'a', { type: 'goDown' }), T.GameError);
  assert.throws(() => T.applyAction(round, 'a', { type: 'draw' }), T.GameError);
  T.applyAction(round, 'a', { type: 'discard', card: c(9, 'D') });
  assert.equal(round.order[round.turn], 'b');
  assert.equal(round.phase, 'draw');
  assert.equal(round.discard.at(-1), c(9, 'D'));
});

test('take discard', () => {
  const round = makeRound({ hands: { a: [c(2, 'C'), c(9, 'D')], b: [c(5, 'C'), c(6, 'D')] }, discard: [c(7, 'H')] });
  T.applyAction(round, 'a', { type: 'takeDiscard' });
  assert.ok(round.hands.a.includes(c(7, 'H')));
  assert.equal(round.discard.length, 0);
});

test('meld removes cards from hand; invalid melds and unheld cards are rejected without changes', () => {
  const round = makeRound({
    hands: { a: [c(8, 'C'), c(8, 'D'), c(8, 'H'), c(1, 'S'), c(13, 'S')], b: [c(5, 'C'), c(6, 'D')] },
    phase: 'play',
  });
  assert.throws(() => T.applyAction(round, 'a', { type: 'meld', cards: [c(8, 'C'), c(8, 'D'), c(1, 'S')] }), T.GameError);
  assert.throws(() => T.applyAction(round, 'a', { type: 'meld', cards: [c(8, 'C'), c(8, 'D'), c(8, 'S')] }), T.GameError);
  assert.equal(round.hands.a.length, 5);
  T.applyAction(round, 'a', { type: 'meld', cards: [c(8, 'C'), c(8, 'D'), c(8, 'H')] });
  assert.equal(round.hands.a.length, 2);
  assert.equal(round.melds.length, 1);
  assert.equal(round.melds[0].owner, 'a');
});

test("layoff extends spreads at either end, even other players' ones; sets cannot be extended", () => {
  const round = makeRound({
    hands: { a: [c(8, 'S'), c(13, 'S'), c(7, 'C'), c(1, 'H')], b: [c(5, 'C'), c(6, 'D')] },
    melds: [
      { id: 1, owner: 'b', type: 'run', cards: [c(9, 'S'), c(10, 'S'), c(11, 'S')] },
      { id: 2, owner: 'b', type: 'set', cards: [c(7, 'D'), c(7, 'H'), c(7, 'S')] },
    ],
    phase: 'play',
  });
  T.applyAction(round, 'a', { type: 'layoff', card: c(8, 'S'), meldId: 1 });
  assert.deepEqual(round.melds[0].cards, [c(8, 'S'), c(9, 'S'), c(10, 'S'), c(11, 'S')]);
  assert.throws(() => T.applyAction(round, 'a', { type: 'layoff', card: c(13, 'S'), meldId: 1 }), T.GameError);
  assert.throws(() => T.applyAction(round, 'a', { type: 'layoff', card: c(7, 'C'), meldId: 2 }), T.GameError);
  assert.throws(() => T.applyAction(round, 'a', { type: 'layoff', card: c(1, 'H'), meldId: 1 }), T.GameError);
  // Queen then King extend the high end; King is only legal once the Queen is down.
  round.hands.a.push(c(12, 'S'));
  T.applyAction(round, 'a', { type: 'layoff', card: c(12, 'S'), meldId: 1 });
  T.applyAction(round, 'a', { type: 'layoff', card: c(13, 'S'), meldId: 1 });
  assert.equal(round.melds[0].cards.length, 6);
});

test('emptying the hand by melding or discarding wins; everyone pays 1', () => {
  const melded = makeRound({ hands: { a: [c(8, 'C'), c(8, 'D'), c(8, 'H')], b: [c(5, 'C')], c: [c(6, 'D')] }, phase: 'play' });
  T.applyAction(melded, 'a', { type: 'meld', cards: [c(8, 'C'), c(8, 'D'), c(8, 'H')] });
  assert.equal(melded.result.type, 'empty');
  assert.deepEqual(melded.result.deltas, { a: 2, b: -1, c: -1 });

  const discarded = makeRound({ hands: { a: [c(8, 'C')], b: [c(5, 'C')] }, phase: 'play' });
  T.applyAction(discarded, 'a', { type: 'discard', card: c(8, 'C') });
  assert.equal(discarded.result.type, 'empty');
  assert.deepEqual(discarded.result.deltas, { a: 1, b: -1 });
  assert.throws(() => T.applyAction(discarded, 'b', { type: 'draw' }), T.GameError);
});

test('empty draw pile reshuffles the discards but keeps the top card', () => {
  const round = makeRound({
    hands: { a: [c(2, 'C')], b: [c(5, 'C')] },
    deck: [],
    discard: [c(3, 'C'), c(4, 'C'), c(5, 'H')],
  });
  const events = T.applyAction(round, 'a', { type: 'draw' });
  assert.ok(events.some((e) => e.type === 'reshuffle'));
  assert.deepEqual(round.discard, [c(5, 'H')]);
  assert.equal(round.hands.a.length, 2);
  assert.equal(round.deck.length, 1);
});

test('draw is refused when no cards can be drawn, but the discard can still be taken', () => {
  const round = makeRound({ hands: { a: [c(2, 'C')], b: [c(5, 'C')] }, deck: [], discard: [c(5, 'H')] });
  assert.throws(() => T.applyAction(round, 'a', { type: 'draw' }), T.GameError);
  T.applyAction(round, 'a', { type: 'takeDiscard' });
});

test('removePlayer: turn bookkeeping and abort with too few players', () => {
  const round = makeRound({ hands: { a: [c(2, 'C')], b: [c(3, 'C')], c: [c(4, 'C')] }, turn: 1, phase: 'play' });
  T.removePlayer(round, 'a');
  assert.equal(round.order[round.turn], 'b');
  assert.equal(round.phase, 'play');
  T.removePlayer(round, 'b');
  assert.equal(round.result.type, 'aborted');
  assert.deepEqual(round.result.deltas, { c: 0 });

  const r2 = makeRound({ hands: { a: [c(2, 'C')], b: [c(3, 'C')], c: [c(4, 'C')] }, turn: 2, phase: 'play' });
  T.removePlayer(r2, 'c');
  assert.equal(r2.order[r2.turn], 'a');
  assert.equal(r2.phase, 'draw');
});

test("viewRound hides opponents' hands until the hand ends", () => {
  const round = makeRound({ hands: { a: [c(2, 'C')], b: [c(3, 'C')] } });
  const v = T.viewRound(round, 'a');
  assert.deepEqual(v.players.a.hand, [c(2, 'C')]);
  assert.equal(v.players.b.hand, null);
  assert.equal(v.players.b.count, 1);
  assert.equal(JSON.stringify(v).includes('"deck":['), false);
});
