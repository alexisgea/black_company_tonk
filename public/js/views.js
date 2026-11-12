import { h } from './dom.js';
import { state, toast, nameOf, isSpectator } from './state.js';
import { send, sendAction, connect } from './net.js';
import { classifyMeld, layoffEnd } from './rules.js';
import { cardEl, cardLabel } from './theme.js';
import { chat, fillChatLog, isChatAtBottom } from './chat.js';
import { rulesButton } from './rules-dialog.js';
import { drag, handCardEl } from './hand.js';
import { anim, captureCards, currentMeta, playAnimations } from './animation.js';

const app = document.getElementById('app');

export function render() {
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
        h('h1', null, 'Black Company Tonk'),
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
    h('h1', null, 'Black Company Tonk'),
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
            g.spectators ? h('span', { class: 'muted' }, `\u2022 ${g.spectators} watching`) : null,
            h('span', { class: 'spacer' }),
            h('span', { class: 'muted' }, g.status === 'playing' ? 'in progress' : 'open'),
            h('button', { disabled: !g.joinable, onClick: () => send({ t: 'joinGame', gameId: g.id }) }, 'Join'),
            h('button', { class: 'secondary', disabled: !g.watchable, onClick: () => send({ t: 'watchGame', gameId: g.id }) }, 'Watch'),
          ),
        ),
      )
    : h('p', { class: 'muted' }, 'No tables yet. Create one!');
  return h(
    'div',
    { class: 'screen' },
    h('h1', null, 'Black Company Tonk'),
    h(
      'div',
      { class: 'panel row' },
      h('span', null, 'Playing as ', h('strong', null, state.name)),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'secondary',
          onClick: () => {
            state.view = 'name';
            render();
          },
        },
        'Change name',
      ),
      rulesButton(),
      h('button', { onClick: () => send({ t: 'createGame' }) }, 'Create table'),
    ),
    h('div', { class: 'panel' }, h('h3', { style: 'margin-top:0' }, 'Open tables'), list),
  );
}

function renderRoom() {
  const room = state.room;
  const leave = h('button', { class: 'secondary', onClick: () => send({ t: 'leaveGame' }) }, 'Leave table');
  if (room.status === 'waiting') {
    const isHost = room.hostId === state.you;
    const spectating = isSpectator();
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
            h(
              'span',
              null,
              p.name,
              p.id === room.hostId ? ' (host)' : '',
              p.id === state.you ? ' (you)' : '',
              p.connected ? '' : ' \u2013 disconnected',
            ),
            isHost && p.isBot
              ? h('button', { class: 'secondary small-btn', onClick: () => send({ t: 'removeBot', id: p.id }) }, 'Remove')
              : kickControls(p),
          ),
        ),
      ),
      spectatorsPanel(),
      h(
        'div',
        { class: 'row', style: 'margin-bottom:14px' },
        spectating ? null : h('button', { disabled: !canStart, onClick: () => send({ t: 'startGame' }) }, 'Start game'),
        addBotButton(),
        leave,
        rulesButton(),
        h(
          'span',
          { class: 'muted' },
          isHost ? (canStart ? '' : 'Waiting for at least one more player\u2026') : 'Waiting for the host to start\u2026',
        ),
      ),
      chat.el,
    );
  }
  return h('div', { class: 'table-layout' }, renderTable(), renderSide(leave));
}

function renderSide(leaveBtn) {
  const room = state.room;
  const lines = room.log.map(formatEvent).filter(Boolean);
  const logEl = h(
    'div',
    { class: 'log' },
    lines.map((l) => h('div', null, l)),
  );
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
      room.players.map((p) =>
        h(
          'div',
          { class: 'score-row' },
          h('span', { class: 'score-name' }, p.name + (p.connected ? '' : ' (offline)')),
          h('span', { class: 'score-actions' }, kickControls(p)),
          h('span', { class: 'score-value' }, String(p.score)),
        ),
      ),
    ),
    spectatorsPanel(),
    chat.el,
    h('div', { class: 'panel' }, h('strong', null, 'Log'), logEl),
  );
}

