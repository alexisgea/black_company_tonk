'use strict';
// The character of each computer player: seven numbers, each one knob. Edit the table below to tune a bot, or LEVEL
// to make every bot easier or harder at once.
//
// All of them are 0 to 1 (0.5 is the middle where there is one), except `speed`:
//
//   memory        how well it remembers the discards and who took what; forgets or half-remembers (right rank, wrong
//                 suit) the rest. 1 = a perfect memory.
//   counting      how well it works with the cards it cannot see: keeping a promising pair or run, finding a way to
//                 empty its hand, and judging how safe it is to go down. 1 = sharp.
//   tunnelVision  how much it only watches its own game. A bot with tunnel vision often ignores what the others
//                 do (their spreads, what they need, who is nearly out) and so goes down by a rule of thumb instead
//                 of working out the risk. 0 = always watches the table, 1 = never does.
//   attention     how carefully it plays its own cards: noticing a useful top discard, and slips like throwing the
//                 second-best card or overlooking a card for its own spread. 1 = never slips.
//   risk          how ready it is to take a risk: it goes down on a thinner edge (and its rule of thumb goes higher).
//                 0.5 = neutral, 0 = timid, 1 = reckless.
//   mood          how much winning, losing and being behind on coins sways it, and how readily it panics when an
//                 opponent is nearly out. 0 = steady.
//   speed         how long it thinks: below 1 is quick, above 1 is slow. (Not part of the level.)
//
// Each knob has its own job; the logic that turns them into behaviour is in botmind.js and botsmart.js, and every
// fixed number behind it is in bottuning.js. Profiles are keyed by the bot's id from botnames.js, not by its display
// name, so a bot can be renamed or translated.
const { BOT_IDS } = require('./botnames');

// Makes every bot easier (below 1) or harder (above 1): it scales memory, counting, attention and how well it watches
// the table (the opposite of tunnelVision) by this factor, so the differences between characters stay.
const LEVEL = 1;

const PARAMS = ['memory', 'counting', 'tunnelVision', 'attention', 'risk', 'mood', 'speed'];
const BASE = { memory: 0.8, counting: 0.8, tunnelVision: 0.2, attention: 0.8, risk: 0.5, mood: 0.5, speed: 1 };

