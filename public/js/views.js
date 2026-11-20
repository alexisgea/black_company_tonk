import { h, patchChildren } from './dom.js';
import { state, toast, nameOf, isSpectator, playerName, tableName, canAccuse } from './state.js';
import { send, sendAction, sendHello, connect, enterTable } from './net.js';
import { classifyMeld, layoffEnd } from './rules.js';
import { cardEl, cardLabel } from './theme.js';
import { chat, fillChatLog, isChatAtBottom } from './chat.js';
import { sidePanel } from './side-panels.js';
import { bubbleEl, flavorEvents } from './callouts.js';
import { nameTag, roleMarks, wentDownMark } from './name-tag.js';
import { avatar } from './avatar.js';
import { coin } from './coin.js';
import { botLabel } from './bot-picker.js';
import { tableDialog, tableDialogButton, openTableDialog } from './table-dialog.js';
import { rulesButton } from './rules-dialog.js';
import { settingsButton } from './settings-dialog.js';
import { fullscreenButton } from './fullscreen.js';
import { changelogButton } from './changelog-dialog.js';
import { drag, handCardEl } from './hand.js';
import { anim, beginDeal, captureCards, captureMarks, currentMeta, isDealing, playAnimations } from './animation.js';
import { t, tNodes, botName } from './i18n.js';

const app = document.getElementById('app');
const chatSlot = () => h('div', { 'data-persist': 'chat' });
const emoteSlot = () => h('div', { 'data-persist': 'emotes' });
const secondsLeft = (deadline) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
const URGENT_SECONDS = 15;
// Rows of more than this many cards overlap slightly, like a real spread.
// Six is left loose so drawing a card doesn't make a row jump; spreads (7+) overlap.
const TIGHT_FROM = 6;
const FEEDBACK_EMAIL = 'alexis@geaxle.com';
const title = () => h('h1', null, t('app.title'));

const playerTag = (p) => nameTag(playerName(p), { bot: p.isBot, host: p.id === state.room.hostId });

// Someone who left at the end of a hand keeps the name they had in it: the result remembers it.
const leftName = (id, round) => {
  const r = round.result;
  if (r?.bots?.[id]) return botName(r.bots[id], r.names?.[id]);
  return r?.names?.[id] ?? nameOf(id);
};
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
  const prevMarks = captureMarks();
  anim.meta = null;
  const inRoom = !state.replaced && state.connected && state.view === 'room';
  const starting = inRoom && state.room.status !== 'waiting' && app.firstElementChild?.dataset.waitingRoom === state.room.id;
  beginDeal(prevMeta, inRoom);
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
      playAnimations(prevMeta, prevCards, prevMarks, render);
      if (hadFocus && document.activeElement !== chat.input) {
        chat.input.focus();
        chat.input.setSelectionRange(caret[0], caret[1]);
      }
    }
    void app.offsetHeight; // commit styles while transitions are still off
    if (starting) window.scrollTo(0, 0);
  } finally {
    app.classList.remove('no-transition');
  }
}

function screen() {
  if (state.replaced) {
    return h(
      'div',
      { class: 'screen' },
      h('h1', null, t('app.title')),
      h(
        'div',
        { class: 'panel' },
        h('p', null, t('connection.replaced')),
        h(
          'button',
          {
            onClick: () => {
              state.replaced = false;
              connect();
            },
          },
          t('connection.useThisTab'),
        ),
      ),
    );
  }
  if (!state.connected) {
    return h(
      'div',
      { class: 'screen' },
      h('p', null, t('connection.connecting')),
      state.retryAt ? h('p', { class: 'muted retry-timer' }, retryText()) : null,
    );
  }
  if (state.view === 'name') return renderName();
  if (state.view === 'lobby') return renderLobby();
  return renderRoom();
}

function credits() {
  return h(
    'div',
    { class: 'footer' },
    footerActions(),
    h('p', { class: 'credits muted' }, tNodes('credits.text', { email: h('a', { href: `mailto:${FEEDBACK_EMAIL}` }, FEEDBACK_EMAIL) })),
  );
}

// Reference and display controls stay out of the way of the game.
function footerActions() {
  const lobby = state.view === 'lobby' || state.room?.status === 'waiting';
  return h(
    'div',
    { class: `footer-actions ${lobby ? 'lobby-footer-actions' : 'row'}` },
    rulesButton(),
    lobby ? changelogButton() : null,
    settingsButton(),
    fullscreenButton(),
  );
}

