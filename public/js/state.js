import { botName, t } from './i18n.js';

const toastEl = document.getElementById('toast');

export const state = {
  ws: null,
  name: localStorage.getItem('tonk.name') || '',
  // Per tab (sessionStorage), so two tabs are two players instead of fighting over one seat.
  token: sessionStorage.getItem('tonk.token') || '',
  connected: false,
  replaced: false, // this seat was taken over by another tab: stop reconnecting
  view: 'name', // 'name' | 'lobby' | 'room'
  games: [],
  online: 0, // players connected to the server
  you: null,
  room: null,
  selected: new Set(),
  confirmDown: false, // "Go down" clicked, waiting for "I'm sure"
  confirmKick: null, // player id whose "Kick" button was clicked, waiting for confirmation
  tonkDeadline: 0, // local time when TONK! is pressed automatically
  restartDeadline: null, // local time when a table whose last human player went broke closes
  turnDeadline: null, // local time when a bot takes over the current human turn (null: no timer running)
  turnWarningMs: Infinity, // the turn countdown is only shown once this little time is left
  retryAt: 0, // local time of the next reconnect attempt (0: none scheduled)
  device: loadDeviceId(), // stable per browser, so the server can enforce bans
  invite: readInvite(), // { gameId, password? } from an invite link, followed once the player is in the lobby
  pendingJoin: null, // the table we just asked to enter, so a "password needed" answer knows what it was for
  passwordPrompt: null, // { gameId, mode, name, error } while asking for a table password
};

// Invite links look like /#table=ABCD or /#table=ABCD&pw=secret. The hash never reaches the server (or its logs),
// and it is removed from the address bar right away so the password does not linger there.
function readInvite() {
  const params = new URLSearchParams(location.hash.slice(1));
  const table = params.get('table');
  if (!table) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return { gameId: table.toUpperCase(), password: params.get('pw') || undefined };
}

function loadDeviceId() {
  let id = localStorage.getItem('tonk.device');
  if (!id) {
    if (crypto.randomUUID) id = crypto.randomUUID();
    else id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('tonk.device', id);
  }
  return id;
}

let toastTimer;
export function toast(message, ms = 3500) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

// A bot shows its character's name in the player's language; everyone else shows the name they chose.
export const playerName = (p) => (p.botId ? botName(p.botId, p.name) : p.name);

export const nameOf = (id, fallback) => {
  const who = state.room?.players.find((p) => p.id === id) || state.room?.spectators.find((s) => s.id === id);
  return (who && playerName(who)) || fallback || t('player.someone');
};

// Tables are named after their creator; the wording ("X's table") belongs to the language.
export const tableName = (table) => (table.owner ? t('table.name', { owner: table.owner }) : table.name);

export const isSpectator = () => !!state.room && !state.room.players.some((p) => p.id === state.you);
