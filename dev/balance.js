#!/usr/bin/env node
'use strict';
// How much does each knob decide? The swing of a knob is what one seat gains by having it at its best instead of its
// worst, in bets per hand, against tables full of copies of the same bot. The knobs (besides thinkSpeed, which is only
// pace) should have about the same swing: a knob whose swing is near zero is only flavour, and one that dwarfs the others
// drowns them out.
//
// A skill (memory, calculating, tunnelVision, sloppiness) is tried at 0 and at 1. A personality (riskTaker, moodSwing)
// has no good end: its swing is the gap between its best and worst value of 0, 0.5 and 1, and is shown for comparison
// (the balance verdict covers the skills). Every variant, and the untouched
// control, plays the same seeded tables, so the games stay identical until the change makes a difference. Nobody goes
// broke by default, so every table adds many hands.
const { PROFILES, PARAMS, BASE } = require('../server/botprofiles');
const { parseArgs, fail } = require('./args');
const { table } = require('./format');
const { compare } = require('./compare');
const { BASE_TUNING } = require('./sim');
const { playSessions } = require('./pool');
const { sessionOptions, checkSessionOptions, subjectSessions, parseTuning, progress, reportFallbacks } = require('./common');

// The skills, and which end is the good one. Everything else is a personality with no good end.
const SKILLS = { memory: 1, calculating: 1, tunnelVision: 0, sloppiness: 0 };
const MEASURED = PARAMS.filter((p) => p !== 'thinkSpeed');
const valuesOf = (knob) => (knob in SKILLS ? [0, 1] : [0, 0.5, 1]);

const opts = parseArgs(
  process.argv.slice(2),
  {
    knobs: { type: 'list', default: MEASURED, help: 'which knobs to measure (names, comma separated)' },
    bot: { type: 'string', default: 'base', help: 'the character everybody at the table is a copy of ("base" is the average bot)' },
    set: { type: 'list', default: [], help: 'try other numbers of bottuning.js for every seat, without editing it: NAME=value,NAME=value' },
    tolerance: { type: 'number', default: 0.3, help: 'balanced when every swing is within this share of the average swing' },
    ...sessionOptions,
    sessions: { ...sessionOptions.sessions, default: 200 },
    coins: { ...sessionOptions.coins, default: 100000, help: 'starting coins of each player (a lot, so tables run to --max-hands)' },
    maxHands: { ...sessionOptions.maxHands, default: 100 },
  },
  {
    usage: 'npm run dev:balance -- [options]',
    about:
      'Plays one seat with a knob at its extremes against copies of the same bot and prints the swing between the best and the\n' +
      'worst in bets per hand, with its standard error, and whether the knobs are balanced. Play more tables (--sessions) to see\n' +
      'smaller swings. --set tries other bottuning.js numbers without editing the file.',
  },
);
checkSessionOptions(opts);
for (const knob of opts.knobs) if (!MEASURED.includes(knob)) fail(`Unknown knob ${knob}. Try ${MEASURED.join(', ')}.`);
if (!(opts.tolerance > 0)) fail('--tolerance must be above 0.');
const shared = parseTuning(opts.set, BASE_TUNING);

const baseline = { ...BASE, ...(PROFILES[opts.bot] ?? {}) };
const SIGNIFICANT = 3; // standard errors

const bets = (coins) => coins / opts.bet;
const signed = (x, digits = 2) => (x >= 0 ? '+' : '-') + Math.abs(x).toFixed(digits);
const cell = (x) => (x ? `${signed(x.betsPerHand)} +-${x.stdError.toFixed(2)}` : '');

// How far each swing is from the average one of the skills (all of the knobs asked for if no skill is among them), and
// whether the skills are all close enough to it. Personalities have no good end, so they are compared but do not decide.
function balance(rows) {
  const judged = rows.some((r) => r.skill) ? rows.filter((r) => r.skill) : rows;
  const average = judged.reduce((sum, r) => sum + r.swing, 0) / (judged.length || 1);
  for (const r of rows) r.relative = average > 0 ? r.swing / average - 1 : 0;
  return { average, balanced: judged.length > 1 && judged.every((r) => Math.abs(r.relative) <= opts.tolerance) };
}

