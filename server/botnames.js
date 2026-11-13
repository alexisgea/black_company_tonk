'use strict';

// Names for computer players. Each will get its own profile later. Players cannot use these names.
const BOT_NAMES = [
  'Croaker',
  'Goblin',
  'One-Eye',
  'Elmo',
  'Silent',
  'The Lieutenant',
  'Otto',
  'Hagop',
  'Willow Swan',
  'Slink',
  'Gupta',
  'Puddle',
  'Corey',
  'Buzz',
  'Murgen',
  'Sleepy',
  'Raven',
  'Case',
];

// The quirk that marks a bot at the table while keeping the name immersive.
const BOT_MARK = '★';

const botDisplayName = (name) => `${name} ${BOT_MARK}`;

// Ignores case, accents, full-width letters, spacing, punctuation and symbols, so "one eye", "GOBLIN",
// "Goblín" and "Goblin ★" all match.
const normalize = (s) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const RESERVED = new Set(BOT_NAMES.map(normalize));

function isReservedName(name) {
  const n = normalize(name);
  return RESERVED.has(n) || (n.endsWith('bot') && RESERVED.has(n.slice(0, -3)));
}

// Picks a random bot name that is not in `taken` (display names already at the table).
function pickBotName(taken, rng = Math.random) {
  const free = BOT_NAMES.filter((n) => !taken.has(botDisplayName(n)));
  const pool = free.length ? free : BOT_NAMES;
  return botDisplayName(pool[Math.floor(rng() * pool.length)]);
}

module.exports = { BOT_NAMES, BOT_MARK, botDisplayName, isReservedName, pickBotName };
