import { state, toast } from './state.js';
import { chat, addChatMessage } from './chat.js';
import { render } from './views.js';

export function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}
export const sendAction = (action) => send({ t: 'action', action });

export function connect() {
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

function pruneSelection() {
  const hand = state.room?.round?.players[state.you]?.hand || [];
  for (const c of [...state.selected]) if (!hand.includes(c)) state.selected.delete(c);
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
      state.online = msg.online ?? 0;
      state.room = null;
      state.view = 'lobby';
      chat.messages = [];
      break;
    case 'room':
      state.you = msg.you;
      state.room = msg.room;
      state.tonkDeadline = Date.now() + (msg.room.tonkMsLeft ?? 0);
      state.view = 'room';
      chat.messages = msg.room.chat;
      pruneSelection();
      if (msg.room.round?.turn !== state.you || msg.room.round.phase !== 'draw') state.confirmDown = false;
      if (state.confirmKick && ![...msg.room.players, ...msg.room.spectators].some((p) => p.id === state.confirmKick))
        state.confirmKick = null;
      break;
    case 'chat':
      addChatMessage(msg.message); // no full re-render: keeps typing and drags undisturbed
      return;
    case 'kicked':
      state.confirmKick = null;
      toast('The host removed you from the table.', 6000);
      return; // the lobby list that follows takes you back to the lobby
    case 'closed':
      toast(msg.message, 7000);
      return;
    case 'broke':
      toast(msg.message, 9000);
      break;
    case 'notice':
      toast(msg.message, 9000);
      return;
    case 'error':
      toast(msg.message);
      return;
  }
  render();
}
