'use strict';
// Spread-finding helpers shared by the smart bot (botsmart.js) and the original simple bot (bot.js).
const { rankOf, suitOf, classifyMeld, layoffEnd } = require('../shared/cards');

// Finds a set or run (as card ids) inside a hand, or null. Prefers the largest spread.
function findMeld(hand) {
  const candidates = [];
  const byRank = new Map();
  const bySuit = new Map();
  for (const c of hand) {
    byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) || []), c]);
    bySuit.set(suitOf(c), [...(bySuit.get(suitOf(c)) || []), c]);
  }
  for (const group of byRank.values()) if (group.length >= 3) candidates.push(group.slice(0, 4));
  for (const group of bySuit.values()) {
    const sorted = [...group].sort((a, b) => rankOf(a) - rankOf(b));
    let run = [];
    const flush = () => {
      if (run.length >= 3) candidates.push(run);
      run = [];
    };
    for (const c of sorted) {
      if (run.length && rankOf(c) !== rankOf(run[run.length - 1]) + 1) flush();
      run.push(c);
    }
    flush();
  }
  const valid = candidates.filter((cards) => classifyMeld(cards));
  valid.sort((a, b) => b.length - a.length);
  return valid[0] || null;
}

// The first card (in the order given) that fits the end of one of the spreads, with that spread's id, or null.
function findLayoff(cards, melds) {
  for (const card of cards) {
    const meld = melds.find((m) => layoffEnd(m, card));
    if (meld) return { card, meldId: meld.id };
  }
  return null;
}

module.exports = { findMeld, findLayoff };
