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
      maxNameLength: 48,
      settings: { startingCoins: 50, bet: 5, dynamicTable: true, cheating: true },
      settingLimits: { startingCoins: { min: 10, max: 10000 }, bet: { min: 1, max: 1000 } },
      log: [],
    },
  };
  const sent = [];
  const scrolls = [];
  window.scrollTo = (...position) => scrolls.push(position);
  let redraw = () => {};
  const noop = () => null;
  const context = {
    ...dom,
    window,
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
  return { ...views, ...chatModule, state, sent, scrolls, document, persistent, round };
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

test('emotes are absent in the waiting room and available on the hand panel during play', async () => {
  const { render, state, round, chat, setEmotes, sent, document, persistent } = await setup();
  setEmotes(['wellPlayed'], 4000);
  render();
  assert.equal(document.querySelector('.emote-toggle'), null);
  state.room.status = 'playing';
  state.room.round = round;
  render();
  assert.equal(document.querySelector('.me-panel .emote-controls'), persistent.get('emotes'));
  chat.emoteToggle.click();
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

test('waiting room puts Leave and Start below the title and scrolls up only when play begins', async () => {
  const { render, state, round, sent, scrolls, document } = await setup();
  state.room.players.push({ id: 'bot', name: 'Bot', isBot: true, connected: true, coins: 50 });
  render();
  const [leave, start] = document.querySelector('h1 + .waiting-controls').children;
  assert.equal(leave.textContent, 'room.leave');
  assert.equal(start.textContent, 'room.startGame');
  start.click();
  assert.deepEqual(sent, [{ t: 'startGame' }]);
  assert.deepEqual(scrolls, []);
  state.room.status = 'playing';
  state.room.round = round;
  render();
  render();
  assert.deepEqual(scrolls, [[0, 0]]);
});

test('the waiting room lets the host submit a table name but hides the editor from guests', async () => {
  const { render, state, sent, document } = await setup();
  render();
  const input = document.querySelector('input[name="tableName"]');
  assert.equal(input.value, 'Test table');
  input.value = '  The Annals  ';
  input.form.querySelector('button').click();
  assert.deepEqual(sent, [{ t: 'renameTable', name: 'The Annals' }]);
  state.room.name = 'The Annals';
  render();
  assert.equal(document.querySelector('h1').textContent, 'The Annals');
  assert.equal(input.value, 'The Annals');
  state.you = 'guest';
  render();
  assert.equal(document.querySelector('input[name="tableName"]'), null);
});

test('finished hands reveal each hand and show its total and coin change without a summary panel', async () => {
  const { render, state, round, document } = await setup();
  state.room.status = 'between';
  state.room.round = round;
  round.players.bot.hand = null;
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
  assert.equal(document.querySelector('.hand-summary'), null);
  assert.equal(document.querySelectorAll('.opp .cards .card').length, 2);
  assert.deepEqual(
    Array.from(document.querySelectorAll('.opp .cards .card'), (card) => card.textContent),
    ['2', '3'],
  );
  assert.equal(document.querySelector('.opp .result-line .result-total').textContent, 'status.handValue');
  assert.equal(document.querySelector('.opp .result-line .delta.neg').textContent, 'result.coins');
  assert.equal(document.querySelector('.me-panel .result-line .result-total').textContent, 'status.handValue');
  assert.equal(document.querySelector('.me-panel .result-line .delta.pos').textContent, 'result.coins');
});
