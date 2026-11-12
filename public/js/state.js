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
  you: null,
  room: null,
  selected: new Set(),
  confirmDown: false, // "Go down" clicked, waiting for "I'm sure"
  confirmKick: null, // player id whose "Kick" button was clicked, waiting for confirmation
};

let toastTimer;
export function toast(message, ms = 3500) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

export const nameOf = (id, fallback) => state.room?.players.find((p) => p.id === id)?.name || fallback || 'Someone';
