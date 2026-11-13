'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

test('the newest changelog entry matches the app version', async () => {
  // The client file is an ES module but the package is CommonJS, so load it from its source text.
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'changelog-data.js'), 'utf8');
  const { CHANGELOG } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  assert.equal(CHANGELOG[0].version, version);
  for (const entry of CHANGELOG) assert.ok(entry.changes.length > 0, `v${entry.version} has no changes`);
});
