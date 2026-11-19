import { h } from './dom.js';

// A small decorative coin (drawn in CSS) that marks anything counted in coins. The text next to it carries the meaning.
export function coin() {
  return h('span', { class: 'coin', 'aria-hidden': 'true' });
}
