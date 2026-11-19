'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

let loadId = 0;
async function setup() {
  const { window } = new JSDOM('<!doctype html><div id="app"></div>');
  const { document } = window;
  globalThis.document = document;
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
  const load = (source) => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const dom = await load(read('dom.js') + `\n// ${++loadId}`);
  const { h, persistent } = dom;
  const state = {
    connected: true,
    view: 'room',
    you: 'host',
    name: 'Host',
    selected: new Set(),
    room: {
      id: 'table',
      name: 'Test table',
      hostId: 'host',
      status: 'waiting',
      players: [{ id: 'host', name: 'Host', connected: true, coins: 50 }],
      spectators: [],
      maxPlayers: 5,
      minPlayers: 2,
      settings: { startingCoins: 50, bet: 5, dynamicTable: true, cheating: true },
      settingLimits: { startingCoins: { min: 10, max: 10000 }, bet: { min: 1, max: 1000 } },
      log: [],
    },
  };
  const sent = [];
  let redraw = () => {};
  const noop = () => null;
  const context = {
    ...dom,
    location: { origin: 'http://localhost' },
    state,
    t: (key) => key,
    tNodes: (key) => key,
    tList: () => [],
    botName: (id) => id,
    nameOf: (id) => id,
    playerName: (p) => p.name,
    tableName: (room) => room.name,
    isSpectator: () => !state.room.players.some((p) => p.id === state.you),
    canAccuse: () => false,
    send: (msg) => sent.push(msg),
    sendAction: (action) => sent.push({ t: 'action', action }),
    render: () => redraw(),
    sidePanel: (id, title, ...children) => h('div', { class: id }, ...children),
    setInterval: noop,
    setTimeout: noop,
    clearTimeout: noop,
  };
  const loadClient = async (file) => {
    globalThis.viewsTest = context;
    const mod = await load(
      `const { ${Object.keys(context).join(', ')} } = globalThis.viewsTest;\n` +
        read(file).replace(/^import .*$/gm, '') +
        `\n// ${++loadId}`,
    );
    delete globalThis.viewsTest;
    return mod;
  };
  Object.assign(context, await loadClient('name-tag.js'));
  const chatModule = await loadClient('chat.js');
  Object.assign(context, chatModule);
  for (const name of [
    'toast',
    'sendHello',
    'connect',
    'enterTable',
    'classifyMeld',
    'layoffEnd',
    'cardLabel',
    'bubbleEl',
    'avatar',
    'coin',
    'botLabel',
    'tableDialog',
    'openTableDialog',
    'rulesButton',
    'settingsButton',
    'fullscreenButton',
    'changelogButton',
    'beginDeal',
    'captureCards',
    'captureMarks',
    'currentMeta',
    'playAnimations',
  ])
    context[name] = noop;
  context.flavorEvents = () => [];
  context.tableDialogButton = () => h('button', null, 'Bots');
  context.cardEl = (id) => h('div', { class: 'card' }, String(id));
  context.handCardEl = context.cardEl;
  context.drag = {};
  context.anim = {};
  context.isDealing = () => false;
  delete context.render;
  const views = await loadClient('views.js');
  redraw = views.render;
  const round = {
    order: ['host', 'bot'],
    players: { host: { hand: [0, 1], total: 3, count: 2 }, bot: { hand: [2, 3], total: 7, count: 2 } },
    melds: [],
    turn: 'host',
    phase: 'draw',
    deckCount: 40,
    discardTop: 4,
    dealer: 'bot',
  };
  return { ...views, ...chatModule, state, sent, document, persistent, round };
}

test('leaving a waiting, playing or watched table requires confirmation and supports cancel', async () => {
  const { state, sent, render, document, round } = await setup();
  for (const [status, you] of [
    ['waiting', 'host'],
    ['playing', 'host'],
    ['playing', 'guest'],
  ]) {
    state.room.status = status;
    state.room.round = round;
    state.you = you;
    render();
    const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text);
    button('room.leave').click();
    assert.ok(document.querySelector('.leave-confirm'));
    assert.equal(sent.length, 0);
    button('common.cancel').click();
    assert.equal(document.querySelector('.leave-confirm'), null);
    button('room.leave').click();
    button('common.confirm').click();
    assert.deepEqual(sent.splice(0), [{ t: 'leaveGame' }]);
  }
});

test('emotes move from the waiting room onto the hand panel and keep their open state and cooldown', async () => {
  const { render, state, round, chat, setEmotes, sent, document, persistent } = await setup();
  setEmotes(['wellPlayed'], 4000);
  render();
  assert.equal(document.querySelector('.chat .emote-toggle'), null);
  chat.emoteToggle.click();
  state.room.status = 'playing';
  state.room.round = round;
  render();
  assert.equal(document.querySelector('.me-panel .emote-controls'), persistent.get('emotes'));
  assert.equal(chat.emoteBox.hidden, false);
  chat.emoteBox.querySelector('.emote').click();
  assert.deepEqual(sent, [{ t: 'emote', id: 'wellPlayed' }]);
  render();
  assert.equal(chat.emoteBox.hidden, true);
  assert.equal(chat.emoteBox.querySelector('.emote').disabled, true);
  state.you = 'guest';
  render();
  assert.ok(document.querySelector('.me-panel .emote-toggle'), 'watchers also keep access to emotes');
});

test('hand summaries put the went-down chip beside its actor, including a failed go-down', async () => {
  const { render, state, round, document } = await setup();
  state.room.status = 'between';
  state.room.round = round;
  round.result = {
    type: 'down',
    actor: 'host',
    success: true,
    names: { host: 'Host', bot: 'Bot' },
    hands: { host: [0, 1], bot: [2, 3] },
    totals: { host: 3, bot: 7 },
    deltas: { host: 5, bot: -5 },
    winners: ['host'],
  };
  render();
  const actor = () => document.querySelector('.hand-summary [data-player="host"]');
  assert.equal(actor().querySelector('.who .went-down.won').textContent, 'mark.wentDown');
  assert.equal(document.querySelector('.hand-summary [data-player="bot"] .went-down'), null);
  assert.ok(actor().querySelector('.cards + .result-line'));
  round.result.success = false;
  render();
  assert.equal(actor().querySelector('.who .went-down.caught').textContent, 'mark.caught');
});
