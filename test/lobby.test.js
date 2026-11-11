'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Lobby } = require('../server/lobby');

// Minimal fake connection that records what the server sends.
function fakeConn() {
  const conn = {
    readyState: 1,
    user: null,
    inbox: [],
    closed: false,
    send(s) { this.inbox.push(JSON.parse(s)); },
    close() { this.closed = true; this.readyState = 3; },
    last(type) { return [...this.inbox].reverse().find((m) => m.t === type); },
  };
  return conn;
}

const say = (lobby, conn, msg) => lobby.handle(conn, JSON.stringify(msg));

function connect(lobby, name) {
  const conn = fakeConn();
  say(lobby, conn, { t: 'hello', name });
  return conn;
}

test('create, list, join, start and play a hand through the lobby', () => {
  const lobby = new Lobby({ graceMs: 10 });
  const alice = connect(lobby, 'Alice');
  const bob = connect(lobby, 'Bob');
  assert.equal(alice.last('lobby').games.length, 0);

  say(lobby, alice, { t: 'createGame' });
  assert.equal(bob.last('lobby').games.length, 1);
  const gameId = bob.last('lobby').games[0].id;

  say(lobby, bob, { t: 'joinGame', gameId });
  assert.equal(alice.last('room').room.players.length, 2);

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
    const mover = turnId === aView.you ? alice : bob;
    const other = mover === alice ? bob : alice;
    say(lobby, other, { t: 'action', action: { type: 'draw' } });
    assert.match(other.last('error').message, /turn/i);
    say(lobby, mover, { t: 'action', action: { type: 'draw' } });
    const mv = mover.last('room').room.round;
    assert.equal(mv.phase, 'play');
    assert.equal(mv.players[turnId].hand.length, 6);
    say(lobby, mover, { t: 'action', action: { type: 'discard', card: mv.players[turnId].hand[0] } });
    assert.equal(other.last('room').room.round.turn, other.last('room').you);
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

test('leaving hands over host; mid-hand leave with two players aborts the hand', () => {
  const lobby = new Lobby();
  const alice = connect(lobby, 'Alice');
  const bob = connect(lobby, 'Bob');
  say(lobby, alice, { t: 'createGame' });
  say(lobby, bob, { t: 'joinGame', gameId: bob.last('lobby').games[0].id });
  say(lobby, alice, { t: 'startGame' });
  say(lobby, alice, { t: 'leaveGame' });
  const view = bob.last('room').room;
  assert.equal(view.players.length, 1);
  assert.equal(view.hostId, bob.last('welcome').id);
  assert.equal(view.status, 'between');
  assert.ok(['aborted', 'tonk', 'tonkDraw'].includes(view.round.result.type));
});

test('reorder: only the owner gets the new order back, opponents are not notified', () => {
  const lobby = new Lobby();
  const alice = connect(lobby, 'Alice');
  const bob = connect(lobby, 'Bob');
  say(lobby, alice, { t: 'createGame' });
  say(lobby, bob, { t: 'joinGame', gameId: bob.last('lobby').games[0].id });
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
  assert.match(carol.last('error').message, /game/i);

  // History is part of the room view, so rejoining/reconnecting players get it back.
  say(lobby, alice, { t: 'leaveGame' });
  say(lobby, alice, { t: 'joinGame', gameId: alice.last('lobby').games[0].id });
  assert.deepEqual(alice.last('room').room.chat.map((m) => m.text), ['hello <b>there</b>', 'x'.repeat(200)]);

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
  say(lobby, host, { t: 'addBot' });
  const players = host.last('room').room.players;
  assert.equal(players.length, 2);
  assert.equal(players[1].isBot, true);
  assert.equal(players[1].connected, true);

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
    assert.ok(state().log.some((e) => e.type === 'draw' || e.type === 'takeDiscard') && state().log.some((e) => e.pid === players[1].id));
  }

  say(lobby, host, { t: 'leaveGame' });
  assert.equal(lobby.rooms.size, 0);
});

test('bots: can be removed between hands but not mid-hand', () => {
  const lobby = new Lobby({ botDelayMs: 100000 });
  const host = connect(lobby, 'Host');
  say(lobby, host, { t: 'createGame' });
  say(lobby, host, { t: 'addBot' });
  const botId = host.last('room').room.players[1].id;
  say(lobby, host, { t: 'removeBot', id: botId });
  assert.equal(host.last('room').room.players.length, 1);
  say(lobby, host, { t: 'addBot' });
  say(lobby, host, { t: 'startGame' });
  if (host.last('room').room.status === 'playing') {
    say(lobby, host, { t: 'removeBot', id: host.last('room').room.players[1].id });
    assert.match(host.last('error').message, /finish/i);
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
});
