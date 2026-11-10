'use strict';

// ---------------------------------------------------------------------------
// Theme: how cards are drawn. Swap this section out for real art later.
// Card ids are 0..51: rank = id % 13 + 1 (1 = Ace), suit = floor(id / 13) in C, D, H, S order.
// ---------------------------------------------------------------------------
const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_LABELS = ['\u2663', '\u2666', '\u2665', '\u2660'];
const rankOf = (id) => (id % 13) + 1;
const suitOf = (id) => Math.floor(id / 13);
const cardValue = (id) => Math.min(rankOf(id), 10);
const cardLabel = (id) => RANK_LABELS[rankOf(id) - 1] + SUIT_LABELS[suitOf(id)];

// `zone` ('hand' | 'discard' | 'meld') marks cards the animation layer should track by id.
function cardEl(id, { back = false, size = '', selected = false, onClick = null, zone = null } = {}) {
  const el = document.createElement('div');
  el.className = 'card ' + size;
  if (id === null || id === undefined) {
    if (back) el.classList.add('back');
    else el.classList.add('empty');
  } else {
    if (suitOf(id) === 1 || suitOf(id) === 2) el.classList.add('red');
    el.append(RANK_LABELS[rankOf(id) - 1], SUIT_LABELS[suitOf(id)]);
    if (zone) {
      el.dataset.card = id;
      el.dataset.zone = zone;
    }
  }
  if (selected) el.classList.add('selected');
  if (onClick) {
    el.classList.add('clickable');
    el.addEventListener('click', onClick);
  }
  return el;
}
// ---------------------------------------------------------------------------
// End theme
// ---------------------------------------------------------------------------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
localStorage.removeItem('tonk.token'); // older builds shared one token across tabs

const state = {
  ws: null,
  name: localStorage.getItem('tonk.name') || '',
  // Per tab (sessionStorage), so two tabs are two players instead of fighting over one seat.
  token: sessionStorage.getItem('tonk.token') || '',
  connected: false,
  replaced: false, // this seat was taken over by another tab: stop reconnecting
  view: 'name', // 'name' | 'lobby' | 'room'
  games: [],
  you: null,
  room: null,
  selected: new Set(),
  confirmDown: false, // "Go down" clicked, waiting for "I'm sure"
};

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3500);
}

