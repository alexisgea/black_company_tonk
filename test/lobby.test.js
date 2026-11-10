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
