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

const gameOptions = (opts) => ({ coins: opts.coins, bet: opts.bet, maxHands: opts.maxHands });
const sessionSeed = (opts, index) => opts.seed * 1000003 + index;

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

module.exports = { sessionOptions, checkSessionOptions, gameOptions, sessionSeed, progress, reportFallbacks };