// Surface script errors in the UI so a broken animation or render never fails silently.
window.addEventListener('error', (e) => toast(`Script error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => toast(`Script error: ${e.reason?.message || e.reason}`));

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}
const sendAction = (action) => send({ t: 'action', action });

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;
  ws.addEventListener('open', () => {
    state.connected = true;
    if (state.name) send({ t: 'hello', name: state.name, token: state.token });
    render();
  });
  ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  ws.addEventListener('close', () => {
    state.connected = false;
    render();
    if (!state.replaced) setTimeout(connect, 1500);
  });
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      state.token = msg.token;
      state.you = msg.id;
      state.name = msg.name;
      sessionStorage.setItem('tonk.token', msg.token);
      localStorage.setItem('tonk.name', msg.name);
      break;
    case 'replaced':
      state.replaced = true;
      return;
    case 'lobby':
      state.games = msg.games;
      state.room = null;
      state.view = 'lobby';
      chat.messages = [];
      break;
    case 'room':
      state.you = msg.you;
      state.room = msg.room;
      state.view = 'room';
      chat.messages = msg.room.chat || [];
      if (!msg.room.chat) toast('The server is an older version: restart it (npm start) to enable chat, reordering and opponent animations.');
      pruneSelection();
      if (msg.room.round?.turn !== state.you || msg.room.round.phase !== 'draw') state.confirmDown = false;
      break;
    case 'chat':
      addChatMessage(msg.message); // no full re-render: keeps typing and drags undisturbed
      return;
    case 'error':
      toast(msg.message);
      return;
  }
  render();
}

function pruneSelection() {
  const hand = myRound()?.players[state.you]?.hand || [];
  for (const c of [...state.selected]) if (!hand.includes(c)) state.selected.delete(c);
}

const myRound = () => state.room?.round || null;
const nameOf = (id, fallback) => state.room?.players.find((p) => p.id === id)?.name || fallback || 'Someone';

// ---------------------------------------------------------------------------
// Rules popup: built once, lives outside #app so game updates never reset it.
// ---------------------------------------------------------------------------
const rulesEl = document.getElementById('rules');

function buildRules() {
  const section = (title, items) => [h('h3', null, title), h('ul', null, items.map((t) => h('li', null, t)))];
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rules' },
    h('div', { class: 'dialog-head' }, h('h2', null, 'Tonk rules'), h('span', { class: 'spacer' }), h('button', { onClick: closeRules }, 'Close')),
    section('Goal', ['Have the lowest hand total when someone goes down, or get rid of all your cards. Losers pay the winner.']),
    section('Card values', ['Ace = 1, 2\u201310 = face value, Jack / Queen / King = 10.']),
    section('The deal', [
      'Everyone gets 5 cards. One card is flipped to start the discard pile; the rest is the draw pile. Play starts to the left of the dealer.',
      'TONK: right after the deal, a hand totalling 15 or less, or 49 or more, wins on the spot and every other player pays double. If several players have Tonk it is a draw and the hand is redealt. Tonk can only happen on the deal.',
    ]),
    section('Your turn \u2013 choose one path', [
      'Go down (only at the start of your turn): your hand total is compared with everyone\u2019s. If yours is strictly the lowest, you win and each other player pays 1.',
      'If you are not strictly the lowest, you pay double (2) to every player whose total is equal or lower than yours, and the players with a higher total pay the lowest hand 1. Ties lose for the player who went down.',
      'Normal play: take the top card of the draw pile or the discard pile. Then you may put down melds and add to spreads (below). Finish by discarding one card.',
    ]),
    section('Putting cards down', [
      'Set: 3 or 4 cards of the same rank.',
      'Spread: 3 or more cards of the same suit in order (Ace is low only: A-2-3\u2026 J-Q-K, no wrapping from King to Ace).',
      'Select the cards in your hand and press \u201cPut down selected\u201d. Cards put down no longer count toward your total.',
      'You may add a card to either end of any spread on the table, including other players\u2019 spreads: select the card, then click the spread. Sets cannot be added to.',
    ]),
    section('Winning by emptying your hand', [
      'If you get rid of all your cards during your turn (by putting down, adding to a spread, or discarding your last card), you win and every other player pays you 1.',
    ]),
    section('Other', [
      'If the draw pile runs out, the discard pile (except its top card) is reshuffled.',
      'Scores in the side panel are a running total of what each player has won (+) or paid (\u2212) in this game.',
    ]),
  );
  rulesEl.replaceChildren(dialog);
  rulesEl.addEventListener('click', (e) => e.target === rulesEl && closeRules());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeRules());
}

function openRules() {
  rulesEl.hidden = false;
  rulesEl.querySelector('.dialog').scrollTop = 0;
}

function closeRules() {
  rulesEl.hidden = true;
}

const rulesButton = () => h('button', { class: 'secondary', onClick: openRules }, 'Rules');
buildRules();

// ---------------------------------------------------------------------------
// Hand cards: click toggles selection, dragging reorders (mouse and touch).
// ---------------------------------------------------------------------------
const DRAG_THRESHOLD_PX = 6;
const drag = { active: false, pendingRender: false };

function handCardEl(id, canDrag) {
  const el = cardEl(id, { selected: state.selected.has(id), zone: 'hand' });
  el.classList.add('clickable', 'in-hand');
  el.addEventListener('pointerdown', (e) => startHandPointer(e, id, el, canDrag));
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

// ---------------------------------------------------------------------------
// Chat: one persistent DOM node that is re-attached on every render, so incoming
// game updates never clear the text being typed or the scroll position.
// ---------------------------------------------------------------------------
const MAX_CHAT_KEPT = 50;
const chat = { messages: [], el: null, logEl: null, input: null };

function buildChat() {
  chat.logEl = h('div', { class: 'chat-log' });
  chat.input = h('input', { type: 'text', maxLength: 200, placeholder: 'Say something\u2026', autocomplete: 'off' });
  const form = h(
    'form',
    {
      class: 'chat-form',
      onSubmit: (e) => {
        e.preventDefault();
        const text = chat.input.value.trim();
        if (!text) return;
        send({ t: 'chat', text });
        chat.input.value = '';
      },
    },
    chat.input,
    h('button', { type: 'submit' }, 'Send'),
  );
  chat.el = h('div', { class: 'panel chat' }, h('strong', null, 'Chat'), chat.logEl, form);
}

function fillChatLog() {
  chat.logEl.replaceChildren(
    ...chat.messages.map((m) =>
      h('div', { class: 'chat-msg' + (m.pid === state.you ? ' mine' : '') }, h('strong', null, m.name + ': '), m.text),
    ),
  );
}

const isChatAtBottom = () => chat.logEl.scrollTop + chat.logEl.clientHeight >= chat.logEl.scrollHeight - 24;

function addChatMessage(message) {
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.id >= message.id) return;
  const atBottom = isChatAtBottom();
  chat.messages = [...chat.messages, message].slice(-MAX_CHAT_KEPT);
  fillChatLog();
  if (atBottom) chat.logEl.scrollTop = chat.logEl.scrollHeight;
}

buildChat();

// ---------------------------------------------------------------------------
// Animation. Tracked cards ([data-card]) have their positions captured before
// every render and compared afterwards (FLIP), so cards travel instead of
// teleporting. New log events (with seq numbers) tell us which opponent moved a
// card we have never seen, so it can fly in from their panel.
// ---------------------------------------------------------------------------
const fx = document.getElementById('fx');
localStorage.removeItem('tonk.motion'); // leftover from the removed animations toggle
const anim = { meta: null };

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const MOVE_MS = 280;
const DEAL_MS = 380;
const DEAL_STAGGER_MS = 90;
const DRAW_MS = 1050; // fly to above the hand, hold, then slide in
const GHOST_MS = 450;
const SELECT_LIFT = 'translateY(-18px)'; // keep in sync with .card.selected in style.css

const centerOf = (r) => ({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });

function captureCards() {
  const cards = new Map();
  for (const el of document.querySelectorAll('[data-card]')) {
    cards.set(Number(el.dataset.card), { ...centerOf(el.getBoundingClientRect()), selected: el.classList.contains('selected') });
  }
  return cards;
}

function currentMeta() {
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
  el.animate(
    [{ transform: selected ? 'none' : SELECT_LIFT }, { transform: selected ? SELECT_LIFT : 'none' }],
    { duration: 160, easing: EASE_OUT },
  );
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
  Object.assign(g.style, { left: `${from.cx - from.w / 2}px`, top: `${from.cy - from.h / 2}px`, width: `${from.w}px`, height: `${from.h}px` });
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

function playAnimations(prevMeta, prevCards) {
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

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function render() {
  if (drag.active) {
    drag.pendingRender = true; // never rebuild the DOM under an active drag
    return;
  }
  const hadFocus = document.activeElement === chat.input;
  const caret = [chat.input.selectionStart, chat.input.selectionEnd];
  const wasAtBottom = isChatAtBottom();
  const scrollTop = chat.logEl.scrollTop;
  const prevMeta = anim.meta;
  const prevCards = captureCards();
  anim.meta = null;
  app.replaceChildren();
  if (state.replaced) {
    app.append(
      h(
        'div',
        { class: 'screen' },
        h('h1', null, 'Tonk'),
        h(
          'div',
          { class: 'panel' },
          h('p', null, 'This game was opened in another tab or window, so this one was disconnected.'),
          h(
            'button',
            {
              onClick: () => {
                state.replaced = false;
                connect();
              },
            },
            'Use this tab',
          ),
        ),
      ),
    );
    return;
  }
  if (!state.connected) {
    app.append(h('div', { class: 'screen' }, h('p', null, 'Connecting to server\u2026')));
    return;
  }
  if (state.view === 'name') app.append(renderName());
  else if (state.view === 'lobby') app.append(renderLobby());
  else if (state.view === 'room') {
    app.append(renderRoom());
    fillChatLog();
    chat.logEl.scrollTop = wasAtBottom ? chat.logEl.scrollHeight : scrollTop;
    anim.meta = currentMeta();
    playAnimations(prevMeta, prevCards);
    if (hadFocus) {
      chat.input.focus();
      chat.input.setSelectionRange(caret[0], caret[1]);
    }
  }
}

function renderName() {
  const input = h('input', { type: 'text', maxLength: 20, placeholder: 'Your name', value: state.name, autofocus: true });
  const go = () => {
    const name = input.value.trim();
    if (!name) return toast('Please enter a name');
    state.name = name;
    send({ t: 'hello', name, token: state.token });
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  return h(
    'div',
    { class: 'screen' },
    h('h1', null, 'Tonk'),
    h('div', { class: 'panel row' }, input, h('button', { onClick: go }, 'Play')),
  );
}

function renderLobby() {
  const list = state.games.length
    ? h(
        'ul',
        { class: 'games' },
        state.games.map((g) =>
          h(
            'li',
            null,
            h('strong', null, g.name),
            h('span', { class: 'muted' }, `${g.players.join(', ')} (${g.players.length}/${g.max})`),
            h('span', { class: 'spacer' }),
            h('span', { class: 'muted' }, g.status === 'playing' ? 'in progress' : 'open'),
            h('button', { disabled: !g.joinable, onClick: () => send({ t: 'joinGame', gameId: g.id }) }, 'Join'),
          ),
        ),
      )
    : h('p', { class: 'muted' }, 'No games yet. Create one!');
  return h(
    'div',
    { class: 'screen' },
    h('h1', null, 'Tonk'),
    h(
      'div',
      { class: 'panel row' },
      h('span', null, 'Playing as ', h('strong', null, state.name)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'secondary', onClick: () => { state.view = 'name'; render(); } }, 'Change name'),
      rulesButton(),
      h('button', { onClick: () => send({ t: 'createGame' }) }, 'Create game'),
    ),
    h('div', { class: 'panel' }, h('h3', { style: 'margin-top:0' }, 'Open games'), list),
  );
}

function renderRoom() {
  const room = state.room;
  const leave = h('button', { class: 'secondary', onClick: () => send({ t: 'leaveGame' }) }, 'Leave game');
  if (room.status === 'waiting') {
    const isHost = room.hostId === state.you;
    const canStart = isHost && room.players.length >= room.minPlayers;
    return h(
      'div',
      { class: 'screen' },
      h('h1', null, room.name),
      h(
        'div',
        { class: 'panel' },
        h('h3', { style: 'margin-top:0' }, 'Players'),
        room.players.map((p) =>
          h(
            'div',
            { class: 'row' },
            h('span', null, p.name, p.id === room.hostId ? ' (host)' : '', p.id === state.you ? ' (you)' : '', p.connected ? '' : ' \u2013 disconnected'),
            isHost && p.isBot
              ? h('button', { class: 'secondary small-btn', onClick: () => send({ t: 'removeBot', id: p.id }) }, 'Remove')
              : null,
          ),
        ),
      ),
      h(
        'div',
        { class: 'row', style: 'margin-bottom:14px' },
        h('button', { disabled: !canStart, onClick: () => send({ t: 'startGame' }) }, 'Start game'),
        addBotButton(),
        leave,
        rulesButton(),
        h('span', { class: 'muted' }, isHost ? (canStart ? '' : 'Waiting for at least one more player\u2026') : 'Waiting for the host to start\u2026'),
      ),
      chat.el,
    );
  }
  return h('div', { class: 'table-layout' }, renderTable(), renderSide(leave));
}

function renderSide(leaveBtn) {
  const room = state.room;
  const lines = room.log.map(formatEvent).filter(Boolean);
  const logEl = h('div', { class: 'log' }, lines.map((l) => h('div', null, l)));
  requestAnimationFrame(() => (logEl.scrollTop = logEl.scrollHeight));
  return h(
    'div',
    { class: 'side' },
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'row' }, h('strong', null, room.name), h('span', { class: 'spacer' }), rulesButton(), leaveBtn),
      h('div', { class: 'muted' }, `Hand #${room.handNo}`),
    ),
    h(
      'div',
      { class: 'panel scores' },
      h('strong', null, 'Scores'),
      room.players.map((p) => h('div', null, h('span', null, p.name + (p.connected ? '' : ' (offline)')), h('span', null, String(p.score)))),
    ),
    chat.el,
    h('div', { class: 'panel' }, h('strong', null, 'Log'), logEl),
  );
}

