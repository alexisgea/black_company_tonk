#!/usr/bin/env node
'use strict';
// How much does each tweakable number of the bots matter?
//
// One "subject" seat plays at tables full of copies of the same bot (the field). The subject's numbers are changed one at a
// time: the seven knobs of botprofiles.js, and the constants of bottuning.js. The result is how many coins per hand the
// subject wins or loses against the field because of that change. Every variant plays the same seeded tables as the
// untouched control, so the games stay identical until the change makes a difference, which cuts the noise a lot and
// shows a number that does nothing as exactly zero.
const { PROFILES, PARAMS, BASE } = require('../server/botprofiles');
const { BASE_TUNING } = require('./sim');
const { parseArgs, fail } = require('./args');
const { table } = require('./format');
const { compare } = require('./compare');
const { playSessions } = require('./pool');
const { sessionOptions, checkSessionOptions, subjectSessions, progress, reportFallbacks } = require('./common');

const opts = parseArgs(
  process.argv.slice(2),
  {
    target: { type: 'string', default: 'all', help: 'what to vary: knobs (the seven character numbers), constants (bottuning.js) or all' },
    bot: { type: 'string', default: 'base', help: 'the character everybody at the table is a copy of ("base" is the average bot)' },
    factor: { type: 'number', default: 2, help: 'constants are tried at their value divided and multiplied by this' },
    only: { type: 'list', default: [], help: 'only these knobs or constants (names, comma separated)' },
    ...sessionOptions,
  },
  {
    usage: 'npm run dev:sensitivity -- [options]',
    about:
      'Changes one number at a time for a single seat and measures the coins per hand it wins or loses against copies of the\n' +
      'same bot. Pace numbers (thinkSpeed, THINK_*) and the payoffs of the rules are not tried: they do not change how well a bot plays.',
  },
);
checkSessionOptions(opts);
if (!['all', 'knobs', 'constants'].includes(opts.target)) fail('--target must be knobs, constants or all.');
if (!(opts.factor > 1)) fail('--factor must be above 1.');

const KNOB_VALUES = [0, 0.25, 0.5, 0.75, 1];
const PACE_KNOBS = new Set(['thinkSpeed']);
// Pace only (they decide how long a bot takes to move), the payoffs of the rules, and the number of suits.
const SKIP_CONSTANTS = /^(PAY_|THINK_|GO_CLOSE_RANGE$|DISCARD_CLOSE_GAP$|BLUR_SPOTS$)/;
const CAPS = { MOOD_DECAY: 1 }; // a share that cannot go above 1
const SIGNIFICANT = 3; // a change counts as clear at this many standard errors (many numbers are tried, so 2 would flag a few by luck)

const baseline = { ...BASE, ...(PROFILES[opts.bot] ?? {}) };
const only = new Set(opts.only.map((s) => s.toLowerCase()));
const wanted = (name) => !only.size || only.has(name.toLowerCase());

const round = (x) => Number(x.toPrecision(4));
function triedValues(name, value) {
  const f = opts.factor;
  const cap = CAPS[name] ?? Infinity;
  if (Array.isArray(value)) {
    return [
      { side: 'low', label: `x${round(1 / f)}`, value: value.map((x) => x / f) },
      { side: 'high', label: `x${round(f)}`, value: value.map((x) => Math.min(cap, x * f)) },
    ];
  }
  const values = Number.isInteger(value) ? [Math.floor(value / f), Math.ceil(value * f)] : [value / f, Math.min(cap, value * f)];
  return values.map((v, k) => ({ side: k ? 'high' : 'low', label: String(round(v)), value: v })).filter((v) => v.value !== value);
}

// Every variant to try. `patch` goes onto the subject seat.
function buildArms() {
  const arms = [{ id: 'control', group: 'control' }];
  if (opts.target !== 'constants') {
    for (const knob of PARAMS) {
      if (PACE_KNOBS.has(knob) || !wanted(knob)) continue;
      for (const v of KNOB_VALUES) {
        arms.push({
          id: `${knob}=${v}`,
          group: 'knob',
          name: knob,
          label: String(v),
          base: baseline[knob],
          patch: { profile: { [knob]: v } },
        });
      }
    }
  }
  if (opts.target !== 'knobs') {
    for (const [name, value] of Object.entries(BASE_TUNING)) {
      if (SKIP_CONSTANTS.test(name) || !wanted(name)) continue;
      for (const v of triedValues(name, value)) {
        arms.push({
          id: `${name}=${v.label}`,
          group: 'constant',
          name,
          side: v.side,
          label: v.label,
          base: value,
          patch: { tuning: { [name]: v.value } },
        });
      }
    }
  }
  return arms;
}

