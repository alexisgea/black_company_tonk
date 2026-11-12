// Chat: one persistent DOM node that is re-attached on every render, so incoming
// game updates never clear the text being typed or the scroll position.
import { h } from './dom.js';
import { state } from './state.js';
import { send } from './net.js';

const MAX_CHAT_KEPT = 50;
export const chat = { messages: [], el: null, logEl: null, input: null };

function buildChat() {
  chat.logEl = h('div', { class: 'chat-log' });
  chat.input = h('input', { type: 'text', maxLength: 200, placeholder: 'Say something\u2026', autocomplete: 'off' });
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
    h('button', { type: 'submit' }, 'Send'),
  );
  chat.el = h('div', { class: 'panel chat' }, h('strong', null, 'Chat'), chat.logEl, form);
}

export function fillChatLog() {
  chat.logEl.replaceChildren(
    ...chat.messages.map((m) =>
      h('div', { class: 'chat-msg' + (m.pid === state.you ? ' mine' : '') }, h('strong', null, m.name + ': '), m.text),
    ),
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
