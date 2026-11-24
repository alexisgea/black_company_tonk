'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

let loadId = 0;
async function setup() {
  const { window } = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost' });
  const { document } = window;
  globalThis.document = document;
  globalThis.localStorage = window.localStorage;
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
  const load = (source) => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const dom = await load(read('dom.js') + `\n// ${++loadId}`);
  const { h, persistent } = dom;
  const state = {
    connected: true,
    view: 'room',
    you: 'host',
    name: 'Host',
    portraitId: 'portrait-07',
    showPortraits: false,
    games: [],
    online: 1,
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
    sendHello: (name) => sent.push({ t: 'hello', name }),
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
  Object.assign(context, await loadClient('avatar.js'));
  Object.assign(context, await loadClient('name-tag.js'));
  const chatModule = await loadClient('chat.js');
  Object.assign(context, chatModule);
  for (const name of [
    'toast',
    'connect',
    'enterTable',
    'classifyMeld',
    'layoffEnd',
    'cardLabel',
    'bubbleEl',
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

test('players can choose a portrait before playing and customise their profile from the lobby', async () => {
  const { state, render, document, sent } = await setup();
  localStorage.clear();
  state.view = 'name';
  state.you = null;
  render();
  assert.ok([...document.querySelectorAll('button')].some((button) => button.textContent === 'name.play'));
  let choices = [...document.querySelectorAll('.portrait-choice')];
  assert.equal(choices.length, 7);
  choices[2].click();
  assert.equal(state.portraitId, 'portrait-03');
  assert.equal(localStorage.getItem('tonk.portrait'), 'portrait-03');

  state.you = 'host';
  state.view = 'lobby';
  render();
  assert.equal(document.querySelector('.panel.row > .avatar img').getAttribute('src'), '/img/player-portraits/portrait-03.png');
  const customise = [...document.querySelectorAll('button')].find((button) => button.textContent === 'lobby.customise');
  assert.ok(customise.classList.contains('small-btn'));
  customise.click();
  assert.ok(![...document.querySelectorAll('button')].some((button) => button.textContent === 'name.play'));
  document.querySelector('#name-input').value = 'New name';
  choices = [...document.querySelectorAll('.portrait-choice')];
  choices[6].click();
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'name.set').click();
  assert.equal(state.portraitId, 'portrait-07');
  assert.equal(localStorage.getItem('tonk.portrait'), 'portrait-07');
  assert.deepEqual(sent.at(-1), { t: 'hello', name: 'New name' });
});

test('emotes are absent in the waiting room and available on the hand panel during play', async () => {
  const { render, state, round, chat, chatText, setEmotes, sent, document, persistent } = await setup();
  setEmotes(['wellPlayed'], 4000);
  render();
  assert.equal(document.querySelector('.emote-toggle'), null);
  state.room.status = 'playing';
  state.room.round = round;
  render();
  assert.equal(document.querySelector('.me-panel .emote-controls'), persistent.get('emotes'));
  assert.equal(chat.emoteBox.querySelector('.emote').textContent, 'emoteButton.wellPlayed');
  assert.equal(chatText({ kind: 'emote', emote: 'wellPlayed', text: 'fallback' }), 'emote.wellPlayed');
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

test('opponent card layout follows the actual hidden and revealed hand sizes', async () => {
  const { render, state, round, document } = await setup();
  state.room.status = 'playing';
  state.room.round = round;
  round.players.bot.hand = null;
  round.players.bot.count = 6;
  render();
  const cards = document.querySelector('.opp > .cards');
  assert.equal(cards.children.length, 6);
  assert.equal(cards.style.getPropertyValue('--card-count'), '6');
  assert.equal(cards.style.getPropertyValue('--card-steps'), '5');
  assert.equal(cards.classList.contains('revealed'), false);

  round.players.bot.count = 1;
  render();
  assert.equal(cards.children.length, 1);
  assert.equal(cards.style.getPropertyValue('--card-count'), '1');
  assert.equal(cards.style.getPropertyValue('--card-steps'), '1');

  state.room.status = 'between';
  round.result = {
    type: 'down',
    actor: 'host',
    success: true,
    names: { host: 'Host', bot: 'Bot' },
    hands: { host: [0, 1], bot: [2, 3, 4] },
    totals: { host: 3, bot: 12 },
    deltas: { host: 5, bot: -5 },
    winners: ['host'],
  };
  render();
  assert.equal(cards.children.length, 3);
  assert.equal(cards.style.getPropertyValue('--card-count'), '3');
  assert.equal(cards.style.getPropertyValue('--card-steps'), '2');
  assert.equal(cards.classList.contains('revealed'), true);
});

test('player and opponent portraits and balances stay visible during a hand and after it ends', async () => {
  const { render, state, round, document } = await setup();
  state.room.status = 'playing';
  state.room.players[0].portraitId = 'portrait-07';
  state.room.players.push({ id: 'bot', name: 'Bot', connected: true, isBot: true, botId: 'croaker', coins: 37 });
  state.room.round = round;

  render();
  assert.equal(document.querySelector('.opp-portrait').getAttribute('src'), '/img/bot-portraits/portrait-02.png');
  assert.equal(document.querySelector('.me-portrait').getAttribute('src'), '/img/player-portraits/portrait-07.png');
  assert.equal(document.querySelector('.me-portrait').getAttribute('aria-hidden'), 'true');
  assert.equal(document.querySelector('.opp .avatar'), null);
  assert.equal(document.querySelector('.opp-id strong').textContent, 'Bot');
  assert.ok(document.querySelector('.opp-id .name-tag').firstChild.classList.contains('helmet'));
  assert.equal(document.querySelector('.opp-art').getAttribute('aria-hidden'), 'true');
  assert.ok(document.querySelector('.opp-id .purse'));
  assert.ok(document.querySelector('.opp-head .dealer'));
  assert.equal(document.querySelector('.opp .purse').textContent, '37');
  assert.equal(document.querySelector('.me-panel .purse').textContent, '50');

  state.room.players[1] = { id: 'bot', name: 'Guest', connected: true, portraitId: 'portrait-03', coins: 37 };
  render();
  assert.equal(document.querySelector('.opp-portrait').getAttribute('src'), '/img/player-portraits/portrait-03.png');
  state.room.players.splice(1, 1);
  render();
  assert.equal(document.querySelector('.opp-portrait'), null);
  assert.equal(document.querySelector('.opp .purse'), null);

  state.room.players.push({ id: 'bot', name: 'Bot', connected: true, isBot: true, botId: 'croaker', coins: 37 });
  state.room.status = 'between';
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
  assert.equal(document.querySelector('.opp .purse').textContent, '37');
  assert.equal(document.querySelector('.me-panel .purse').textContent, '50');
  assert.ok(document.querySelector('.me-portrait'));

  state.you = 'guest';
  render();
  assert.equal(document.querySelector('.me-portrait'), null);
});

test('host names start with their host icon', async () => {
  const { render, document } = await setup();
  render();
  const tag = document.querySelector('.seat .name-tag');
  assert.ok(tag.firstChild.classList.contains('host-star'));
  assert.equal(tag.lastChild.textContent, 'Host');
});
