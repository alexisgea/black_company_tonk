// Language of the page: picks it, loads its messages and exposes the translate functions used by every view.
// Everything the player can read comes from public/locales/<language>.json (English is the reference and the fallback).
// To add a language: add its file there and its code to SUPPORTED. The test suite checks the two stay in step.
import { LOADED_VERSION } from './app-version.js';
import { FALLBACK_LOCALE, pickLocale, createTranslator } from './i18n-core.js';

export const SUPPORTED = ['en'];
const STORAGE_KEY = 'tonk.lang';

async function load(locale) {
  try {
    const res = await fetch(`/locales/${locale}.json?v=${encodeURIComponent(LOADED_VERSION)}`);
    return res.ok ? await res.json() : {};
  } catch {
    return {}; // offline or blocked: the keys themselves show, and the page still works
  }
}

function savedLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const locale = pickLocale(SUPPORTED, savedLocale(), navigator.languages ?? [navigator.language]);
const english = await load(FALLBACK_LOCALE);
const messages = locale === FALLBACK_LOCALE ? english : await load(locale);
const translator = createTranslator(locale, messages, english);

document.documentElement.lang = locale;
export const { t, tNodes, tList } = translator;
export const currentLocale = locale;
document.title = t('app.title');

// The name of a bot character in this language; `fallback` is the English name the server sent.
export const botName = (botId, fallback) => t(`bot.${botId}`, undefined, fallback);

// The text for something the server reported by code ("err", "notice"), or the English message it sent along.
export const serverText = (prefix, msg) => t(`${prefix}.${msg.code}`, msg.params, msg.message);

// Dialogs and views are built once, so a new language starts with a reload (the session carries over).
export function setLocale(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage unavailable: nothing to remember the choice with.
  }
  location.reload();
}

// A language's own name for itself ("français"), for the language picker.
export const languageName = (code) => new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
