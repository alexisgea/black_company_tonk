'use strict';
const { text, allTranslations } = require('./i18n');

// The computer players, strongest first: this is the order they are listed in when the host picks one. Edit it by hand
// (it is finer than the rank in botprofiles.js, which only has four levels). The `id` never changes (profiles and
// anything else that needs to know which bot it is use it).
// What people see is the name under "bot.<id>" in the locale files (public/locales), one per language; the English
// name is what the server sends along, and players cannot take a bot's name in any language.
const BOT_IDS = [
  'the-lady',
  'croaker',
  'silent',
  'otto',
  'bomanz',
  'willow-swan',
  'goblin',
  'hagop',
  'case',
  'one-eye',
  'the-lieutenant',
  'cordy',
];
// The word that sums up how a bot plays (its text is "tag.<word>" in the locale files), or null when the bot's rank
// already says it all (a rookie, a veteran or an expert). Its one-sentence profile is "bot.<id>.bio".
const BOT_TAGS = {
  'willow-swan': 'gambler',
  case: 'coward',
  'one-eye': 'tilter',
  bomanz: 'amnesiac',
  silent: 'savant',
  cordy: null,
  otto: null,
  'the-lady': null,
  hagop: 'stoic',
  'the-lieutenant': 'guesser',
  goblin: 'sloppy',
  croaker: 'annalist',
};
const BOTS = BOT_IDS.map((id) => ({ id, name: text(`bot.${id}`) }));
const BOT_NAMES = BOTS.map((b) => b.name);

// Ignores case, accents, full-width letters, spacing, punctuation and symbols, so "one eye", "GOBLIN",
// "Goblín" and "Goblin ★" all match.
const normalize = (s) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const RESERVED = new Set(BOT_IDS.flatMap((id) => allTranslations(`bot.${id}`)).map(normalize));

function isReservedName(name) {
  const n = normalize(name);
  return RESERVED.has(n) || (n.endsWith('bot') && RESERVED.has(n.slice(0, -3)));
}

// Picks a random bot that is not in `taken` (the bot ids already at the table). The client marks bots with a helmet.
function pickBot(taken, rng = Math.random) {
  const free = BOTS.filter((b) => !taken.has(b.id));
  const pool = free.length ? free : BOTS;
  return pool[Math.floor(rng() * pool.length)];
}

module.exports = { BOTS, BOT_IDS, BOT_NAMES, BOT_TAGS, isReservedName, pickBot };