// Croaker is written out in full: copy his entry as a template. The others override a few values like this:
// { ...BASE, memory: 0.95, risk: 0.3 }
const PROFILES = {
  croaker: {
    memory: 0.8, //       remembers most of what went by
    counting: 0.8, //     usually sees what the unseen cards allow
    tunnelVision: 0.2, // usually watches the others
    attention: 0.8, //    now and then a slip with its own cards
    risk: 0.5, //         neither bold nor timid
    mood: 0.5, //         moderately swayed by how the game is going
    speed: 1,
  },
  // Reckless: dares on thin edges, panics, takes it badly when behind. Easy to bluff into trouble.
  goblin: { ...BASE, counting: 0.65, tunnelVision: 0.4, attention: 0.5, risk: 0.9, mood: 0.9, speed: 0.8 },
  // Sharp and watchful: remembers everything, slow to move, rarely slips.
  'one-eye': { ...BASE, memory: 0.95, tunnelVision: 0.1, attention: 0.9, risk: 0.45, mood: 0.3, speed: 1.3 },
  // Scatterbrained and cheerful: misses things, forgets things, goes along with its feelings.
  elmo: { ...BASE, memory: 0.6, counting: 0.65, tunnelVision: 0.3, attention: 0.4, risk: 0.6, speed: 0.9 },
  // Calm and unreadable: quick, steady, hardly moved by wins or losses.
  silent: { ...BASE, counting: 0.95, tunnelVision: 0.1, attention: 0.9, mood: 0.1, speed: 0.7 },
  // By the book: always goes down at 12 or lower without working it out, throws the dear cards, steady.
  lieutenant: { ...BASE, counting: 0.5, tunnelVision: 0.9, attention: 0.85, mood: 0.2, speed: 1.1 },
  // Always keeps its pairs and chases a finish; does not care what it hands the others.
  otto: { ...BASE, counting: 0.9, tunnelVision: 0.5, attention: 0.9, risk: 0.45, speed: 1.2 },
  // Grumpy: wary of danger, timid, and sulks for a long time after a bad hand.
  hagop: { ...BASE, counting: 0.7, tunnelVision: 0.1, risk: 0.35, mood: 0.9, speed: 1.2 },
  // Graceful and strong all round, with few slips.
  'willow-swan': { ...BASE, memory: 0.9, counting: 0.9, tunnelVision: 0.1, attention: 0.9, risk: 0.55, mood: 0.3 },
  // Sneaky opportunist: watches what everyone needs, a little bold.
  slink: { ...BASE, counting: 0.7, tunnelVision: 0.05, attention: 0.85, risk: 0.65, speed: 0.8 },
  // Methodical: slow, works the odds out and rarely goes by feel.
  gupta: { ...BASE, memory: 0.9, counting: 0.85, tunnelVision: 0.15, mood: 0.2, speed: 1.4 },
  // Dreamy and slow: loses track of the game.
  puddle: { ...BASE, memory: 0.5, tunnelVision: 0.5, attention: 0.4, risk: 0.55, speed: 1.8 },
  // Eager beginner: fast, bold, panics, and falls back on a rule of thumb.
  corey: { ...BASE, memory: 0.65, counting: 0.65, tunnelVision: 0.5, attention: 0.5, risk: 0.75, mood: 0.8, speed: 0.7 },
  // Impatient gambler: plays fast and loose, goes down by feel.
  buzz: { ...BASE, counting: 0.65, tunnelVision: 0.4, attention: 0.5, risk: 0.8, mood: 0.7, speed: 0.5 },
  // Steady veteran: remembers, careful with what it hands over, often goes down at 12 without a calculation.
  murgen: { ...BASE, memory: 0.9, counting: 0.7, tunnelVision: 0.3, risk: 0.45, mood: 0.3, speed: 1.2 },
  // Forgetful and slow: nods off.
  sleepy: { ...BASE, memory: 0.4, tunnelVision: 0.5, attention: 0.5, speed: 1.8 },
  // Watches the others: knows what they hold and does not give them what they need.
  raven: { ...BASE, memory: 0.9, counting: 0.7, tunnelVision: 0.05, speed: 0.9 },
  // Chases the big win: goes for an empty hand, takes risks to get it.
  case: { ...BASE, counting: 0.85, risk: 0.7 },
};

// Plays for a human who is away or disconnected (they have no character of their own).
const SUBSTITUTE = { ...BASE };

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// The profile for a seat, with the level applied and in the form the bot logic uses: `focus` is how well it watches
// the table (1 - tunnelVision) and `boldness` is risk from -1 (timid) to 1 (reckless).
function profileFor(player, level = LEVEL) {
  const p = player.isBot ? (PROFILES[player.botId] ?? SUBSTITUTE) : SUBSTITUTE;
  return {
    memory: clamp01(p.memory * level),
    counting: clamp01(p.counting * level),
    focus: clamp01((1 - p.tunnelVision) * level),
    attention: clamp01(p.attention * level),
    boldness: (p.risk - 0.5) * 2,
    mood: p.mood,
    speed: p.speed,
  };
}

// Problems in the table above (empty when it is fine); a test keeps it honest after manual edits.
function profileProblems() {
  const problems = [];
  for (const id of BOT_IDS) if (!PROFILES[id]) problems.push(`${id} has no profile`);
  for (const [id, profile] of Object.entries({ ...PROFILES, SUBSTITUTE })) {
    if (id !== 'SUBSTITUTE' && !BOT_IDS.includes(id)) problems.push(`${id} is not a bot id`);
    for (const key of Object.keys(profile)) if (!PARAMS.includes(key)) problems.push(`${id}: unknown parameter ${key}`);
    for (const key of PARAMS) {
      const value = profile[key];
      if (key === 'speed' ? !(value > 0) : !(value >= 0 && value <= 1))
        problems.push(`${id}: ${key} must be ${key === 'speed' ? 'above 0' : 'from 0 to 1'}`);
    }
  }
  return problems;
}

module.exports = { PROFILES, PARAMS, BASE, LEVEL, profileFor, profileProblems };
