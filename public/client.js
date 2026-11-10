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

function cardEl(id, { back = false, size = '', selected = false, onClick = null } = {}) {
  const el = document.createElement('div');
  el.className = 'card ' + size;
  if (id === null || id === undefined) {
    if (back) el.classList.add('back');
    else el.classList.add('empty');
  } else {
    if (suitOf(id) === 1 || suitOf(id) === 2) el.classList.add('red');
    el.append(RANK_LABELS[rankOf(id) - 1], SUIT_LABELS[suitOf(id)]);
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

const state = {
  ws: null,
  name: localStorage.getItem('tonk.name') || '',
  token: localStorage.getItem('tonk.token') || '',
  connected: false,
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
    setTimeout(connect, 1500);
  });
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      state.token = msg.token;
      state.you = msg.id;
      state.name = msg.name;
      localStorage.setItem('tonk.token', msg.token);
      localStorage.setItem('tonk.name', msg.name);
      break;
    case 'lobby':
      state.games = msg.games;
      state.room = null;
      state.view = 'lobby';
      break;
    case 'room':
      state.you = msg.you;
      state.room = msg.room;
      state.view = 'room';
      pruneSelection();
      if (msg.room.round?.turn !== state.you || msg.room.round.phase !== 'draw') state.confirmDown = false;
      break;
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
  const el = cardEl(id, { selected: state.selected.has(id) });
  el.classList.add('clickable', 'in-hand');
  el.addEventListener('pointerdown', (e) => startHandPointer(e, id, el, canDrag));
  return el;
}

// Where a dragged card would be inserted among the other cards, in reading order.
function insertionIndex(others, x, y) {
  let index = 0;
  for (const other of others) {
    const r = other.getBoundingClientRect();
    if (y > r.bottom || (y >= r.top && x > r.left + r.width / 2)) index++;
  }
  return index;
}

function startHandPointer(e, id, el, canDrag) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const handEl = el.parentElement;
  let dragging = false;
  let insertAt = 0;

  const clearMarkers = () => handEl.querySelectorAll('.card').forEach((c) => c.classList.remove('drop-before', 'drop-after'));

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (!canDrag || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      drag.active = true;
      el.classList.add('dragging');
    }
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    const others = [...handEl.querySelectorAll('.card')].filter((c) => c !== el);
    insertAt = insertionIndex(others, ev.clientX, ev.clientY);
    clearMarkers();
    if (insertAt < others.length) others[insertAt].classList.add('drop-before');
    else if (others.length) others[others.length - 1].classList.add('drop-after');
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
// Views
// ---------------------------------------------------------------------------
function render() {
  if (drag.active) {
    drag.pendingRender = true; // never rebuild the DOM under an active drag
    return;
  }
  app.replaceChildren();
  if (!state.connected) {
    app.append(h('div', { class: 'screen' }, h('p', null, 'Connecting to server\u2026')));
    return;
  }
  if (state.view === 'name') app.append(renderName());
  else if (state.view === 'lobby') app.append(renderLobby());
  else if (state.view === 'room') app.append(renderRoom());
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
          h('div', null, p.name, p.id === room.hostId ? ' (host)' : '', p.id === state.you ? ' (you)' : '', p.connected ? '' : ' \u2013 disconnected'),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { disabled: !canStart, onClick: () => send({ t: 'startGame' }) }, 'Start game'),
        leave,
        rulesButton(),
        h('span', { class: 'muted' }, isHost ? (canStart ? '' : 'Waiting for at least one more player\u2026') : 'Waiting for the host to start\u2026'),
      ),
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
      { class: 'opp' + (round.turn === id ? ' turn' : '') + (info && !info.connected ? ' offline' : '') },
      h('strong', null, nameOf(id)),
      h('span', { class: 'muted' }, ` \u2022 ${p.count} cards`, over ? ` \u2022 total ${p.total}` : ''),
      cards,
    );
  });

  const canDrawPhase = myTurn && round.phase === 'draw';
  const canPlayPhase = myTurn && round.phase === 'play';

  const deck = h(
    'div',
    { class: 'pile' },
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
    { class: 'pile' },
    cardEl(round.discardTop, { onClick: discardClick }),
    h('div', null, canPlayPhase ? 'Discard here' : 'Discard'),
  );

  const meldEls = round.melds.map((m) => {
    const canLayoff = canPlayPhase && selected.length === 1 && layoffEnd(m, selected[0]);
    return h(
      'div',
      { class: 'meld' + (canLayoff ? ' target' : ''), onClick: canLayoff ? () => sendAction({ type: 'layoff', card: selected[0], meldId: m.id }) : null },
      h('div', { class: 'label' }, `${nameOf(m.owner)} \u2013 ${m.type === 'set' ? 'set' : 'spread'}`),
      h('div', { class: 'cards' }, m.cards.map((c) => cardEl(c, { size: 'mini' }))),
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
      { class: 'hand-row' },
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
    h('button', { disabled: !canDeal, onClick: () => send({ t: 'startGame' }) }, canDeal ? 'Deal next hand' : 'Waiting for players\u2026'),
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