function renderName() {
  const input = h('input', {
    id: 'name-input',
    type: 'text',
    maxLength: 20,
    placeholder: t('name.placeholder'),
    value: state.name,
    autofocus: true,
    onKeydown: (e) => e.key === 'Enter' && go(e.currentTarget),
  });
  // `field` is the live input: the patcher may keep an older element instead of the one built here.
  const go = (field) => {
    const name = field.value.trim();
    if (!name) return toast(t('name.required'));
    state.name = name;
    sendHello(name);
  };
  return h(
    'div',
    { class: 'screen' },
    title(),
    h('div', { class: 'panel row' }, input, h('button', { onClick: () => go(document.getElementById('name-input')) }, t('name.play'))),
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
            h('strong', { class: 'game-name' }, g.locked ? `\u{1F512} ${tableName(g)}` : tableName(g)),
            h(
              'span',
              { class: 'muted' },
              `${g.players.map((name, i) => (g.bots?.[i] ? botName(g.bots[i], name) : name)).join(', ')} (${g.players.length}/${g.max})`,
            ),
            g.spectators ? h('span', { class: 'muted' }, `\u2022 ${t('lobby.watching', { count: g.spectators })}`) : null,
            h('span', { class: 'muted' }, '\u2022 ', coin(), t('lobby.stakes', { coins: g.startingCoins, bet: g.bet })),
            h(
              'div',
              { class: 'row game-actions' },
              h('span', { class: 'muted' }, g.status === 'playing' ? t('lobby.inProgress') : t('lobby.open')),
              h('button', { disabled: !g.joinable, onClick: () => enterTable(g, 'join') }, t('common.join')),
              h('button', { class: 'secondary', disabled: !g.watchable, onClick: () => enterTable(g, 'watch') }, t('common.watch')),
            ),
          ),
        ),
      )
    : h('p', { class: 'muted' }, t('lobby.noTables'));
  return h(
    'div',
    { class: 'screen' },
    title(),
    h(
      'div',
      { class: 'panel row' },
      h('span', null, tNodes('lobby.playingAs', { name: h('strong', null, state.name) })),
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
        t('lobby.changeName'),
      ),
      h('button', { onClick: () => send({ t: 'createGame' }) }, t('lobby.createTable')),
    ),
    passwordPrompt(),
    h(
      'div',
      { class: 'panel' },
      h('h3', { style: 'margin-top:0' }, t('lobby.openTables')),
      h('p', { class: 'muted' }, t('lobby.online', { count: state.online })),
      list,
    ),
    credits(),
  );
}

function leaveControls() {
  if (!state.confirmLeave)
    return h(
      'button',
      {
        class: 'secondary',
        onClick: () => {
          state.confirmLeave = true;
          render();
        },
      },
      t('room.leave'),
    );
  return h(
    'div',
    { class: 'row leave-confirm' },
    h('span', null, t('room.confirmLeave')),
    h(
      'button',
      {
        onClick: () => {
          state.confirmLeave = false;
          send({ t: 'leaveGame' });
        },
      },
      t('common.confirm'),
    ),
    h(
      'button',
      {
        class: 'secondary',
        onClick: () => {
          state.confirmLeave = false;
          render();
        },
      },
      t('common.cancel'),
    ),
  );
}

function renderRoom() {
  const room = state.room;
  const leave = leaveControls();
  if (room.status === 'waiting') {
    const isHost = room.hostId === state.you;
    const spectating = isSpectator();
    const canStart = isHost && room.players.length >= room.minPlayers;
    return h(
      'div',
      { class: 'screen', 'data-waiting-room': room.id },
      h('h1', { class: 'table-name' }, tableName(room)),
      h(
        'div',
        { class: 'waiting-controls' },
        leave,
        spectating ? freeSeatButton() : h('button', { disabled: !canStart, onClick: () => send({ t: 'startGame' }) }, t('room.startGame')),
        canStart ? null : h('span', { class: 'muted waiting-status' }, t(isHost ? 'room.needMorePlayers' : 'room.waitingForHost')),
      ),
      isHost ? renameTableForm(room) : null,
      h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'row seats-head' },
          h('h3', { style: 'margin:0' }, t('room.players')),
          h('span', { class: 'spacer' }),
          tableDialogButton(),
        ),
        h(
          'div',
          { class: 'seats' },
          Array.from({ length: room.maxPlayers }, (_, i) => (room.players[i] ? seat(room.players[i]) : emptySeat())),
        ),
      ),
      spectatorsPanel(),
      settingsPanel(isHost),
      h('div', { class: 'panel' }, invitePanel(isHost)),
      awayNotice(),
      chatSlot(),
      footerActions(),
      tableDialog(),
    );
  }
  return h('div', { class: 'table-layout' }, renderTable(), renderSide(leave), tableDialog());
}

