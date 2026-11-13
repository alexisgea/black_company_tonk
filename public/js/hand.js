// Hand cards: click toggles selection, dragging reorders (mouse and touch).
import { h, on } from './dom.js';
import { state } from './state.js';
import { send } from './net.js';
import { render } from './views.js';
import { cardEl } from './theme.js';

const DRAG_THRESHOLD_PX = 6;
export const drag = { active: false, pendingRender: false };

export function handCardEl(id, canDrag) {
  const el = cardEl(id, { selected: state.selected.has(id), zone: 'hand' });
  el.classList.add('clickable', 'in-hand');
  // currentTarget, not `el`: the patcher may reuse an older element for this card.
  on(el, 'pointerdown', (e) => startHandPointer(e, id, e.currentTarget, canDrag));
  return el;
}

// Index of the slot closest to a point. Slots are the hand's natural layout positions.
function nearestSlot(slots, x, y) {
  let best = 0;
  let bestDist = Infinity;
  slots.forEach((s, i) => {
    const dist = Math.hypot(s.x + s.w / 2 - x, s.y + s.h / 2 - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

function startHandPointer(e, id, el, canDrag) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const handEl = el.parentElement;
  // Layout positions (offset*, so unaffected by transforms such as the selection lift).
  const cards = [...handEl.querySelectorAll('.card.in-hand')];
  const slots = cards.map((c) => ({ x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight }));
  const from = cards.indexOf(el);
  let dragging = false;
  let insertAt = from;
  let highlight = null;

  const showInsertion = () => {
    const s = slots[insertAt];
    Object.assign(highlight.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px` });
    // The other cards "push" apart: each one moves to the slot it would occupy after the drop.
    cards.forEach((c, i) => {
      if (c === el) return;
      const j = i < from ? i : i - 1;
      const target = slots[j < insertAt ? j : j + 1];
      c.style.translate = `${target.x - slots[i].x}px ${target.y - slots[i].y}px`;
    });
  };

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (!canDrag || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      drag.active = true;
      el.classList.add('dragging');
      highlight = h('div', { class: 'slot-highlight' });
      handEl.prepend(highlight); // behind the cards
    }
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
    const origin = slots[from];
    insertAt = nearestSlot(slots, origin.x + origin.w / 2 + dx, origin.y + origin.h / 2 + dy);
    showInsertion();
  };

  const finish = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (!dragging) {
      if (ev.type === 'pointerup') {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
      }
      render();
      return;
    }
    drag.active = false;
    drag.pendingRender = false;
    const player = state.room?.round?.players[state.you];
    if (ev.type === 'pointerup' && player?.hand.includes(id)) {
      const order = player.hand.filter((c) => c !== id);
      order.splice(insertAt, 0, id);
      if (order.some((c, i) => c !== player.hand[i])) {
        player.hand = order; // optimistic; the server confirms with a fresh view
        send({ t: 'reorder', cards: order });
      }
    }
    render();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}
