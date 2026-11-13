'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadPrefsModule() {
  // The client file is an ES module but the package is CommonJS, so load it from its source text.
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display-prefs.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

const storageWith = (value) => ({ getItem: () => value, setItem() {} });

test('display prefs fall back to defaults for missing or broken storage', async () => {
  const { loadPrefs, DEFAULT_PREFS } = await loadPrefsModule();
  assert.deepEqual(loadPrefs(storageWith(null)), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(storageWith('not json')), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(storageWith('{"fontScale":"big"}')), DEFAULT_PREFS);
});

test('display prefs are clamped to the slider limits', async () => {
  const { loadPrefs, PREF_LIMITS } = await loadPrefsModule();
  const prefs = loadPrefs(storageWith('{"fontScale":99,"cardScale":0.01}'));
  assert.equal(prefs.fontScale, PREF_LIMITS.fontScale.max);
  assert.equal(prefs.cardScale, PREF_LIMITS.cardScale.min);
});
