'use strict';
// The original, simple computer opponent: given the round, pick an action. It is the safety net for the smart player
// in botsmart.js, which is used first (see Lobby.botMove).
const { cardValue, handTotal } = require('./tonk');
const { GO_DOWN_AT } = require('./bottuning');
const { findMeld, findLayoff } = require('./botmelds');

// Would taking this card from the discard pile let the bot put cards down right away?
const discardHelps = (round, hand, card) => !!findLayoff([card], round.melds) || !!findMeld([...hand, card])?.includes(card);

function legacyAction(round, id) {
  const hand = round.hands[id];
  if (round.phase === 'draw') {
    // An empty draw pile means the table is cycling without anyone getting low enough; end the hand.
    if (!round.cheatedThisTurn && (handTotal(hand) <= GO_DOWN_AT || round.deck.length === 0)) return { type: 'goDown' };
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

// Plain legal move used when everything else fails, so a bug in the bot logic can never freeze a table:
// take a card, then throw away the highest one.
function fallbackAction(round, id) {
  if (round.phase === 'draw') {
    return round.deck.length > 0 || round.discard.length > 1 ? { type: 'draw' } : { type: 'takeDiscard' };
  }
  const worst = [...round.hands[id]].sort((a, b) => cardValue(b) - cardValue(a))[0];
  return { type: 'discard', card: worst };
}

module.exports = { legacyAction, fallbackAction };
