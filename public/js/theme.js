// Theme: how cards are drawn. Swap this module out for real art later.
// Card ids are 0..51: rank = id % 13 + 1 (1 = Ace), suit = floor(id / 13) in C, D, H, S order.
import { rankOf, suitOf } from './rules.js';
import { on } from './dom.js';

const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_LABELS = ['\u2663', '\u2666', '\u2665', '\u2660'];

export const cardLabel = (id) => RANK_LABELS[rankOf(id) - 1] + SUIT_LABELS[suitOf(id)];

// `zone` ('hand' | 'discard' | 'meld') marks cards the animation layer should track by id.
export function cardEl(id, { back = false, size = '', selected = false, onClick = null, zone = null } = {}) {
  const el = document.createElement('div');
  el.className = 'card ' + size;
  if (id === null || id === undefined) {
    if (back) el.classList.add('back');
    else el.classList.add('empty');
  } else {
    if (suitOf(id) === 1 || suitOf(id) === 2) el.classList.add('red');
    el.append(RANK_LABELS[rankOf(id) - 1], SUIT_LABELS[suitOf(id)]);
    if (zone) {
      el.dataset.card = id;
      el.dataset.zone = zone;
    }
  }
  if (selected) el.classList.add('selected');
  if (onClick) {
    el.classList.add('clickable');
    on(el, 'click', onClick);
  }
  return el;
}
