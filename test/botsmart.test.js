'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/tonk');
const { Room } = require('../server/room');
const { Mind } = require('../server/botmind');
const { smartAction, linkOuts, findFinish } = require('../server/botsmart');
const { estimateGoDown, goDownPayoff } = require('../server/botrisk');
const { SKILL_KEYS, profileFor, profileProblems } = require('../server/botprofiles');

const c = (rank, suit) => 'CDHS'.indexOf(suit) * 13 + rank - 1;
const skills = (overrides = {}) => ({ ...Object.fromEntries(SKILL_KEYS.map((k) => [k, 0])), ...overrides });

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

// Player 'a' at a table of a, b and c (b plays after a), with a fresh mind. Skills not named are 0.
function setup(
  { hand, phase = 'play', top = c(2, 'S'), melds = [], counts = { b: 5, c: 5 }, deckCount = 20 },
  skillValues = {},
  rng = seeded(1),
) {
  const view = {
    order: ['a', 'b', 'c'],
    turn: 'a',
    phase,
    deckCount,
    discardTop: top,
    melds,
    players: {
      a: { count: hand.length, total: null, hand },
      b: { count: counts.b, total: null, hand: null },
      c: { count: counts.c, total: null, hand: null },
    },
    result: null,
  };
  const mind = new Mind('a', skills(skillValues), rng);
  mind.start(view);
  return { view, mind };
}
const act = (s) => smartAction(s.view, 'a', s.mind);
const sightWith = (...cards) => ({ seen: new Set(cards) });

test('memory: the last full round is perfect, older discards follow the memory skill', () => {
  const players = ['a', 'b', 'c'];
  for (const [memory, expectOld] of [
    [1, true],
    [0, false],
  ]) {
    const mind = new Mind('a', skills({ memory }), seeded(3));
    mind.start({ order: players, discardTop: c(2, 'S') });
    [c(3, 'S'), c(4, 'S'), c(5, 'S'), c(6, 'S')].forEach((card, i) => mind.observe({ type: 'discard', pid: players[(i + 1) % 3], card }));
    const known = mind.pileCards();
    assert.ok(
      [c(4, 'S'), c(5, 'S'), c(6, 'S')].every((card) => known.includes(card)),
      'the last three turns are always remembered',
    );
    assert.equal(known.includes(c(3, 'S')), expectOld);
    assert.equal(known.includes(c(2, 'S')), expectOld);
  }
});

test('memory: a forgotten card stays forgotten, and a reshuffle puts the pile back in the draw pile', () => {
  const mind = new Mind('a', skills({ memory: 0.5 }), seeded(11));
  mind.start({ order: ['a', 'b', 'c'], discardTop: c(2, 'S') });
  for (let i = 0; i < 8; i++) mind.observe({ type: 'discard', pid: 'b', card: c(3 + i, 'H') });
  assert.deepEqual(mind.pileCards(), mind.pileCards());
  mind.observe({ type: 'reshuffle' });
  assert.deepEqual(mind.pileCards(), [c(10, 'H')]);
  assert.equal(mind.reshuffles, 1);
  assert.equal(mind.pileSize, 1);
});

test('memory tracks what others took from the pile and what they turned down', () => {
  const mind = new Mind('a', skills({ memory: 1 }), seeded(1));
  mind.start({ order: ['a', 'b', 'c'], discardTop: c(7, 'H') });
  mind.observe({ type: 'takeDiscard', pid: 'b', card: c(7, 'H') });
  assert.deepEqual(mind.heldBy('b'), [c(7, 'H')]);
  mind.observe({ type: 'discard', pid: 'b', card: c(9, 'C') });
  mind.observe({ type: 'draw', pid: 'c' }); // c passes on the 9 of clubs
  assert.deepEqual(mind.evidenceAgainst('c'), [c(9, 'C')]);
  assert.deepEqual(mind.evidenceAgainst('b'), [c(9, 'C')]);
  mind.observe({ type: 'meld', pid: 'b', kind: 'set', cards: [c(7, 'H'), c(7, 'S'), c(7, 'D')] });
  assert.deepEqual(mind.heldBy('b'), []);
});

