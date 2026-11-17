'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/tonk');
const TUNING = require('../server/bottuning');
const { Room } = require('../server/room');
const { Lobby } = require('../server/lobby');
const { Mind, NO_TRAITS } = require('../server/botmind');
const { smartAction, smartThink, linkOuts, findFinish } = require('../server/botsmart');
const { estimateGoDown, goDownPayoff } = require('../server/botrisk');
const { SKILL_KEYS, BASE_TRAITS, profileFor, profileProblems } = require('../server/botprofiles');
const { BOTS } = require('../server/botnames');

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
  traits = undefined,
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
  const mind = new Mind('a', skills(skillValues), rng, traits && { ...NO_TRAITS, ...traits });
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
  // ...but on a gut-feeling roll (first number) with a wishful threshold (last number) the bot goes down anyway.
  const rolls = [0.1, 0.99, 0.99];
  assert.equal(act(setup({ hand, phase: 'draw', counts, top: null }, { goDownRisk: 0 }, () => rolls.shift() ?? 0.5)).type, 'goDown');

  // Rarely the gut feeling is wild (second number) and sends it down with a big hand; a normal one does not.
  const big = [c(10, 'S'), c(10, 'D'), c(5, 'C')];
  const wild = [0.1, 0.01, 0.99];
  assert.equal(act(setup({ hand: big, phase: 'draw', counts, top: null }, { goDownRisk: 0 }, () => wild.shift() ?? 0.5)).type, 'goDown');
  const normal = [0.1, 0.5, 0.99];
  assert.equal(act(setup({ hand: big, phase: 'draw', counts, top: null }, { goDownRisk: 0 }, () => normal.shift() ?? 0.5)).type, 'draw');
});

test('going down: heads-up a calculating bot can go down (a go-down pays one bet from one opponent)', () => {
  const s = setup({ hand: [c(1, 'S'), c(2, 'D')], phase: 'draw', counts: { b: 5 } }, { goDownRisk: 1 });
  s.view.order = ['a', 'b'];
  delete s.view.players.c;
  assert.equal(act(s).type, 'goDown');
});

