'use strict';
const fs = require('fs');
const path = require('path');

// The locale files are shared with the browser (public/locales). The server only needs English, for the short
// messages that travel next to every error code, and the names of the bots in every language, so no player can
// take one of them.
const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales');
const en = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8'));

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (whole, name) => (params && name in params ? String(params[name]) : whole));
}

// The English text for `key` (the key itself if it is missing, which the tests catch).
const text = (key, params) => (typeof en[key] === 'string' ? format(en[key], params) : key);

// The English list of texts for `key` (empty if there is none, which the tests catch).
const lines = (key) => (Array.isArray(en[key]) ? en[key] : []);

// What goes over the wire for an error or notice: a code the client translates, its parameters,
// and the English text as a fallback for clients that do not know the code.
function describe(prefix, code, params) {
  const out = { code, message: text(`${prefix}.${code}`, params) };
  if (params) out.params = params;
  return out;
}

// Every translation of one message (used for the bot names).
function allTranslations(key) {
  const found = [];
  for (const file of fs.readdirSync(LOCALES_DIR)) {
    if (!file.endsWith('.json')) continue;
    const value = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'))[key];
    if (typeof value === 'string') found.push(value);
  }
  return found;
}

module.exports = { text, lines, describe, allTranslations };
