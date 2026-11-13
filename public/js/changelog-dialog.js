// Changelog popup: built once, lives outside #app so game updates never reset it.
import { h } from './dom.js';
import { CHANGELOG } from './changelog-data.js';

const changelogEl = document.getElementById('changelog');

function buildChangelog() {
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Changelog' },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', null, 'Changelog'),
      h('span', { class: 'spacer' }),
      h('button', { onClick: closeChangelog }, 'Close'),
    ),
    CHANGELOG.map(({ version, date, changes }) => [
      h('h3', null, `v${version} `, h('span', { class: 'muted' }, date)),
      h(
        'ul',
        null,
        changes.map((t) => h('li', null, t)),
      ),
    ]),
  );
  changelogEl.replaceChildren(dialog);
  changelogEl.addEventListener('click', (e) => e.target === changelogEl && closeChangelog());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeChangelog());
}

function openChangelog() {
  changelogEl.hidden = false;
  changelogEl.querySelector('.dialog').scrollTop = 0;
}

function closeChangelog() {
  changelogEl.hidden = true;
}

export const changelogButton = () => h('button', { class: 'secondary', onClick: openChangelog }, 'Changelog');
buildChangelog();