function renameTableForm(room) {
  return h(
    'form',
    {
      class: 'row table-rename',
      onSubmit: (e) => {
        e.preventDefault();
        const field = e.currentTarget.elements.namedItem('tableName');
        const name = field.value.trim();
        if (!name) return toast(t('err.tableNameRequired'));
        field.blur();
        if (name !== tableName(room)) send({ t: 'renameTable', name });
      },
    },
    h('input', {
      type: 'text',
      name: 'tableName',
      'aria-label': t('room.tableName'),
      maxLength: room.maxNameLength,
      required: true,
      value: tableName(room),
      'data-sync': true,
    }),
    h('button', { type: 'submit', class: 'secondary' }, t('room.renameTable')),
  );
}

// A seat at the table in the waiting room.
function seat(p) {
  return h(
    'div',
    { class: 'seat' },
    avatar(),
    h(
      'span',
      { class: 'seat-text' },
      h(
        'span',
        { class: 'seat-name' },
        playerTag(p),
        p.id === state.you ? ` ${t('player.you')}` : '',
        p.connected ? '' : ` \u2013 ${t('player.disconnected')}`,
        p.away ? ` \u2013 ${t('player.botPlaying')}` : '',
      ),
      p.isBot ? h('span', { class: 'seat-sub muted' }, botLabel(p.botId)) : null,
    ),
    takeOverButton(p),
  );
}

function emptySeat() {
  const canAdd = state.room.hostId === state.you;
  return h(
    canAdd ? 'button' : 'div',
    { class: 'seat empty', onClick: canAdd ? openTableDialog : null },
    avatar({ empty: true }),
    h('span', { class: 'seat-text' }, t('room.emptySeat')),
  );
}

// Shown to a player whose seat is being played by a bot because they took too long.
function awayNotice() {
  if (!state.room.players.some((p) => p.id === state.you && p.away)) return null;
  return h(
    'div',
    { class: 'away-notice' },
    h('span', null, t('room.awayNotice')),
    h('button', { onClick: () => send({ t: 'resume' }) }, t('room.takeBackControl')),
  );
}

