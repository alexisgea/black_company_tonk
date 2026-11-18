import { h } from './dom.js';

// The small profile picture frame next to a name. It is empty for now: when players and bots get pictures, this is
// the one place that draws them. `mark` is an optional short text inside the frame (the random bot shows a "?"),
// `small` is the size used in the compact lists during a game.
export function avatar({ mark = '', empty = false, small = false } = {}) {
  const classes = ['avatar', empty ? 'empty' : '', small ? 'small' : ''].filter(Boolean).join(' ');
  return h('span', { class: classes, 'aria-hidden': 'true' }, mark);
}
