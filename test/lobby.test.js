'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Lobby } = require('../server/lobby');
const { MIN_PLAYERS } = require('../server/tonk');

// Minimal fake connection that records what the server sends.
function fakeConn() {
  const conn = {
    readyState: 1,
    user: null,
    inbox: [],
    closed: false,
    send(s) {
      this.inbox.push(JSON.parse(s));
    },
    close() {
      this.closed = true;
      this.readyState = 3;
    },
    last(type) {
      return [...this.inbox].reverse().find((m) => m.t === type);
    },
  };
  return conn;
}

const say = (lobby, conn, msg) => lobby.handle(conn, JSON.stringify(msg));

function connect(lobby, name) {
  const conn = fakeConn();
  say(lobby, conn, { t: 'hello', name });
  return conn;
}

// Creates a game with MIN_PLAYERS humans; the first one hosts.
function seatedGame(lobby) {
  const humans = Array.from({ length: MIN_PLAYERS }, (_, i) => connect(lobby, `P${i + 1}`));
  say(lobby, humans[0], { t: 'createGame' });
  const gameId = humans[1].last('lobby').games[0].id;
  humans.slice(1).forEach((h) => say(lobby, h, { t: 'joinGame', gameId }));
  return { humans, gameId };
}

test('create, list, join, start and play a hand through the lobby', () => {
  const lobby = new Lobby({ graceMs: 10 });
  const humans = Array.from({ length: MIN_PLAYERS }, (_, i) => connect(lobby, `P${i + 1}`));
  const [alice, bob, ...others] = humans;
  assert.equal(alice.last('lobby').games.length, 0);

  say(lobby, alice, { t: 'createGame' });
  assert.equal(bob.last('lobby').games.length, 1);
  const gameId = bob.last('lobby').games[0].id;

  say(lobby, bob, { t: 'joinGame', gameId });
  others.forEach((h) => say(lobby, h, { t: 'joinGame', gameId }));
  assert.equal(alice.last('room').room.players.length, MIN_PLAYERS);

  // Non-host cannot start; host can.
  say(lobby, bob, { t: 'startGame' });
  assert.match(bob.last('error').message, /host/i);
  say(lobby, alice, { t: 'startGame' });
  const aView = alice.last('room');
  const bView = bob.last('room');
  assert.equal(aView.room.status === 'playing' || aView.room.status === 'between', true);

  // Opponent hands are never leaked mid-hand.
  if (aView.room.status === 'playing') {
    assert.equal(aView.room.round.players[bView.you].hand, null);
    assert.equal(bView.room.round.players[aView.you].hand, null);
    assert.equal(aView.room.round.players[aView.you].hand.length, 5);

    const turnId = aView.room.round.turn;
    const mover = humans.find((h) => h.last('room').you === turnId);
    const other = humans.find((h) => h !== mover);
    say(lobby, other, { t: 'action', action: { type: 'draw' } });
    assert.match(other.last('error').message, /turn/i);
    say(lobby, mover, { t: 'action', action: { type: 'draw' } });
    const mv = mover.last('room').room.round;
    assert.equal(mv.phase, 'play');
    assert.equal(mv.players[turnId].hand.length, 6);
    say(lobby, mover, { t: 'action', action: { type: 'discard', card: mv.players[turnId].hand[0] } });
    const nextId = other.last('room').room.round.turn;
    assert.notEqual(nextId, turnId);
    assert.ok(humans.some((h) => h.last('room').you === nextId));
  }
});

test('reconnect with token resumes the seat; grace timeout removes the player', async () => {
  const lobby = new Lobby({ graceMs: 20 });
  const alice = connect(lobby, 'Alice');
  say(lobby, alice, { t: 'createGame' });
  const token = alice.last('welcome').token;

  lobby.disconnect(alice);
  const alice2 = fakeConn();
  say(lobby, alice2, { t: 'hello', name: 'Alice', token });
  assert.equal(alice2.last('room').room.players.length, 1);
  assert.equal(lobby.rooms.size, 1);

  lobby.disconnect(alice2);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(lobby.rooms.size, 0);
});

test('a second connection with the same token takes the seat and tells the old one', () => {
  const lobby = new Lobby();
  const first = connect(lobby, 'Alice');
  const token = first.last('welcome').token;
  const second = fakeConn();
  say(lobby, second, { t: 'hello', name: 'Alice', token });
  assert.ok(first.last('replaced'));
  assert.equal(first.closed, true);
  assert.equal(second.last('welcome').token, token);
  // The old connection closing afterwards must not remove the user or their seat.
  lobby.disconnect(first);
  assert.equal(lobby.users.size, 1);
});