test('going down: opponents who have played a while hold lower cards than a uniform deal says', () => {
  const unseen = [...Array(52).keys()];
  const rival = [{ count: 3, known: [] }];
  const uniform = estimateGoDown(14, rival, unseen, seeded(3), 400, 0);
  const leaning = estimateGoDown(14, rival, unseen, seeded(3), 400, 0.2);
  assert.ok(leaning < uniform, `${leaning} should be below ${uniform}: low hidden cards make a go-down riskier`);
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
          // An old memory can be half remembered (the right rank, maybe the wrong suit), so only the rank must be there.
          for (const card of mind.heldBy(other.id)) {
            assert.ok(
              room.round.hands[other.id].some((held) => held % 13 === card % 13),
              'a card it thinks they hold',
            );
          }
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

// Re-decides every discard of some full games with one scoring term of chooseDiscard switched off (all skills 1, no
// traits, same random numbers) and counts how often the choice changes. No term may decide nearly everything or nothing.
test('no discard scoring term dominates or does nothing', () => {
  const original = { ...TUNING };
  const off = {
    keep: { KEEP_WEIGHT: 0 },
    help: { HELP_WEIGHT: 0 },
    chase: { CHASE_WEIGHT: 0 },
    threat: { THREAT_HIGH_CARD_BOOST: 0, THREAT_PLAN_DAMPING: 0 },
    all: { KEEP_WEIGHT: 0, HELP_WEIGHT: 0, CHASE_WEIGHT: 0, THREAT_HIGH_CARD_BOOST: 0, THREAT_PLAN_DAMPING: 0 },
  };
  const full = Object.fromEntries(SKILL_KEYS.map((k) => [k, 1]));
  const decideWith = (view, id, mind, seed, overrides) => {
    const copy = Object.assign(Object.create(Mind.prototype), mind, {
      skills: full,
      traits: NO_TRAITS,
      rolls: new Map(),
      rng: seeded(seed),
    });
    Object.assign(TUNING, original, overrides);
    try {
      return smartAction(view, id, copy);
    } finally {
      Object.assign(TUNING, original);
    }
  };
  const changed = Object.fromEntries(Object.keys(off).map((k) => [k, 0]));
  let decisions = 0;
  let chaseHands = 0;
  let threatHands = 0;
  let chaseChanged = 0;
  let threatChanged = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const room = new Room('R', 'Test', seeded(seed), { settings: { startingCoins: 100, bet: 5 } });
    const host = { id: 'h', name: 'Ann', conn: {}, room: null };
    room.join(host);
    for (let i = 0; i < 2 + (seed % 3); i++) room.addBot();
    for (let h = 0; h < 12 && room.players.length >= T.MIN_PLAYERS; h++) {
      room.startHand(host);
      for (const p of room.pendingTonkers) room.declareTonk(p);
      for (let steps = 0; room.status === 'playing' && steps < 1000; steps++) {
        const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
        const { view, mind } = room.botSight(user);
        const base = view.phase === 'play' && decideWith(view, user.id, mind, seed * 7 + steps, {});
        if (base && base.type === 'discard') {
          decisions++;
          const chase = view.players[user.id].hand.length - 1 <= TUNING.CHASE_MAX_CARDS;
          const threat = view.order.some((p) => p !== user.id && view.players[p].count <= 2);
          chaseHands += chase;
          threatHands += threat;
          for (const [term, overrides] of Object.entries(off)) {
            const pick = decideWith(view, user.id, mind, seed * 7 + steps, overrides);
            if (pick.type === 'discard' && pick.card === base.card) continue;
            changed[term]++;
            if (term === 'chase' && chase) chaseChanged++;
            if (term === 'threat' && threat) threatChanged++;
          }
        }
        room.act(user, smartAction(view, user.id, mind));
      }
    }
  }
  const share = (n, of = decisions) => n / of;
  assert.ok(decisions > 500, 'enough discards to measure');
  assert.ok(share(changed.all) > 0.1, 'the heuristics change a real share of the choices, not only the card values');
  assert.ok(share(changed.all) < 0.6, 'the card value still drives most choices');
  for (const term of ['keep', 'help']) {
    assert.ok(share(changed[term]) > 0.03, `${term} matters`);
    assert.ok(share(changed[term]) < 0.4, `${term} does not decide most choices`);
  }
  assert.ok(share(chaseChanged, chaseHands) > 0.01, 'chase matters when few cards are left');
  assert.ok(share(threatChanged, threatHands) > 0.01, 'threat matters when an opponent is nearly out');
  assert.ok(share(changed.chase) < 0.1 && share(changed.threat) < 0.1, 'the endgame terms stay endgame terms');
});

test('a bot works its move out once per position and plays that same move', () => {
  const room = new Room('R', 'Test', seeded(5));
  const host = { id: 'h', name: 'Ann', conn: {}, room: null };
  room.join(host);
  room.addBot();
  room.addBot();
  room.startHand(host);
  for (const p of room.pendingTonkers) room.declareTonk(p);
  const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
  const first = room.botThink(user);
  assert.equal(room.botThink(user), first, 'asking again does not think again');
  room.act(user, first.action);
  const next = room.players.find((p) => p.id === room.round.order[room.round.turn]);
  assert.notEqual(room.botThink(next), first, 'a new position gets a new plan');
});

test('every bot has a valid profile by id, and difficulty scales all skills together', () => {
  assert.deepEqual(profileProblems(), []);
  const bot = { isBot: true, botId: 'croaker', name: 'Croaker' };
  const normal = profileFor(bot);
  const easier = profileFor(bot, 0.5);
  for (const key of SKILL_KEYS) assert.equal(easier.skills[key], normal.skills[key] / 2);
  assert.ok(Object.values(profileFor(bot, 3).skills).every((v) => v <= 1));
  assert.equal(profileFor({ isBot: false, botId: 'croaker', name: 'Croaker' }).tag, 'normal', 'a human seat gets the stand-in');
  assert.equal(profileFor({ ...bot, name: 'Renamed' }).speed, normal.speed, 'the profile follows the id, not the name');
});

test('a bot added to a room has a unique id for its character, and the room uses it for its profile', () => {
  const room = new Room('R', 'Test', seeded(4));
  room.join({ id: 'h', name: 'Ann', conn: {}, room: null });
  const bots = [room.addBot(), room.addBot(), room.addBot()];
  assert.equal(new Set(bots.map((b) => b.botId)).size, 3);
  for (const bot of bots) assert.ok(BOTS.some((b) => b.id === bot.botId && b.name === bot.name));
});

test('taking a discard that completes a spread is noticed even when the hand has a bigger spread', () => {
  const hand = [c(7, 'C'), c(7, 'D'), c(7, 'H'), c(5, 'S'), c(6, 'S')];
  assert.equal(act(setup({ hand, phase: 'draw', top: c(4, 'S') }, { spotDiscard: 1 })).type, 'takeDiscard');
  assert.equal(act(setup({ hand, phase: 'draw', top: c(4, 'S') })).type, 'draw', 'it does not notice');
});

test('memory follows a seat change, and forgets a player who leaves', () => {
  const mind = new Mind('a', skills({ memory: 1 }), seeded(1));
  mind.start({ order: ['a', 'b', 'c'], discardTop: c(7, 'H') });
  mind.observe({ type: 'takeDiscard', pid: 'b', card: c(7, 'H') });
  mind.observe({ type: 'discard', pid: 'b', card: c(9, 'C') });
  mind.observe({ type: 'draw', pid: 'c' });
  mind.rename('b', 'b2');
  mind.rename('a', 'a2');
  assert.equal(mind.id, 'a2');
  assert.deepEqual(mind.order, ['a2', 'b2', 'c']);
  assert.deepEqual(mind.heldBy('b2'), [c(7, 'H')]);
  assert.deepEqual(mind.heldBy('b'), []);
  assert.deepEqual(mind.evidenceAgainst('b2'), [c(9, 'C')]);
  mind.observe({ type: 'leave', pid: 'b2' });
  assert.deepEqual(mind.heldBy('b2'), []);
  assert.deepEqual(mind.order, ['a2', 'c']);
  mind.observe({ type: 'kick', pid: 'c' });
  assert.deepEqual(mind.order, ['a2']);
});

test('a guest taking over a bot keeps its memory, under the new id', () => {
  const room = new Room('R', 'Test', seeded(6));
  const host = { id: 'h', name: 'Ann', conn: {}, room: null };
  const guest = { id: 'g', name: 'Gus', conn: {}, room: null };
  room.join(host);
  const bot = room.addBot();
  room.addBot();
  room.watch(guest);
  room.startHand(host);
  room.takeSeat(guest, bot.id);
  assert.equal(room.minds.has(bot.id), false);
  assert.equal(room.minds.get('g').id, 'g');
  assert.ok(room.minds.get('h').order.includes('g'));
  assert.equal(room.minds.get('h').order.includes(bot.id), false);
});

test('a fault in a bot memory does not undo the move that was played', () => {
  const room = new Room('R', 'Test', seeded(8));
  const host = { id: 'h', name: 'Ann', conn: {}, room: null };
  room.join(host);
  room.addBot();
  room.startHand(host);
  for (const p of room.pendingTonkers) room.declareTonk(p);
  const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
  const mind = room.mindOf(user);
  mind.observe = () => {
    throw new Error('boom');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    room.act(user, { type: 'draw' });
  } finally {
    console.error = quiet;
  }
  assert.equal(room.round.phase, 'play');
  assert.equal(room.log.at(-1).type, 'draw');
});

test('every character has valid traits, and traits are not scaled by difficulty', () => {
  const bot = { isBot: true, botId: 'lieutenant', name: 'The Lieutenant' };
  assert.equal(profileFor(bot).traits.thumbRate, 0.9);
  assert.deepEqual(profileFor(bot, 0.5).traits, profileFor(bot).traits);
  assert.deepEqual(Object.keys(profileFor(bot).traits).sort(), Object.keys(BASE_TRAITS).sort());
});

test('sloppiness: a sloppy bot sometimes throws a close second-best card, a precise one never does', () => {
  const hand = [c(10, 'S'), c(9, 'D'), c(8, 'C'), c(2, 'H'), c(3, 'D')];
  const thrown = (sloppiness, seed) => act(setup({ hand }, {}, seeded(seed), { sloppiness })).card;
  const precise = new Set();
  const sloppy = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    precise.add(thrown(0, seed));
    sloppy.add(thrown(0.5, seed));
  }
  assert.deepEqual([...precise], [c(10, 'S')]);
  assert.ok(sloppy.has(c(10, 'S')) && sloppy.size > 1, 'usually the dearest, now and then another');
  assert.ok(!sloppy.has(c(2, 'H')), 'but never a wild choice');
});