function renderTable() {
  const room = state.room;
  const round = room.round;
  const me = round.players[state.you];
  const inHand = !!me;
  const myTurn = round.turn === state.you;
  const over = !!round.result;
  const selected = [...state.selected];

  // Opponents in seating order, starting from the seat after mine.
  const seats = round.order;
  const myIdx = seats.indexOf(state.you);
  const opponents = (myIdx === -1 ? seats : [...seats.slice(myIdx + 1), ...seats.slice(0, myIdx)]).filter((id) => id !== state.you);
  const oppEls = opponents.map((id) => {
    const p = round.players[id];
    const info = room.players.find((x) => x.id === id);
    const cards = h('div', { class: 'cards' });
    if (over) p.hand.forEach((c) => cards.append(cardEl(c, { size: 'mini' })));
    else for (let i = 0; i < p.count; i++) cards.append(cardEl(null, { back: true, size: 'small' }));
    return h(
      'div',
      { class: 'opp' + (round.turn === id ? ' turn' : '') + (info && !info.connected ? ' offline' : ''), 'data-player': id },
      h('strong', null, nameOf(id)),
      h('span', { class: 'muted' }, ` \u2022 ${p.count} cards`, over ? ` \u2022 total ${p.total}` : ''),
      cards,
    );
  });

  const canDrawPhase = myTurn && round.phase === 'draw';
  const canPlayPhase = myTurn && round.phase === 'play';

  const deck = h(
    'div',
    { class: 'pile', 'data-pile': 'deck' },
    cardEl(null, { back: round.deckCount > 0, size: '', onClick: canDrawPhase ? () => sendAction({ type: 'draw' }) : null }),
    h('div', null, `Draw (${round.deckCount})`),
  );
  const discardClick = canDrawPhase
    ? () => sendAction({ type: 'takeDiscard' })
    : canPlayPhase && selected.length === 1
      ? () => sendAction({ type: 'discard', card: selected[0] })
      : null;
  const discard = h(
    'div',
    { class: 'pile', 'data-pile': 'discard' },
    cardEl(round.discardTop, { onClick: discardClick, zone: 'discard' }),
    h('div', null, canPlayPhase ? 'Discard here' : 'Discard'),
  );

  const meldEls = round.melds.map((m) => {
    const canLayoff = canPlayPhase && selected.length === 1 && layoffEnd(m, selected[0]);
    return h(
      'div',
      { class: 'meld' + (canLayoff ? ' target' : ''), onClick: canLayoff ? () => sendAction({ type: 'layoff', card: selected[0], meldId: m.id }) : null },
      h('div', { class: 'label' }, `${nameOf(m.owner)} \u2013 ${m.type === 'set' ? 'set' : 'spread'}`),
      h('div', { class: 'cards' }, m.cards.map((c) => cardEl(c, { size: 'mini', zone: 'meld' }))),
    );
  });

  let status = '';
  if (!over) {
    if (!inHand) status = 'Spectating this hand\u2026';
    else if (myTurn) status = round.phase === 'draw' ? 'Your turn: draw, take the discard, or go down.' : 'Meld, lay off, then discard one card.';
    else status = `Waiting for ${nameOf(round.turn)}\u2026`;
  }

  const handEls = (inHand ? me.hand : []).map((c) => handCardEl(c, !over));

  const validMeld = selected.length >= 3 && classifyMeld(selected);
  const controls = h(
    'div',
    { class: 'row' },
    h(
      'button',
      {
        disabled: !canDrawPhase || state.confirmDown,
        onClick: () => {
          state.confirmDown = true;
          render();
        },
      },
      inHand ? `Go down (${me.total})` : 'Go down',
    ),
    state.confirmDown && canDrawPhase
      ? [
          h(
            'button',
            {
              onClick: () => {
                state.confirmDown = false;
                sendAction({ type: 'goDown' });
              },
            },
            "I'm sure",
          ),
          h(
            'button',
            {
              class: 'secondary',
              onClick: () => {
                state.confirmDown = false;
                render();
              },
            },
            'Cancel',
          ),
        ]
      : null,
    h('button', { disabled: !(canPlayPhase && validMeld), onClick: () => sendAction({ type: 'meld', cards: selected }) }, 'Put down selected'),
    h('button', { disabled: !(canPlayPhase && selected.length === 1), onClick: () => sendAction({ type: 'discard', card: selected[0] }) }, 'Discard selected'),
  );

  return h(
    'div',
    { class: 'table' },
    h('div', { class: 'opponents' }, oppEls),
    h('div', { class: 'center' }, h('div', { class: 'piles' }, deck, discard), h('div', { class: 'melds' }, meldEls)),
    over ? renderResult(round) : null,
    inHand
      ? h(
          'div',
          { class: 'me-panel' + (myTurn ? ' turn' : '') },
          h('div', { class: 'status' }, status),
          h('div', { class: 'hand' }, handEls),
          over ? null : controls,
        )
      : h('div', { class: 'me-panel' }, h('div', { class: 'status' }, status || 'Join the next hand when this one ends.')),
  );
}

