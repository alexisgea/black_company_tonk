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
  turnDeadline: null, // local time when a bot takes over the current human turn (null: no timer running)
  retryAt: 0, // local time of the next reconnect attempt (0: none scheduled)
  device: loadDeviceId(), // stable per browser, so the server can enforce bans
};

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

export const nameOf = (id, fallback) =>
  state.room?.players.find((p) => p.id === id)?.name || state.room?.spectators.find((s) => s.id === id)?.name || fallback || 'Someone';

export const isSpectator = () => !!state.room && !state.room.players.some((p) => p.id === state.you);