test('dumpHigh: the habit throws away the dearest card even when it breaks a pair', () => {
  const hand = [c(9, 'S'), c(9, 'D'), c(13, 'C'), c(2, 'H'), c(3, 'D')];
  const pair = [c(13, 'S'), c(13, 'D'), c(2, 'C'), c(4, 'H'), c(9, 'D')];
  assert.equal(act(setup({ hand: pair }, { planAhead: 1 })).card, c(9, 'D'), 'it normally keeps the pair of kings');
  assert.equal(act(setup({ hand: pair }, { planAhead: 1 }, seeded(1), { dumpHigh: 1 })).card, c(13, 'S'), 'but the habit dumps a king');
  assert.equal(act(setup({ hand }, {}, seeded(1), { dumpHigh: 1 })).card, c(13, 'C'));
});

test('thumbRate: a conservative bot goes down at its rule of thumb and not above it, whatever the calculation says', () => {
  const traits = { thumbRate: 1, thumbAt: 12 };
  const low = [c(1, 'S'), c(2, 'D'), c(3, 'C'), c(4, 'H')];
  const high = [c(13, 'S'), c(12, 'D'), c(10, 'C')];
  assert.equal(act(setup({ hand: low, phase: 'draw' }, {}, seeded(1), traits)).type, 'goDown');
  assert.notEqual(act(setup({ hand: high, phase: 'draw' }, { goDownRisk: 1 }, seeded(1), traits)).type, 'goDown');
  const borderline = [c(10, 'S'), c(3, 'D')];
  assert.notEqual(
    act(setup({ hand: borderline, phase: 'draw', top: null }, {}, seeded(1), traits)).type,
    'goDown',
    '13 is over the rule of thumb',
  );
});

