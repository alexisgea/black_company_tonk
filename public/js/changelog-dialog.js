// Changelog popup: built once, lives outside #app so game updates never reset it.
import { h } from './dom.js';
import { CHANGELOG } from './changelog-data.js';
import { t } from './i18n.js';

const changelogEl = document.getElementById('changelog');

// The entries themselves (changelog-data.js) stay in English; only the dialog around them is translated.
function buildChangelog() {
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('changelog.title') },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', null, t('changelog.title')),
      h('span', { class: 'spacer' }),
      h('button', { onClick: closeChangelog }, t('common.close')),
    ),
    CHANGELOG.map(({ version, date, changes }) => [
      h('h3', null, `v${version} `, h('span', { class: 'muted' }, date)),
      h(
        'ul',
        null,
        changes.map((change) => h('li', null, change)),
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

export const changelogButton = () => h('button', { class: 'secondary', onClick: openChangelog }, t('changelog.title'));
buildChangelog();
