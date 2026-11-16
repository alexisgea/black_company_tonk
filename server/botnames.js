'use strict';

// The computer players. The `id` never changes (profiles and anything else that needs to know which bot it is use it);
// the `name` is only what people see, so it can be changed or translated freely. Players cannot use these names.
const BOTS = [
  { id: 'croaker', name: 'Croaker' },
  { id: 'goblin', name: 'Goblin' },
  { id: 'one-eye', name: 'One-Eye' },
  { id: 'elmo', name: 'Elmo' },
  { id: 'silent', name: 'Silent' },
  { id: 'lieutenant', name: 'The Lieutenant' },
  { id: 'otto', name: 'Otto' },
  { id: 'hagop', name: 'Hagop' },
  { id: 'willow-swan', name: 'Willow Swan' },
  { id: 'slink', name: 'Slink' },
  { id: 'gupta', name: 'Gupta' },
  { id: 'puddle', name: 'Puddle' },
  { id: 'corey', name: 'Corey' },
  { id: 'buzz', name: 'Buzz' },
  { id: 'murgen', name: 'Murgen' },
  { id: 'sleepy', name: 'Sleepy' },
  { id: 'raven', name: 'Raven' },
  { id: 'case', name: 'Case' },
];
const BOT_IDS = BOTS.map((b) => b.id);
const BOT_NAMES = BOTS.map((b) => b.name);

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

// Picks a random bot that is not in `taken` (the bot ids already at the table). The client marks bots with a helmet.
function pickBot(taken, rng = Math.random) {
  const free = BOTS.filter((b) => !taken.has(b.id));
  const pool = free.length ? free : BOTS;
  return pool[Math.floor(rng() * pool.length)];
}

module.exports = { BOTS, BOT_IDS, BOT_NAMES, isReservedName, pickBot };
