'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const { GameError, MIN_PLAYERS, MAX_PLAYERS } = require('../server/tonk');
const { BOT_NAMES, isReservedName } = require('../server/botnames');

let nextId = 0;
const human = (name) => ({ id: `u${++nextId}`, name, conn: {}, room: null });

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const namesFor = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

// A table with the given humans (first one hosts). Deals until a hand is actually in progress,
// since a Tonk on the deal ends the hand immediately.
function playingRoom(names = namesFor(MIN_PLAYERS)) {
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

test('only the host can start a new game, and it needs the minimum number of players', () => {
  const room = new Room('R', 'Test');
  const users = namesFor(MIN_PLAYERS).map(human);
  users.slice(0, -1).forEach((u) => room.join(u));
  assert.throws(() => room.startHand(users[0]), new RegExp(`at least ${MIN_PLAYERS}`));
  room.join(users.at(-1));
  assert.throws(() => room.startHand(users.at(-1)), /Only the host/);
  room.startHand(users[0]);
  assert.notEqual(room.status, 'waiting');
});

test('cannot join mid-hand, when full, or after being removed', () => {
  const { room, users } = playingRoom();
  assert.throws(() => room.join(human('Late')), GameError);

  const full = new Room('R', 'Test');
  namesFor(MAX_PLAYERS).forEach((n) => full.join(human(n)));
  assert.throws(() => full.join(human('Extra')), GameError);

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

test('bots get random distinct names from the reserved list, marked with a star, and can be removed', () => {
  const room = new Room('R', 'Test');
  room.join(human('Ann'));
  const bot = room.addBot();
  assert.match(bot.name, /★$/);
  assert.ok(BOT_NAMES.includes(bot.name.replace(/ ★$/, '')));
  const more = [room.addBot(), room.addBot(), room.addBot()];
  assert.equal(new Set([bot, ...more].map((b) => b.name)).size, 4);
  more.forEach((b) => room.removeBot(b.id));
  assert.equal(room.humans.length, 1);
  room.removeBot(bot.id);
  assert.equal(room.players.length, 1);
  assert.throws(() => room.removeBot('nope'), /No such bot/);
  assert.throws(() => room.removeBot(room.players[0].id), /No such bot/); // humans are not bots
});

test('bot names are reserved', () => {
  for (const n of ['Croaker', 'goblin', 'ONE EYE', 'One-Eye', 'the lieutenant', 'Raven ★', 'Case (bot)']) {
    assert.ok(isReservedName(n), n);
  }
  for (const n of ['Alice', 'Casey', 'Ravens', 'Bot']) assert.ok(!isReservedName(n), n);
});

test('a hand that ends settles zero-sum scores', () => {
  const { room, users } = playingRoom();
  const mover = users.find((u) => u.id === room.round.order[room.round.turn]);
  room.act(mover, { type: 'goDown' });
  assert.equal(room.status, 'between');
  const total = Object.values(room.scores).reduce((a, b) => a + b, 0);
  assert.equal(total, 0);
  assert.notDeepEqual(Object.values(room.scores), Array(MIN_PLAYERS).fill(0));
});

test('acting without a hand in progress is an error', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  room.join(a);
  assert.throws(() => room.act(a, { type: 'draw' }), /No hand/);
  assert.throws(() => room.reorder(a, []), /No hand/);
});

test('leaving a minimum-size hand aborts it with no payoff', () => {
  const { room, users } = playingRoom();
  room.leave(users.at(-1));
  assert.equal(room.status, 'between');
  assert.equal(room.round.result.type, 'aborted');
  assert.deepEqual(room.scores, Object.fromEntries(users.slice(0, -1).map((u) => [u.id, 0])));
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
  assert.throws(() => room.addChat(human('Stranger'), 'hi'), /Not at this table/);
  for (let i = 0; i < 60; i++) room.addChat(a, `m${i}`);
  assert.equal(room.chat.length, 50);
  assert.equal(room.chat.at(-1).text, 'm59');
});

test('a Tonk on the deal is shouted in the chat by each player who has it', () => {
  let checked = 0;
  for (let seed = 1; seed < 300 && checked < 5; seed++) {
    const room = new Room('ROOM', 'Test', seeded(seed));
    const users = namesFor(MIN_PLAYERS).map(human);
    users.forEach((u) => room.join(u));
    room.startHand(users[0]);
    if (!room.round.result || !room.round.result.winners.length) {
      assert.deepEqual(room.chat, []);
      continue;
    }
    checked++;
    const shouts = room.chat.filter((m) => m.text === 'TONK!').map((m) => m.pid);
    assert.deepEqual(shouts.sort(), [...room.round.result.winners].sort());
  }
  assert.ok(checked > 0, 'expected at least one Tonk deal among the seeds');
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
  const [a, ...rest] = namesFor(MIN_PLAYERS).map(human);
  room.join(a);
  assert.equal(room.summary().joinable, true);
  rest.forEach((u) => room.join(u));
  room.startHand(a);
  assert.deepEqual(room.summary().players, namesFor(MIN_PLAYERS));
  assert.equal(room.summary().joinable, room.status !== 'playing');
});