// Only the host (table creator) can pause, and only while a hand is being played.
function pauseButton() {
  const room = state.room;
  if (room.hostId !== state.you || room.status !== 'playing') return null;
  return h(
    'button',
    { class: 'secondary pause-btn', onClick: () => send({ t: room.paused ? 'unpause' : 'pause' }) },
    room.paused ? t('room.resumeGame') : t('room.pauseGame'),
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
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          { class: 'table-head' },
          h('strong', { class: 'table-name' }, tableName(room)),
          h('div', { class: 'muted' }, t('room.handNumber', { number: room.handNo }), room.paused ? ` \u2013 ${t('room.paused')}` : ''),
        ),
        h('span', { class: 'spacer' }),
        tableDialogButton(),
      ),
      h('div', { class: 'row side-actions' }, leaveBtn, pauseButton()),
    ),
    h(
      'div',
      { class: 'panel scores' },
      h(
        'div',
        { class: 'row' },
        coin(),
        h('strong', null, t('room.coins')),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted' }, t('room.bet', { bet: room.settings.bet }), coin()),
      ),
      room.players.map((p) =>
        h(
          'div',
          { class: 'score-row' },
          avatar({ small: true }),
          h(
            'span',
            { class: 'score-name' },
            playerTag(p),
            (p.connected ? '' : ` (${t('player.offline')})`) + (p.away ? ` (${t('player.botPlaying')})` : ''),
          ),
          h('span', { class: 'score-actions' }, takeOverButton(p)),
          h('span', { class: 'score-value' }, String(p.coins), coin()),
        ),
      ),
    ),
    spectatorsPanel(),
    chatSlot(),
    sidePanel('log', t('room.log'), logEl),
    footerActions(),
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
  const paused = !!room.paused && !over;
  const dealing = isDealing();
  const selected = [...state.selected];

  const canDrawPhase = myTurn && !paused && !dealing && round.phase === 'draw';
  const canPlayPhase = myTurn && !paused && !dealing && round.phase === 'play';

  // Opponents in seating order, starting from the seat after mine.
  const seats = round.order;
  const myIdx = seats.indexOf(state.you);
  const opponents = (myIdx === -1 ? seats : [...seats.slice(myIdx + 1), ...seats.slice(0, myIdx)]).filter((id) => id !== state.you);
  const accusing = state.accusing && canAccuse() && !dealing;
  // Accusing is a gamble (a wrong one costs double the bet), so it asks first. It starts from the hand's quick words
  // ("accuse someone of cheating"), then the player clicks the bot.
  function accuseControls(id, info) {
    if (!accusing || !info?.isBot || state.confirmAccuse !== id) return null;
    const name = playerName(info);
    const price = Math.min(room.settings.bet * 2, room.players.find((x) => x.id === state.you)?.coins ?? 0);
    return h(
      'div',
      { class: 'accuse-row' },
      h(
        'p',
        { class: 'muted accuse-text' },
        t('accuse.confirm', { name, price: t('result.coins', { count: price, amount: String(price) }) }),
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'kick-btn',
            onClick: () => {
              state.confirmAccuse = null;
              state.accusing = false;
              send({ t: 'accuse', target: id });
            },
          },
          t('common.confirm'),
        ),
        h(
          'button',
          {
            class: 'secondary kick-btn',
            onClick: () => {
              state.confirmAccuse = null;
              render();
            },
          },
          t('common.cancel'),
        ),
      ),
    );
  }

  const oppEls = opponents.map((id) => {
    const p = round.players[id];
    const info = room.players.find((x) => x.id === id);
    const cards = h('div', { class: 'cards' + (p.count > TIGHT_FROM ? ' tight' : '') });
    if (p.hand) p.hand.forEach((c) => cards.append(cardEl(c, { size: 'mini' })));
    else for (let i = 0; i < p.count; i++) cards.append(cardEl(null, { back: true, size: 'small' }));
    return h(
      'div',
      {
        class:
          'opp' +
          (round.turn === id && !tonkPhase ? ' turn' : '') +
          (info && !info.connected ? ' offline' : '') +
          (info?.away ? ' away' : '') +
          (accusing && info?.isBot && state.confirmAccuse !== id ? ' accusable' : ''),
        'data-player': id,
        onClick:
          accusing && info?.isBot && state.confirmAccuse !== id
            ? () => {
                state.confirmAccuse = id;
                render();
              }
            : null,
      },
      h(
        'div',
        { class: 'opp-head' },
        avatar({ small: true }),
        h(
          'div',
          { class: 'opp-id' },
          h('strong', null, info ? playerTag(info) : leftName(id, round), info?.away ? ` (${t('player.botPlaying')})` : ''),
          roleMarks(id, round, { reserve: true }),
        ),
      ),
      accuseControls(id, info),
      cards,
      meldsOf(id),
      bubbleEl(id),
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
          h('div', { class: 'label' }, m.type === 'set' ? t('table.set') : t('table.run')),
          h(
            'div',
            { class: 'cards' + (m.cards.length > TIGHT_FROM ? ' tight' : '') },
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
    h('div', null, t('table.draw', { count: round.deckCount })),
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
    h('div', null, canPlayPhase ? t('table.discardHere') : t('table.discard')),
  );

  let status = '';
  if (paused) status = t('status.paused');
  else if (dealing && round.dealer) status = t('status.dealing', { name: nameOf(round.dealer) });
  else if (!over) {
    if (!inHand) status = isSpectator() ? t('status.watchingHand') : t('status.spectatingHand');
    else if (tonkPhase) status = round.mustDeclareTonk ? t('status.mustTonk') : t('status.waitingForTonk');
    else if (myTurn) status = round.phase === 'draw' ? t('status.yourTurnDraw') : t('status.yourTurnPlay');
    else status = t('status.waitingFor', { name: nameOf(round.turn) });
  }

  const handEls = (inHand ? me.hand : []).map((c) => handCardEl(c, true));

  const validMeld = selected.length >= 3 && classifyMeld(selected);
  const tonkControls = h(
    'div',
    { class: 'row' },
    round.mustDeclareTonk
      ? [
          h('button', { class: 'tonk-btn', disabled: paused || dealing, onClick: () => send({ t: 'declareTonk' }) }, t('action.tonk')),
          h('span', { class: 'muted tonk-timer' }, tonkCountdownText()),
        ]
      : null,
  );
  // Custom CSS tooltip (data-tip) on a wrapper: native title tooltips are slow, flaky on disabled buttons and absent on touch.
  const tipped = (tip, button) => h('span', { class: 'tip-wrap', 'data-tip': tip, tabindex: tip ? 0 : null }, button);
  const waitingTip = myTurn ? t('tip.drawFirst') : t('tip.notYourTurn');
  const sub = (label, hint) => [label, h('small', { class: 'btn-sub' }, hint)];
  const confirming = state.confirmDown && canDrawPhase;
  const controls = h(
    'div',
    { class: 'row controls' },
    confirming
      ? [
          h(
            'button',
            {
              onClick: () => {
                state.confirmDown = false;
                sendAction({ type: 'goDown' });
              },
            },
            t('action.sure'),
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
            t('common.cancel'),
          ),
        ]
      : [
          tipped(
            canDrawPhase ? null : t('tip.goDownTiming'),
            h(
              'button',
              {
                class: 'greyed',
                disabled: !canDrawPhase,
                onClick: () => {
                  state.confirmDown = true;
                  render();
                },
              },
              t('action.goDown'),
            ),
          ),
          tipped(
            canPlayPhase ? null : waitingTip,
            h(
              'button',
              { class: 'greyed', disabled: !(canPlayPhase && validMeld), onClick: () => sendAction({ type: 'meld', cards: selected }) },
              sub(t('action.spread'), t('action.selection')),
            ),
          ),
          tipped(
            canPlayPhase ? null : waitingTip,
            h(
              'button',
              {
                class: 'greyed',
                disabled: !(canPlayPhase && selected.length === 1),
                onClick: () => sendAction({ type: 'discard', card: selected[0] }),
              },
              sub(t('action.discard'), t('action.selection')),
            ),
          ),
        ],
  );

  return h(
    'div',
    { class: 'table', 'data-deal': dealing ? anim.deal.phase : null },
    h('div', { class: 'opponents' }, oppEls),
    flavorBanner(),
    h(
      'div',
      { class: 'center' },
      h('div', { class: 'center-stack' }, h('div', { class: 'piles' }, deck, discard), over ? renderResult(round) : null),
    ),
    over ? renderSummary(round) : null,
    inHand
      ? h(
          'div',
          { class: 'me-panel' + (myTurn ? ' turn' : '') },
          roleMarks(state.you, round),
          h('div', { class: 'status' }, status),
          accusing && !state.confirmAccuse
            ? h(
                'div',
                { class: 'row accuse-banner' },
                h('span', null, t('accuse.prompt')),
                h(
                  'button',
                  {
                    class: 'secondary kick-btn',
                    onClick: () => {
                      state.accusing = false;
                      render();
                    },
                  },
                  t('common.cancel'),
                ),
              )
            : null,
          turnTimerLine(myTurn),
          awayNotice(),
          meldsOf(state.you),
          h('div', { class: 'hand-value' }, t('status.handValue', { total: me.total })),
          h('div', { class: 'hand' }, handEls),
          over ? null : tonkPhase ? tonkControls : controls,
          emoteSlot(),
          bubbleEl(state.you),
        )
      : h(
          'div',
          { class: 'me-panel' },
          h('div', { class: 'status' }, isSpectator() ? status || t('status.watchingTable') : status || t('status.joinNextHand')),
          isSpectator() && !over ? h('div', { class: 'row' }, freeSeatButton()) : null,
          emoteSlot(),
          bubbleEl(state.you),
        ),
  );
}

// The lore lines the log gets (a bot walking in or out, a player going broke), announced on the table where nobody can miss them.
function flavorBanner() {
  const lines = flavorEvents().map(formatEvent).filter(Boolean);
  if (!lines.length) return null;
  return h(
    'div',
    { class: 'flavor-banner', 'data-flavor': 'banner', role: 'status' },
    lines.map((line) => h('div', null, line)),
  );
}

// Guests who watch and chat but never see hidden cards. Shown only when there are some.
function spectatorsPanel() {
  const room = state.room;
  if (!room.spectators.length) return null;
  return h(
    'div',
    { class: 'panel scores' },
    h('strong', null, t('room.watching')),
    room.spectators.map((s) =>
      h(
        'div',
        { class: 'score-row' },
        h(
          'span',
          { class: 'score-name' },
          s.name + (s.id === state.you ? ` ${t('player.you')}` : '') + (s.connected ? '' : ` (${t('player.offline')})`),
        ),
      ),
    ),
  );
}

function tonkCountdownText() {
  return state.room?.paused ? t('action.tonkPaused') : t('action.tonkCountdown', { seconds: secondsLeft(state.tonkDeadline) });
}

const turnTimerText = () => t('table.botTakesOver', { seconds: secondsLeft(state.turnDeadline) });
const restartText = () => t('result.tableClosesIn', { seconds: secondsLeft(state.restartDeadline) });
const retryText = () => t('connection.retrying', { seconds: secondsLeft(state.retryAt) });

// The countdown stays hidden until the last part of the turn; the 250 ms ticker below reveals it.
const turnTimerShown = () => state.turnDeadline - Date.now() <= state.turnWarningMs;

// Only on my own turn: after this long without a move a bot plays for me.
function turnTimerLine(myTurn) {
  if (!myTurn || state.turnDeadline === null || state.room.paused) return null;
  const urgent = secondsLeft(state.turnDeadline) <= URGENT_SECONDS;
  return h('div', { class: 'muted turn-timer' + (urgent ? ' urgent' : ''), hidden: !turnTimerShown() }, turnTimerText());
}

setInterval(() => {
  const tonk = document.querySelector('.tonk-timer');
  if (tonk) tonk.textContent = tonkCountdownText();
  const turn = document.querySelector('.turn-timer');
  if (turn && state.turnDeadline !== null) {
    turn.textContent = turnTimerText();
    turn.hidden = !turnTimerShown();
    turn.classList.toggle('urgent', secondsLeft(state.turnDeadline) <= URGENT_SECONDS);
  }
  const restart = document.querySelector('.restart-timer');
  if (restart && state.restartDeadline !== null) restart.textContent = restartText();
  const retry = document.querySelector('.retry-timer');
  if (retry) retry.textContent = retryText();
}, 250);

// Keep all the final hands together, including players who have since left or gone broke.
function renderSummary(round) {
  const r = round.result;
  return h(
    'div',
    { class: 'panel hand-summary' },
    h('h3', null, t('result.summary')),
    round.order.map((id) =>
      h(
        'div',
        { class: 'hand-row', 'data-player': id },
        h('span', { class: 'who' }, nameTag(leftName(id, round), { bot: !!r.bots?.[id] }), wentDownMark(id, round)),
        h(
          'div',
          { class: 'cards' },
          r.hands[id].map((c) => cardEl(c, { size: 'mini' })),
        ),
        resultLine(round, id),
      ),
    ),
  );
}

// Hand total and coins won or lost in the summary.
function resultLine(round, id) {
  const r = round.result;
  const delta = r.deltas[id] ?? 0;
  return h(
    'div',
    { class: 'result-line', 'data-result': id },
    h('span', { class: 'result-total' }, r.totals[id] === undefined ? null : t('status.handValue', { total: r.totals[id] })),
    h(
      'span',
      { class: 'delta ' + (delta > 0 ? 'pos' : delta < 0 ? 'neg' : '') },
      coin(),
      t('result.coins', { count: Math.abs(delta), amount: `${delta > 0 ? '+' : ''}${delta}` }),
    ),
  );
}

// The outcome of the hand and the way on to the next one, shown under the piles.
function renderResult(round) {
  const r = round.result;
  const room = state.room;
  const nameFor = (id) => leftName(id, round);
  let headline;
  switch (r.type) {
    case 'tonk':
      headline = t('result.tonk', { name: nameFor(r.winners[0]) });
      break;
    case 'tonkDraw':
      headline = t('result.tonkDraw');
      break;
    case 'down':
      headline = t(r.success ? 'result.downWon' : 'result.downCaught', { name: nameFor(r.actor), total: r.totals[r.actor] });
      break;
    case 'empty':
      headline = t('result.empty', { name: nameFor(r.actor) });
      break;
    case 'caught':
      headline = t('result.caught', { accuser: nameFor(r.actor), name: nameFor(r.cheater) });
      break;
    default:
      headline = t('result.aborted');
  }
  const cheats = (r.cheats ?? []).map((c) =>
    h('div', null, t(`result.cheat.${c.kind}`, { name: nameFor(c.pid), card: c.card === undefined ? '' : cardLabel(c.card) })),
  );
  const canDeal = room.players.length >= room.minPlayers;
  return h(
    'div',
    { class: 'result' },
    h('strong', null, headline),
    cheats.length
      ? h('div', { class: 'result-cheats muted' }, r.type === 'caught' ? null : h('div', null, t('result.cheatsRevealed')), cheats)
      : null,
    state.restartDeadline !== null
      ? h(
          'div',
          { class: 'row' },
          room.canRestart ? h('button', { onClick: () => send({ t: 'restartTable' }) }, t('result.restartTable')) : null,
          h('span', { class: 'muted restart-timer' }, restartText()),
        )
      : isSpectator()
        ? h('div', { class: 'row' }, freeSeatButton())
        : h(
            'div',
            { class: 'row' },
            h(
              'button',
              { disabled: !canDeal, onClick: () => send({ t: 'startGame' }) },
              canDeal ? t('result.dealNext') : t('result.waitingForPlayers'),
            ),
          ),
  );
}

// Guests can sit in a bot's seat (it keeps the bot's cards and coins) or, between hands, in a free one.
function takeOverButton(p) {
  if (!p.isBot || !isSpectator()) return null;
  return h(
    'button',
    { class: 'small-btn', title: t('room.takeOverTitle', { name: playerName(p) }), onClick: () => send({ t: 'takeSeat', id: p.id }) },
    t('room.takeOver'),
  );
}

function freeSeatButton() {
  const room = state.room;
  if (!isSpectator() || room.status === 'playing' || room.players.length >= room.maxPlayers) return null;
  return h('button', { onClick: () => send({ t: 'takeSeat' }) }, t('room.joinGame'));
}

// Asks for the password of the locked table the player just tried to enter.
function passwordPrompt() {
  const prompt = state.passwordPrompt;
  if (!prompt) return null;
  const submit = (field) => {
    const password = field.value;
    if (!password) return toast(t('password.required'));
    enterTable({ id: prompt.gameId, name: prompt.name }, prompt.mode, password);
  };
  const input = h('input', {
    id: 'table-password',
    type: 'password',
    maxLength: 32,
    placeholder: t('password.placeholder'),
    autofocus: true,
    onKeydown: (e) => e.key === 'Enter' && submit(e.currentTarget),
  });
  return h(
    'div',
    { class: 'panel' },
    h(
      'p',
      { style: 'margin-top:0' },
      `\u{1F512} ${t('password.locked', { name: prompt.name })}`,
      prompt.error ? h('span', { class: 'muted' }, ` ${prompt.error}`) : null,
    ),
    h(
      'div',
      { class: 'row' },
      input,
      h(
        'button',
        { onClick: () => submit(document.getElementById('table-password')) },
        prompt.mode === 'join' ? t('common.join') : t('common.watch'),
      ),
      h(
        'button',
        {
          class: 'secondary',
          onClick: () => {
            state.passwordPrompt = null;
            render();
          },
        },
        t('common.cancel'),
      ),
    ),
  );
}

// Invite friends with a link; the host can also lock the table by setting a password (applied on Enter or when the
// field loses focus; clearing it unlocks). The password rides in the link's
// hash (never sent to the server) so invited friends get straight in.
export function invitePanel(isHost) {
  const room = state.room;
  const link = `${location.origin}/#table=${room.id}${room.password ? `&pw=${encodeURIComponent(room.password)}` : ''}`;
  const copy = async (field) => {
    field.select();
    try {
      await navigator.clipboard.writeText(field.value);
      toast(t('invite.copied'));
    } catch {
      toast(t('invite.copyFailed'));
    }
  };
  const linkInput = h('input', {
    id: 'invite-link',
    type: 'text',
    readOnly: true,
    value: link,
    class: 'invite-link',
    'data-sync': true,
    onFocus: (e) => e.currentTarget.select(),
  });
  const lock = () => {
    const field = document.getElementById('table-lock');
    send({ t: 'setPassword', password: field.value });
  };
  return h(
    'div',
    null,
    h('h3', { style: 'margin-top:0' }, t('invite.title')),
    h(
      'div',
      { class: 'row' },
      linkInput,
      h('button', { class: 'secondary', onClick: () => copy(document.getElementById('invite-link')) }, t('invite.copyLink')),
    ),
    isHost
      ? h(
          'div',
          { class: 'row', style: 'margin-top:10px' },
          h('input', {
            id: 'table-lock',
            type: 'text',
            maxLength: 32,
            placeholder: t('invite.lockPlaceholder'),
            value: room.password ?? '',
            'data-sync': true,
            class: 'invite-link',
            onChange: lock,
          }),
          room.locked
            ? h(
                'button',
                {
                  class: 'secondary',
                  onClick: () => {
                    document.getElementById('table-lock').value = '';
                    lock();
                  },
                },
                t('invite.unlock'),
              )
            : null,
        )
      : room.locked
        ? h('div', { class: 'muted', style: 'margin-top:6px' }, t('invite.lockedNote'))
        : null,
  );
}

// Table rules: the host edits them in the waiting room, everyone else just sees them.
function settingsPanel(isHost) {
  const { settings, settingLimits } = state.room;
  // One rule: its control (an input for the host, the value for everyone else) with its explanation underneath.
  const rule = (key, control) =>
    h('div', { class: 'setting' }, control, h('p', { class: 'setting-hint muted' }, t(`tableRules.${key}.hint`)));
  const field = (key) => {
    const { min, max } = settingLimits[key];
    const label = t(`tableRules.${key}.label`);
    if (!isHost) return rule(key, h('div', null, coin(), `${label}: `, h('strong', null, String(settings[key]))));
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
    return rule(key, h('label', { class: 'row' }, h('span', null, coin(), label), input));
  };
  const toggle = (key) => {
    const label = t(`tableRules.${key}.label`);
    if (!isHost) return rule(key, h('div', null, `${label}: `, h('strong', null, t(settings[key] ? 'common.on' : 'common.off'))));
    const input = h('input', {
      type: 'checkbox',
      class: 'tick',
      checked: settings[key],
      onChange: (e) => send({ t: 'updateSettings', settings: { ...settings, [key]: e.currentTarget.checked } }),
    });
    return rule(key, h('label', { class: 'row tick-row' }, input, h('span', null, label)));
  };
  return h(
    'div',
    { class: 'panel' },
    h('h3', { style: 'margin-top:0' }, t('tableRules.title')),
    field('startingCoins'),
    field('bet'),
    toggle('dynamicTable'),
    toggle('cheating'),
    h('p', { class: 'setting-hint muted' }, t('tableRules.outOfCoins')),
  );
}

const accusedName = (e) => (e.targetBotId ? botName(e.targetBotId, e.targetName) : nameOf(e.target, e.targetName));

function formatEvent(e) {
  const who = e.botId && e.type !== 'takeover' ? botName(e.botId, e.name) : nameOf(e.pid, e.name);
  switch (e.type) {
    case 'broke':
      return t(e.bot ? 'log.brokeBot' : 'log.brokeHuman', { who });
    case 'join':
      return t('log.join', { who });
    case 'leave':
      return t('log.leave', { who });
    case 'dynLeave':
    case 'dynJoin':
      return t(`log.${e.type}.${e.variant}`, { who });
    case 'kick':
      return t('log.kick', { who });
    case 'takeover':
      return t('log.takeover', { who, bot: botName(e.botId, e.botName) });
    case 'deal':
      return t('log.deal', { number: e.hand, who });
    case 'draw':
      return t('log.draw', { who });
    case 'takeDiscard':
      return t('log.takeDiscard', { who });
    case 'discard':
      return t('log.discard', { who, card: cardLabel(e.card) });
    case 'meld':
      return t(e.kind === 'set' ? 'log.meldSet' : 'log.meldRun', { who, cards: e.cards.map(cardLabel).join(' ') });
    case 'layoff':
      return t('log.layoff', { who, card: cardLabel(e.card) });
    case 'goDown':
      return t('log.goDown', { who, total: e.total });
    case 'accuse':
      return t('log.accuse', { who, target: accusedName(e) });
    case 'accusePaid':
      return t('log.accusePaid', { who, target: accusedName(e), count: e.amount, amount: e.amount });
    case 'reshuffle':
      return t('log.reshuffle');
    case 'timeout':
      return t('log.timeout', { who });
    case 'back':
      return t('log.back', { who });
    case 'pause':
      return t('log.pause', { who });
    case 'unpause':
      return t('log.unpause', { who });
    case 'restart':
      return t('log.restart', { who });
    default:
      return null;
  }
}
