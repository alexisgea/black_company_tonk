// Short-lived things that put the talk and the lore of the table where the players are looking: a speech bubble on
// the character who said something, and a banner for the flavour lines the log gets (a bot walking in or out).
import { h } from './dom.js';

const BUBBLE_MS = 6000; // keep in step with the bubble-out animation in style.css
const BUBBLE_MAX_CHARS = 80;
const FLAVOR_MS = 10000;
const FLAVOR_MAX_LINES = 4;
const FLAVOR_TYPES = new Set(['dynJoin', 'dynLeave']);

const bubbles = new Map(); // player id -> { id, text, until }
let bubbleTimer;
let flavor = null; // { events, until }
let flavorSeen = null; // highest log seq already looked at (null: none yet, so what is already there stays quiet)
let flavorTimer;

export const clampText = (text, max = BUBBLE_MAX_CHARS) => {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() + '\u2026' : text;
};

// `onExpire` repaints the table once a bubble is gone.
export function showBubble(pid, id, text, onExpire) {
  bubbles.set(pid, { id, text: clampText(text), until: Date.now() + BUBBLE_MS });
  scheduleBubbleSweep(onExpire);
}

function scheduleBubbleSweep(onExpire) {
  clearTimeout(bubbleTimer);
  const now = Date.now();
  for (const [pid, b] of bubbles) if (b.until <= now) bubbles.delete(pid);
  if (!bubbles.size) return;
  const next = Math.min(...Array.from(bubbles.values(), (b) => b.until));
  bubbleTimer = setTimeout(() => {
    scheduleBubbleSweep(onExpire);
    onExpire();
  }, next - now);
}

// The bubble to hang on a player's panel (null when they have not spoken lately). Its key changes with every
// message, so a new message pops up again while a repaint of the same one leaves the running animation alone.
export function bubbleEl(pid) {
  const b = bubbles.get(pid);
  if (!b || b.until <= Date.now()) return null;
  return h('span', { class: 'bubble', 'data-bubble': `${pid}:${b.id}`, role: 'status' }, b.text);
}

export function clearCallouts() {
  bubbles.clear();
  flavor = null;
  flavorSeen = null;
  clearTimeout(bubbleTimer);
  clearTimeout(flavorTimer);
}

// Looks at the log of a room update for flavour lines that were not there before. The first look (arriving at a
// table) only takes note of what is already in the log.
export function noteFlavor(log, onExpire) {
  const top = log.reduce((max, e) => Math.max(max, e.seq), 0);
  const fresh = flavorSeen === null ? [] : log.filter((e) => e.seq > flavorSeen && FLAVOR_TYPES.has(e.type));
  flavorSeen = Math.max(flavorSeen ?? 0, top);
  if (!fresh.length) return;
  const kept = flavor && flavor.until > Date.now() ? flavor.events : [];
  flavor = { events: [...kept, ...fresh].slice(-FLAVOR_MAX_LINES), until: Date.now() + FLAVOR_MS };
  clearTimeout(flavorTimer);
  flavorTimer = setTimeout(onExpire, FLAVOR_MS);
}

// The log events to announce on the table right now. They are kept here, so the log being trimmed when the next
// hand starts does not take them away early.
export const flavorEvents = () => (flavor && flavor.until > Date.now() ? flavor.events : []);
