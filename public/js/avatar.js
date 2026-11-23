import { h } from './dom.js';

export const BOT_PORTRAITS = {
  'the-lady': '/img/bot-portraits/portrait-01.png',
  croaker: '/img/bot-portraits/portrait-02.png',
  silent: '/img/bot-portraits/portrait-03.png',
  otto: '/img/bot-portraits/portrait-04.png',
  'willow-swan': '/img/bot-portraits/portrait-06.png',
  goblin: '/img/bot-portraits/portrait-07.png',
  hagop: '/img/bot-portraits/portrait-08.png',
  case: '/img/bot-portraits/portrait-09.png',
  'one-eye': '/img/bot-portraits/portrait-10.png',
  'the-lieutenant': '/img/bot-portraits/portrait-11.png',
  cordy: '/img/bot-portraits/cordy.png',
  elmo: '/img/bot-portraits/portrait-13.png',
};

// `mark` is an optional short text inside the frame (the random bot shows a "?").
export function avatar({ mark = '', botId = null, empty = false, small = false } = {}) {
  const classes = ['avatar', empty ? 'empty' : '', small ? 'small' : ''].filter(Boolean).join(' ');
  const portrait = BOT_PORTRAITS[botId];
  return h('span', { class: classes, 'aria-hidden': 'true' }, portrait ? h('img', { src: portrait, alt: '' }) : mark);
}
