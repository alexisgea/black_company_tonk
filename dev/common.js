'use strict';
// Options and helpers shared by the developer tools that play many simulated games.
const { MAX_PLAYERS, MIN_PLAYERS } = require('../server/tonk');
const { DEFAULT_OPTIONS } = require('./sim');
const { defaultWorkers } = require('./pool');
const { fail } = require('./args');

const sessionOptions = {
  sessions: { type: 'number', default: 300, help: 'how many tables to play (more is slower and more exact)' },
  seats: { type: 'number', default: 4, help: `players at each table, ${MIN_PLAYERS} to ${MAX_PLAYERS}` },
  coins: { type: 'number', default: DEFAULT_OPTIONS.coins, help: 'starting coins of each player' },
  bet: { type: 'number', default: DEFAULT_OPTIONS.bet, help: 'coins one bet is worth' },
  maxHands: { type: 'number', default: DEFAULT_OPTIONS.maxHands, help: 'a table stops after this many hands (or when somebody is broke)' },
  cheat: {
    type: 'boolean',
    default: false,
    help: 'let the bots that have the habit cheat (nobody accuses them here, so it is never punished)',
  },
  seed: { type: 'number', default: 1, help: 'the same seed plays the same games' },
  workers: { type: 'number', default: defaultWorkers(), help: 'threads to play on' },
  json: { type: 'boolean', default: false, help: 'print the results as JSON instead of tables' },
};

function checkSessionOptions(opts) {
  if (!Number.isInteger(opts.seats) || opts.seats < MIN_PLAYERS || opts.seats > MAX_PLAYERS)
    fail(`--seats must be ${MIN_PLAYERS} to ${MAX_PLAYERS}.`);
  if (!Number.isInteger(opts.sessions) || opts.sessions < 1) fail('--sessions must be a whole number of at least 1.');
  if (!(opts.bet >= 1) || !(opts.coins >= opts.bet)) fail('--bet must be at least 1 and no more than --coins.');
}

const gameOptions = (opts) => ({ coins: opts.coins, bet: opts.bet, maxHands: opts.maxHands, cheating: opts.cheat });
const sessionSeed = (opts, index) => opts.seed * 1000003 + index;

// The same tables for every variant: one "subject" seat (with `patch` applied: { profile?, tuning? }) among copies of
// opts.bot, moving round the table so no seat is favoured. `shared` (numbers from bottuning.js) goes to every seat.
function subjectSessions(opts, patch = {}, shared = {}) {
  const sessions = [];
  const withShared = (seat, own) => {
    const tuning = { ...shared, ...own };
    return Object.keys(tuning).length ? { ...seat, tuning } : seat;
  };
  for (let i = 0; i < opts.sessions; i++) {
    const subject = i % opts.seats;
    const seats = Array.from({ length: opts.seats }, (_, j) =>
      j === subject
        ? withShared({ bot: opts.bot, key: 'subject', ...patch, tuning: undefined }, patch.tuning)
        : withShared({ bot: opts.bot, key: 'field' }),
    );
    sessions.push({ seats, seed: sessionSeed(opts, i), ...gameOptions(opts) });
  }
  return sessions;
}

// "NAME=value,NAME=value" from the command line to { NAME: value }, for numbers of bottuning.js.
function parseTuning(list, known) {
  const out = {};
  for (const item of list) {
    const [name, raw] = item.split('=');
    if (!(name in known) || Array.isArray(known[name]) || !Number.isFinite(Number(raw)))
      fail(`--set wants NAME=number with a number from bottuning.js, not "${item}".`);
    out[name] = Number(raw);
  }
  return out;
}

function progress(label) {
  if (!process.stderr.isTTY) return undefined;
  return (done, total) => process.stderr.write(`\r${label}: ${done}/${total} tables${done === total ? '\n' : ''}`);
}

// Everything that went wrong inside the bot logic (it fell back to a simpler move), once each.
function reportFallbacks(records) {
  const errors = new Set(records.flatMap((r) => r.errors));
  if (errors.size) {
    console.error(`\nWARNING: the smart bot failed and a fallback move was played (${errors.size} kinds of error):`);
    for (const e of errors) console.error(`  ${e}`);
  }
}

module.exports = {
  sessionOptions,
  checkSessionOptions,
  gameOptions,
  sessionSeed,
  subjectSessions,
  parseTuning,
  progress,
  reportFallbacks,
};
