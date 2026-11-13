import { h } from './dom.js';

// A player name followed by its marks: a helmet for bots, a star for the table's host (the player who made it).
export function nameTag(name, { bot = false, host = false } = {}) {
  return h(
    'span',
    { class: 'name-tag' },
    name,
    bot ? h('span', { class: 'mark helmet', role: 'img', 'aria-label': 'Bot', title: 'Bot' }) : null,
    host ? h('span', { class: 'mark host-star', role: 'img', 'aria-label': 'Host', title: 'Host of this table' }, '\u2605') : null,
  );
}
