// Chat: one persistent DOM node that the patcher keeps in place (or re-attaches), so incoming
// game updates never clear the text being typed or the scroll position.
import { h, persistent } from './dom.js';
import { state, playerName, canAccuse } from './state.js';
import { send } from './net.js';
import { render } from './views.js';
import { nameTag } from './name-tag.js';
import { sidePanel } from './side-panels.js';
import { t, tList, tNodes } from './i18n.js';

const MAX_CHAT_KEPT = 50;
export const chat = { messages: [], el: null, logEl: null, input: null, emoteBox: null, emoteToggle: null, accuseEntry: null };
let emoteCooldownMs = 0;
let emoteTimer;

function buildChat() {
  chat.logEl = h('div', { class: 'chat-log' });
  chat.input = h('input', { type: 'text', maxLength: 200, placeholder: t('chat.placeholder'), autocomplete: 'off' });
  chat.emoteToggle = h(
    'button',
    {
      type: 'button',
      class: 'emote-toggle secondary',
      title: t('chat.emotesTitle'),
      'aria-expanded': 'false',
      onClick: () => {
        const open = chat.emoteBox.hidden;
        chat.emoteBox.hidden = !open;
        chat.emoteToggle.setAttribute('aria-expanded', String(open));
      },
    },
    t('chat.emotes'),
  );
  chat.emoteBox = h('div', { class: 'emote-box', hidden: true });
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
  chat.el = sidePanel('chat', t('chat.title'), chat.logEl, form);
  persistent.set('chat', chat.el);
  persistent.set('emotes', h('div', { class: 'emote-controls' }, chat.emoteToggle, chat.emoteBox));
}

// The quick words come from the server (see emotes.js), which also keeps them from being spammed: after one is said
// the buttons stay greyed out for `cooldownMs`, the same wait the server enforces.
export function setEmotes(ids, cooldownMs = 0) {
  emoteCooldownMs = cooldownMs;
  chat.accuseEntry = h(
    'button',
    {
      type: 'button',
      class: 'accuse-entry secondary',
      hidden: true,
      onClick: () => {
        state.accusing = true;
        state.confirmAccuse = null;
        chat.emoteBox.hidden = true;
        chat.emoteToggle.setAttribute('aria-expanded', 'false');
        render();
      },
    },
    t('accuse.entry'),
  );
  chat.emoteBox.replaceChildren(
    ...ids.map((id) =>
      h(
        'button',
        {
          type: 'button',
          class: 'emote',
          onClick: () => {
            if (chat.emoteBox.classList.contains('cooling')) return;
            send({ t: 'emote', id });
            chat.emoteBox.hidden = true;
            chat.emoteToggle.setAttribute('aria-expanded', 'false');
            coolDownEmotes();
          },
        },
        t(`emoteButton.${id}`),
      ),
    ),
    chat.accuseEntry,
  );
}

function coolDownEmotes() {
  chat.emoteBox.classList.add('cooling');
  for (const b of chat.emoteBox.querySelectorAll('.emote')) b.disabled = true;
  clearTimeout(emoteTimer);
  emoteTimer = setTimeout(() => {
    chat.emoteBox.classList.remove('cooling');
    for (const b of chat.emoteBox.querySelectorAll('.emote')) b.disabled = false;
  }, emoteCooldownMs);
}

// Messages the game speaks for a player (see Room.pushChat) are worded here, in the reader's language. A bot's
// banter is picked by its place in a list of lines, and the English text it came with covers a list that is missing.
export const chatText = (m) => {
  if (m.kind === 'tonk') return t('chat.tonk');
  if (m.kind === 'emote') return t(`emote.${m.emote}`, undefined, m.text);
  if (m.kind === 'banter') return tList(`banter.${m.tone}.${m.situation}`)[m.line] ?? m.text;
  return m.text;
};

export function fillChatLog() {
  if (chat.accuseEntry) chat.accuseEntry.hidden = !canAccuse();
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
