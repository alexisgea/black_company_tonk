import { h } from './dom.js';
import { state } from './state.js';
import { send } from './net.js';
import { t, botName } from './i18n.js';
import { avatar } from './avatar.js';
import { render } from './views.js';

// "stoic regular", or just "veteran" for a bot whose tag would only repeat its rank.
export function botLabel(botId) {
  const entry = state.bots.find((b) => b.id === botId);
  if (!entry) return '';
  const rank = t(`rank.${entry.rank}`);
  return entry.tag ? t('bot.label', { tag: t(`tag.${entry.tag}`), rank }) : rank;
}

const closeInfo = () => {
  if (state.botInfo === null) return;
  state.botInfo = null;
  render();
};

// The profile popup closes on a click anywhere else, or on Escape.
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.bot-info, .bot-pop')) closeInfo();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeInfo());

function profilePopup(botId) {
  return h(
    'div',
    { class: 'bot-pop', role: 'dialog', 'aria-label': botName(botId) },
    h('strong', null, botName(botId)),
    h('div', { class: 'bot-label muted' }, botLabel(botId)),
    h('p', null, t(`bot.${botId}.bio`)),
  );
}

// The "i" button that opens a bot's profile. `place` says where it is on the page (the same bot can be shown in several
// places), so only the one that was clicked opens its popup.
function infoButton(botId, place) {
  const name = botName(botId);
  const key = `${place}:${botId}`;
  return h(
    'button',
    {
      class: 'secondary bot-info',
      title: t('room.botInfo', { name }),
      'aria-label': t('room.botInfo', { name }),
      'aria-expanded': String(state.botInfo === key),
      onClick: () => {
        state.botInfo = state.botInfo === key ? null : key;
        render();
      },
    },
    'i',
  );
}

// The "i" next to a bot's name during a game (nothing for a human), with its popup right under it.
export function botInfo(p, place) {
  if (!p?.botId) return null;
  return h(
    'span',
    { class: 'info-wrap' },
    infoButton(p.botId, place),
    state.botInfo === `${place}:${p.botId}` ? profilePopup(p.botId) : null,
  );
}

function botCard(entry, full) {
  const { id } = entry;
  const seated = state.room.players.some((p) => p.botId === id);
  const name = botName(id);
  return h(
    'div',
    { class: 'bot-card' },
    h(
      'button',
      {
        class: 'secondary bot-pick',
        disabled: full || seated,
        title: t('room.addBotNamed', { name }),
        onClick: () => send({ t: 'addBot', botId: id }),
      },
      avatar(),
      h('span', { class: 'bot-name' }, name),
      h('span', { class: 'bot-label muted' }, botLabel(id)),
    ),
    infoButton(id, 'grid'),
    state.botInfo === `grid:${id}` ? profilePopup(id) : null,
  );
}

// Host only: every bot with its rank and tag, plus a random pick. Clicking one seats it at the table.
export function botGrid() {
  const room = state.room;
  const full = room.players.length >= room.maxPlayers;
  return h(
    'div',
    { class: 'panel' },
    h('h3', { style: 'margin-top:0' }, t('room.addBot')),
    h('p', { class: 'muted' }, t('room.botsHint')),
    h(
      'div',
      { class: 'bot-grid' },
      state.bots.map((entry) => botCard(entry, full)),
      h(
        'div',
        { class: 'bot-card' },
        h(
          'button',
          { class: 'secondary bot-pick', disabled: full, onClick: () => send({ t: 'addBot' }) },
          avatar({ mark: '?' }),
          h('span', { class: 'bot-name' }, t('room.randomBot')),
          h('span', { class: 'bot-label muted' }, t('room.randomBotHint')),
        ),
      ),
    ),
  );
}
