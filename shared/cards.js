'use strict';
// Card and spread rules shared by the server (require) and the browser (window.TonkCards), so both
// always agree on what is a valid spread. Cards are integers 0..51: rank = id % 13 + 1
// (1 = Ace .. 13 = King), suit = floor(id / 13).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TonkCards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const rankOf = (id) => (id % 13) + 1;
  const suitOf = (id) => Math.floor(id / 13);
  const cardValue = (id) => Math.min(rankOf(id), 10);
  const handTotal = (cards) => cards.reduce((sum, c) => sum + cardValue(c), 0);
  const isCard = (c) => Number.isInteger(c) && c >= 0 && c < 52;

  // Returns { type: 'set' | 'run', cards } (runs sorted low to high) or null.
  // Runs are same-suit, consecutive, Ace low only (A 2 3 ... J Q K), no wrap-around.
  function classifyMeld(cards) {
    if (!cards.every(isCard) || cards.length < 3 || new Set(cards).size !== cards.length) return null;
    const r0 = rankOf(cards[0]);
    if (cards.length <= 4 && cards.every((c) => rankOf(c) === r0)) {
      return { type: 'set', cards: [...cards] };
    }
    const s0 = suitOf(cards[0]);
    if (!cards.every((c) => suitOf(c) === s0)) return null;
    const sorted = [...cards].sort((a, b) => rankOf(a) - rankOf(b));
    for (let i = 1; i < sorted.length; i++) {
      if (rankOf(sorted[i]) !== rankOf(sorted[i - 1]) + 1) return null;
    }
    return { type: 'run', cards: sorted };
  }

  // Which end of a spread the card extends: 'low', 'high' or null. Only runs can be extended.
  function layoffEnd(meld, card) {
    if (meld.type !== 'run') return null;
    const first = meld.cards[0];
    const last = meld.cards[meld.cards.length - 1];
    if (suitOf(card) !== suitOf(first)) return null;
    if (rankOf(card) === rankOf(first) - 1) return 'low';
    if (rankOf(card) === rankOf(last) + 1) return 'high';
    return null;
  }

  // Suits are C, D, H, S: diamonds and hearts are red, clubs and spades black.
  const isRed = (id) => suitOf(id) === 1 || suitOf(id) === 2;

  // A cheating way of adding a card to a run: the card is not legal there, yet it looks almost right. Returns
  // { end: 'low' | 'high', kind } or null. `kind` is 'suit' (the next rank in another suit of the same colour) or
  // 'gap' (the right suit, but one rank is skipped, as in 4 5 7).
  function cheatLayoffEnd(meld, card) {
    if (meld.type !== 'run' || layoffEnd(meld, card)) return null;
    const first = meld.cards[0];
    const last = meld.cards[meld.cards.length - 1];
    const rank = rankOf(card);
    if (suitOf(card) !== suitOf(first)) {
      if (isRed(card) !== isRed(first)) return null;
      if (rank === rankOf(first) - 1) return { end: 'low', kind: 'suit' };
      if (rank === rankOf(last) + 1) return { end: 'high', kind: 'suit' };
      return null;
    }
    if (rank === rankOf(first) - 2) return { end: 'low', kind: 'gap' };
    if (rank === rankOf(last) + 2) return { end: 'high', kind: 'gap' };
    return null;
  }

  return { rankOf, suitOf, cardValue, handTotal, isCard, classifyMeld, layoffEnd, cheatLayoffEnd };
});
