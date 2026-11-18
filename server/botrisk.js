'use strict';
// How good is going down right now? The bot deals the opponents' unknown cards at random from the cards it cannot
// account for, many times over, and scores each deal with the real go-down payoff. Everything it uses comes from the
// view a human gets and from its own memory.
const { handTotal } = require('../shared/cards');
const T = require('./bottuning'); // read when used, not copied, so the developer tools can try other numbers

// Payoff, in bets, for the player going down with `mine` against these opponent totals (see goDown in tonk.js).
function goDownPayoff(mine, totals) {
  if (totals.every((t) => t > mine)) return T.PAY_DOWN_WIN * totals.length;
  return -T.PAY_DOWN_LOSS * totals.filter((t) => t <= mine).length;
}

// opponents: [{ count, known }]: how many cards they hold and which of those the bot knows about.
// unseen: the cards that could be in an opponent's hand (the bot's best guess).
// lowBias: opponents keep their low cards and throw the dear ones away, so the longer a hand has lasted the more their
// hidden cards lean low. A card of value v is dealt with weight exp(-lowBias * (v - 1)); 0 deals them uniformly.
function estimateGoDown(mine, opponents, unseen, rng, samples = T.RISK_SAMPLES, lowBias = 0) {
  const knownTotals = opponents.map((o) => handTotal(o.known));
  const unknownCounts = opponents.map((o) => Math.max(0, o.count - o.known.length));
  const values = unseen.map((card) => handTotal([card]));
  const weights = values.map((v) => Math.exp(-lowBias * (v - 1)));
  const allWeight = weights.reduce((sum, w) => sum + w, 0);
  let sum = 0;
  for (let s = 0; s < samples; s++) {
    const pool = values.map((_, i) => i);
    let left = allWeight;
    const totals = opponents.map((_, i) => {
      let total = knownTotals[i];
      for (let k = 0; k < unknownCounts[i] && pool.length; k++) {
        let target = rng() * left;
        let j = 0;
        while (j < pool.length - 1 && (target -= weights[pool[j]]) >= 0) j++;
        total += values[pool[j]];
        left -= weights[pool[j]];
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
