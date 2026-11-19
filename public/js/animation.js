// Animation. Tracked cards ([data-card]) have their positions captured before
// every render and compared afterwards (FLIP), so cards travel instead of
// teleporting. New log events (with seq numbers) tell us which opponent moved a
// card we have never seen, so it can fly in from their panel.
import { state } from './state.js';
import { cardEl } from './theme.js';

const fx = document.getElementById('fx');
export const anim = { meta: null, deal: null };

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const MOVE_MS = 280;
const DEAL_MS = 380;
const DEAL_STAGGER_MS = 90;
const DRAW_MS = 1050; // fly to above the hand, hold, then slide in
const GHOST_MS = 450;
const SELECT_LIFT = 'translateY(-18px)'; // keep in sync with .card.selected in style.css

// The scripted deal (see runDeal). Its steps add up to about 3.2 s; Lobby.dealMs (server) keeps the bots and the
// TONK! timer waiting a little longer than that, so keep the two in step.
const DECK_MOVE_MS = 320;
const SHUFFLE_MS = 220; // one riffle; the deck does two
const SHUFFLE_STACK = 6;
const DECK_SCALE = 0.65; // the deck is smaller while it sits by the dealer
const DEAL_FLIGHT_MS = 300;
const DEAL_CARD_GAP_MS = 45;
const DEAL_SPREAD_MS = 600; // the gaps shrink so that a big table is not dealt any slower
const FLIP_MS = 140;
const FLIP_GAP_MS = 30;
const DECK_BACK_MS = 280;
const DISCARD_MS = 400;
const MARK_MS = 350;
const DEAL_MAX_MS = 6000; // a deal that has not finished by now (say, in a background tab) is dropped

const centerOf = (r) => ({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });

export function captureCards() {
  const cards = new Map();
  for (const el of document.querySelectorAll('[data-card]')) {
    cards.set(Number(el.dataset.card), { ...centerOf(el.getBoundingClientRect()), selected: el.classList.contains('selected') });
  }
  return cards;
}

// Where the dealer chip is, so it can slide to its new seat.
export function captureMarks() {
  const marks = {};
  for (const el of document.querySelectorAll('[data-role-mark]')) marks[el.dataset.roleMark] = centerOf(el.getBoundingClientRect());
  return marks;
}

