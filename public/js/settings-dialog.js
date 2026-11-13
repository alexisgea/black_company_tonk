// Display settings popup: built once, lives outside #app so game updates never reset it.
import { h } from './dom.js';
import { PREF_LIMITS, DEFAULT_PREFS, loadPrefs, savePrefs, applyPrefs, clampPref } from './display-prefs.js';

const settingsEl = document.getElementById('settings');
const prefs = loadPrefs();
applyPrefs(prefs);

function slider(key, label) {
  const { min, max, step } = PREF_LIMITS[key];
  const percent = (v) => `${Math.round(v * 100)}%`;
  const value = h('span', { class: 'slider-value' }, percent(prefs[key]));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value: prefs[key],
    onInput: (e) => {
      prefs[key] = clampPref(key, e.target.value);
      value.textContent = percent(prefs[key]);
      applyPrefs(prefs);
      savePrefs(prefs);
    },
  });
  const reset = () => {
    prefs[key] = DEFAULT_PREFS[key];
    input.value = prefs[key];
    value.textContent = percent(prefs[key]);
    applyPrefs(prefs);
    savePrefs(prefs);
  };
  return h(
    'label',
    { class: 'slider-row' },
    h('span', { class: 'slider-label' }, label),
    input,
    value,
    h('button', { type: 'button', class: 'secondary small-btn', onClick: reset }, 'Reset'),
  );
}

function buildSettings() {
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', null, 'Settings'),
      h('span', { class: 'spacer' }),
      h('button', { onClick: closeSettings }, 'Close'),
    ),
    slider('fontScale', 'Font size'),
    slider('cardScale', 'Card size'),
  );
  settingsEl.replaceChildren(dialog);
  settingsEl.addEventListener('click', (e) => e.target === settingsEl && closeSettings());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSettings());
}

function openSettings() {
  settingsEl.hidden = false;
}

function closeSettings() {
  settingsEl.hidden = true;
}

export const settingsButton = () => h('button', { class: 'secondary', onClick: openSettings }, 'Settings');
buildSettings();
