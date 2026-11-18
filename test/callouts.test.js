'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The client is made of native ES modules; load callouts.js the way the browser would, with its one import stubbed.
async function load() {
  const source = fs
    .readFileSync(path.join(__dirname, '..', 'public', 'js', 'callouts.js'), 'utf8')
    .replace(/^import .*$/m, 'const h = () => null;');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('clampText leaves short text alone and cuts long text with an ellipsis', async () => {
  const { clampText } = await load();
  assert.equal(clampText('hello'), 'hello');
  const clamped = clampText('x'.repeat(200));
  assert.equal(Array.from(clamped).length, 81);
  assert.ok(clamped.endsWith('\u2026'));
});

test('flavour lines are announced when they show up in the log, not when arriving at a table', async () => {
  const { noteFlavor, flavorEvents, clearCallouts } = await load();
  const old = { seq: 1, type: 'dynJoin', pid: 'a', variant: 0 };
  noteFlavor([old], () => {});
  assert.deepEqual(flavorEvents(), []);

  const log = [old, { seq: 2, type: 'discard', pid: 'a' }, { seq: 3, type: 'dynLeave', pid: 'b', variant: 1 }];
  noteFlavor(log, () => {});
  assert.deepEqual(
    flavorEvents().map((e) => e.seq),
    [3],
  );

  noteFlavor(log, () => {});
  assert.equal(flavorEvents().length, 1, 'the same event is not announced twice');
  clearCallouts();
});
