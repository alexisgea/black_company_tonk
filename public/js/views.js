import { h, patchChildren } from './dom.js';
import { state, toast, nameOf, isSpectator } from './state.js';
import { send, sendAction, sendHello, connect } from './net.js';
import { classifyMeld, layoffEnd } from './rules.js';
import { cardEl, cardLabel } from './theme.js';
import { chat, fillChatLog, isChatAtBottom } from './chat.js';
import { rulesButton } from './rules-dialog.js';
import { changelogButton } from './changelog-dialog.js';
import { drag, handCardEl } from './hand.js';
import { anim, captureCards, currentMeta, playAnimations } from './animation.js';

const app = document.getElementById('app');
const chatSlot = () => h('div', { 'data-persist': 'chat' });
const secondsLeft = (deadline) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
const URGENT_SECONDS = 15;

export function render() {
  if (drag.active) {
    drag.pendingRender = true; // never rebuild the DOM under an active drag
    return;
  }
  const hadFocus = document.activeElement === chat.input;
  const caret = [chat.input.selectionStart, chat.input.selectionEnd];
  const wasAtBottom = isChatAtBottom();
  const scrollTop = chat.logEl.scrollTop;
  const oldLog = app.querySelector('.log');
  const logWasAtBottom = !oldLog || oldLog.scrollTop + oldLog.clientHeight >= oldLog.scrollHeight - 24;
  const prevMeta = anim.meta;
  const prevCards = captureCards();
  anim.meta = null;
  const inRoom = !state.replaced && state.connected && state.view === 'room';
  // Reused elements must not start CSS transitions from the stale inline styles the patcher clears (drag, FLIP).
  app.classList.add('no-transition');
  try {
    patchChildren(app, [screen()]);
    const log = app.querySelector('.log');
    if (log && logWasAtBottom) log.scrollTop = log.scrollHeight;
    if (inRoom) {
      fillChatLog();
      chat.logEl.scrollTop = wasAtBottom ? chat.logEl.scrollHeight : scrollTop;
      anim.meta = currentMeta();
      playAnimations(prevMeta, prevCards);
      if (hadFocus && document.activeElement !== chat.input) {
        chat.input.focus();
        chat.input.setSelectionRange(caret[0], caret[1]);
      }
    }
    void app.offsetHeight; // commit styles while transitions are still off
  } finally {
    app.classList.remove('no-transition');
  }
}

function screen() {
  if (state.replaced) {
    return h(
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
    );
  }
  if (!state.connected) {
    return h(
      'div',
      { class: 'screen' },
      h('p', null, 'Connecting to server\u2026'),
      state.retryAt ? h('p', { class: 'muted retry-timer' }, retryText()) : null,
    );
  }
  if (state.view === 'name') return renderName();
  if (state.view === 'lobby') return renderLobby();
  return renderRoom();
}

function credits() {
  return h(
    'p',
    { class: 'credits muted' },
    'Thanks to Glen Cook for his Black Company series. Based on the rules from John P. Speno and the Baltimore Science Fiction Society. ' +
      'Programming by Claude Sonnet 5.5 with Copilot on VS Code, overall design by Alexis. For any feedback or bug report: ',
    h('a', { href: 'mailto:alexis@geaxle.com' }, 'alexis@geaxle.com'),
    '.',
  );
}

function renderName() {
  const input = h('input', {
    id: 'name-input',
    type: 'text',
    maxLength: 20,
    placeholder: 'Your name',
    value: state.name,
    autofocus: true,
    onKeydown: (e) => e.key === 'Enter' && go(e.currentTarget),
  });
  // `field` is the live input: the patcher may keep an older element instead of the one built here.
  const go = (field) => {
    const name = field.value.trim();
    if (!name) return toast('Please enter a name');
    state.name = name;
    sendHello(name);
  };
  return h(
    'div',
    { class: 'screen' },
    h('h1', null, 'Black Company Tonk'),
    h('div', { class: 'panel row' }, input, h('button', { onClick: () => go(document.getElementById('name-input')) }, 'Play')),
    credits(),
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
            h('span', { class: 'muted' }, `\u2022 ${g.startingCoins} coins, bet ${g.bet}`),
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
      changelogButton(),
      h('button', { onClick: () => send({ t: 'createGame' }) }, 'Create table'),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', { style: 'margin-top:0' }, 'Open tables'),
      h('p', { class: 'muted' }, `${state.online} ${state.online === 1 ? 'player' : 'players'} online`),
      list,
    ),
    credits(),
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
              p.away ? ' \u2013 bot playing' : '',
            ),
            isHost && p.isBot
              ? h('button', { class: 'secondary small-btn', onClick: () => send({ t: 'removeBot', id: p.id }) }, 'Remove')
              : kickControls(p),
          ),
        ),
      ),
      spectatorsPanel(),
      settingsPanel(isHost),
      awayNotice(),
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
      chatSlot(),
    );
  }
  return h('div', { class: 'table-layout' }, renderTable(), renderSide(leave));
}

