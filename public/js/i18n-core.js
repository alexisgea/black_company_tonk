// Translation core: no browser APIs, so it can be tested on its own. See i18n.js for loading and the shared instance.
//
// Messages are flat { "dotted.key": "text" } maps (public/locales/<language>.json). Text can hold {placeholders}.
// Plural forms are separate keys named after the CLDR category ("key.one", "key.other", ...), chosen by params.count.
// A list of paragraphs is an array. Anything missing in the current language falls back to English.
export const FALLBACK_LOCALE = 'en';

const PLACEHOLDER = /\{(\w+)\}/g;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function format(template, params) {
  return template.replace(PLACEHOLDER, (whole, name) => (params && has(params, name) ? String(params[name]) : whole));
}

// The first language the person asked for that we have: their saved choice, then the browser's list. "fr-CA" finds "fr".
export function pickLocale(supported, saved, languages = []) {
  for (const wanted of [saved, ...languages]) {
    if (typeof wanted !== 'string') continue;
    const tag = wanted.toLowerCase();
    const found = supported.find((s) => s.toLowerCase() === tag) ?? supported.find((s) => s.toLowerCase() === tag.split('-')[0]);
    if (found) return found;
  }
  return FALLBACK_LOCALE;
}

export function createTranslator(locale, messages, fallback = {}) {
  const plurals = new Intl.PluralRules(locale);
  const find = (key) => (has(messages, key) ? messages[key] : fallback[key]);

  const lookup = (key, params) => {
    if (params && typeof params.count === 'number') {
      for (const form of [plurals.select(params.count), 'other']) {
        const entry = find(`${key}.${form}`);
        if (entry !== undefined) return entry;
      }
    }
    return find(key);
  };

  // `missing` is what to show when the key exists nowhere (e.g. the English text a server sent along with its code).
  function t(key, params, missing) {
    const entry = lookup(key, params);
    return typeof entry === 'string' ? format(entry, params) : (missing ?? key);
  }

  // Like t, but values in `params` may be DOM nodes: returns an array of strings and those nodes, ready for h().
  function tNodes(key, params, missing) {
    const entry = lookup(key, params);
    if (typeof entry !== 'string') return [missing ?? key];
    return entry
      .split(/(\{\w+\})/)
      .map((part) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        return name && params && has(params, name) ? params[name] : part;
      })
      .filter((part) => part !== '');
  }

  function tList(key) {
    const entry = find(key);
    return Array.isArray(entry) ? [...entry] : [];
  }

  return { locale, t, tNodes, tList, has: (key) => find(key) !== undefined };
}