function renderTable() {
  const room = state.room;
  const round = room.round;
  const me = round.players[state.you];
  const inHand = !!me;
  const over = !!round.result;
  const tonkPhase = !over && round.phase === 'tonk';
  const myTurn = round.turn === state.you && !tonkPhase;
  const selected = [...state.selected];

  const canDrawPhase = myTurn && round.phase === 'draw';
  const canPlayPhase = myTurn && round.phase === 'play';

  // Opponents in seating order, starting from the seat after mine.
  const seats = round.order;
  const myIdx = seats.indexOf(state.you);
  const opponents = (myIdx === -1 ? seats : [...seats.slice(myIdx + 1), ...seats.slice(0, myIdx)]).filter((id) => id !== state.you);
  const oppEls = opponents.map((id) => {
    const p = round.players[id];
    const info = room.players.find((x) => x.id === id);
    const cards = h('div', { class: 'cards' });
    if (p.hand) p.hand.forEach((c) => cards.append(cardEl(c, { size: 'mini' })));
    else for (let i = 0; i < p.count; i++) cards.append(cardEl(null, { back: true, size: 'small' }));
    return h(
      'div',
      { class: 'opp' + (round.turn === id && !tonkPhase ? ' turn' : '') + (info && !info.connected ? ' offline' : ''), 'data-player': id },
      h('strong', null, nameOf(id)),
      h('span', { class: 'muted' }, ` \u2022 ${p.count} cards`, p.total !== null ? ` \u2022 total ${p.total}` : ''),
      cards,
      meldsOf(id),
    );
  });

  // Sets and spreads a player has put down, shown in front of that player's hand.
  function meldsOf(owner) {
    const mine = round.melds.filter((m) => m.owner === owner);
    if (!mine.length) return null;
    return h(
      'div',
      { class: 'melds' },
      mine.map((m) => {
        const canLayoff = canPlayPhase && selected.length === 1 && layoffEnd(m, selected[0]);
        return h(
          'div',
          {
            class: 'meld' + (canLayoff ? ' target' : ''),
            onClick: canLayoff ? () => sendAction({ type: 'layoff', card: selected[0], meldId: m.id }) : null,
          },
          h('div', { class: 'label' }, m.type === 'set' ? 'set' : 'spread'),
          h(
            'div',
            { class: 'cards' },
            m.cards.map((c) => cardEl(c, { size: 'mini', zone: 'meld' })),
          ),
        );
      }),
    );
  }

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

  let status = '';
  if (!over) {
    if (!inHand) status = isSpectator() ? 'Watching this hand\u2026' : 'Spectating this hand\u2026';
    else if (tonkPhase)
      status = round.mustDeclareTonk ? 'You have TONK! Press the button to put your cards down.' : 'Waiting for TONK! to be declared\u2026';
    else if (myTurn)
      status = round.phase === 'draw' ? 'Your turn: draw, take the discard, or go down.' : 'Spread, lay off, then discard one card.';
    else status = `Waiting for ${nameOf(round.turn)}\u2026`;
  }

  const handEls = (inHand ? me.hand : []).map((c) => handCardEl(c, !over));

  const validMeld = selected.length >= 3 && classifyMeld(selected);
  const tonkControls = h(
    'div',
    { class: 'row' },
    round.mustDeclareTonk
      ? [
          h('button', { class: 'tonk-btn', onClick: () => send({ t: 'declareTonk' }) }, 'TONK!'),
          h('span', { class: 'muted tonk-timer' }, tonkCountdownText()),
        ]
      : null,
  );
  const controls = h(
    'div',
    { class: 'row' },
    h(
      'button',
      {
        class: 'go-down',
        disabled: !canDrawPhase || state.confirmDown,
        title: canDrawPhase ? '' : 'You can only go down at the start of your turn, before drawing.',
        onClick: () => {
          state.confirmDown = true;
          render();
        },
      },
      'Go down',
    ),
    canDrawPhase ? null : h('span', { class: 'muted go-down-hint' }, 'You can only go down at the start of your turn, before drawing.'),
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
    h(
      'button',
      { disabled: !(canPlayPhase && validMeld), onClick: () => sendAction({ type: 'meld', cards: selected }) },
      'Put down selected',
    ),
    h(
      'button',
      { disabled: !(canPlayPhase && selected.length === 1), onClick: () => sendAction({ type: 'discard', card: selected[0] }) },
      'Discard selected',
    ),
  );

  return h(
    'div',
    { class: 'table' },
    h('div', { class: 'opponents' }, oppEls),
    h('div', { class: 'center' }, h('div', { class: 'piles' }, deck, discard)),
    over ? renderResult(round) : null,
    inHand
      ? h(
          'div',
          { class: 'me-panel' + (myTurn ? ' turn' : '') },
          h('div', { class: 'status' }, status),
          meldsOf(state.you),
          h('div', { class: 'hand-value' }, `Hand value: ${me.total}`),
          h('div', { class: 'hand' }, handEls),
          over ? null : tonkPhase ? tonkControls : controls,
        )
      : h(
          'div',
          { class: 'me-panel' },
          h(
            'div',
            { class: 'status' },
            isSpectator() ? status || 'You are watching this table.' : status || 'Join the next hand when this one ends.',
          ),
        ),
  );
}