// Shown to a player whose seat is being played by a bot because they took too long.
function awayNotice() {
  if (!state.room.players.some((p) => p.id === state.you && p.away)) return null;
  return h(
    'div',
    { class: 'away-notice' },
    h('span', null, 'You took too long, so a bot is playing your turns.'),
    h('button', { onClick: () => send({ t: 'resume' }) }, 'Take back control'),
  );
}

function renderSide(leaveBtn) {
  const room = state.room;
  const lines = room.log.map(formatEvent).filter(Boolean);
  const logEl = h(
    'div',
    { class: 'log' },
    lines.map((l) => h('div', null, l)),
  );
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
      h(
        'div',
        { class: 'row' },
        h('strong', null, 'Coins'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted' }, `Bet: ${room.settings.bet}`),
      ),
      room.players.map((p) =>
        h(
          'div',
          { class: 'score-row' },
          h('span', { class: 'score-name' }, p.name + (p.connected ? '' : ' (offline)') + (p.away ? ' (bot playing)' : '')),
          h('span', { class: 'score-actions' }, kickControls(p)),
          h('span', { class: 'score-value' }, String(p.coins)),
        ),
      ),
    ),
    spectatorsPanel(),
    chatSlot(),
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
      {
        class:
          'opp' +
          (round.turn === id && !tonkPhase ? ' turn' : '') +
          (info && !info.connected ? ' offline' : '') +
          (info?.away ? ' away' : ''),
        'data-player': id,
      },
      h('strong', null, nameOf(id) + (info?.away ? ' (bot playing)' : '')),
      h('span', { class: 'muted' }, ` \u2022 ${p.count} cards`, p.total !== null ? ` \u2022 total ${p.total}` : ''),
      cards,
      meldsOf(id),
    );
  });

  // Spreads (sets and runs) a player has put down, shown in front of that player's hand.
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
          h('div', { class: 'label' }, m.type === 'set' ? 'set' : 'run'),
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
      status =
        round.phase === 'draw'
          ? 'Your turn: draw, take the discard, or go down.'
          : 'Put down a spread or add cards to a spread, then discard one card.';
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
    // Custom CSS tooltip (data-tip) on a wrapper: native title tooltips are slow, flaky on disabled buttons and absent on touch.
    h(
      'span',
      {
        class: 'go-down-wrap',
        'data-tip': canDrawPhase ? null : 'You can only go down at the start of your turn, before drawing.',
        tabindex: canDrawPhase ? null : 0,
      },
      h(
        'button',
        {
          class: 'go-down',
          disabled: !canDrawPhase || state.confirmDown,
          onClick: () => {
            state.confirmDown = true;
            render();
          },
        },
        'Go down',
      ),
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
          turnTimerLine(myTurn),
          awayNotice(),
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
  return `Automatic in ${secondsLeft(state.tonkDeadline)}s`;
}

const turnTimerText = () => `Bot takes over in ${secondsLeft(state.turnDeadline)}s`;
const retryText = () => `Retrying in ${secondsLeft(state.retryAt)}s\u2026`;

// Only on my own turn: after this long without a move a bot plays for me.
function turnTimerLine(myTurn) {
  if (!myTurn || state.turnDeadline === null) return null;
  const urgent = secondsLeft(state.turnDeadline) <= URGENT_SECONDS;
  return h('div', { class: 'muted turn-timer' + (urgent ? ' urgent' : '') }, turnTimerText());
}

setInterval(() => {
  const tonk = document.querySelector('.tonk-timer');
  if (tonk) tonk.textContent = tonkCountdownText();
  const turn = document.querySelector('.turn-timer');
  if (turn && state.turnDeadline !== null) {
    turn.textContent = turnTimerText();
    turn.classList.toggle('urgent', secondsLeft(state.turnDeadline) <= URGENT_SECONDS);
  }
  const retry = document.querySelector('.retry-timer');
  if (retry) retry.textContent = retryText();
}, 250);

