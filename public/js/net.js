import { state, toast, tableName } from './state.js';
import { chat, addChatMessage } from './chat.js';
import { render } from './views.js';
import { t, serverText } from './i18n.js';

// Answers that mean "this table needs its password": the client asks for it instead of just reporting the error.
const PASSWORD_CODES = new Set(['tableLocked', 'wrongPassword']);

export function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}
export const sendAction = (action) => send({ t: 'action', action });
export const sendHello = (name) => send({ t: 'hello', name, token: state.token, device: state.device });

// Asks to sit down (mode 'join') or watch at a table. A locked table first asks for its password.
export function enterTable(game, mode, password) {
  if (game.locked && password === undefined) {
    state.passwordPrompt = { gameId: game.id, mode, name: tableName(game), error: null };
    render();
    return;
  }
  state.pendingJoin = { gameId: game.id, mode, name: tableName(game) };
  send({ t: mode === 'join' ? 'joinGame' : 'watchGame', gameId: game.id, password });
}

// Comes in through an invite link: sit down if there is a seat, otherwise watch (and take a bot's seat from there).
function followInvite() {
  const { gameId, password } = state.invite;
  state.invite = null;
  const game = state.games.find((g) => g.id === gameId);
  if (!game) toast(t('toast.tableGone'));
  else if (game.joinable) enterTable(game, 'join', password);
  else if (game.watchable) enterTable(game, 'watch', password);
  else toast(t('toast.tableFull'));
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
const RETRY_JITTER = 0.25;
const STABLE_MS = 5000; // a connection must stay open this long before the backoff starts over

let attempt = 0;
let retryTimer = null;
let stableTimer = null;

// 1s, 2s, 4s, 8s, 16s, then 30s, each randomised by +-25%.
function retryDelay(n) {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** n);
  return Math.min(RETRY_MAX_MS, Math.round(base * (1 - RETRY_JITTER + Math.random() * 2 * RETRY_JITTER)));
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  const delay = retryDelay(attempt++);
  state.retryAt = Date.now() + delay;
  retryTimer = setTimeout(connect, delay);
}

function stopRetrying() {
  clearTimeout(retryTimer);
  retryTimer = null;
  state.retryAt = 0;
}

export function connect() {
  stopRetrying();
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) state.ws.close(); // its close event is ignored below
  state.connected = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;
  render();
  ws.addEventListener('open', () => {
    if (ws !== state.ws) return;
    state.connected = true;
    clearTimeout(stableTimer);
    stableTimer = setTimeout(() => (attempt = 0), STABLE_MS);
    if (state.name) sendHello(state.name);
    render();
  });
  ws.addEventListener('message', (e) => ws === state.ws && onMessage(JSON.parse(e.data)));
  ws.addEventListener('close', () => {
    if (ws !== state.ws) return;
    clearTimeout(stableTimer);
    state.connected = false;
    if (!state.replaced) scheduleReconnect();
    render();
  });
}

// The network is back or the tab was just shown again: no point waiting out the backoff. Mobile browsers often
// kill the socket of a backgrounded tab without telling the page, so check the socket itself, not just our flag.
function retryNow() {
  if (state.replaced) return;
  if (state.connected && state.ws?.readyState === WebSocket.OPEN) return;
  attempt = 0;
  connect();
}
window.addEventListener('online', retryNow);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && retryNow());

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
      state.bots = msg.bots ?? [];
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
      if (state.invite) followInvite();
      break;
    case 'room':
      state.pendingJoin = null;
      state.passwordPrompt = null;
      state.invite = null;
      state.you = msg.you;
      state.room = msg.room;
      state.tonkDeadline = Date.now() + (msg.room.tonkMsLeft ?? 0);
      state.restartDeadline = msg.room.restartMsLeft == null ? null : Date.now() + msg.room.restartMsLeft;
      state.turnDeadline = msg.room.turnMsLeft == null ? null : Date.now() + msg.room.turnMsLeft;
      state.turnWarningMs = msg.room.turnWarningMs ?? Infinity;
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
      toast(t('toast.kicked'), 6000);
      return; // the lobby list that follows takes you back to the lobby
    case 'closed':
      toast(serverText('notice', msg), 7000);
      return;
    case 'broke':
      toast(serverText('notice', msg), 9000);
      break;
    case 'notice':
      toast(serverText('notice', msg), 9000);
      return;
    case 'error':
      if (PASSWORD_CODES.has(msg.code) && state.pendingJoin) {
        state.passwordPrompt = { ...state.pendingJoin, error: serverText('err', msg) };
        break;
      }
      toast(serverText('err', msg));
      return;
  }
  render();
}
