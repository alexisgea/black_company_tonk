import { h } from './dom.js';

// The small profile picture frame next to a name. It is empty for now: when players and bots get pictures, this is
// the one place that draws them. `mark` is an optional short text inside the frame (the random bot shows a "?").
export function avatar({ mark = '', empty = false } = {}) {
  return h('span', { class: empty ? 'avatar empty' : 'avatar', 'aria-hidden': 'true' }, mark);
}