test('panic: with an opponent nearly out a nervous bot goes down with a middling hand, a calm one does not', () => {
  const hand = [c(10, 'S'), c(8, 'D'), c(2, 'H')];
  const decide = (counts, panic) =>
    act(setup({ hand, phase: 'draw', counts, top: null }, { goDownRisk: 1, danger: 1 }, seeded(2), { panic })).type;
  const nearlyOut = { b: 2, c: 2 };
  assert.notEqual(decide(nearlyOut, 0), 'goDown', 'twenty against two-card hands is a bad bet');
  assert.equal(decide(nearlyOut, 1), 'goDown', 'but it panics');
  assert.notEqual(decide({ b: 3, c: 3 }, 1), 'goDown', 'nobody is nearly out, so there is nothing to panic about');
});

test('ownMiss: a bot can overlook that a card fits its own spread', () => {
  const hand = [c(9, 'D'), c(1, 'C'), c(13, 'S'), c(12, 'H'), c(2, 'H')];
  const own = { id: 1, owner: 'a', type: 'run', cards: [c(5, 'D'), c(6, 'D'), c(7, 'D'), c(8, 'D')] };
  assert.equal(act(setup({ hand, melds: [own] }, {}, seeded(1), { ownMiss: 0 })).type, 'layoff');
  assert.equal(act(setup({ hand, melds: [own] }, {}, seeded(1), { ownMiss: 1 })).type, 'discard');
});

