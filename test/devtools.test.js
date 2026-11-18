'use strict';
// The developer tools (dev/): the simulator, the thinking trace, the worker pool, the dev table and the command line tools.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const TUNING = require('../server/bottuning');
const { Room } = require('../server/room');
const { smartThink } = require('../server/botsmart');
const { PROFILES } = require('../server/botprofiles');
const { seeded, withSeededRandom, playSession, aggregate, summarize, BASE_TUNING } = require('../dev/sim');
const { playSessions } = require('../dev/pool');
const { DevTable } = require('../dev/devtable');

const bots = Object.keys(PROFILES).slice(0, 4);
const seats = bots.map((bot) => ({ bot }));
const dev = (script, ...args) =>
  JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'dev', script), ...args, '--json'], { encoding: 'utf8' }));

test('a seeded session plays the same twice, and different seeds play differently', () => {
  const a = playSession({ seats, seed: 11 });
  assert.deepEqual(playSession({ seats, seed: 11 }), a);
  assert.notDeepEqual(playSession({ seats, seed: 12 }), a);
  assert.ok(a.hands > 3);
  assert.deepEqual(a.errors, []);
  // The coins of every hand add up to nothing: what one wins another loses.
  assert.equal(
    a.seats.reduce((sum, s) => sum + s.coins, 0),
    0,
  );
});

test('a tuning number given to one seat changes only that seat, and is put back afterwards', () => {
  const seat = (tuning) => seats.map((s, i) => (i === 0 ? { ...s, profile: { tunnelVision: 0 }, tuning } : s));
  // A margin nobody can miss against one nobody can reach: it goes down at the first chance, or never (barring forced ends).
  const eager = playSession({ seats: seat({ GO_MARGIN: -100 }), seed: 5, maxHands: 60, coins: 1000 });
  const shy = playSession({ seats: seat({ GO_MARGIN: 100 }), seed: 5, maxHands: 60, coins: 1000 });
  assert.ok(eager.seats[0].downs > shy.seats[0].downs + 3, 'the changed seat goes down more');
  assert.deepEqual({ ...TUNING }, { ...BASE_TUNING }, 'the shared numbers are back to normal');
});

test('a profile given to one seat is used for that seat only and does not stay registered', () => {
  const known = Object.keys(PROFILES).length;
  const timid = playSession({
    seats: seats.map((s, i) => (i === 0 ? { ...s, profile: { riskTaker: 0, tunnelVision: 0, calculating: 1 } } : s)),
    seed: 3,
  });
  const bold = playSession({
    seats: seats.map((s, i) => (i === 0 ? { ...s, profile: { riskTaker: 1, tunnelVision: 0, calculating: 1 } } : s)),
    seed: 3,
  });
  assert.notDeepEqual(timid.seats[0], bold.seats[0]);
  assert.equal(Object.keys(PROFILES).length, known);
});

test('the thinking trace never changes what a bot does', () => {
  const play = (withTrace) => {
    const rng = seeded(21);
    return withSeededRandom(rng, () => {
      const room = new Room('R', 'Test', rng, { settings: { startingCoins: 100, bet: 5 } });
      for (const [i, botId] of bots.entries()) room.join({ id: `s${i}`, botId, name: botId, isBot: true, conn: null, room: null });
      const moves = [];
      for (let hand = 0; hand < 6 && room.players.length === bots.length; hand++) {
        room.startHand(room.players[0]);
        for (const p of room.pendingTonkers) room.declareTonk(p);
        while (room.status === 'playing') {
          const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
          const { view, mind } = room.botSight(user);
          const trace = withTrace ? [] : undefined;
          const { action, effort } = smartThink(view, user.id, mind, trace);
          if (withTrace) assert.ok(trace.length >= 2, 'it says something');
          moves.push([action, effort, rng()]);
          room.act(user, action);
        }
      }
      return moves;
    });
  };
  assert.deepEqual(play(true), play(false));
});

