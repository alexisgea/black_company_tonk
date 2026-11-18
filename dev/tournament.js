#!/usr/bin/env node
'use strict';
// Plays the bots against each other and ranks them by the coins they win per hand.
const { PROFILES } = require('../server/botprofiles');
const { parseArgs, fail } = require('./args');
const { table, signed, percent } = require('./format');
const { seeded, botName, aggregate, summarize } = require('./sim');
const { playSessions } = require('./pool');
const { rankOfEach, writeRanks } = require('./ranks');
const { sessionOptions, checkSessionOptions, gameOptions, sessionSeed, progress, reportFallbacks } = require('./common');

const opts = parseArgs(
  process.argv.slice(2),
  {
    bots: { type: 'list', default: [], help: 'character ids to include (default: every character in botprofiles.js)' },
    ...sessionOptions,
    noRanks: { type: 'boolean', default: false, help: 'do not write the ranks (rookie ... expert) into botprofiles.js' },
  },
  {
    usage: 'npm run dev:tournament -- [options]',
    about:
      'Seats the bots at random tables (everybody plays the same number of tables) and ranks them by coins won per hand.\n' +
      'Hands are played with the real rules, bets, moods and bot logic; the table stops when somebody is broke.\n' +
      'When every character plays (no --bots), the ranking also sets the `rank` of each one in botprofiles.js.',
  },
);
checkSessionOptions(opts);

const pool = opts.bots.length ? [...new Set(opts.bots)] : Object.keys(PROFILES);
for (const id of pool) if (!PROFILES[id]) console.error(`Note: "${id}" has no profile in botprofiles.js, it plays as an average bot.`);
if (pool.length < opts.seats) fail(`Need at least ${opts.seats} different bots for ${opts.seats} seats (got ${pool.length}).`);

// Each table takes the bots that have played the fewest tables so far, so everybody gets about the same number.
function schedule() {
  const rng = seeded(opts.seed);
  const played = new Map(pool.map((id) => [id, 0]));
  const tables = [];
  for (let i = 0; i < opts.sessions; i++) {
    const picked = pool
      .map((id) => ({ id, order: rng() }))
      .sort((a, b) => played.get(a.id) - played.get(b.id) || a.order - b.order)
      .slice(0, opts.seats)
      .map((p) => ({ id: p.id, seat: rng() }))
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);
    for (const id of picked) played.set(id, played.get(id) + 1);
    tables.push({ seats: picked.map((bot) => ({ bot })), seed: sessionSeed(opts, i), ...gameOptions(opts) });
  }
  return tables;
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const label = (id) => (squash(botName(id)) === squash(id) ? botName(id) : `${botName(id)} (${id})`);

async function main() {
  const started = Date.now();
  const records = await playSessions(schedule(), { workers: opts.workers, onProgress: progress('Playing') });
  const rows = [...aggregate(records)]
    .map(([id, totals]) => ({ id, ...summarize(totals) }))
    .sort((a, b) => b.coinsPerHand - a.coinsPerHand);
  const hands = records.reduce((n, r) => n + r.hands, 0);
  const ranksNote = updateRanks(rows);
  if (opts.json) {
    console.log(JSON.stringify({ options: opts, hands, ranking: rows }, null, 2));
    if (ranksNote) console.error(ranksNote);
    return;
  }
  console.log(
    `${opts.sessions} tables of ${opts.seats} (${hands} hands), ${opts.coins} coins each, bet ${opts.bet}, seed ${opts.seed}, ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
  console.log(
    table(rows, [
      { title: '#', get: (r) => rows.indexOf(r) + 1 },
      { title: 'Bot', align: 'left', get: (r) => label(r.id) },
      { title: 'Coins/hand', get: (r) => signed(r.coinsPerHand) },
      { title: '+-', get: (r) => r.stdError.toFixed(2) },
      { title: 'Hands won', get: (r) => percent(r.winRate) },
      { title: 'Go-downs', get: (r) => `${percent(r.downsPerHand)} of hands` },
      { title: 'Go-down ok', get: (r) => (r.downsPerHand ? percent(r.downSuccess) : '-') },
      { title: 'Emptied hand', get: (r) => percent(r.emptiesPerHand, 1) },
      { title: 'Tables won', get: (r) => percent(r.sessionWinRate) },
      { title: 'Hands', get: (r) => r.hands },
    ]),
  );
  console.log(
    '\nCoins/hand is the average coins won (+) or lost (-) in a hand; "+-" is one standard error, so bots closer than about two of those cannot be told apart yet (play more tables).',
  );
  reportFallbacks(records);
  if (ranksNote) console.log(`\n${ranksNote}`);
}

// A partial roster cannot tell who is the best of everybody, so only a full tournament sets the ranks.
function updateRanks(rows) {
  if (opts.noRanks || opts.bots.length || rows.some((r) => !PROFILES[r.id])) return '';
  const ranks = rankOfEach(rows.map((r) => r.id));
  const changed = writeRanks(ranks);
  const list = rows.map((r) => `${botName(r.id)}: ${ranks[r.id]}`).join(', ');
  return `Ranks in botprofiles.js (${changed.length ? `changed: ${changed.join(', ')}` : 'unchanged'}) - ${list}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