function renderResult(round) {
  const r = round.result;
  const room = state.room;
  let headline;
  switch (r.type) {
    case 'tonk':
      headline = `${nameOf(r.winners[0])} has TONK and wins double!`;
      break;
    case 'tonkDraw':
      headline = 'More than one player has TONK \u2013 the hand is a draw.';
      break;
    case 'down':
      headline = r.success
        ? `${nameOf(r.actor)} went down with ${r.totals[r.actor]} and wins!`
        : `${nameOf(r.actor)} went down with ${r.totals[r.actor]} but was beaten and pays double.`;
      break;
    case 'empty':
      headline = `${nameOf(r.actor)} emptied their hand and wins!`;
      break;
    default:
      headline = 'Hand aborted: not enough players.';
  }
  const rows = round.order.map((id) =>
    h(
      'div',
      { class: 'hand-row', 'data-player': id },
      h('span', { class: 'who' }, `${nameOf(id)} (${r.totals[id]})`),
      r.hands[id].map((c) => cardEl(c, { size: 'mini' })),
      h('span', { class: 'delta ' + (r.deltas[id] > 0 ? 'pos' : r.deltas[id] < 0 ? 'neg' : '') }, r.deltas[id] > 0 ? `+${r.deltas[id]}` : String(r.deltas[id])),
    ),
  );
  const canDeal = room.players.length >= room.minPlayers;
  return h(
    'div',
    { class: 'panel result' },
    h('strong', null, headline),
    h('div', { class: 'hands' }, rows),
    h(
      'div',
      { class: 'row' },
      h('button', { disabled: !canDeal, onClick: () => send({ t: 'startGame' }) }, canDeal ? 'Deal next hand' : 'Waiting for players\u2026'),
      addBotButton(),
    ),
  );
}

