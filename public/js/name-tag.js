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
// Once the hand is over, whoever went down gets a chip too: green if it won, red if they were caught.
// With `reserve`, a player without a chip still gets an empty row so no panel is taller than the others.
export function roleMarks(id, round, { reserve = false } = {}) {
  const marks = [];
  if (round.dealer === id) {
    marks.push(h('span', { class: 'role-mark dealer', 'data-role-mark': 'dealer', title: t('mark.dealerTitle') }, t('mark.dealer')));
  }
  const r = round.result;
  if (r?.type === 'down' && r.actor === id) {
    marks.push(
      h('span', { class: 'role-mark went-down ' + (r.success ? 'won' : 'caught') }, t(r.success ? 'mark.wentDown' : 'mark.caught')),
    );
  }
  if (!marks.length) return reserve ? h('div', { class: 'role-marks' }) : null;
  return h('div', { class: 'role-marks' }, marks);
}
