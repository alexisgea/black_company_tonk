'use strict';
// The character of each computer player: seven numbers, each one knob. Edit the table below to tune a bot, or LEVEL
// to make every bot easier or harder at once.
//
// All of them are 0 to 1 (0.5 is the middle where there is one), except `thinkSpeed`. For `memory`, `calculating` and
// `thinkSpeed` higher is better; `tunnelVision` and `sloppiness` are flaws, so lower is better:
//
//   memory        how well it remembers the discards and who took what; forgets or half-remembers (right rank, wrong
//                 suit) the rest. 1 = a perfect memory.
//   calculating   how well it works with the cards it cannot see: keeping a promising pair or run, finding a way to
//                 empty its hand, and judging how safe it is to go down. 1 = sharp.
//   tunnelVision  how much it only watches its own game. A bot with tunnel vision often ignores what the others
//                 do (their spreads, what they need, who is nearly out) and so goes down by a rule of thumb instead
//                 of working out the risk. 0 = always watches the table, 1 = never does.
//   sloppiness    how carelessly it plays its own cards: missing a useful top discard, and slips like throwing the
//                 second-best card or overlooking a card for its own spread. 0 = never slips, 1 = always sloppy.
//   riskTaker     how ready it is to take a risk: it goes down on a thinner edge (and its rule of thumb goes higher).
//                 0.5 = neutral, 0 = timid, 1 = reckless.
//   moodSwing     how much winning, losing and being behind on coins sways it, and how readily it panics when an
//                 opponent is nearly out. 0 = steady.
//   thinkSpeed    how fast it thinks: 1 is the table's normal pace, above 1 is quicker, below 1 is slower. (Not part of
//                 the level.)
//
// Each knob has its own job; the logic that turns them into behaviour is in botmind.js and botsmart.js, and every
// fixed number behind it is in bottuning.js. Profiles are keyed by the bot's id from botnames.js, not by its display
// name, so a bot can be renamed or translated.
const { BOT_IDS } = require('./botnames');

// Makes every bot easier (below 1) or harder (above 1): it scales memory, calculating and how well it watches the table
// (the opposite of tunnelVision) and its own cards (the opposite of sloppiness) by this factor, so the differences
// between characters stay.
const LEVEL = 1;

const PARAMS = ['memory', 'calculating', 'tunnelVision', 'sloppiness', 'riskTaker', 'moodSwing', 'thinkSpeed'];
const BASE = { memory: 0.8, calculating: 0.8, tunnelVision: 0.2, sloppiness: 0.2, riskTaker: 0.5, moodSwing: 0.5, thinkSpeed: 1 };

