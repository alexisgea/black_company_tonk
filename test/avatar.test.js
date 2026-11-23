'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { BOT_IDS } = require('../server/botnames');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const load = (source) => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('every bot has a portrait that the avatar component renders', async () => {
  const { window } = new JSDOM();
  globalThis.document = window.document;
  const { h } = await load(read('public', 'js', 'dom.js'));
  globalThis.avatarTest = { h };
  const { avatar, BOT_PORTRAITS } = await load(
    `const { h } = globalThis.avatarTest;\n${read('public', 'js', 'avatar.js').replace(/^import .*$/gm, '')}`,
  );
  delete globalThis.avatarTest;
  assert.deepEqual(Object.keys(BOT_PORTRAITS).sort(), [...BOT_IDS].sort());
  for (const botId of BOT_IDS) {
    const element = avatar({ botId, small: true });
    const image = element.querySelector('img');
    assert.ok(image, `${botId} should render an image`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', image.getAttribute('src').replace(/^\//, ''))), `${botId} image should exist`);
    assert.ok(element.classList.contains('small'));
  }
  delete globalThis.document;
});

test('human and random avatars remain image-free', async () => {
  const { window } = new JSDOM();
  globalThis.document = window.document;
  const { h } = await load(read('public', 'js', 'dom.js'));
  globalThis.avatarTest = { h };
  const { avatar } = await load(
    `const { h } = globalThis.avatarTest;\n${read('public', 'js', 'avatar.js').replace(/^import .*$/gm, '')}\n// unique`,
  );
  assert.equal(avatar().querySelector('img'), null);
  assert.equal(avatar({ mark: '?' }).textContent, '?');
  delete globalThis.avatarTest;
  delete globalThis.document;
});