test('leaving hands over host; mid-hand leave below the minimum aborts the hand', () => {
  const lobby = new Lobby();
  const { humans } = seatedGame(lobby);
  const [alice, bob] = humans;
  say(lobby, alice, { t: 'startGame' });
  say(lobby, alice, { t: 'leaveGame' });
  const view = bob.last('room').room;
  assert.equal(view.players.length, MIN_PLAYERS - 1);
  assert.equal(view.hostId, bob.last('welcome').id);
  assert.equal(view.status, 'between');
  assert.ok(['aborted', 'tonk', 'tonkDraw'].includes(view.round.result.type));
});

test('reorder: only the owner gets the new order back, opponents are not notified', () => {
  const lobby = new Lobby();
  const { humans } = seatedGame(lobby);
  const [alice, bob] = humans;
  say(lobby, alice, { t: 'startGame' });
  const view = alice.last('room');
  if (view.room.status !== 'playing') return; // rare Tonk on the deal ends the hand immediately
  const hand = view.room.round.players[view.you].hand;
  const reversed = [...hand].reverse();
  const bobMsgs = bob.inbox.length;
  say(lobby, alice, { t: 'reorder', cards: reversed });
  assert.deepEqual(alice.last('room').room.round.players[view.you].hand, reversed);
  assert.equal(bob.inbox.length, bobMsgs);
  say(lobby, alice, { t: 'reorder', cards: hand.slice(1) });
  assert.match(alice.last('error').message, /order/i);
  assert.deepEqual(alice.last('room').room.round.players[view.you].hand, reversed);
});

test('chat: delivered to everyone in the room, stored in history, sanitised and rate limited', () => {
  const lobby = new Lobby();
  const alice = connect(lobby, 'Alice');
  const bob = connect(lobby, 'Bob');
  const carol = connect(lobby, 'Carol'); // lobby only, must not see room chat
  say(lobby, alice, { t: 'createGame' });
  say(lobby, bob, { t: 'joinGame', gameId: bob.last('lobby').games[0].id });

  say(lobby, alice, { t: 'chat', text: '  hello \u0007 <b>there</b>  ' });
  const got = bob.last('chat').message;
  assert.equal(got.name, 'Alice');
  assert.equal(got.text, 'hello <b>there</b>'); // trimmed, control chars removed; HTML is left for the client to escape
  assert.equal(alice.last('chat').message.id, got.id);
  assert.equal(carol.last('chat'), undefined);

  say(lobby, bob, { t: 'chat', text: 'x'.repeat(500) });
  assert.equal(alice.last('chat').message.text.length, 200);

  say(lobby, bob, { t: 'chat', text: '   ' });
  assert.match(bob.last('error').message, /empty/i);
  say(lobby, bob, { t: 'chat', text: 42 });
  assert.match(bob.last('error').message, /empty/i);
  say(lobby, carol, { t: 'chat', text: 'hi' });
  assert.match(carol.last('error').message, /table/i);

  // History is part of the room view, so rejoining/reconnecting players get it back.
  say(lobby, alice, { t: 'leaveGame' });
  say(lobby, alice, { t: 'joinGame', gameId: alice.last('lobby').games[0].id });
  assert.deepEqual(
    alice.last('room').room.chat.map((m) => m.text),
    ['hello <b>there</b>', 'x'.repeat(200)],
  );

  // Rate limit: at most 5 messages per 5 seconds per player.
  for (let i = 0; i < 6; i++) say(lobby, alice, { t: 'chat', text: `spam ${i}` });
  assert.match(alice.last('error').message, /too fast/i);
});

test('bots: only the host can add or remove them', () => {
  const lobby = new Lobby();
  const host = connect(lobby, 'Host');
  const guest = connect(lobby, 'Guest');
  say(lobby, host, { t: 'createGame' });
  say(lobby, guest, { t: 'joinGame', gameId: guest.last('lobby').games[0].id });
  say(lobby, guest, { t: 'addBot' });
  assert.match(guest.last('error').message, /host/i);
  say(lobby, host, { t: 'addBot' });
  assert.equal(host.last('room').room.players.length, 3);
  const botId = host.last('room').room.players[2].id;
  say(lobby, guest, { t: 'removeBot', id: botId });
  assert.match(guest.last('error').message, /host/i);
  say(lobby, host, { t: 'removeBot', id: guest.last('room').you }); // not a bot
  assert.match(host.last('error').message, /no such bot/i);
  say(lobby, host, { t: 'leaveGame' });
});