test('a skill is rolled once per turn: the same question gets the same answer until the turn ends', () => {
  const mind = new Mind('a', skills({ planAhead: 0.5 }), seeded(5));
  mind.start({ order: ['a', 'b', 'c'], discardTop: c(2, 'S') });
  const first = mind.decide('planAhead');
  for (let i = 0; i < 10; i++) assert.equal(mind.decide('planAhead'), first);
  const answers = new Set();
  for (let i = 0; i < 40; i++) {
    mind.observe({ type: 'discard', pid: 'b', card: c(3, 'H') });
    answers.add(mind.decide('planAhead'));
  }
  assert.equal(answers.size, 2, 'a new turn is a new roll');
});

test('linkOuts counts the cards that could still complete a spread, and not the ones already seen', () => {
  assert.equal(linkOuts(c(7, 'S'), [c(7, 'H')], sightWith(c(7, 'S'), c(7, 'H'))), 2);
  assert.equal(linkOuts(c(7, 'S'), [c(7, 'H')], sightWith(c(7, 'S'), c(7, 'H'), c(7, 'D'), c(7, 'C'))), 0);
  assert.equal(linkOuts(c(10, 'D'), [c(12, 'D')], sightWith(c(10, 'D'), c(12, 'D'))), 1, 'only the jack fits between them');
  assert.equal(linkOuts(c(10, 'D'), [c(11, 'D')], sightWith(c(10, 'D'), c(11, 'D'), c(12, 'D'))), 1, 'only the nine is left');
});

test('findFinish finds a way to put every card down, and nothing when there is none', () => {
  const run = { id: 1, owner: 'b', type: 'run', cards: [c(5, 'D'), c(6, 'D'), c(7, 'D'), c(8, 'D')] };
  const winning = [c(5, 'S'), c(6, 'S'), c(7, 'S'), c(9, 'D'), c(4, 'D')];
  assert.ok(findFinish(winning, [run]));
  assert.equal(findFinish(winning, []), null, 'without the spread on the table two cards are left over');
  assert.equal(findFinish([c(1, 'S'), c(5, 'H'), c(9, 'C'), c(12, 'D'), c(3, 'D')], [run]), null);
});

test('finishHand: the bot picks the spreads that empty its hand, not the biggest one', () => {
  const hand = [c(4, 'S'), c(5, 'S'), c(6, 'S'), c(6, 'H'), c(6, 'D'), c(6, 'C')];
  assert.equal(act(setup({ hand })).cards.length, 4, 'greedy: the four sixes leave two cards');
  const planned = act(setup({ hand }, { finishHand: 1 }));
  assert.equal(planned.type, 'meld');
  assert.deepEqual([...planned.cards].sort(), [c(4, 'S'), c(5, 'S'), c(6, 'S')].sort(), 'the run first, then the three sixes');
});

test('finishHand chase: with few cards left it keeps the pair that can still empty the hand', () => {
  const hand = [c(5, 'H'), c(5, 'D'), c(2, 'C'), c(3, 'S')];
  assert.equal(act(setup({ hand })).card, c(5, 'H'), 'without the skill it throws the highest card');
  assert.equal(act(setup({ hand }, { finishHand: 1 })).card, c(3, 'S'), 'with it, it keeps the pair and drops the dearest of the rest');
  const dead = setup({ hand }, { finishHand: 1, memory: 1 });
  dead.mind.observe({ type: 'discard', pid: 'b', card: c(5, 'S') });
  dead.mind.observe({ type: 'discard', pid: 'c', card: c(5, 'C') });
  assert.equal(act(dead).card, c(5, 'H'), 'both other fives are gone: the pair is no longer worth keeping');
});

