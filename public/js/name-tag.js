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
