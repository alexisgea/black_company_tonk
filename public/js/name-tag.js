import { h } from './dom.js';
import { t } from './i18n.js';

// A player name followed by its marks: a helmet for bots, a star for the table's host (the player who made it).
export function nameTag(name, { bot = false, host = false } = {}) {
  return h(
    'span',
    { class: 'name-tag' },
    name,
    bot ? h('span', { class: 'mark helmet', role: 'img', 'aria-label': t('mark.bot'), title: t('mark.bot') }) : null,
    host ? h('span', { class: 'mark host-star', role: 'img', 'aria-label': t('mark.host'), title: t('mark.hostTitle') }, '\u2605') : null,
  );
}

// The chip that shows who deals this hand. The animation (animation.js) slides it from seat to seat,
// finding it by data-role-mark.
export function roleMarks(id, round) {
  if (round.dealer !== id) return null;
  return h(
    'div',
    { class: 'role-marks' },
    h('span', { class: 'role-mark dealer', 'data-role-mark': 'dealer', title: t('mark.dealerTitle') }, t('mark.dealer')),
  );
}
