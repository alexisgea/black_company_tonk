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
// since a Tonk on the deal ends the hand once it has been declared.
function playingRoom(names = namesFor(MIN_PLAYERS)) {
  const room = new Room('ROOM', 'Test', seeded(7));
  const users = names.map(human);
  users.forEach((u) => room.join(u));
  room.startHand(users[0]);
  for (let i = 0; i < 50 && !(room.status === 'playing' && room.round.phase !== 'tonk'); i++) {
    for (const p of room.pendingTonkers) room.declareTonk(p);
    room.startHand(users[0]);
  }
  assert.equal(room.status, 'playing');
  return { room, users };
}

test('first player to join is the host and starts with the starting coins', () => {
  const room = new Room('R', 'Test');
  const a = human('Ann');
  const b = human('Bob');
  room.join(a);
  room.join(b);
  assert.equal(room.hostId, a.id);
  assert.deepEqual(room.coins, { [a.id]: 50, [b.id]: 50 });
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

test('someone joining after hands were played gets the average of the seated players, not a fresh stack', () => {
  const room = new Room('R', 'Test');
  const [a, b, c] = ['Ann', 'Bob', 'Cy'].map(human);
  [a, b, c].forEach((u) => room.join(u));
  assert.equal(room.coins[c.id], 50);
  room.handNo = 1;
  Object.assign(room.coins, { [a.id]: 80, [b.id]: 40, [c.id]: 30 }); // average 50
  const late = human('Late');
  room.join(late);
  assert.equal(room.coins[late.id], 50);
  Object.assign(room.coins, { [a.id]: 1, [b.id]: 1, [c.id]: 1, [late.id]: 1 });
  room.settings.bet = 5;
  const later = human('Later');
  room.leave(late);
  room.join(later);
  assert.equal(room.coins[later.id], 5, 'never less than one bet');
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
  for (const n of ['Croaker', 'goblin', 'ONE EYE', 'One-Eye', 'the lieutenant', 'Raven ★', 'Case (bot)', 'Goblín', 'Ｇoblin']) {
    assert.ok(isReservedName(n), n);
  }
  for (const n of ['Alice', 'Casey', 'Ravens', 'Bot']) assert.ok(!isReservedName(n), n);
});

test('a hand that ends moves coins around without creating any', () => {
  const { room, users } = playingRoom();
  const mover = users.find((u) => u.id === room.round.order[room.round.turn]);
  room.act(mover, { type: 'goDown' });
  assert.equal(room.status, 'between');
  const total = Object.values(room.coins).reduce((a, b) => a + b, 0);
  assert.equal(total, 50 * MIN_PLAYERS);
  assert.notDeepEqual(Object.values(room.coins), Array(MIN_PLAYERS).fill(50));
});

test('the host can change the settings only before the game starts, with limits', () => {
  const room = new Room('R', 'Test');
  const users = namesFor(MIN_PLAYERS).map(human);
  users.forEach((u) => room.join(u));
  room.updateSettings(users[0], { startingCoins: 100, bet: 5 });
  assert.deepEqual(room.settings, { startingCoins: 100, bet: 5 });
  assert.ok(Object.values(room.coins).every((c) => c === 100));
  assert.throws(() => room.updateSettings(users[0], { startingCoins: 5, bet: 1 }), /Starting coins/);
  assert.throws(() => room.updateSettings(users[0], { startingCoins: 100, bet: 1.5 }), /Bet/);
  assert.throws(() => room.updateSettings(users[0], { startingCoins: 100, bet: 200 }), /more than/);
  assert.throws(() => room.updateSettings(users[0], null), /Bad settings/);
  room.startHand(users[0]);
  assert.throws(() => room.updateSettings(users[0], { startingCoins: 20, bet: 1 }), /before the game starts/);
});

test('a player who cannot pay in full gives what they have, and ends up a guest (bots are removed)', () => {
  const room = new Room('R', 'Test', seeded(3), { settings: { startingCoins: 10, bet: 10 } });
  const [a, b, c] = namesFor(3).map(human);
  [a, b, c].forEach((u) => room.join(u));
  const bot = room.addBot();
  room.coins[bot.id] = 3;
  room.coins[a.id] = 12;
  const deltas = room.payout({ [a.id]: 3, [b.id]: 0, [c.id]: -1, [bot.id]: -2 });
  // c can pay 10 of 10, the bot only 3 of 20: the winner receives 13.
  assert.deepEqual(deltas, { [a.id]: 13, [b.id]: 0, [c.id]: -10, [bot.id]: -3 });
  assert.equal(
    Object.values(deltas).reduce((x, y) => x + y, 0),
    0,
  );
});

test('losing the last coin turns a human into a guest and removes a bot', () => {
  const room = new Room('R', 'Test', seeded(7), { settings: { startingCoins: 10, bet: 10 } });
  const users = namesFor(MIN_PLAYERS).map(human);
  users.forEach((u) => room.join(u));
  room.addBot();
  room.startHand(users[0]);
  for (const p of [...room.pendingTonkers]) room.declareTonk(p);
  if (room.status === 'playing') {
    const mover = room.players.find((p) => p.id === room.round.order[room.round.turn]);
    room.act(mover, { type: 'goDown' });
  }
  assert.equal(room.status, 'between');
  const broke = room.takeBroke();
  assert.ok(broke.length > 0);
  assert.deepEqual(room.takeBroke(), []);
  for (const user of broke) {
    assert.ok(!room.players.includes(user));
    assert.ok(!(user.id in room.coins));
    if (user.isBot) assert.equal(user.room, null);
    else assert.ok(room.spectators.includes(user));
  }
  assert.ok(room.players.every((p) => room.coins[p.id] > 0));
  assert.ok(room.log.some((e) => e.type === 'broke'));
  assert.ok(room.round.result.broke.length === broke.length);
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
  assert.deepEqual(room.coins, Object.fromEntries(users.slice(0, -1).map((u) => [u.id, 50])));
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

test('a Tonk on the deal waits until it is declared, then shouts TONK! in the chat', () => {
  let checked = 0;
  for (let seed = 1; seed < 300 && checked < 5; seed++) {
    const room = new Room('ROOM', 'Test', seeded(seed));
    const users = namesFor(MIN_PLAYERS).map(human);
    users.forEach((u) => room.join(u));
    room.startHand(users[0]);
    if (room.round.phase !== 'tonk') {
      assert.deepEqual(room.chat, []);
      assert.equal(room.tonkDeadline, null);
      continue;
    }
    checked++;
    assert.equal(room.status, 'playing');
    assert.ok(room.tonkDeadline > Date.now());
    assert.equal(room.round.result, null);
    assert.deepEqual(room.chat, []);
    assert.throws(() => room.act(users[0], { type: 'draw' }), GameError);
    assert.ok(room.view(room.pendingTonkers[0]).room.tonkMsLeft > 0);

    const tonkers = room.pendingTonkers.map((p) => p.id);
    const nonTonker = users.find((u) => !tonkers.includes(u.id));
    if (nonTonker) assert.throws(() => room.declareTonk(nonTonker), /do not have/);
    for (const p of [...room.pendingTonkers]) room.declareTonk(p);
    assert.equal(room.status, 'between');
    assert.ok(room.round.result.winners.length);
    const shouts = room.chat.filter((m) => m.text === 'TONK!').map((m) => m.pid);
    assert.deepEqual(shouts.sort(), tonkers.sort());
  }
  assert.ok(checked > 0, 'expected at least one Tonk deal among the seeds');
});

test('the log is hard-capped and sequence numbers keep increasing', () => {
  const room = new Room('R', 'Test');
  for (let i = 0; i < 250; i++) room.addLog({ type: 'join', pid: 'x', name: 'x' });
  assert.equal(room.log.length, 200);
  assert.equal(room.log.at(-1).seq, 250);
});

test('the log keeps only the current hand, the last full round and the turn in progress', () => {
  const { room, users } = playingRoom();
  const n = room.players.length;
  const ids = users.map((u) => u.id);
  for (let turn = 0; turn < n * 3; turn++) {
    room.addLog({ type: 'draw', pid: ids[turn % n] });
    room.addLog({ type: 'discard', pid: ids[turn % n], card: 'S5' });
  }
  room.addLog({ type: 'draw', pid: ids[0] }); // turn in progress
  assert.equal(room.log.filter((e) => e.type === 'discard').length, n);
  assert.equal(room.log.at(-1).type, 'draw');
  assert.equal(room.log.at(-2).type, 'discard');
  assert.ok(room.log.every((e) => e.type !== 'deal' || e.hand === room.handNo));
});

test('log events expose only public fields and do not alias live game state', () => {
  const room = new Room('R', 'Test');
  const cards = ['S1', 'S2', 'S3'];
  room.addLog({ type: 'draw', pid: 'a', card: 'H9', hand: ['H9'] });
  room.addLog({ type: 'meld', pid: 'a', kind: 'run', cards, secret: 'x' });
  cards.push('S4'); // a later lay-off must not rewrite history
  assert.deepEqual(room.log[0], { seq: 1, type: 'draw', pid: 'a' });
  assert.deepEqual(room.log[1].cards, ['S1', 'S2', 'S3']);
  assert.equal('secret' in room.log[1], false);
});

test('bots cannot be removed mid-hand', () => {
  const room = new Room('R', 'Test', seeded(7));
  const host = human('Ann');
  room.join(host);
  const bots = [room.addBot(), room.addBot()];
  room.startHand(host);
  assert.equal(room.status, 'playing');
  assert.throws(() => room.removeBot(bots[0].id), /between hands/);
  room.leave(host); // the hand ends (below the minimum), so removing is allowed again
  room.removeBot(bots[0].id);
  assert.equal(room.players.length, 1);
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