test('finishHand chase: it takes a discard that lets it empty its hand this turn, and does not go down with a sure win in hand', () => {
  const pair = [c(5, 'H'), c(5, 'D')];
  assert.equal(act(setup({ hand: pair, phase: 'draw', top: c(5, 'S') }, { finishHand: 1, goDownRisk: 1 })).type, 'takeDiscard');
  assert.notEqual(act(setup({ hand: pair, phase: 'draw', top: c(9, 'S') }, { finishHand: 1, goDownRisk: 1 })).type, 'takeDiscard');

  // One card that fits a run on the table: any card drawn lets it lay that card off and discard the other.
  // Going down would win 1 bet from each opponent; emptying the hand wins 2 from each. With no discard in view it draws.
  const run = { id: 1, owner: 'b', type: 'run', cards: [c(5, 'D'), c(6, 'D'), c(7, 'D'), c(8, 'D')] };
  const one = { hand: [c(9, 'D')], phase: 'draw', top: null, melds: [run] };
  assert.equal(act(setup(one, { goDownRisk: 1, layoffOthers: 1 })).type, 'goDown');
  assert.equal(act(setup(one, { goDownRisk: 1, layoffOthers: 1, finishHand: 1 })).type, 'draw');
});

test('planAhead keeps a pair together instead of throwing away the highest card', () => {
  const hand = [c(13, 'S'), c(13, 'D'), c(2, 'C'), c(4, 'H'), c(9, 'D')];
  assert.equal(act(setup({ hand })).card, c(13, 'S'));
  assert.equal(act(setup({ hand }, { planAhead: 1 })).card, c(9, 'D'));
});

test('planAhead does not count cards it has seen go by as outs', () => {
  const hand = [c(13, 'S'), c(13, 'D'), c(2, 'C'), c(4, 'H'), c(9, 'D')];
  const s = setup({ hand }, { planAhead: 1, memory: 1 });
  s.mind.observe({ type: 'discard', pid: 'b', card: c(13, 'H') });
  s.mind.observe({ type: 'discard', pid: 'c', card: c(13, 'C') });
  assert.equal(act(s).card, c(13, 'S'), 'both other kings are gone, so the pair is dead');
});

test('danger: with an opponent about to empty their hand it sheds the high cards', () => {
  const hand = [c(13, 'S'), c(13, 'D'), c(2, 'C'), c(4, 'H'), c(8, 'D')];
  const counts = { b: 1, c: 5 };
  assert.equal(act(setup({ hand, counts }, { planAhead: 1 })).card, c(8, 'D'));
  assert.equal(act(setup({ hand, counts }, { planAhead: 1, danger: 1 })).card, c(13, 'S'));
});

test('denyHelp: it will not hand the next player a card that extends a spread, unless that leaves it a hand to go down with', () => {
  const run = { id: 1, owner: 'b', type: 'run', cards: [c(5, 'D'), c(6, 'D'), c(7, 'D'), c(8, 'D')] };
  const hand = [c(9, 'D'), c(8, 'C'), c(2, 'S'), c(3, 'H'), c(4, 'C')];
  assert.equal(act(setup({ hand, melds: [run] })).card, c(9, 'D'));
  assert.equal(act(setup({ hand, melds: [run] }, { denyHelp: 1 })).card, c(8, 'C'));
  const low = [c(9, 'D'), c(1, 'C'), c(2, 'S'), c(3, 'H'), c(4, 'C')];
  assert.equal(act(setup({ hand: low, melds: [run] }, { denyHelp: 1 })).card, c(9, 'D'), 'the rest is 10: it gives the help away anyway');
});

test('denyHelp uses its memory of what the next player took from the pile', () => {
  const hand = [c(9, 'C'), c(9, 'H'), c(2, 'S'), c(3, 'D'), c(4, 'H')];
  const choose = (memory, turnsLater) => {
    const s = setup({ hand }, { denyHelp: 1, memory });
    s.mind.observe({ type: 'takeDiscard', pid: 'b', card: c(10, 'C') });
    for (const [pid, card] of [
      ['c', c(13, 'S')],
      ['a', c(12, 'S')],
      ['c', c(11, 'S')],
    ].slice(0, turnsLater)) {
      s.mind.observe({ type: 'discard', pid, card });
    }
    return act(s).card;
  };
  assert.equal(choose(0, 0), c(9, 'H'), 'b holds the ten of clubs, so the nine of clubs would help them');
  assert.equal(choose(1, 3), c(9, 'H'), 'still remembered a full round later');
  assert.equal(choose(0, 3), c(9, 'C'), 'forgotten a full round later: nothing to be careful about');
});

