'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

let loadId = 0;
async function setup(status) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const { document } = dom.window;
  globalThis.document = document;
  const load = (source) => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
  const { h } = await load(read('dom.js'));
  const bot = { id: 'bot', name: 'Bot', botId: 'croaker', isBot: true, connected: true };
  const guest = { id: 'guest', name: 'Guest', connected: true };
  const state = {
    you: 'host',
    tableDialog: true,
    confirmKick: null,
    room: {
      hostId: 'host',
      status,
      maxPlayers: 5,
      players: [{ id: 'host', name: 'Host', connected: true }, bot],
      spectators: [guest],
    },
  };
  const sent = [];
  globalThis.tableDialogTest = {
    h,
    state,
    playerName: (p) => p.name,
    send: (msg) => sent.push(msg),
    t: (key) => key,
    avatar: () => null,
    nameTag: (name) => name,
    render: () => {},
    invitePanel: () => h('div', { class: 'test-invite' }),
    botGrid: () => h('div', { class: 'test-bot-grid' }),
    botInfo: () => null,
    botLabel: () => '',
  };
  const source = read('table-dialog.js').replace(/^import .*$/gm, '');
  const mod = await load(
    `const { ${Object.keys(globalThis.tableDialogTest).join(', ')} } = globalThis.tableDialogTest;\n${source}\n// ${++loadId}`,
  );
  delete globalThis.tableDialogTest;
  const draw = () => {
    document.getElementById('app').replaceChildren(mod.tableDialog());
    return [...document.querySelectorAll('.tbl-player:not(.tbl-empty)')];
  };
  return { ...mod, state, sent, draw, document };
}

test('waiting-room bots are removed immediately, but human kicks still ask first', async () => {
  const { state, sent, draw, tableDialogButton, document } = await setup('waiting');
  assert.equal(tableDialogButton().textContent, 'tableDialog.bots');
  let rows = draw();
  assert.ok(document.querySelector('.test-bot-grid'));
  assert.equal(document.querySelector('.test-invite'), null);
  rows[1].querySelector('button').click();
  assert.deepEqual(sent, [{ t: 'removeBot', id: 'bot' }]);
  assert.equal(state.confirmKick, null);
  rows[2].querySelector('button').click();
  assert.equal(state.confirmKick, 'guest');
  assert.equal(sent.length, 1);
  rows = draw();
  rows[2].querySelector('button').click();
  assert.deepEqual(sent[1], { t: 'kick', id: 'guest' });
});

test('waiting-room seats stay visible as bots are added and removed', async () => {
  const { state, draw, document } = await setup('waiting');
  const checkSeats = (emptyCount) => {
    draw();
    const emptySeats = [...document.querySelectorAll('.tbl-empty')];
    assert.equal(emptySeats.length, emptyCount);
    assert.ok(emptySeats.every((seat) => seat.textContent === 'room.emptySeat'));
    assert.equal(document.querySelectorAll('.tbl-player').length, state.room.maxPlayers + state.room.spectators.length);
    assert.ok(
      emptySeats.every(
        (seat) =>
          seat.compareDocumentPosition(document.querySelector('.test-bot-grid')) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    );
  };
  checkSeats(3);
  state.room.players.push({ id: 'bot2', name: 'Bot 2', isBot: true, connected: true });
  checkSeats(2);
  state.room.players.pop();
  checkSeats(3);
  state.room.players.push(
    { id: 'bot2', name: 'Bot 2', isBot: true, connected: true },
    { id: 'bot3', name: 'Bot 3', isBot: true, connected: true },
    { id: 'bot4', name: 'Bot 4', isBot: true, connected: true },
  );
  checkSeats(0);
});

test('in-game settings include invites and guest kicks, without allowing bot removal during play', async () => {
  const { state, sent, draw, tableDialogButton, document } = await setup('playing');
  assert.equal(tableDialogButton().textContent, 'tableDialog.title');
  let rows = draw();
  assert.equal(document.querySelectorAll('.tbl-empty').length, 0);
  assert.ok(document.querySelector('.test-invite'));
  assert.equal(rows[1].querySelector('button'), null);
  rows[2].querySelector('button').click();
  rows = draw();
  rows[2].querySelector('button').click();
  assert.deepEqual(sent, [{ t: 'kick', id: 'guest' }]);
  state.you = 'guest';
  rows = draw();
  assert.ok(rows.every((row) => !row.querySelector('button')));
  assert.equal(document.querySelector('.test-bot-grid'), null);
  assert.ok(document.querySelector('.test-invite'));
});
