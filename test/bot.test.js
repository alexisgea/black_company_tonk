'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/tonk');
const { chooseAction, fallbackAction, findMeld } = require('../server/bot');

const c = (rank, suit) => 'CDHS'.indexOf(suit) * 13 + rank - 1;

function seededRng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

test('findMeld finds sets, runs and nothing otherwise', () => {
  assert.equal(findMeld([c(2, 'C'), c(9, 'D'), c(13, 'S'), c(5, 'H')]), null);
  assert.equal(findMeld([c(8, 'C'), c(8, 'D'), c(8, 'H'), c(1, 'S')]).length, 3);
  assert.equal(findMeld([c(8, 'C'), c(8, 'D'), c(8, 'H'), c(8, 'S')]).length, 4);
  const run = findMeld([c(5, 'S'), c(6, 'S'), c(7, 'S'), c(8, 'S'), c(1, 'H')]);
  assert.deepEqual(run, [c(5, 'S'), c(6, 'S'), c(7, 'S'), c(8, 'S')]);
  // A gap splits the run: 3-4-5 is found, 7-8 is not enough.
  assert.equal(findMeld([c(3, 'D'), c(4, 'D'), c(5, 'D'), c(7, 'D'), c(8, 'D')]).length, 3);
});

test('bots only ever make legal moves and always finish the hand', () => {
  let melds = 0;
  let layoffs = 0;
  let wins = { down: 0, empty: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seededRng(seed);
    const count = T.MIN_PLAYERS + (seed % (T.MAX_PLAYERS - T.MIN_PLAYERS + 1));
    const players = Array.from({ length: count }, (_, i) => `p${i}`);
    const round = T.startRound(players, 0, rng);
    let steps = 0;
    while (!round.result) {
      assert.ok(++steps < 2000, `seed ${seed} did not finish`);
      const id = round.order[round.turn];
      const action = chooseAction(round, id);
      if (action.type === 'meld') melds++;
      if (action.type === 'layoff') layoffs++;
      T.applyAction(round, id, action); // throws on any illegal move
    }
    if (round.result.type === 'down') wins.down++;
    if (round.result.type === 'empty') wins.empty++;
  }
  assert.ok(melds > 0, 'bots put cards down at least once');
  assert.ok(layoffs > 0, 'bots added to spreads at least once');
  assert.ok(wins.down + wins.empty > 0);
});

test('the fallback move is always legal, so a failing bot cannot freeze a table', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const round = T.startRound(['a', 'b', 'c'], 0, seededRng(seed));
    for (let step = 0; step < 400 && !round.result; step++) {
      const id = round.order[round.turn];
      T.applyAction(round, id, fallbackAction(round, id)); // throws on any illegal move
    }
  }
});

test('bot takes a discard that completes a meld, draws otherwise', () => {
  const base = { melds: [], deck: [c(2, 'S')], phase: 'draw' };
  const helpful = { ...base, hands: { a: [c(8, 'C'), c(8, 'D'), c(13, 'S'), c(12, 'S'), c(11, 'S')] }, discard: [c(8, 'H')] };
  assert.equal(chooseAction(helpful, 'a').type, 'takeDiscard');
  const useless = { ...base, hands: { a: [c(8, 'C'), c(8, 'D'), c(13, 'S'), c(12, 'S'), c(11, 'S')] }, discard: [c(2, 'H')] };
  assert.equal(chooseAction(useless, 'a').type, 'draw');
  const low = { ...base, hands: { a: [c(1, 'C'), c(2, 'D'), c(3, 'S')] }, discard: [c(2, 'H')] };
  assert.equal(chooseAction(low, 'a').type, 'goDown');
});
