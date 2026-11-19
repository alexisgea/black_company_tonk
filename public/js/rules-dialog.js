// Rules popup: built once, lives outside #app so game updates never reset it.
// The text is in the locale files (keys "rules.*"): each section has a title and a list of paragraphs.
import { h } from './dom.js';
import { t, tList } from './i18n.js';

const rulesEl = document.getElementById('rules');

const SECTIONS = ['goal', 'values', 'deal', 'turn', 'spreads', 'emptyHand', 'cheating', 'words', 'other'];

function buildRules() {
  const section = (name) => [
    h('h3', null, t(`rules.${name}.title`)),
    h(
      'ul',
      null,
      tList(`rules.${name}.items`).map((item) => h('li', null, item)),
    ),
  ];
  const link = (href, label) => h('li', null, h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label));
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('rules.button') },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', null, t('rules.title')),
      h('span', { class: 'spacer' }),
      h('button', { onClick: closeRules }, t('common.close')),
    ),
    SECTIONS.map(section),
    h('h3', null, t('rules.credits.title')),
    h(
      'ul',
      null,
      link('https://www.bsfs.org/bsfstonk.htm', t('rules.credits.bsfs')),
      link('http://www.gamecabinet.com/rules/Tonk.html', t('rules.credits.gamecabinet')),
    ),
  );
  rulesEl.replaceChildren(dialog);
  rulesEl.addEventListener('click', (e) => e.target === rulesEl && closeRules());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeRules());
}

function openRules() {
  rulesEl.hidden = false;
  rulesEl.querySelector('.dialog').scrollTop = 0;
}

function closeRules() {
  rulesEl.hidden = true;
}

export const rulesButton = () => h('button', { class: 'secondary', onClick: openRules }, t('rules.button'));
buildRules();
