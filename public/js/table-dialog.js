// Table settings popup: who is at the table (bot profiles, kick/remove) and, for the host, adding bots.
// Rebuilt with every render (it depends on the live table), so it is part of the page, unlike the rules popup.
import { h } from './dom.js';
import { state, playerName } from './state.js';
import { send } from './net.js';
import { t } from './i18n.js';
import { avatar } from './avatar.js';
import { nameTag } from './name-tag.js';
import { render, invitePanel } from './views.js';
import { botGrid, botInfo, botLabel } from './bot-picker.js';

const setOpen = (open) => {
  if (state.tableDialog === open) return;
  state.tableDialog = open;
  state.confirmKick = null;
  render();
};

document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));

export const openTableDialog = () => setOpen(true);
const dialogTitle = () => t(state.room.status === 'waiting' ? 'tableDialog.bots' : 'tableDialog.title');
export const tableDialogButton = () => h('button', { class: 'secondary', onClick: openTableDialog }, dialogTitle());

// Human kicks and post-hand bot removals ask first; waiting-room bot removals are immediate.
function kickControls(p) {
  if (state.room.hostId !== state.you || p.id === state.you) return null;
  if (p.isBot && state.room.status === 'playing') return null;
  const label = p.isBot ? t('room.remove') : t('room.kick');
  if (state.confirmKick !== p.id) {
    return h(
      'button',
      {
        class: 'secondary kick-btn',
        title: t('room.removeFromTable', { name: playerName(p) }),
        onClick: () => {
          if (p.isBot && state.room.status === 'waiting') {
            send({ t: 'removeBot', id: p.id });
            return;
          }
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
        class: 'kick-btn',
        onClick: () => {
          state.confirmKick = null;
          send({ t: p.isBot ? 'removeBot' : 'kick', id: p.id });
        },
      },
      t('common.confirm'),
    ),
    h(
      'button',
      {
        class: 'secondary kick-btn',
        onClick: () => {
          state.confirmKick = null;
          render();
        },
      },
      t('common.cancel'),
    ),
  ];
}

function playerRow(p) {
  const room = state.room;
  return h(
    'div',
    { class: 'tbl-player' },
    avatar({ small: true, botId: p.botId, portraitId: p.portraitId }),
    h(
      'span',
      {
        class: 'tbl-name',
        title: room.status === 'waiting' ? [playerName(p), p.isBot ? botLabel(p.botId) : ''].filter(Boolean).join(' - ') : null,
      },
      nameTag(playerName(p), { bot: p.isBot, host: p.id === room.hostId }),
      p.id === state.you ? ` ${t('player.you')}` : '',
      p.connected ? '' : ` (${t('player.offline')})`,
      p.isBot ? h('span', { class: 'muted bot-label' }, ` ${botLabel(p.botId)}`) : null,
    ),
    botInfo(p, 'table'),
    kickControls(p),
  );
}

export function tableDialog() {
  if (!state.tableDialog || !state.room) return null;
  const room = state.room;
  const isHost = room.hostId === state.you;
  return h(
    'div',
    { class: 'modal', onClick: (e) => e.target === e.currentTarget && setOpen(false) },
    h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': dialogTitle() },
      h(
        'div',
        { class: 'dialog-head' },
        h('h2', null, dialogTitle()),
        h('span', { class: 'spacer' }),
        h('button', { onClick: () => setOpen(false) }, t('common.close')),
      ),
      room.status !== 'waiting' ? h('div', { class: 'tbl-invite' }, invitePanel(isHost)) : null,
      h('h3', null, t('room.players')),
      h(
        'div',
        { class: room.status === 'waiting' ? 'tbl-seats' : null },
        room.players.map(playerRow),
        room.status === 'waiting'
          ? Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }, () =>
              h(
                'div',
                { class: 'tbl-player tbl-empty' },
                avatar({ small: true, empty: true }),
                h('span', { class: 'muted' }, t('room.emptySeat')),
              ),
            )
          : null,
      ),
      room.spectators.length ? h('h3', null, t('room.watching')) : null,
      room.spectators.map(playerRow),
      isHost
        ? h(
            'div',
            { class: 'tbl-bots' },
            botGrid(),
            room.status === 'playing' ? h('p', { class: 'muted' }, t('tableDialog.botsBetweenHands')) : null,
          )
        : null,
    ),
  );
}