test('denyHelp uses what a player threw away: they are unlikely to want the same kind of card', () => {
  const hand = [c(9, 'C'), c(9, 'H'), c(2, 'S'), c(3, 'D'), c(4, 'H')];
  const choose = (thrown) => {
    const s = setup({ hand }, { denyHelp: 1, memory: 1 });
    s.mind.observe({ type: 'takeDiscard', pid: 'b', card: c(10, 'C') });
    if (thrown) s.mind.observe({ type: 'discard', pid: 'b', card: c(8, 'C') });
    return act(s).card;
  };
  assert.equal(choose(false), c(9, 'H'));
  assert.equal(choose(true), c(9, 'C'), 'b threw away an eight of clubs, so a nine of clubs worries it less');
});

test('going down: the second empty draw pile forces it, the first does not', () => {
  const hand = [c(13, 'S'), c(12, 'D'), c(11, 'C'), c(10, 'H'), c(9, 'D')];
  const first = setup({ hand, phase: 'draw', deckCount: 0 }, { goDownRisk: 1 });
  first.mind.drops.push(first.mind.drop(c(3, 'S'), 'b')); // a pile that can be reshuffled
  assert.equal(act(first).type, 'draw');
  first.mind.observe({ type: 'reshuffle' });
  assert.equal(act(first).type, 'goDown');
});

test('going down: it weighs the risk, and a gut feeling can wrongly feel safe', () => {
  assert.equal(act(setup({ hand: [c(1, 'S'), c(2, 'D'), c(3, 'C')], phase: 'draw' }, { goDownRisk: 1 })).type, 'goDown');
  assert.equal(act(setup({ hand: [c(13, 'S'), c(12, 'D'), c(8, 'C'), c(4, 'H')], phase: 'draw' }, { goDownRisk: 1 })).type, 'draw');

  // Fifteen is hopeless against opponents who have two cards left each...
  const hand = [c(10, 'S'), c(5, 'D')];
  const counts = { b: 2, c: 2 };
  assert.equal(act(setup({ hand, phase: 'draw', counts }, { goDownRisk: 1 })).type, 'draw');
  // ...but on a gut-feeling roll (first number) with a wishful threshold (second number) the bot goes down anyway.
  const rolls = [0.1, 0.99];
  assert.equal(act(setup({ hand, phase: 'draw', counts }, { goDownRisk: 0 }, () => rolls.shift() ?? 0.5)).type, 'goDown');
});

test('going down: the estimate pays out like the real rules', () => {
  assert.equal(goDownPayoff(10, [11, 20]), 2);
  assert.equal(goDownPayoff(10, [10, 20]), -2, 'a tie loses');
  assert.equal(goDownPayoff(10, [5, 6]), -4);
  const unseen = [...Array(52).keys()];
  const five = { count: 5, known: [] };
  assert.equal(estimateGoDown(3, [five, five], unseen, seeded(2)), 2, 'five cards always add up to more than three');
  assert.equal(estimateGoDown(60, [{ count: 1, known: [c(1, 'S')] }], unseen, seeded(2)), -2, 'a known ace beats it');
});

