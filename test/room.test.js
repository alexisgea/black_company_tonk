'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const { GameError } = require('../server/tonk');

let nextId = 0;
const human = (name) => ({ id: `u${++nextId}`, name, conn: {}, room: null });

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// A table with the given humans (first one hosts). Deals until a hand is actually in progress,
// since a Tonk on the deal ends the hand immediately.
function playingRoom(names = ['Ann', 'Bob']) {
  const room = new Room('ROOM', 'Test', seeded(7));
  const users = names.map(human);
  users.forEach((u) => room.join(u));
  room.startHand(users[0]);
  for (let i = 0; i < 50 && room.status !== 'playing'; i++) room.startHand(users[0]);
  assert.equal(room.status, 'playing');
  return { room, users };
}

test('first player to join is the host and starts at zero', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  const b = human('Bob');
  room.join(a);
  room.join(b);
  assert.equal(room.hostId, a.id);
  assert.deepEqual(room.scores, { [a.id]: 0, [b.id]: 0 });
  assert.equal(a.room, room);
});

test('only the host can start a new game, and it needs two players', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  const b = human('Bob');
  room.join(a);
  assert.throws(() => room.startHand(a), /at least 2/);
  room.join(b);
  assert.throws(() => room.startHand(b), /Only the host/);
  room.startHand(a);
  assert.notEqual(room.status, 'waiting');
});

test('cannot join mid-hand, when full, or after being removed', () => {
  const { room, users } = playingRoom();
  assert.throws(() => room.join(human('Late')), GameError);

  const full = new Room('R', 'Test');
  for (let i = 0; i < 6; i++) full.join(human(`P${i}`));
  assert.throws(() => full.join(human('Seventh')), GameError);

  const kicked = users[1];
  room.leave(kicked, 'kick');
  room.bannedIds.add(kicked.id);
  assert.throws(() => room.join(kicked), /removed/);
});

test('host role passes to the next human, never to a bot', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  const b = human('Bob');
  room.join(a);
  room.addBot();
  room.join(b);
  room.leave(a);
  assert.equal(room.hostId, b.id);
  room.leave(b);
  assert.equal(room.hostId, null);
});

test('bots are named in order and can be removed', () => {
  const room = new Room('R', 'Test');
  room.join(human('Ann'));
  const bot = room.addBot();
  assert.equal(bot.name, 'Bot 1');
  assert.equal(room.humans.length, 1);
  room.removeBot(bot.id);
  assert.equal(room.players.length, 1);
  assert.throws(() => room.removeBot('nope'), /No such bot/);
  assert.throws(() => room.removeBot(room.players[0].id), /No such bot/); // humans are not bots
});

test('a hand that ends settles zero-sum scores', () => {
  const { room, users } = playingRoom(['Ann', 'Bob', 'Cy']);
  const mover = users.find((u) => u.id === room.round.order[room.round.turn]);
  room.act(mover, { type: 'goDown' });
  assert.equal(room.status, 'between');
  const total = Object.values(room.scores).reduce((a, b) => a + b, 0);
  assert.equal(total, 0);
  assert.notDeepEqual(Object.values(room.scores), [0, 0, 0]);
});

test('acting without a hand in progress is an error', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  room.join(a);
  assert.throws(() => room.act(a, { type: 'draw' }), /No hand/);
  assert.throws(() => room.reorder(a, []), /No hand/);
});

test('leaving a two-player hand aborts it with no payoff', () => {
  const { room, users } = playingRoom();
  room.leave(users[1]);
  assert.equal(room.status, 'between');
  assert.equal(room.round.result.type, 'aborted');
  assert.deepEqual(room.scores, { [users[0].id]: 0 });
});

test('chat is cleaned, capped and limited to members', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  room.join(a);
  const msg = room.addChat(a, '  hi\u0007 \n  there  ');
  assert.equal(msg.text, 'hi there');
  assert.equal(room.addChat(a, 'x'.repeat(500)).text.length, 200);
  assert.throws(() => room.addChat(a, '   '), /empty/);
  assert.throws(() => room.addChat(a, 42), /empty/);
  assert.throws(() => room.addChat(human('Stranger'), 'hi'), /Not in this game/);
  for (let i = 0; i < 60; i++) room.addChat(a, `m${i}`);
  assert.equal(room.chat.length, 50);
  assert.equal(room.chat.at(-1).text, 'm59');
});

test('the log is capped and sequence numbers keep increasing', () => {
  const room = new Room('R', 'Test');
  for (let i = 0; i < 70; i++) room.addLog({ type: 'join', pid: 'x', name: 'x' });
  assert.equal(room.log.length, 60);
  assert.equal(room.log.at(-1).seq, 70);
});

test('views show only the viewer their own hand', () => {
  const { room, users } = playingRoom();
  const [a, b] = users;
  const view = room.view(a);
  assert.equal(view.you, a.id);
  assert.equal(view.room.round.players[a.id].hand.length, 5);
  assert.equal(view.room.round.players[b.id].hand, null);
  assert.equal(view.room.round.players[b.id].count, 5);
});

test('joinable and summary reflect status and seats', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  room.join(a);
  assert.equal(room.summary().joinable, true);
  room.join(human('Bob'));
  room.startHand(a);
  assert.deepEqual(room.summary().players, ['Ann', 'Bob']);
  assert.equal(room.summary().joinable, room.status !== 'playing');
});
