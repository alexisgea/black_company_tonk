'use strict';
// Computer opponent. Pure decision logic: given the round, pick an action.
const { rankOf, suitOf, cardValue, handTotal, classifyMeld, layoffEnd } = require('./tonk');

const GO_DOWN_AT = 12;

// Finds a set or run (as card ids) inside a hand, or null. Prefers the largest meld.
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

const findLayoff = (hand, melds) => {
  for (const card of hand) {
    const meld = melds.find((m) => layoffEnd(m, card));
    if (meld) return { card, meldId: meld.id };
  }
  return null;
};

// Would taking this card from the discard pile let the bot put cards down right away?
const discardHelps = (round, hand, card) => !!findLayoff([card], round.melds) || !!findMeld([...hand, card])?.includes(card);

function chooseAction(round, id) {
  const hand = round.hands[id];
  if (round.phase === 'draw') {
    // An empty draw pile means the table is cycling without anyone getting low enough; end the hand.
    if (handTotal(hand) <= GO_DOWN_AT || round.deck.length === 0) return { type: 'goDown' };
    const top = round.discard[round.discard.length - 1];
    if (top !== undefined && discardHelps(round, hand, top)) return { type: 'takeDiscard' };
    const canDraw = round.deck.length > 0 || round.discard.length > 1;
    return { type: canDraw ? 'draw' : 'takeDiscard' };
  }
  const layoff = findLayoff(hand, round.melds);
  if (layoff) return { type: 'layoff', ...layoff };
  const meld = findMeld(hand);
  if (meld) return { type: 'meld', cards: meld };
  const worst = [...hand].sort((a, b) => cardValue(b) - cardValue(a))[0];
  return { type: 'discard', card: worst };
}

module.exports = { chooseAction, findMeld };