// The same tables for every variant: the subject moves round the table so no seat is favoured.
const sessionsFor = (arm) => subjectSessions(opts, arm.patch);

const fmt = (arm) =>
  `${arm.delta >= 0 ? '+' : '-'}${Math.abs(arm.delta).toFixed(2)} +-${arm.stdError.toFixed(2)}${Math.abs(arm.z) >= SIGNIFICANT ? ' *' : ''}`;

function verdict(arms) {
  if (arms.every((a) => a.identical)) return 'no effect: the games came out identical';
  const clear = arms.filter((a) => Math.abs(a.z) >= SIGNIFICANT);
  if (!clear.length) return 'within noise';
  const best = clear.reduce((x, y) => (y.delta > x.delta ? y : x));
  const worst = clear.reduce((x, y) => (y.delta < x.delta ? y : x));
  if (worst.delta >= 0) return `better at ${best.label}`;
  if (best.delta <= 0) return `worse at ${worst.label}`;
  return `best at ${best.label}, worst at ${worst.label}`;
}

const sideCell = (row, side) => {
  const arm = row.arms.find((a) => a.side === side);
  return arm ? `: ${fmt(arm)}` : '-';
};

async function main() {
  const arms = buildArms();
  if (arms.length === 1) fail('Nothing to try: check --target and --only.');
  const started = Date.now();
  const all = arms.flatMap(sessionsFor);
  const records = await playSessions(all, { workers: opts.workers, onProgress: progress('Playing') });
  const byArm = arms.map((arm, k) => ({ ...arm, records: records.slice(k * opts.sessions, (k + 1) * opts.sessions) }));
  const control = byArm[0].records;
  const results = byArm.slice(1).map(({ records: r, ...arm }) => ({ ...arm, ...compare(r, control) }));
  const groups = new Map();
  for (const r of results) groups.set(`${r.group}:${r.name}`, [...(groups.get(`${r.group}:${r.name}`) ?? []), r]);
  const rows = [...groups.values()]
    .map((list) => ({
      name: list[0].name,
      group: list[0].group,
      base: list[0].base,
      arms: list,
      impact: Math.max(...list.map((a) => Math.abs(a.delta))),
      clear: list.some((a) => Math.abs(a.z) >= SIGNIFICANT),
      verdict: verdict(list),
    }))
    .sort((a, b) => b.clear - a.clear || b.impact - a.impact);
  const hands = byArm.reduce((n, a) => n + a.records.reduce((m, r) => m + r.hands, 0), 0);

  if (opts.json) {
    console.log(JSON.stringify({ options: opts, hands, parameters: rows }, null, 2));
    return;
  }
  const who = PROFILES[opts.bot] ? opts.bot : 'the average bot';
  console.log(
    `${arms.length - 1} variants x ${opts.sessions} tables of ${opts.seats} against copies of ${who} (${hands} hands), seed ${opts.seed}, ${((Date.now() - started) / 60000).toFixed(1)} min\n`,
  );
  const knobRows = rows.filter((r) => r.group === 'knob');
  if (knobRows.length) {
    console.log(
      'KNOBS (character numbers): coins per hand gained (+) or lost (-) by the subject when this knob is set to the value in the column title',
    );
    console.log(
      table(knobRows, [
        { title: 'Knob', align: 'left', get: (r) => r.name },
        { title: 'Now', get: (r) => r.base },
        ...KNOB_VALUES.map((v) => ({ title: `at ${v}`, get: (r) => fmt(r.arms.find((a) => a.label === String(v))) })),
        { title: 'Verdict', align: 'left', get: (r) => r.verdict },
      ]),
    );
    console.log('');
  }
  const constantRows = rows.filter((r) => r.group === 'constant');
  if (constantRows.length) {
    console.log(`CONSTANTS (bottuning.js): coins per hand gained (+) or lost (-) with the value divided / multiplied by ${opts.factor}`);
    console.log(
      table(constantRows, [
        { title: 'Constant', align: 'left', get: (r) => r.name },
        { title: 'Now', get: (r) => (Array.isArray(r.base) ? `[${r.base.join(', ')}]` : r.base) },
        { title: 'Lower', get: (r) => sideCell(r, 'low') },
        { title: 'Higher', get: (r) => sideCell(r, 'high') },
        { title: 'Verdict', align: 'left', get: (r) => r.verdict },
      ]),
    );
    console.log('');
  }
  console.log(
    `+- is one standard error; * marks a change of ${SIGNIFICANT} or more of them (a clear effect). Rows are sorted by how much they matter. Play more tables (--sessions) to see smaller effects.`,
  );
  reportFallbacks(records);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