test('takes a discard that helps, or that makes a promising pair of a cheap card', () => {
  const hand = [c(8, 'C'), c(8, 'D'), c(13, 'S'), c(12, 'S'), c(2, 'H')];
  assert.equal(act(setup({ hand, phase: 'draw', top: c(8, 'H') }, { spotDiscard: 1 })).type, 'takeDiscard');
  assert.equal(act(setup({ hand, phase: 'draw', top: c(8, 'H') })).type, 'draw', 'it does not notice');
  const pair = [c(6, 'C'), c(13, 'D'), c(12, 'S'), c(11, 'H'), c(2, 'H')];
  assert.equal(act(setup({ hand: pair, phase: 'draw', top: c(6, 'S') }, { spotDiscard: 1 })).type, 'takeDiscard');
  const dear = [c(13, 'C'), c(5, 'D'), c(12, 'S'), c(11, 'H'), c(2, 'H')];
  assert.equal(
    act(setup({ hand: dear, phase: 'draw', top: c(13, 'S') }, { spotDiscard: 1 })).type,
    'draw',
    'a king is too dear to keep for a pair',
  );
});

test('layoffOthers: it always adds to its own spreads, and to the others only when it notices them', () => {
  const hand = [c(9, 'D'), c(1, 'C'), c(13, 'S'), c(12, 'H'), c(2, 'H')];
  const own = { id: 1, owner: 'a', type: 'run', cards: [c(5, 'D'), c(6, 'D'), c(7, 'D'), c(8, 'D')] };
  const other = { ...own, owner: 'b' };
  assert.equal(act(setup({ hand, melds: [own] })).type, 'layoff');
  assert.equal(act(setup({ hand, melds: [other] })).type, 'discard');
  assert.deepEqual(act(setup({ hand, melds: [other] }, { layoffOthers: 1 })), { type: 'layoff', card: c(9, 'D'), meldId: 1 });
});

test('the bot only ever sees what a human at its seat sees', () => {
  const room = new Room('R', 'Test', seeded(9));
  const host = { id: 'h', name: 'Ann', conn: {}, room: null };
  room.join(host);
  const bots = [room.addBot(), room.addBot()];
  room.startHand(host);
  const { view } = room.botSight(bots[0]);
  assert.equal(view.players[host.id].hand, null);
  assert.equal(view.players[bots[1].id].hand, null);
  assert.equal(view.players[bots[0].id].hand.length, 5);
  assert.equal('deck' in view, false);
  assert.equal('discard' in view, false);
});

test('smart bots play whole games legally and their memory matches the real table', () => {
  let hands = 0;
  let goDowns = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const room = new Room('R', 'Test', seeded(seed), { settings: { startingCoins: 100, bet: 5 } });
    const host = { id: 'h', name: 'Ann', conn: {}, room: null };
    room.join(host);
    room.addBot();
    room.addBot();
    for (let h = 0; h < 15 && room.players.length >= T.MIN_PLAYERS; h++) {
      room.startHand(host);
      for (const p of room.pendingTonkers) room.declareTonk(p);
      for (let steps = 0; room.status === 'playing'; steps++) {
        assert.ok(steps < 1000, `seed ${seed} hand ${h} did not finish`);
        const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
        const { view, mind } = room.botSight(user);
        assert.equal(mind.pileSize, room.round.discard.length, 'it knows how many cards are in the discard pile');
        for (const other of room.players) {
          if (other === user) continue;
          for (const card of mind.heldBy(other.id)) assert.ok(room.round.hands[other.id].includes(card), 'a card it thinks they hold');
        }
        room.act(user, smartAction(view, user.id, mind));
      }
      hands++;
      if (room.round.result.type === 'down') goDowns++;
    }
  }
  assert.ok(hands > 20);
  assert.ok(goDowns > 0, 'bots go down');
});

test('every bot name has a valid profile, and difficulty scales all skills together', () => {
  assert.deepEqual(profileProblems(), []);
  const bot = { isBot: true, name: 'Croaker' };
  const normal = profileFor(bot);
  const easier = profileFor(bot, 0.5);
  for (const key of SKILL_KEYS) assert.equal(easier.skills[key], normal.skills[key] / 2);
  assert.ok(Object.values(profileFor(bot, 3).skills).every((v) => v <= 1));
  assert.equal(profileFor({ isBot: false, name: 'Croaker' }).tag, 'normal', 'a human seat gets the stand-in');
});
