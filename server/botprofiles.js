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
// Each entry also has a `rank` (rookie, regular, veteran or expert): how strong the character turns out to be compared
// with the others. It is not a knob and changes nothing in the game; `npm run dev:tournament` rewrites it here from
// the ranking it measures (the best quarter are experts, the worst quarter rookies), so do not edit it by hand.
//
// Each knob has its own job; the logic that turns them into behaviour is in botmind.js and botsmart.js, and every
// fixed number behind it is in bottuning.js. Profiles are keyed by the bot's id from botnames.js, not by its display
// name, so a bot can be renamed or translated.
const { BOT_IDS } = require('./botnames');

// Makes every bot easier (below 1) or harder (above 1): it scales memory, calculating and how well it watches the table
// (the opposite of tunnelVision) and its own cards (the opposite of sloppiness) by this factor, so the differences
// between characters stay.
const LEVEL = 1;

// From the weakest to the strongest.
const RANKS = ['rookie', 'regular', 'veteran', 'expert'];

const PARAMS = ['memory', 'calculating', 'tunnelVision', 'sloppiness', 'riskTaker', 'moodSwing', 'thinkSpeed'];
const BASE = { memory: 0.8, calculating: 0.8, tunnelVision: 0.2, sloppiness: 0.2, riskTaker: 0.5, moodSwing: 0.5, thinkSpeed: 1 };

const PROFILES = {
  // Gambler: Sharp, but bets everything on thin edges: goes down early whenever the odds look even slightly good.
  'willow-swan': {
    rank: 'veteran',
    memory: 0.75,
    calculating: 0.75,
    tunnelVision: 0.15,
    sloppiness: 0.3,
    riskTaker: 0.9,
    moodSwing: 0.58,
    thinkSpeed: 1.1,
  },
  // Coward: Works out the odds very well, then never dares: almost never goes down early.
  case: {
    rank: 'regular',
    memory: 0.7,
    calculating: 0.9,
    tunnelVision: 0.2,
    sloppiness: 0.25,
    riskTaker: 0.05,
    moodSwing: 0.6,
    thinkSpeed: 0.75,
  },
  // Tilter: Average skills, but wins and losses throw it completely: brilliant when confident, reckless when behind.
  'one-eye': {
    rank: 'rookie',
    memory: 0.65,
    calculating: 0.65,
    tunnelVision: 0.35,
    sloppiness: 0.35,
    riskTaker: 0.5,
    moodSwing: 1,
    thinkSpeed: 1.1,
  },
  // Amnesiac: Reasons about the odds very well but forgets what was discarded.
  bomanz: {
    rank: 'veteran',
    memory: 0.1,
    calculating: 0.95,
    tunnelVision: 0.05,
    sloppiness: 0.05,
    riskTaker: 0.5,
    moodSwing: 0.3,
    thinkSpeed: 0.8,
  },
  // Savant: Plays its own hand perfectly and ignores everybody else, so it goes by a rule of thumb and never reads the table.
  silent: {
    rank: 'expert',
    memory: 0.95,
    calculating: 0.95,
    tunnelVision: 0.8,
    sloppiness: 0.05,
    riskTaker: 0.6,
    moodSwing: 0,
    thinkSpeed: 0.9,
  },
  // Rookie: Still learning: weak at everything, and slow about it.
  cordy: {
    rank: 'rookie',
    memory: 0.2,
    calculating: 0.2,
    tunnelVision: 0.7,
    sloppiness: 0.8,
    riskTaker: 0.4,
    moodSwing: 0.6,
    thinkSpeed: 0.7,
  },
  // Veteran: An above average player: good but beatable.
  otto: {
    rank: 'veteran',
    memory: 0.75,
    calculating: 0.72,
    tunnelVision: 0.3,
    sloppiness: 0.35,
    riskTaker: 0.5,
    moodSwing: 0.25,
    thinkSpeed: 1,
  },
  // Expert: Near-flawless memory, math, and table awareness: reads every move at lightning speed and rarely makes a mistake.
  'the-lady': {
    rank: 'expert',
    memory: 0.95,
    calculating: 0.95,
    tunnelVision: 0.05,
    sloppiness: 0.05,
    riskTaker: 0.5,
    moodSwing: 0.1,
    thinkSpeed: 1.2,
  },
  // Stoic: Steady, slightly below average fundamentals with zero emotional reaction: wins and losses never rattle it.
  hagop: {
    rank: 'regular',
    memory: 0.48,
    calculating: 0.48,
    tunnelVision: 0.45,
    sloppiness: 0.5,
    riskTaker: 0.5,
    moodSwing: 0,
    thinkSpeed: 0.85,
  },
  // Guesser: A poor player who is only here for the company: he chats with everybody and notices who does what, but
  // has no head for the odds, forgets the discards and just guesses, often on a whim.
  'the-lieutenant': {
    rank: 'rookie',
    memory: 0.6,
    calculating: 0.05,
    tunnelVision: 0.3,
    sloppiness: 0.7,
    riskTaker: 0.5,
    moodSwing: 0.5,
    thinkSpeed: 1.25,
  },
  // Sloppy: Sharp memory and strong card math, but constantly undermines itself with careless, sloppy plays.
  goblin: {
    rank: 'regular',
    memory: 0.95,
    calculating: 0.95,
    tunnelVision: 0.1,
    sloppiness: 0.8,
    riskTaker: 0.5,
    moodSwing: 0.3,
    thinkSpeed: 1.15,
  },
  // Annalist: Whines about every hand while quietly counting every discard: conservative, observant, and dangerous over long sessions.
  croaker: {
    rank: 'expert',
    memory: 0.9,
    calculating: 0.85,
    tunnelVision: 0.1,
    sloppiness: 0.08,
    riskTaker: 0.3,
    moodSwing: 0.28,
    thinkSpeed: 1.05,
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
    for (const key of Object.keys(profile)) if (key !== 'rank' && !PARAMS.includes(key)) problems.push(`${id}: unknown parameter ${key}`);
    if (id !== 'SUBSTITUTE' && !RANKS.includes(profile.rank)) problems.push(`${id}: rank must be one of ${RANKS.join(', ')}`);
    for (const key of PARAMS) {
      const value = profile[key];
      if (key === 'thinkSpeed' ? !(value > 0) : !(value >= 0 && value <= 1))
        problems.push(`${id}: ${key} must be ${key === 'thinkSpeed' ? 'above 0' : 'from 0 to 1'}`);
    }
  }
  return problems;
}

module.exports = { PROFILES, PARAMS, RANKS, BASE, LEVEL, profileFor, profileProblems };
