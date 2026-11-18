'use strict';
const { text, allTranslations } = require('./i18n');

// The computer players. The `id` never changes (profiles and anything else that needs to know which bot it is use it).
// What people see is the name under "bot.<id>" in the locale files (public/locales), one per language; the English
// name is what the server sends along, and players cannot take a bot's name in any language.
const BOT_IDS = [
  'willow-swan',
  'case',
  'one-eye',
  'bomanz',
  'silent',
  'cordy',
  'otto',
  'the-lady',
  'hagop',
  'the-lieutenant',
  'goblin',
  'croaker',
];
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

module.exports = { BOTS, BOT_IDS, BOT_NAMES, isReservedName, pickBot };