test('bots: join, play their turns automatically, and rooms with only bots are removed', async () => {
  const lobby = new Lobby({ botDelayMs: 5 });
  const host = connect(lobby, 'Host');
  say(lobby, host, { t: 'createGame' });
  for (let i = 1; i < MIN_PLAYERS; i++) say(lobby, host, { t: 'addBot' });
  const players = host.last('room').room.players;
  assert.equal(players.length, MIN_PLAYERS);
  assert.equal(players[1].isBot, true);
  assert.equal(players[1].connected, true);
  const botIds = players.filter((p) => p.isBot).map((p) => p.id);

  say(lobby, host, { t: 'startGame' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => host.last('room').room;
  if (state().status === 'playing') {
    // Play the human side for a few turns; the bot must answer every time on its own.
    for (let i = 0; i < 3 && state().status === 'playing'; i++) {
      const me = host.last('room').you;
      for (let w = 0; w < 100 && state().status === 'playing' && state().round.turn !== me; w++) await wait(10);
      if (state().status !== 'playing') break;
      assert.equal(state().round.turn, me, 'bot handed the turn back');
      say(lobby, host, { t: 'action', action: { type: 'draw' } });
      const hand = state().round.players[me].hand;
      say(lobby, host, { t: 'action', action: { type: 'discard', card: hand[hand.length - 1] } });
    }
    assert.ok(state().log.some((e) => e.type === 'draw' || e.type === 'takeDiscard') && state().log.some((e) => botIds.includes(e.pid)));
  }

  say(lobby, host, { t: 'leaveGame' });
  assert.equal(lobby.rooms.size, 0);
});

test('bots: can be removed at any time, including mid-hand', () => {
  const lobby = new Lobby({ botDelayMs: 100000 });
  const host = connect(lobby, 'Host');
  say(lobby, host, { t: 'createGame' });
  say(lobby, host, { t: 'addBot' });
  const botId = host.last('room').room.players[1].id;
  say(lobby, host, { t: 'removeBot', id: botId });
  assert.equal(host.last('room').room.players.length, 1);

  // Mid-hand with the minimum plus one bots: removing one keeps the hand going with the rest.
  for (let i = 0; i < MIN_PLAYERS; i++) say(lobby, host, { t: 'addBot' });
  say(lobby, host, { t: 'startGame' });
  if (host.last('room').room.status === 'playing') {
    const [, firstBot] = host.last('room').room.players;
    say(lobby, host, { t: 'removeBot', id: firstBot.id });
    const view = host.last('room').room;
    assert.equal(view.players.length, MIN_PLAYERS);
    assert.equal(view.status, 'playing');
    assert.equal(view.round.order.includes(firstBot.id), false);
    assert.ok(view.round.turn, 'someone still has the turn');

    // Removing another bot drops below the minimum: the hand is cancelled with no payoff.
    say(lobby, host, { t: 'removeBot', id: view.players[1].id });
    const after = host.last('room').room;
    assert.equal(after.status, 'between');
    assert.equal(after.round.result.type, 'aborted');
    assert.equal(after.players[0].score, 0);
  }
  say(lobby, host, { t: 'leaveGame' });
});

test('abuse limits: room cap and create-game rate limit', () => {
  const capped = new Lobby({ maxRooms: 2, createsPerMinute: 100 });
  const players = ['A', 'B', 'C'].map((n) => connect(capped, n));
  say(capped, players[0], { t: 'createGame' });
  say(capped, players[1], { t: 'createGame' });
  say(capped, players[2], { t: 'createGame' });
  assert.match(players[2].last('error').message, /full/i);
  assert.equal(capped.rooms.size, 2);
  say(capped, players[0], { t: 'leaveGame' }); // frees a slot
  say(capped, players[2], { t: 'createGame' });
  assert.ok(players[2].last('room'));

  const limited = new Lobby({ createsPerMinute: 3 });
  const spammer = connect(limited, 'Spammer');
  for (let i = 0; i < 3; i++) {
    say(limited, spammer, { t: 'createGame' });
    say(limited, spammer, { t: 'leaveGame' });
  }
  say(limited, spammer, { t: 'createGame' });
  assert.match(spammer.last('error').message, /too quickly/i);
  assert.equal(limited.rooms.size, 0);
});

test('kick: host can remove a human (even mid-hand), they cannot rejoin, others cannot kick', () => {
  const lobby = new Lobby({ botDelayMs: 100000 });
  const host = connect(lobby, 'Host');
  const bob = connect(lobby, 'Bob');
  const cy = connect(lobby, 'Cy');
  say(lobby, host, { t: 'createGame' });
  const gameId = host.last('room').room.id;
  say(lobby, bob, { t: 'joinGame', gameId });
  say(lobby, cy, { t: 'joinGame', gameId });
  const bobId = bob.last('room').you;

  say(lobby, bob, { t: 'kick', id: cy.last('room').you });
  assert.match(bob.last('error').message, /host/i);
  say(lobby, host, { t: 'kick', id: host.last('room').you });
  assert.match(host.last('error').message, /yourself/i);
  say(lobby, host, { t: 'addBot' });
  say(lobby, host, { t: 'kick', id: host.last('room').room.players.find((p) => p.isBot).id });
  assert.match(host.last('error').message, /no such player/i);

  say(lobby, host, { t: 'startGame' });
  say(lobby, host, { t: 'kick', id: bobId });
  assert.ok(bob.last('kicked'), 'kicked player is told');
  assert.equal(bob.inbox.at(-1).t, 'lobby', 'and returned to the lobby');
  const view = host.last('room').room;
  assert.equal(
    view.players.some((p) => p.id === bobId),
    false,
  );
  assert.ok(view.log.some((e) => e.type === 'kick' && e.pid === bobId));
  assert.ok(['playing', 'between'].includes(view.status)); // one fewer than before, still at or above the minimum: the table carries on

  say(lobby, bob, { t: 'joinGame', gameId });
  assert.match(bob.last('error').message, /removed/i);
  say(lobby, host, { t: 'leaveGame' });
});

test('room lifecycle: host leaving passes the host role on; rooms with no humans are deleted', () => {
  const lobby = new Lobby({ botDelayMs: 100000 });
  const a = connect(lobby, 'A');
  const b = connect(lobby, 'B');
  say(lobby, a, { t: 'createGame' });
  say(lobby, b, { t: 'joinGame', gameId: a.last('room').room.id });
  say(lobby, a, { t: 'addBot' });
  say(lobby, a, { t: 'leaveGame' }); // creator leaves: the room survives, B becomes host
  assert.equal(lobby.rooms.size, 1);
  assert.equal(b.last('room').room.hostId, b.last('room').you);
  say(lobby, b, { t: 'leaveGame' }); // only a bot left: removed
  assert.equal(lobby.rooms.size, 0);

  say(lobby, a, { t: 'createGame' });
  say(lobby, a, { t: 'leaveGame' }); // empty: removed
  assert.equal(lobby.rooms.size, 0);
});

test('idle rooms: warned, then closed; activity resets the clock', () => {
  const lobby = new Lobby({ roomIdleMs: 10 * 60000, idleWarningMs: 2 * 60000 });
  const host = connect(lobby, 'Host');
  const guest = connect(lobby, 'Guest');
  say(lobby, host, { t: 'createGame' });
  const room = [...lobby.rooms.values()][0];
  say(lobby, guest, { t: 'joinGame', gameId: room.id });
  const t0 = room.lastActivity;

  lobby.sweepIdleRooms(t0 + 5 * 60000); // not idle enough yet
  assert.equal(host.last('notice'), undefined);

  lobby.sweepIdleRooms(t0 + 8.5 * 60000); // inside the warning window
  assert.match(host.last('notice').message, /close in about \d+ min/i);
  assert.ok(guest.last('notice'));
  const notices = host.inbox.filter((m) => m.t === 'notice').length;
  lobby.sweepIdleRooms(t0 + 9 * 60000); // only warned once
  assert.equal(host.inbox.filter((m) => m.t === 'notice').length, notices);

  say(lobby, guest, { t: 'chat', text: 'still here' }); // any activity resets the timer and the warning
  const t1 = room.lastActivity;
  assert.ok(t1 >= t0);
  lobby.sweepIdleRooms(t1 + 9 * 60000);
  assert.equal(lobby.rooms.size, 1);

  lobby.sweepIdleRooms(t1 + 10 * 60000 + 1);
  assert.equal(lobby.rooms.size, 0);
  assert.match(host.last('closed').message, /closed/i);
  assert.ok(guest.last('closed'));
  assert.equal(host.inbox.at(-1).t, 'lobby');
  assert.equal(host.last('lobby').games.length, 0);

  // Closed players are back in the lobby and can create new games.
  say(lobby, host, { t: 'createGame' });
  assert.ok(host.last('room'));
});

test('input validation', () => {
  const lobby = new Lobby();
  const c = fakeConn();
  lobby.handle(c, 'not json');
  assert.equal(c.last('error').message, 'Malformed message');
  say(lobby, c, { t: 'createGame' });
  assert.match(c.last('error').message, /hello/i);
  say(lobby, c, { t: 'hello', name: '   ' });
  assert.match(c.last('error').message, /name/i);
  say(lobby, c, { t: 'hello', name: '<b>x</b>'.repeat(20) });
  assert.equal(c.last('welcome').name.length, 20);
  say(lobby, c, { t: 'hello', name: 'Croaker' });
  assert.match(c.last('error').message, /reserved/i);
});