// Croaker is written out in full: copy his entry as a template. The others override a few values like this:
// { ...BASE, memory: 0.95, riskTaker: 0.3 }
const PROFILES = {
  croaker: {
    memory: 0.9, //       remembers most of what went by
    calculating: 0.9, //  usually sees what the unseen cards allow
    tunnelVision: 0.1, // usually watches the others
    sloppiness: 0.1, //   now and then a slip with its own cards
    riskTaker: 0.6, //    neither bold nor timid
    moodSwing: 0.4, //    moderately swayed by how the game is going
    thinkSpeed: 1.25, //  sharp
  },
  'one-eye': {
    memory: 0.6, //       remembers century old grudges but forget cards
    calculating: 0.3, //  can plan god killing plans but not his hand
    tunnelVision: 0.8, // fixated on one-upping goblin
    sloppiness: 0.8, //   plays sloppily
    riskTaker: 0.95, //   reckless gambler
    moodSwing: 0.9, //    volatile and theatrical
    thinkSpeed: 1.05, //  surprisingly fast
  },
  // Reckless: dares on thin edges, panics, takes it badly when behind. Easy to bluff into trouble.
  goblin: {
    memory: 0.7,
    calculating: 0.7,
    tunnelVision: 0.7,
    sloppiness: 0.3,
    riskTaker: 0.85,
    moodSwing: 0.7,
    thinkSpeed: 1.05,
  },
  // Scatterbrained and cheerful: misses things, forgets things, goes along with its feelings.
  elmo: {
    memory: 0.7,
    calculating: 0.7,
    tunnelVision: 0.3,
    sloppiness: 0.2,
    riskTaker: 0.3,
    moodSwing: 0.3,
    thinkSpeed: 1.25,
  },
  // Calm and unreadable: quick, steady, hardly moved by wins or losses.
  silent: {
    memory: 0.95,
    calculating: 0.95,
    tunnelVision: 0.1,
    sloppiness: 0.05,
    riskTaker: 0.1,
    moodSwing: 0.1,
    thinkSpeed: 1.1,
  },
  // Steady veteran: remembers, careful with what it hands over, often goes down at 12 without a calculation.
  murgen: {
    memory: 0.8,
    calculating: 0.8,
    tunnelVision: 0.6,
    sloppiness: 0.2,
    riskTaker: 0.2,
    moodSwing: 0.6,
    thinkSpeed: 1.4,
  },
  // By the book: almost always goes down at 12 or lower without working it out, throws the dear cards, steady.
  lieutenant: {
    memory: 0.5,
    calculating: 0.2,
    tunnelVision: 0.95,
    sloppiness: 0.6,
    riskTaker: 0.3,
    moodSwing: 0.3,
    thinkSpeed: 1.4,
  },
  // Always keeps its pairs and chases a finish; does not care what it hands the others.
  otto: {
    memory: 0.8,
    calculating: 0.7,
    tunnelVision: 0.4,
    sloppiness: 0.6,
    riskTaker: 0.6,
    moodSwing: 0.2,
    thinkSpeed: 1.4,
  },
  // Grumpy: wary of danger, timid, and sulks for a long time after a bad hand.
  hagop: {
    memory: 0.8,
    calculating: 0.7,
    tunnelVision: 0.3,
    sloppiness: 0.9,
    riskTaker: 0.2,
    moodSwing: 0.1,
    thinkSpeed: 1.25,
  },
  // Graceful and strong all round, with few slips.
  'willow-swan': {
    memory: 0.7,
    calculating: 0.8,
    tunnelVision: 0.5,
    sloppiness: 0.4,
    riskTaker: 0.6,
    moodSwing: 0.4,
    thinkSpeed: 1.4,
  },
  // Sharp, but bets everything on thin edges: goes down early whenever the odds look even slightly good.
  gambler: {
    memory: 0.85,
    calculating: 0.85,
    tunnelVision: 0.15,
    sloppiness: 0.15,
    riskTaker: 0.9,
    moodSwing: 0.5,
    thinkSpeed: 1.1,
  },
  // Works out the odds very well, then never dares: almost never goes down early.
  coward: {
    memory: 0.7,
    calculating: 0.9,
    tunnelVision: 0.2,
    sloppiness: 0.3,
    riskTaker: 0.05,
    moodSwing: 0.6,
    thinkSpeed: 0.75,
  },
  // Average skills, but wins and losses throw it completely: brilliant when confident, reckless when behind.
  tilter: {
    memory: 0.65,
    calculating: 0.65,
    tunnelVision: 0.35,
    sloppiness: 0.35,
    riskTaker: 0.5,
    moodSwing: 1,
    thinkSpeed: 1.1,
  },
  // Reasons about the odds very well but forgets what was discarded.
  amnesiac: {
    memory: 0.1,
    calculating: 0.9,
    tunnelVision: 0.2,
    sloppiness: 0.2,
    riskTaker: 0.5,
    moodSwing: 0.4,
    thinkSpeed: 1,
  },
  // Plays its own hand perfectly and ignores everybody else, so it goes by a rule of thumb and never reads the table.
  savant: {
    memory: 0.8,
    calculating: 0.95,
    tunnelVision: 0.9,
    sloppiness: 0.05,
    riskTaker: 0.5,
    moodSwing: 0.3,
    thinkSpeed: 0.9,
  },
  // Still learning: weak at everything, and slow about it.
  rookie: {
    memory: 0.4,
    calculating: 0.4,
    tunnelVision: 0.6,
    sloppiness: 0.6,
    riskTaker: 0.4,
    moodSwing: 0.5,
    thinkSpeed: 0.7,
  },
  // An average player: not good and not bad at anything.
  veteran: {
    memory: 0.65,
    calculating: 0.65,
    tunnelVision: 0.35,
    sloppiness: 0.35,
    riskTaker: 0.5,
    moodSwing: 0.5,
    thinkSpeed: 1,
  },
};

// Plays for a human who is away or disconnected (they have no character of their own).
const SUBSTITUTE = { ...BASE };

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// The profile for a seat, with the level applied and in the form the bot logic uses: `focus` is how well it watches
// the table (1 - tunnelVision), a sloppiness of 1 - (1 - sloppiness) * level, and `boldness` is risk from -1 (timid)
// to 1 (reckless).
function profileFor(player, level = LEVEL) {
  const p = player.isBot ? (PROFILES[player.botId] ?? SUBSTITUTE) : SUBSTITUTE;
  return {
    memory: clamp01(p.memory * level),
    calculating: clamp01(p.calculating * level),
    focus: clamp01((1 - p.tunnelVision) * level),
    sloppiness: clamp01(1 - (1 - p.sloppiness) * level),
    boldness: (p.riskTaker - 0.5) * 2,
    moodSwing: p.moodSwing,
    thinkSpeed: p.thinkSpeed,
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
      if (key === 'thinkSpeed' ? !(value > 0) : !(value >= 0 && value <= 1))
        problems.push(`${id}: ${key} must be ${key === 'thinkSpeed' ? 'above 0' : 'from 0 to 1'}`);
    }
  }
  return problems;
}

module.exports = { PROFILES, PARAMS, BASE, LEVEL, profileFor, profileProblems };
