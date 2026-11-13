// Display preferences (text size and card size), kept in localStorage and applied as CSS variables.
const STORAGE_KEY = 'tonk.display';

export const PREF_LIMITS = {
  fontScale: { min: 0.8, max: 1.6, step: 0.05 },
  cardScale: { min: 0.7, max: 1.6, step: 0.05 },
};
export const DEFAULT_PREFS = { fontScale: 1, cardScale: 1 };

export function clampPref(key, value) {
  const { min, max } = PREF_LIMITS[key];
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_PREFS[key];
}

export function loadPrefs(storage = globalThis.localStorage) {
  let saved = {};
  try {
    saved = JSON.parse(storage.getItem(STORAGE_KEY)) || {};
  } catch {
    // Unreadable or unavailable storage: fall back to the defaults.
  }
  return {
    fontScale: clampPref('fontScale', saved.fontScale ?? DEFAULT_PREFS.fontScale),
    cardScale: clampPref('cardScale', saved.cardScale ?? DEFAULT_PREFS.cardScale),
  };
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or a full quota: the setting still applies until the page is closed.
  }
}

export function applyPrefs(prefs, root = document.documentElement) {
  root.style.setProperty('--font-scale', prefs.fontScale);
  root.style.setProperty('--card-scale', prefs.cardScale);
}