test('blur: an old memory keeps the rank but can lose the suit; the last round is always exact', () => {
  const mind = new Mind('a', skills({ memory: 1 }), seeded(7), { ...NO_TRAITS, blur: 1 });
  mind.start({ order: ['a', 'b', 'c'], discardTop: c(2, 'S') });
  const real = [c(3, 'S'), c(4, 'S'), c(5, 'S'), c(6, 'S'), c(7, 'S'), c(8, 'S'), c(9, 'S'), c(10, 'S')];
  real.forEach((card, i) => mind.observe({ type: 'discard', pid: ['b', 'c', 'a'][i % 3], card }));
  const known = mind.pileCards();
  const ranks = (cards) => cards.map((card) => card % 13);
  assert.deepEqual(ranks(known), ranks([c(2, 'S'), ...real]), 'every rank is right');
  assert.notDeepEqual(known, [c(2, 'S'), ...real], 'but some suit is wrong');
  assert.deepEqual(known.slice(-3), real.slice(-3), 'the last round is exact');
  assert.deepEqual(mind.pileCards(), known, 'a blurred memory stays the same');
});

test('boldness: a bold bot goes down on a thinner edge than a timid one', () => {
  const downs = (boldness) => {
    let n = 0;
    for (let k = 1; k <= 10; k++) {
      const s = setup({ hand: [c(10, 'S'), c(k, 'D')], phase: 'draw', top: null }, { goDownRisk: 1 });
      s.mind.boldness = boldness;
      if (act(s).type === 'goDown') n++;
    }
    return n;
  };
  assert.ok(downs(1) > downs(-1), `${downs(1)} should be more than ${downs(-1)}`);
});

test('mood: wins build confidence, a failed go-down shakes it, and it fades; being behind makes a moody bot bolder', () => {
  const room = new Room('R', 'Test', seeded(5));
  room.join({ id: 'h', name: 'Ann', conn: {}, room: null });
  const bot = room.addBot();
  const other = room.addBot();
  room.round = { order: [bot.id] };
  const confidence = () => room.moods.get(bot.id).confidence;
  room.updateMoods({ type: 'down', actor: 'h', success: true, deltas: { [bot.id]: 2 } });
  const afterWin = confidence();
  assert.ok(afterWin > 0);
  room.updateMoods({ type: 'down', actor: bot.id, success: false, deltas: { [bot.id]: -4 } });
  assert.ok(confidence() < 0, 'a failed go-down makes it gun-shy');
  for (let i = 0; i < 12; i++) room.updateMoods({ type: 'down', actor: 'h', success: true, deltas: { [bot.id]: 0 } });
  assert.ok(Math.abs(confidence()) < 0.05, 'it fades back to normal');

  const profile = { traits: { boldness: 0, moodiness: 0.5 } };
  room.coins = { h: 100, [bot.id]: 100, [other.id]: 100 };
  const even = room.boldnessOf(bot, profile);
  room.coins[bot.id] = 40;
  assert.ok(room.boldnessOf(bot, profile) > even, 'behind on coins it gets reckless');
  assert.equal(room.boldnessOf(bot, { traits: { boldness: 0, moodiness: 0 } }), 0, 'a steady bot is not swayed');
});

test('think time follows the difficulty of the move: a close call takes longer than an obvious one', () => {
  const easy = smartThink(setup({ hand: [c(13, 'S'), c(2, 'D')] }).view, 'a', setup({ hand: [c(13, 'S'), c(2, 'D')] }).mind);
  assert.equal(easy.action.type, 'discard');
  assert.equal(easy.effort, 0, 'a king against a two is no contest');
  const close = setup({ hand: [c(10, 'S'), c(9, 'D')] });
  assert.ok(smartThink(close.view, 'a', close.mind).effort > 0.5, 'a ten against a nine is close');

  const lobby = new Lobby({ botDelayMs: 1000 });
  const room = { round: { phase: 'draw' } };
  const seat = { isBot: true, botId: 'croaker' };
  for (let i = 0; i < 20; i++) assert.ok(lobby.thinkMs(room, seat, 0) < lobby.thinkMs(room, seat, 1));
});