export function currentMeta() {
  const room = state.room;
  return {
    roomId: room.id,
    handNo: room.handNo,
    ended: !!room.round?.result,
    lastSeq: room.log.reduce((m, e) => Math.max(m, e.seq || 0), 0),
    discardTop: room.round?.discardTop ?? null, // the log does not name a card taken from the discard pile
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
  return el.animate(
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

// ---- The deal ----
// A new hand is dealt as a little show: the deck slides to the dealer, is shuffled, the cards fly out face down
// (mine are then turned over), and the deck goes back to the middle and turns up the first discard. While it
// runs the real cards are hidden by CSS (the table's data-deal
// phase, see style.css) and stand-in cards in #fx do the moving. Nobody can move until it is over.
// A client that joins or reconnects during a deal never sees it: only a change of hand number seen live starts one.
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finished = (a) => a.finished.catch(() => {}); // a cancelled animation counts as finished; runDeal checks for that itself
const edgeOn = (deg) => `perspective(600px) rotateY(${deg}deg)`;
const sizeOf = (el) => ['small', 'mini'].find((s) => el.classList.contains(s)) ?? '';

export const isDealing = () => !!anim.deal && anim.deal.handNo === state.room?.handNo;

export function cancelDeal() {
  if (!anim.deal) return;
  anim.deal.token.cancelled = true;
  clearTimeout(anim.deal.watchdog);
  anim.deal = null;
  for (const g of fx.querySelectorAll('.deal-ghost')) g.remove();
}

const abortDeal = (rerender) => {
  cancelDeal();
  queueMicrotask(rerender);
};

// Called before every render: drops a deal that no longer applies and decides whether this render starts one.
export function beginDeal(prevMeta, inRoom) {
  const room = state.room;
  if (anim.deal && (!inRoom || !room || room.id !== anim.deal.roomId || room.handNo !== anim.deal.handNo || room.round?.result))
    cancelDeal();
  if (anim.deal || !inRoom || !room || !prevMeta || prevMeta.roomId !== room.id || prevMeta.handNo === room.handNo) return;
  if (!room.round || room.round.result || document.hidden || reducedMotion()) return;
  anim.deal = { roomId: room.id, handNo: room.handNo, phase: 'deal', pending: true, token: { cancelled: false }, watchdog: null };
}

// A card-shaped stand-in in #fx, placed exactly over `rect` (a centerOf result).
function dealGhost(card, rect, size = '') {
  const g = cardEl(card, { back: card === null, size });
  g.classList.add('ghost', 'deal-ghost');
  Object.assign(g.style, {
    left: `${rect.cx - rect.w / 2}px`,
    top: `${rect.cy - rect.h / 2}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  });
  fx.append(g);
  return g;
}

// A chip slides from the seat it was at (or pops in, if it is new) to where it is now.
function flyMark(role, from) {
  const el = document.querySelector(`[data-role-mark="${role}"]`);
  if (!el) return;
  const to = centerOf(el.getBoundingClientRect());
  el.animate(
    [
      { translate: from ? `${from.cx - to.cx}px ${from.cy - to.cy}px` : '0px 0px', scale: from ? 1 : 0 },
      { translate: '0px 0px', scale: 1 },
    ],
    { duration: MARK_MS, easing: EASE_OUT, fill: 'backwards' },
  );
}

async function runDeal(prevMarks, rerender) {
  const deal = anim.deal;
  const { token } = deal;
  const round = state.room.round;
  const alive = () => !token.cancelled;
  const setPhase = (phase) => {
    deal.phase = phase;
    document.querySelector('.table')?.setAttribute('data-deal', phase);
  };

  const deckEl = document.querySelector('[data-pile="deck"] .card');
  const discardEl = document.querySelector('[data-pile="discard"] .card');
  if (!deckEl || !discardEl || round.discardTop === null) return abortDeal(rerender);
  const deck = centerOf(deckEl.getBoundingClientRect());
  const discard = centerOf(discardEl.getBoundingClientRect());
  const deckAt = (id) => {
    const panel = id === state.you ? document.querySelector('.me-panel') : document.querySelector(`.opp[data-player="${CSS.escape(id)}"]`);
    if (!panel) return deck;
    // Tucked against the dealer's right-hand corner, under the panel (above mine, which is at the bottom of the screen),
    // so the name and the dealer chip stay readable even in the two-column layout of a phone.
    const r = panel.getBoundingClientRect();
    const w = deck.w * DECK_SCALE;
    const h = deck.h * DECK_SCALE;
    return { cx: r.right - w * 0.6, cy: id === state.you ? r.top - h / 2 + 4 : r.bottom + h / 2 - 4, w: deck.w, h: deck.h };
  };
  const dealerAt = (round.dealer && deckAt(round.dealer)) || deck;
  deal.watchdog = setTimeout(() => abortDeal(rerender), DEAL_MAX_MS);

  // The deck is a small stack of card backs that all move and riffle together.
  const stack = Array.from({ length: SHUFFLE_STACK }, () => dealGhost(null, deck));
  let at = { p: deck, scale: 1 };
  const pose = (i, p, scale, dx = 0, deg = 0) => ({
    translate: `${p.cx - deck.cx - i * 0.7 + dx}px ${p.cy - deck.cy - i * 0.7}px`,
    scale,
    rotate: `${deg}deg`,
  });
  const moveStack = (p, scale, duration) => {
    const from = at;
    at = { p, scale };
    return Promise.all(
      stack.map((g, i) =>
        finished(g.animate([pose(i, from.p, from.scale), pose(i, p, scale)], { duration, easing: 'ease-in-out', fill: 'forwards' })),
      ),
    );
  };

  flyMark('dealer', prevMarks.dealer);
  await moveStack(dealerAt, DECK_SCALE, DECK_MOVE_MS);
  if (!alive()) return;

  await Promise.all(
    stack.map((g, i) => {
      const side = i % 2 ? 1 : -1;
      const out = pose(i, at.p, at.scale, side * deck.w * 0.7, side * 8);
      const rest = pose(i, at.p, at.scale);
      return finished(
        g.animate([rest, out, rest], { duration: SHUFFLE_MS, delay: i * 20, iterations: 2, easing: 'ease-in-out', fill: 'forwards' }),
      );
    }),
  );
  if (!alive()) return;

  // Round and round from the first player, one card at a time; each card lands where the real one will be.
  const at0 = { ...at.p, w: deck.w * at.scale, h: deck.h * at.scale };
  const start = Math.max(0, round.order.indexOf(round.first));
  const seats = [...round.order.slice(start), ...round.order.slice(0, start)];
  const slots = new Map(
    seats.map((id) => [
      id,
      id === state.you
        ? [...document.querySelectorAll('.me-panel .hand [data-card]')]
        : [...document.querySelectorAll(`.opp[data-player="${CSS.escape(id)}"] > .cards .card`)],
    ]),
  );
  const total = [...slots.values()].reduce((n, els) => n + els.length, 0);
  const gap = Math.min(DEAL_CARD_GAP_MS, DEAL_SPREAD_MS / Math.max(1, total));
  const dealt = [];
  const mine = [];
  let n = 0;
  for (let k = 0; n < total; k++) {
    for (const id of seats) {
      const el = slots.get(id)[k];
      if (!el) continue;
      const to = centerOf(el.getBoundingClientRect());
      const g = dealGhost(null, to, sizeOf(el));
      dealt.push(g);
      flyFrom(g, at0, { duration: DEAL_FLIGHT_MS, delay: n++ * gap });
      if (id === state.you) mine.push({ g, to, card: Number(el.dataset.card) });
    }
  }
  await wait(Math.max(0, (total - 1) * gap) + DEAL_FLIGHT_MS);
  if (!alive()) return;

  // My cards are turned over, one after the other: the back turns edge-on, then the face turns up.
  await Promise.all(
    mine.map(({ g: back, to, card }, i) => {
      const face = dealGhost(card, to);
      dealt.push(face);
      const delay = i * FLIP_GAP_MS;
      const turnAway = back.animate([{ transform: edgeOn(0) }, { transform: edgeOn(90) }], {
        duration: FLIP_MS,
        delay,
        easing: 'ease-in',
        fill: 'forwards',
      });
      const turnUp = face.animate([{ transform: edgeOn(-90) }, { transform: edgeOn(0) }], {
        duration: FLIP_MS,
        delay: delay + FLIP_MS,
        easing: 'ease-out',
        fill: 'backwards',
      });
      return Promise.all([finished(turnAway), finished(turnUp)]);
    }),
  );
  if (!alive()) return;

  setPhase('return');
  dealt.forEach((g) => g.remove());
  await moveStack(deck, 1, DECK_BACK_MS);
  if (!alive()) return;

  setPhase('discard');
  stack.forEach((g) => g.remove());
  const back = dealGhost(null, deck);
  const face = dealGhost(round.discardTop, deck);
  const travel = { duration: DISCARD_MS, easing: 'ease-in-out', fill: 'forwards' };
  const toDiscard = [{ translate: '0px 0px' }, { translate: `${discard.cx - deck.cx}px ${discard.cy - deck.cy}px` }];
  await Promise.all([
    finished(back.animate(toDiscard, travel)),
    finished(face.animate(toDiscard, travel)),
    finished(
      back.animate(
        [
          { transform: edgeOn(0), offset: 0 },
          { transform: edgeOn(90), offset: 0.5 },
          { transform: edgeOn(90), offset: 1 },
        ],
        travel,
      ),
    ),
    finished(
      face.animate(
        [
          { transform: edgeOn(-90), offset: 0 },
          { transform: edgeOn(-90), offset: 0.5 },
          { transform: edgeOn(0), offset: 1 },
        ],
        travel,
      ),
    ),
  ]);
  if (!alive()) return;

  back.remove();
  face.remove();
  clearTimeout(deal.watchdog);
  anim.deal = null;
  rerender();
}

export function playAnimations(prevMeta, prevCards, prevMarks, rerender) {
  const meta = anim.meta;
  if (!prevMeta || !meta || prevMeta.roomId !== meta.roomId) return;
  if (anim.deal?.pending) {
    anim.deal.pending = false;
    runDeal(prevMarks, rerender).catch((err) => {
      console.error('Deal animation failed:', err);
      abortDeal(rerender);
    });
    return;
  }
  const newHand = prevMeta.handNo !== meta.handNo;
  const known = newHand ? new Map() : prevCards; // card ids repeat across hands
  const events = newHand ? [] : state.room.log.filter((e) => e.seq > prevMeta.lastSeq);
  const deck = pileCenter('deck');

  const placedBy = new Map(); // card id -> opponent who just placed it
  let top = prevMeta.discardTop; // the top of the discard pile as the events go by; null once it is not known
  for (const e of events) {
    const taken = top;
    if (e.type === 'discard') top = e.card;
    else if (e.type === 'takeDiscard') top = null;
    if (e.pid === state.you) continue;
    if (e.type === 'discard' || e.type === 'layoff') placedBy.set(e.card, e.pid);
    else if (e.type === 'meld') e.cards.forEach((c) => placedBy.set(c, e.pid));
    else if (e.type === 'draw') ghostFly(null, deck, panelCenter(e.pid));
    else if (e.type === 'takeDiscard') ghostFly(taken, known.get(taken) || pileCenter('discard'), panelCenter(e.pid));
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
    for (const opp of document.querySelectorAll('.opp[data-player]')) {
      const from = panelCenter(opp.dataset.player);
      if (!from) continue;
      opp
        .querySelectorAll(':scope > .cards .card')
        .forEach((el, i) => flyFrom(el, { ...from, w: from.w * 0.1 }, { duration: 420, delay: i * 70 }));
    }
  }
}
