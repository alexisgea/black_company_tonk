'use strict';
// How good is going down right now? The bot deals the opponents' unknown cards at random from the cards it cannot
// account for, many times over, and scores each deal with the real go-down payoff. Everything it uses comes from the
// view a human gets and from its own memory.
const { handTotal } = require('../shared/cards');

const SAMPLES = 120;

// Payoff, in bets, for the player going down with `mine` against these opponent totals (see goDown in tonk.js).
function goDownPayoff(mine, totals) {
  if (totals.every((t) => t > mine)) return totals.length;
  return -2 * totals.filter((t) => t <= mine).length;
}

// opponents: [{ count, known }]: how many cards they hold and which of those the bot knows about.
// unseen: the cards that could be in an opponent's hand (the bot's best guess).
function estimateGoDown(mine, opponents, unseen, rng, samples = SAMPLES) {
  const knownTotals = opponents.map((o) => handTotal(o.known));
  const unknownCounts = opponents.map((o) => Math.max(0, o.count - o.known.length));
  let sum = 0;
  for (let s = 0; s < samples; s++) {
    const pool = [...unseen];
    const totals = opponents.map((_, i) => {
      let total = knownTotals[i];
      for (let k = 0; k < unknownCounts[i] && pool.length; k++) {
        const j = Math.floor(rng() * pool.length);
        total += handTotal([pool[j]]);
        pool[j] = pool[pool.length - 1];
        pool.pop();
      }
      return total;
    });
    sum += goDownPayoff(mine, totals);
  }
  return sum / samples;
}

module.exports = { estimateGoDown, goDownPayoff };
