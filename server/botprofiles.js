'use strict';
// The character of each computer player: seven numbers, each one knob. Edit the table below to tune a bot, or LEVEL
// to make every bot easier or harder at once.
//
// All of them are 0 to 1 (0.5 is the middle where there is one), except `speed`:
//
//   memory        how well it remembers the discards and who took what; forgets or half-remembers (right rank, wrong
//                 suit) the rest. 1 = a perfect memory.
//   calculating   how well it works with the cards it cannot see: keeping a promising pair or run, finding a way to
//                 empty its hand, and judging how safe it is to go down. 1 = sharp.
//   tunnelVision  how much it only watches its own game. A bot with tunnel vision often ignores what the others
//                 do (their spreads, what they need, who is nearly out) and so goes down by a rule of thumb instead
//                 of working out the risk. 0 = always watches the table, 1 = never does.
//   observant     how carefully it plays its own cards: noticing a useful top discard, and slips like throwing the
//                 second-best card or overlooking a card for its own spread. 1 = never slips.
//   riskTaker     how ready it is to take a risk: it goes down on a thinner edge (and its rule of thumb goes higher).
//                 0.5 = neutral, 0 = timid, 1 = reckless.
//   moodSwing     how much winning, losing and being behind on coins sways it, and how readily it panics when an
//                 opponent is nearly out. 0 = steady.
//   speed         how long it thinks: below 1 is quick, above 1 is slow. (Not part of the level.)
//
// Each knob has its own job; the logic that turns them into behaviour is in botmind.js and botsmart.js, and every
// fixed number behind it is in bottuning.js. Profiles are keyed by the bot's id from botnames.js, not by its display
// name, so a bot can be renamed or translated.
const { BOT_IDS } = require('./botnames');

// Makes every bot easier (below 1) or harder (above 1): it scales memory, calculating, observant and how well it
// watches the table (the opposite of tunnelVision) by this factor, so the differences between characters stay.
const LEVEL = 1;

const PARAMS = ['memory', 'calculating', 'tunnelVision', 'observant', 'riskTaker', 'moodSwing', 'speed'];
const BASE = { memory: 0.8, calculating: 0.8, tunnelVision: 0.2, observant: 0.8, riskTaker: 0.5, moodSwing: 0.5, speed: 1 };

// Croaker is written out in full: copy his entry as a template. The others override a few values like this:
// { ...BASE, memory: 0.95, riskTaker: 0.3 }
const PROFILES = {
  croaker: {
    memory: 0.9, //       remembers most of what went by
    calculating: 0.9, //  usually sees what the unseen cards allow
    tunnelVision: 0.1, // usually watches the others
    observant: 0.9, //    now and then a slip with its own cards
    riskTaker: 0.6, //    neither bold nor timid
    moodSwing: 0.4, //    moderately swayed by how the game is going
    speed: 0.8, //        sharp
  },
  // TODO write something
  'the-lady': {
    memory: 0.99, //      razor precision
    calculating: 0.99, // mastermind
    tunnelVision: 0.2, // focused on her own survival and vengeance
    observant: 0.99, //   meticulous and disciplined
    riskTaker: 0.7, //    calculated gambler
    moodSwing: 0.2, //    icy control
    speed: 1.0, //        lightning fast
  },
  // Sharp and watchful: remembers everything, slow to move, rarely slips.
  'one-eye': {
    memory: 0.6, //       remembers century old grudges but forget cards
    calculating: 0.3, //  can plan god killing plans but not his hand
    tunnelVision: 0.8, // fixated on one-upping goblin
    observant: 0.2, //    plays sloppily
    riskTaker: 0.9, //    reckless gambler
    moodSwing: 0.9, //    volatile and theatrical
    speed: 0.95, //       surprisingly fast
  },
  // Reckless: dares on thin edges, panics, takes it badly when behind. Easy to bluff into trouble.
  goblin: {
    memory: 0.7,
    calculating: 0.7,
    tunnelVision: 0.7,
    observant: 0.7,
    riskTaker: 0.7,
    moodSwing: 0.7,
    speed: 0.95,
  },
  // Scatterbrained and cheerful: misses things, forgets things, goes along with its feelings.
  elmo: {
    memory: 0.7,
    calculating: 0.7,
    tunnelVision: 0.3,
    observant: 0.8,
    riskTaker: 0.3,
    moodSwing: 0.3,
    speed: 0.8,
  },
  // Calm and unreadable: quick, steady, hardly moved by wins or losses.
  silent: {
    memory: 0.95,
    calculating: 0.95,
    tunnelVision: 0.1,
    observant: 0.95,
    riskTaker: 0.1,
    moodSwing: 0.1,
    speed: 0.9,
  },
  // Steady veteran: remembers, careful with what it hands over, often goes down at 12 without a calculation.
  murgen: {
    memory: 0.8,
    calculating: 0.8,
    tunnelVision: 0.6,
    observant: 0.8,
    riskTaker: 0.2,
    moodSwing: 0.6,
    speed: 0.7,
  },
  // Forgetful and slow: nods off.
  sleepy: {
    memory: 0.9,
    calculating: 0.9,
    tunnelVision: 0.2,
    observant: 0.9,
    riskTaker: 0.4,
    moodSwing: 0.4,
    speed: 0.6,
  },
  // By the book: always goes down at 12 or lower without working it out, throws the dear cards, steady.
  lieutenant: {
    memory: 0.5,
    calculating: 0.2,
    tunnelVision: 0.2,
    observant: 0.4,
    riskTaker: 0.3,
    moodSwing: 0.3,
    speed: 0.7,
  },
  // Always keeps its pairs and chases a finish; does not care what it hands the others.
  otto: {
    memory: 0.8,
    calculating: 0.7,
    tunnelVision: 0.4,
    observant: 0.4,
    riskTaker: 0.6,
    moodSwing: 0.2,
    speed: 0.7,
  },
  // Grumpy: wary of danger, timid, and sulks for a long time after a bad hand.
  hagop: {
    memory: 0.8,
    calculating: 0.7,
    tunnelVision: 0.3,
    observant: 0.1,
    riskTaker: 0.2,
    moodSwing: 0.1,
    speed: 0.8,
  },
  // Graceful and strong all round, with few slips.
  'willow-swan': {
    memory: 0.7,
    calculating: 0.8,
    tunnelVision: 0.5,
    observant: 0.6,
    riskTaker: 0.6,
    moodSwing: 0.4,
    speed: 0.7,
  },
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
    calculating: clamp01(p.calculating * level),
    focus: clamp01((1 - p.tunnelVision) * level),
    observant: clamp01(p.observant * level),
    boldness: (p.riskTaker - 0.5) * 2,
    moodSwing: p.moodSwing,
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