function renderResult(round) {
  const r = round.result;
  const room = state.room;
  const nameFor = (id) => r.names?.[id] ?? nameOf(id);
  let headline;
  switch (r.type) {
    case 'tonk':
      headline = `${nameFor(r.winners[0])} has TONK and everyone pays double!`;
      break;
    case 'tonkDraw':
      headline = 'More than one player has TONK \u2013 the hand is a draw and no coins change hands.';
      break;
    case 'down':
      headline = r.success
        ? `${nameFor(r.actor)} went down with ${r.totals[r.actor]} and pockets the coins!`
        : `${nameFor(r.actor)} went down with ${r.totals[r.actor]} but was caught and pays double.`;
      break;
    case 'empty':
      headline = `${nameFor(r.actor)} emptied their hand and sweeps the pot!`;
      break;
    default:
      headline = 'Hand aborted: not enough players. Every coin stays where it was.';
  }
  const rows = round.order.map((id) =>
    h(
      'div',
      { class: 'hand-row', 'data-player': id },
      h('span', { class: 'who' }, `${nameFor(id)} (${r.totals[id]})`),
      r.hands[id].map((c) => cardEl(c, { size: 'mini' })),
      h(
        'span',
        { class: 'delta ' + (r.deltas[id] > 0 ? 'pos' : r.deltas[id] < 0 ? 'neg' : '') },
        `${r.deltas[id] > 0 ? '+' : ''}${r.deltas[id]} ${Math.abs(r.deltas[id]) === 1 ? 'coin' : 'coins'}`,
      ),
    ),
  );
  const brokeLines = (r.broke ?? []).map((b) => h('div', { class: 'broke-line' }, brokeText(nameFor(b.id), b.bot)));
  const canDeal = room.players.length >= room.minPlayers;
  return h(
    'div',
    { class: 'panel result' },
    h('strong', null, headline),
    h('div', { class: 'hands' }, rows),
    brokeLines,
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

// The Company's reaction to a player losing their last coin.
function brokeText(name, bot) {
  return bot
    ? `${name} lost every last coin and left the table.`
    : `${name} lost every last coin and is out of the game. They watch from the shadows as a guest now.`;
}

// Table rules: the host edits them in the waiting room, everyone else just sees them.
function settingsPanel(isHost) {
  const { settings, settingLimits } = state.room;
  const field = (key, hint) => {
    const { min, max, label } = settingLimits[key];
    if (!isHost) return h('div', null, `${label}: `, h('strong', null, String(settings[key])), h('span', { class: 'muted' }, ` ${hint}`));
    const input = h('input', {
      type: 'number',
      min,
      max,
      step: 1,
      value: settings[key],
      class: 'setting-input',
      'data-sync': true,
      onChange: (e) => send({ t: 'updateSettings', settings: { ...settings, [key]: Number(e.currentTarget.value) } }),
    });
    return h('label', { class: 'row' }, h('span', null, `${label} `), input, h('span', { class: 'muted' }, hint));
  };
  return h(
    'div',
    { class: 'panel' },
    h('h3', { style: 'margin-top:0' }, 'Table rules'),
    field('startingCoins', 'coins for each player at the start'),
    field('bet', 'coins per payoff unit (a plain win pays 1 bet, TONK or getting caught 2)'),
    h('div', { class: 'muted' }, 'Run out of coins and you are out of the game.'),
  );
}

function formatEvent(e) {
  const who = nameOf(e.pid, e.name);
  switch (e.type) {
    case 'broke':
      return e.bot ? `${who} lost every last coin and left the table.` : `${who} lost every last coin and is now a guest.`;
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
      return `${who} put down ${e.kind === 'set' ? 'a set' : 'a run'}: ${e.cards.map(cardLabel).join(' ')}.`;
    case 'layoff':
      return `${who} added ${cardLabel(e.card)} to a spread.`;
    case 'goDown':
      return `${who} went down with ${e.total}.`;
    case 'reshuffle':
      return 'Discard pile reshuffled into the draw pile.';
    case 'timeout':
      return `${who} took too long, a bot plays their turns now.`;
    case 'back':
      return `${who} is back at the table.`;
    default:
      return null;
  }
}