test('playing on worker threads gives the same results as playing here', async () => {
  const sessions = Array.from({ length: 6 }, (_, i) => ({ seats, seed: 100 + i, maxHands: 30 }));
  const here = await playSessions(sessions, { workers: 1 });
  assert.deepEqual(await playSessions(sessions, { workers: 2 }), here);
  const totals = summarize([...aggregate(here)][0][1]);
  assert.equal(totals.sessions, 6);
  assert.ok(Number.isFinite(totals.coinsPerHand) && totals.stdError > 0);
});

test('the dev table plays hand after hand one step at a time, showing every hand and what the bot thought', () => {
  const table = new DevTable({ bots: bots.slice(0, 3), seed: 4, coins: 10, bet: 5 });
  assert.match(table.state().upNext, /Deal the first hand/);
  let moves = 0;
  let sawComeback = false;
  for (let step = 0; step < 400 && table.state().handNo < 6; step++) {
    table.next();
    const state = table.state();
    for (const p of state.players.filter((x) => x.seated)) assert.ok(Array.isArray(p.hand), 'every hand is face up');
    const last = state.entries.at(-1);
    if (last.kind === 'move') {
      moves++;
      assert.ok(last.thinking.length >= 3, 'it says what it thought');
      assert.doesNotMatch(last.thinking.join('\n'), /FAILED/);
    }
    sawComeback ||= state.entries.some((e) => /came back/.test(e.text ?? ''));
  }
  assert.ok(table.state().handNo >= 6);
  assert.ok(moves > 20);
  assert.ok(sawComeback, 'with so few coins somebody goes broke and is seated again for the next hand');
  assert.throws(() => new DevTable({ bots: [bots[0], bots[0]] }), /only once/);
});

test('the bot logic reads its tuning numbers when it decides, so the dev tools can change them per seat', () => {
  const fs = require('node:fs');
  for (const file of ['botsmart', 'botmind', 'botrisk']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', `${file}.js`), 'utf8');
    assert.doesNotMatch(source, /\{[^}]*\}\s*=\s*require\('\.\/bottuning'\)/, `${file}.js must use T.NAME, not copy the constants`);
  }
});

test('the tournament tool ranks the bots', () => {
  const out = dev('tournament.js', '--sessions', '4', '--workers', '1', '--bots', bots.join(','), '--seats', '3');
  assert.equal(out.ranking.length, bots.length);
  assert.ok(out.ranking.every((r) => Number.isFinite(r.coinsPerHand) && r.hands > 0));
  assert.ok(out.ranking[0].coinsPerHand >= out.ranking.at(-1).coinsPerHand);
});

test('the sensitivity tool reports each knob and constant it was asked about', () => {
  const out = dev('sensitivity.js', '--sessions', '4', '--workers', '1', '--only', 'memory,THREAT_CAP,PAY_DOWN_WIN');
  assert.deepEqual(out.parameters.map((p) => p.name).sort(), ['THREAT_CAP', 'memory']);
  assert.equal(out.parameters.find((p) => p.name === 'memory').arms.length, 5);
  assert.equal(out.parameters.find((p) => p.name === 'THREAT_CAP').arms.length, 2);
});

test('the balance tool gives the swing of each knob, with a middle value only for the personalities', () => {
  const out = dev(
    'balance.js',
    '--sessions',
    '4',
    '--workers',
    '1',
    '--max-hands',
    '20',
    '--knobs',
    'memory,riskTaker',
    '--set',
    'GO_MARGIN=0.8',
  );
  assert.deepEqual(
    out.knobs.map((k) => k.name),
    ['memory', 'riskTaker'],
  );
  assert.ok(out.knobs.every((k) => Number.isFinite(k.swing) && k.swing >= 0 && k.swingStdError >= 0));
  assert.equal(out.knobs[0].at05, undefined, 'a skill is tried at both ends only');
  assert.ok(out.knobs[1].at05, 'a personality is also tried in the middle');
  assert.throws(() => dev('balance.js', '--sessions', '2', '--set', 'NOT_A_NUMBER=1'), /Command failed/);
});
