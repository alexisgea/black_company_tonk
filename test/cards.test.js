'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cards = require('../shared/cards');

const c = (rank, suit) => 'CDHS'.indexOf(suit) * 13 + rank - 1;

test('shared cards module loads in a browser-like context as window.TonkCards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'cards.js'), 'utf8');
  const sandbox = {};
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox);
  assert.deepEqual(Object.keys(sandbox.TonkCards).sort(), Object.keys(cards).sort());
  assert.equal(sandbox.TonkCards.classifyMeld([c(5, 'H'), c(6, 'H'), c(7, 'H')]).type, 'run');
});

test('the rules engine re-exports the shared helpers', () => {
  const T = require('../server/tonk');
  for (const name of ['rankOf', 'suitOf', 'cardValue', 'handTotal', 'classifyMeld', 'layoffEnd']) {
    assert.equal(T[name], cards[name]);
  }
});

test('layoffEnd: only runs extend, at either end, same suit', () => {
  const run = cards.classifyMeld([c(5, 'H'), c(6, 'H'), c(7, 'H')]);
  assert.equal(cards.layoffEnd(run, c(4, 'H')), 'low');
  assert.equal(cards.layoffEnd(run, c(8, 'H')), 'high');
  assert.equal(cards.layoffEnd(run, c(8, 'S')), null);
  assert.equal(cards.layoffEnd(run, c(9, 'H')), null);
  const set = cards.classifyMeld([c(5, 'H'), c(5, 'S'), c(5, 'C')]);
  assert.equal(cards.layoffEnd(set, c(5, 'D')), null);
});

test('isCard rejects out-of-range and non-integer values', () => {
  assert.ok(cards.isCard(0) && cards.isCard(51));
  for (const bad of [-1, 52, 1.5, '3', null, undefined, NaN]) assert.equal(cards.isCard(bad), false);
});
