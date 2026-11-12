// Animation. Tracked cards ([data-card]) have their positions captured before
// every render and compared afterwards (FLIP), so cards travel instead of
// teleporting. New log events (with seq numbers) tell us which opponent moved a
// card we have never seen, so it can fly in from their panel.
import { state } from './state.js';
import { cardEl } from './theme.js';

const fx = document.getElementById('fx');
export const anim = { meta: null };

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const MOVE_MS = 280;
const DEAL_MS = 380;
const DEAL_STAGGER_MS = 90;
const DRAW_MS = 1050; // fly to above the hand, hold, then slide in
const GHOST_MS = 450;
const SELECT_LIFT = 'translateY(-18px)'; // keep in sync with .card.selected in style.css

const centerOf = (r) => ({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });

export function captureCards() {
  const cards = new Map();
  for (const el of document.querySelectorAll('[data-card]')) {
    cards.set(Number(el.dataset.card), { ...centerOf(el.getBoundingClientRect()), selected: el.classList.contains('selected') });
  }
  return cards;
}

export function currentMeta() {
  const room = state.room;
  return {
    roomId: room.id,
    handNo: room.handNo,
    ended: !!room.round?.result,
    lastSeq: room.log.reduce((m, e) => Math.max(m, e.seq || 0), 0),
  };
}

const pileCenter = (name) => {
  const el = document.querySelector(`[data-pile="${name}"] .card`);
  return el ? centerOf(el.getBoundingClientRect()) : null;
};
const panelCenter = (pid) => {
  const el = document.querySelector(`.opp[data-player="${CSS.escape(pid)}"]`);
  return el ? centerOf(el.getBoundingClientRect()) : null;
};

// Slide an element from where `from` was to where it is now.
function flyFrom(el, from, { duration = MOVE_MS, delay = 0, easing = EASE_OUT } = {}) {
  const to = centerOf(el.getBoundingClientRect());
  el.animate(
    [
      { translate: `${from.cx - to.cx}px ${from.cy - to.cy}px`, scale: from.w / to.w },
      { translate: '0px 0px', scale: 1 },
    ],
    { duration, delay, easing, fill: 'backwards' },
  );
}

function animateSelection(el, selected) {
  el.animate([{ transform: selected ? 'none' : SELECT_LIFT }, { transform: selected ? SELECT_LIFT : 'none' }], {
    duration: 160,
    easing: EASE_OUT,
  });
}

// My own draw: out of the pile, up above the hand for a moment, then slides into place.
function revealDraw(el, deck) {
  const to = centerOf(el.getBoundingClientRect());
  const handRect = el.parentElement.getBoundingClientRect();
  const reveal = { cx: to.cx, cy: handRect.top - to.h / 2 + 6 };
  const offset = (c) => `${c.cx - to.cx}px ${c.cy - to.cy}px`;
  el.style.zIndex = 20;
  const done = () => (el.style.zIndex = '');
  const a = el.animate(
    [
      { translate: offset(deck), scale: deck.w / to.w, offset: 0, easing: EASE_OUT },
      { translate: offset(reveal), scale: 1.2, offset: 0.3 },
      { translate: offset(reveal), scale: 1.2, offset: 0.62, easing: 'ease-in-out' },
      { translate: '0px 0px', scale: 1, offset: 1 },
    ],
    { duration: DRAW_MS, fill: 'backwards' },
  );
  a.onfinish = done;
  a.oncancel = done;
}

// A throwaway card that flies between two points (used for cards that never appear in our DOM).
function ghostFly(card, from, to) {
  if (!from || !to) return;
  const g = cardEl(card, { back: card === null });
  g.classList.add('ghost');
  Object.assign(g.style, {
    left: `${from.cx - from.w / 2}px`,
    top: `${from.cy - from.h / 2}px`,
    width: `${from.w}px`,
    height: `${from.h}px`,
  });
  fx.append(g);
  const a = g.animate(
    [
      { translate: '0px 0px', scale: 1, opacity: 1 },
      { translate: `${to.cx - from.cx}px ${to.cy - from.cy}px`, scale: 0.5, opacity: 0.5 },
    ],
    { duration: GHOST_MS, easing: 'ease-in-out', fill: 'forwards' },
  );
  a.onfinish = () => g.remove();
  a.oncancel = () => g.remove();
}

export function playAnimations(prevMeta, prevCards) {
  const meta = anim.meta;
  if (!prevMeta || !meta || prevMeta.roomId !== meta.roomId) return;
  const newHand = prevMeta.handNo !== meta.handNo;
  const known = newHand ? new Map() : prevCards; // card ids repeat across hands
  const events = newHand ? [] : state.room.log.filter((e) => e.seq > prevMeta.lastSeq);
  const deck = pileCenter('deck');

  const placedBy = new Map(); // card id -> opponent who just placed it
  for (const e of events) {
    if (e.pid === state.you) continue;
    if (e.type === 'discard' || e.type === 'layoff') placedBy.set(e.card, e.pid);
    else if (e.type === 'meld') e.cards.forEach((c) => placedBy.set(c, e.pid));
    else if (e.type === 'draw') ghostFly(null, deck, panelCenter(e.pid));
    else if (e.type === 'takeDiscard') ghostFly(e.card, known.get(e.card) || pileCenter('discard'), panelCenter(e.pid));
  }

  let dealt = 0;
  let placed = 0;
  let revealed = false;
  for (const el of document.querySelectorAll('[data-card]')) {
    const id = Number(el.dataset.card);
    const zone = el.dataset.zone;
    const before = known.get(id);
    if (before) {
      const now = centerOf(el.getBoundingClientRect());
      if (Math.hypot(before.cx - now.cx, before.cy - now.cy) > 2 || Math.abs(before.w - now.w) > 1) flyFrom(el, before);
      const selected = el.classList.contains('selected');
      if (zone === 'hand' && before.selected !== selected) animateSelection(el, selected);
    } else if (zone === 'hand' && newHand && deck) {
      flyFrom(el, deck, { duration: DEAL_MS, delay: dealt++ * DEAL_STAGGER_MS });
    } else if (zone === 'hand' && !revealed && deck) {
      // A card we have never seen showing up in our hand mid-hand can only be our own draw.
      revealed = true;
      revealDraw(el, deck);
    } else if (zone === 'discard' && newHand && deck) {
      flyFrom(el, deck, { duration: DEAL_MS, delay: dealt++ * DEAL_STAGGER_MS });
    } else if (placedBy.has(id)) {
      const panel = panelCenter(placedBy.get(id));
      if (panel) flyFrom(el, { ...panel, w: panel.w * 0.2 }, { delay: placed++ * 70 });
    }
  }

  // The hand just ended (someone went down, Tonk, or emptied their hand): hands are turned over onto the table.
  if (meta.ended && !prevMeta.ended) {
    for (const row of document.querySelectorAll('.result .hand-row')) {
      const pid = row.dataset.player;
      const from = pid === state.you ? centerOf(document.querySelector('.me-panel .hand').getBoundingClientRect()) : panelCenter(pid);
      if (!from) continue;
      row.querySelectorAll('.card').forEach((el, i) => flyFrom(el, { ...from, w: from.w * 0.1 }, { duration: 420, delay: i * 70 }));
    }
  }
}
