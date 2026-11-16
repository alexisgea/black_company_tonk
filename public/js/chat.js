// Chat: one persistent DOM node that the patcher keeps in place (or re-attaches), so incoming
// game updates never clear the text being typed or the scroll position.
import { h, persistent } from './dom.js';
import { state, playerName } from './state.js';
import { send } from './net.js';
import { nameTag } from './name-tag.js';
import { t, tNodes } from './i18n.js';

const MAX_CHAT_KEPT = 50;
export const chat = { messages: [], el: null, logEl: null, input: null };

function buildChat() {
  chat.logEl = h('div', { class: 'chat-log' });
  chat.input = h('input', { type: 'text', maxLength: 200, placeholder: t('chat.placeholder'), autocomplete: 'off' });
  const form = h(
    'form',
    {
      class: 'chat-form',
      onSubmit: (e) => {
        e.preventDefault();
        const text = chat.input.value.trim();
        if (!text) return;
        send({ t: 'chat', text });
        chat.input.value = '';
      },
    },
    chat.input,
    h('button', { type: 'submit' }, t('chat.send')),
  );
  chat.el = h('div', { class: 'panel chat' }, h('strong', null, t('chat.title')), chat.logEl, form);
  persistent.set('chat', chat.el);
}

// Messages the game speaks for a player (see Room.pushChat) are worded here, in the reader's language.
const chatText = (m) => (m.kind === 'tonk' ? t('chat.tonk') : m.text);

export function fillChatLog() {
  chat.logEl.replaceChildren(
    ...chat.messages.map((m) => {
      const who = nameTag(playerName(m), { bot: !!m.bot, host: state.room?.hostId === m.pid });
      return h(
        'div',
        { class: 'chat-msg' + (m.pid === state.you ? ' mine' : '') },
        h('strong', null, tNodes(m.spectator ? 'chat.guestSender' : 'chat.sender', { name: who })),
        ' ',
        chatText(m),
      );
    }),
  );
}

export const isChatAtBottom = () => chat.logEl.scrollTop + chat.logEl.clientHeight >= chat.logEl.scrollHeight - 24;

export function addChatMessage(message) {
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.id >= message.id) return;
  const atBottom = isChatAtBottom();
  chat.messages = [...chat.messages, message].slice(-MAX_CHAT_KEPT);
  fillChatLog();
  if (atBottom) chat.logEl.scrollTop = chat.logEl.scrollHeight;
}

buildChat();