// Host only: bots fill empty seats (up to the table limit).
function addBotButton() {
  const room = state.room;
  if (room.hostId !== state.you) return null;
  return h(
    'button',
    { class: 'secondary', disabled: room.players.length >= room.maxPlayers, onClick: () => send({ t: 'addBot' }) },
    'Add bot',
  );
}

// Mirrors of the server rules, used only to enable/disable controls. The server is authoritative.
function classifyMeld(cards) {
  if (cards.length < 3 || new Set(cards).size !== cards.length) return null;
  if (cards.length <= 4 && cards.every((c) => rankOf(c) === rankOf(cards[0]))) return { type: 'set' };
  if (!cards.every((c) => suitOf(c) === suitOf(cards[0]))) return null;
  const ranks = cards.map(rankOf).sort((a, b) => a - b);
  return ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1) ? { type: 'run' } : null;
}

function layoffEnd(meld, card) {
  if (meld.type !== 'run' || suitOf(card) !== suitOf(meld.cards[0])) return null;
  if (rankOf(card) === rankOf(meld.cards[0]) - 1) return 'low';
  if (rankOf(card) === rankOf(meld.cards[meld.cards.length - 1]) + 1) return 'high';
  return null;
}

function formatEvent(e) {
  const who = nameOf(e.pid, e.name);
  switch (e.type) {
    case 'join': return `${who} joined.`;
    case 'leave': return `${who} left.`;
    case 'deal': return `Hand #${e.hand} dealt by ${who}.`;
    case 'draw': return `${who} drew from the pile.`;
    case 'takeDiscard': return `${who} took ${cardLabel(e.card)} from the discard.`;
    case 'discard': return `${who} discarded ${cardLabel(e.card)}.`;
    case 'meld': return `${who} put down ${e.kind === 'set' ? 'a set' : 'a spread'}: ${e.cards.map(cardLabel).join(' ')}.`;
    case 'layoff': return `${who} added ${cardLabel(e.card)} to a spread.`;
    case 'goDown': return `${who} went down with ${e.total}.`;
    case 'reshuffle': return 'Discard pile reshuffled into the draw pile.';
    default: return null;
  }
}

render();
connect();
