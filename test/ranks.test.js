'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rankOfEach, writeRanks } = require('../dev/ranks');

test('the ranking is cut into equal groups, the best being experts', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.deepEqual(Object.values(rankOfEach(ids)), ['expert', 'expert', 'veteran', 'veteran', 'regular', 'regular', 'rookie', 'rookie']);
  assert.deepEqual(rankOfEach(['w', 'x', 'y', 'z']), { w: 'expert', x: 'veteran', y: 'regular', z: 'rookie' });
});

test('writeRanks changes a rank, adds a missing one and leaves the rest of the file alone', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ranks-')), 'profiles.js');
  const source =
    "const PROFILES = {\n  // c\n  'one-eye': {\n    rank: 'rookie',\n    memory: 0.5,\n  },\n  goblin: {\n    memory: 0.9,\n  },\n};\n";
  fs.writeFileSync(file, source);
  assert.deepEqual(writeRanks({ 'one-eye': 'expert', goblin: 'regular' }, file), ['one-eye', 'goblin']);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    "const PROFILES = {\n  // c\n  'one-eye': {\n    rank: 'expert',\n    memory: 0.5,\n  },\n  goblin: {\n    rank: 'regular',\n    memory: 0.9,\n  },\n};\n",
  );
  assert.deepEqual(writeRanks({ goblin: 'regular' }, file), [], 'nothing to change');
  assert.throws(() => writeRanks({ nobody: 'rookie' }, file), /nobody/);
});