async function main() {
  const arms = [{ patch: {} }];
  for (const knob of opts.knobs) for (const value of valuesOf(knob)) arms.push({ knob, value, patch: { profile: { [knob]: value } } });
  const started = Date.now();
  const records = await playSessions(
    arms.flatMap((arm) => subjectSessions(opts, arm.patch, shared)),
    { workers: opts.workers, onProgress: progress('Playing') },
  );
  const recordsOf = (k) => records.slice(k * opts.sessions, (k + 1) * opts.sessions);
  const control = recordsOf(0);
  const hands = arms.reduce((n, _, k) => n + recordsOf(k).reduce((m, r) => m + r.hands, 0), 0);

  const rows = opts.knobs.map((knob) => {
    const tried = arms
      .map((arm, k) => ({ ...arm, records: recordsOf(k) }))
      .filter((arm) => arm.knob === knob)
      .map((arm) => ({ ...arm, ...compare(arm.records, control) }));
    const best = tried.reduce((x, y) => (y.delta > x.delta ? y : x));
    const worst = tried.reduce((x, y) => (y.delta < x.delta ? y : x));
    const between = compare(best.records, worst.records);
    const skill = knob in SKILLS;
    const at = (value) => {
      const arm = tried.find((a) => a.value === value);
      return arm && { betsPerHand: bets(arm.delta), stdError: bets(arm.stdError) };
    };
    return {
      name: knob,
      skill,
      base: baseline[knob],
      at0: at(0),
      at05: at(0.5),
      at1: at(1),
      swing: bets(between.delta),
      swingStdError: bets(between.stdError),
      bestAt: best.value,
      wrongWay: skill && between.delta !== 0 && best.value !== SKILLS[knob],
    };
  });
  const summary = balance(rows);

  if (opts.json) {
    console.log(JSON.stringify({ options: opts, hands, knobs: rows, balance: summary }, null, 2));
    return;
  }
  const who = PROFILES[opts.bot] ? opts.bot : 'the average bot';
  const changed = Object.entries(shared).map(([k, v]) => `${k}=${v}`);
  console.log(
    `${arms.length} variants x ${opts.sessions} tables of ${opts.seats} against copies of ${who}${changed.length ? ` with ${changed.join(', ')}` : ''} (${hands} hands), seed ${opts.seed}, ${((Date.now() - started) / 60000).toFixed(1)} min\n`,
  );
  console.log(
    'SWING: bets per hand one seat gains by having the knob at its best value instead of its worst, +- one standard error.\nThe "at" columns are against the untouched bot.',
  );
  console.log(
    table(rows, [
      { title: 'Knob', align: 'left', get: (r) => r.name },
      { title: 'Now', get: (r) => r.base },
      { title: 'At 0', get: (r) => cell(r.at0) },
      { title: 'At 0.5', get: (r) => cell(r.at05) },
      { title: 'At 1', get: (r) => cell(r.at1) },
      {
        title: 'Swing',
        get: (r) => `${r.swing.toFixed(2)} +-${r.swingStdError.toFixed(2)}${r.swing >= SIGNIFICANT * r.swingStdError ? ' *' : ''}`,
      },
      { title: 'Best at', get: (r) => r.bestAt },
      { title: 'vs average', get: (r) => `${signed(r.relative * 100, 0)}%` },
      {
        title: 'Note',
        align: 'left',
        get: (r) => (r.wrongWay ? `WRONG WAY: a better ${r.name} should be at ${SKILLS[r.name]}` : r.skill ? 'skill' : 'personality'),
      },
    ]),
  );
  console.log('');
  if (rows.length > 1) {
    const verdict = summary.balanced ? 'Balanced: every' : 'NOT balanced: not every';
    const of = rows.some((r) => r.skill) ? 'skill' : 'knob';
    console.log(
      `Average ${of} swing ${summary.average.toFixed(2)} bets per hand. ${verdict} ${of} is within ${Math.round(opts.tolerance * 100)}% of it.`,
    );
  }
  console.log(`* marks a swing of ${SIGNIFICANT} or more standard errors (clearly more than nothing).`);
  reportFallbacks(records);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