// Guests who watch and chat but never see hidden cards. Shown only when there are some.
function spectatorsPanel() {
  const room = state.room;
  if (!room.spectators.length) return null;
  return h(
    'div',
    { class: 'panel scores' },
    h('strong', null, 'Watching'),
    room.spectators.map((s) =>
      h(
        'div',
        { class: 'score-row' },
        h('span', { class: 'score-name' }, s.name + (s.id === state.you ? ' (you)' : '') + (s.connected ? '' : ' (offline)')),
        h('span', { class: 'score-actions' }, kickControls(s)),
      ),
    ),
  );
}

function tonkCountdownText() {
  const secs = Math.max(0, Math.ceil((state.tonkDeadline - Date.now()) / 1000));
  return `Automatic in ${secs}s`;
}

setInterval(() => {
  const el = document.querySelector('.tonk-timer');
  if (el) el.textContent = tonkCountdownText();
}, 250);

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
      h(
        'span',
        { class: 'delta ' + (r.deltas[id] > 0 ? 'pos' : r.deltas[id] < 0 ? 'neg' : '') },
        r.deltas[id] > 0 ? `+${r.deltas[id]}` : String(r.deltas[id]),
      ),
    ),
  );
  const canDeal = room.players.length >= room.minPlayers;
  return h(
    'div',
    { class: 'panel result' },
    h('strong', null, headline),
    h('div', { class: 'hands' }, rows),
    isSpectator()
      ? null
      : h(
          'div',
          { class: 'row' },
          h(
            'button',
            { disabled: !canDeal, onClick: () => send({ t: 'startGame' }) },
            canDeal ? 'Deal next hand' : 'Waiting for players\u2026',
          ),
          addBotButton(),
        ),
  );
}

// Host only: remove a human (Kick) or a bot (Remove), with an inline confirmation (no browser popup).
// Bots can only be removed between hands.
function kickControls(p) {
  if (state.room.hostId !== state.you || p.id === state.you) return null;
  if (p.isBot && state.room.status === 'playing') return null;
  const label = p.isBot ? 'Remove' : 'Kick';
  if (state.confirmKick !== p.id) {
    return h(
      'button',
      {
        class: 'secondary small-btn',
        title: `Remove ${p.name} from the table`,
        onClick: () => {
          state.confirmKick = p.id;
          render();
        },
      },
      label,
    );
  }
  return [
    h(
      'button',
      {
        class: 'small-btn',
        onClick: () => {
          state.confirmKick = null;
          send({ t: p.isBot ? 'removeBot' : 'kick', id: p.id });
        },
      },
      'Confirm',
    ),
    h(
      'button',
      {
        class: 'secondary small-btn',
        onClick: () => {
          state.confirmKick = null;
          render();
        },
      },
      'Cancel',
    ),
  ];
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

function formatEvent(e) {
  const who = nameOf(e.pid, e.name);
  switch (e.type) {
    case 'join':
      return `${who} joined.`;
    case 'leave':
      return `${who} left.`;
    case 'kick':
      return `${who} was removed by the host.`;
    case 'deal':
      return `Hand #${e.hand} dealt by ${who}.`;
    case 'draw':
      return `${who} drew from the pile.`;
    case 'takeDiscard':
      return `${who} took ${cardLabel(e.card)} from the discard.`;
    case 'discard':
      return `${who} discarded ${cardLabel(e.card)}.`;
    case 'meld':
      return `${who} put down ${e.kind === 'set' ? 'a set' : 'a spread'}: ${e.cards.map(cardLabel).join(' ')}.`;
    case 'layoff':
      return `${who} added ${cardLabel(e.card)} to a spread.`;
    case 'goDown':
      return `${who} went down with ${e.total}.`;
    case 'reshuffle':
      return 'Discard pile reshuffled into the draw pile.';
    default:
      return null;
  }
}
