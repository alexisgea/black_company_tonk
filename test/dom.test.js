'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function setup() {
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  globalThis.document = dom.window.document;
  // The server's CSP blocks setAttribute('style'), so the patcher must never use it.
  const setAttribute = dom.window.Element.prototype.setAttribute;
  dom.window.Element.prototype.setAttribute = function (name, value) {
    assert.notEqual(String(name).toLowerCase(), 'style', 'setAttribute(style) is blocked by the CSP');
    return setAttribute.call(this, name, value);
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dom.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  return { ...mod, app: dom.window.document.getElementById('app'), window: dom.window };
}

test('patching keeps the element, syncs attributes, style and text', async () => {
  const { h, patchChildren, app } = await setup();
  patchChildren(app, [h('div', { class: 'a', title: 't', style: 'color: red' }, 'one')]);
  const el = app.firstChild;
  patchChildren(app, [h('div', { class: 'b', 'data-x': '1', style: 'margin: 0px' }, 'two')]);
  assert.equal(app.firstChild, el);
  assert.equal(el.className, 'b');
  assert.equal(el.hasAttribute('title'), false);
  assert.equal(el.getAttribute('data-x'), '1');
  assert.equal(el.style.color, '');
  assert.equal(el.style.margin, '0px');
  assert.equal(el.textContent, 'two');
  patchChildren(app, [h('div', { class: 'b' }, 'two')]);
  assert.equal(el.style.cssText, '');
});

test('a reused element runs only the newest handler, once', async () => {
  const { h, patchChildren, app } = await setup();
  const calls = [];
  patchChildren(app, [h('button', { onClick: () => calls.push('old') })]);
  const button = app.firstChild;
  patchChildren(app, [h('button', { onClick: () => calls.push('new') })]);
  button.click();
  assert.deepEqual(calls, ['new']);
  patchChildren(app, [h('button')]);
  button.click();
  assert.deepEqual(calls, ['new']);
});

test('typed input values survive unless the input opts in to syncing', async () => {
  const { h, patchChildren, app } = await setup();
  const build = (text, n) => [h('input', { type: 'text', value: text }), h('input', { type: 'number', value: n, 'data-sync': true })];
  patchChildren(app, build('a', 1));
  const [text, num] = Array.from(app.children);
  text.value = 'typed';
  num.value = '99';
  num.focus();
  patchChildren(app, build('b', 5));
  assert.equal(text.value, 'typed');
  assert.equal(num.value, '99', 'an input being edited is left alone');
  num.blur();
  patchChildren(app, build('b', 5));
  assert.equal(text.value, 'typed');
  assert.equal(num.value, '5');
});

test('persistent nodes keep their identity when moved in and out', async () => {
  const { h, patchChildren, persistent, app } = await setup();
  const chat = h('div', { class: 'chat' }, h('input', { type: 'text' }));
  persistent.set('chat', chat);
  const slot = () => h('div', { 'data-persist': 'chat' });
  patchChildren(app, [h('div', { class: 'screen' }, h('p'), slot())]);
  assert.equal(app.querySelector('.chat'), chat);
  patchChildren(app, [h('div', { class: 'table' }, h('div', { class: 'side' }, h('p'), slot(), h('div', { class: 'log' })))]);
  assert.equal(app.querySelectorAll('.chat').length, 1);
  assert.equal(chat.parentNode.className, 'side');
  assert.equal(chat.parentNode.children[1], chat);
  patchChildren(app, [h('div', { class: 'table' }, h('div', { class: 'side' }, h('p'), h('div', { class: 'log' })))]);
  assert.equal(chat.parentNode, null);
  patchChildren(app, [h('div', { class: 'screen' }, slot())]);
  assert.equal(app.querySelector('.chat'), chat);
  assert.equal(chat.firstChild.localName, 'input');
});

test('keyed children are reordered by identity and leftovers are removed', async () => {
  const { h, patchChildren, app } = await setup();
  const card = (id, extra) => h('div', { 'data-card': id, class: 'card' + (extra ? ' ' + extra : '') }, String(id));
  patchChildren(app, [card(1), card(2), card(3), h('div', { class: 'slot-highlight' })]);
  const [one, two, three] = Array.from(app.children);
  patchChildren(app, [card(3), card(1, 'selected'), card(4)]);
  assert.deepEqual(
    Array.from(app.children).map((c) => c.textContent),
    ['3', '1', '4'],
  );
  assert.equal(app.children[0], three);
  assert.equal(app.children[1], one);
  assert.equal(one.className, 'card selected');
  assert.equal(two.parentNode, null);
  assert.equal(app.querySelector('.slot-highlight'), null);
});
