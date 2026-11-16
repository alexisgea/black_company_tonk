'use strict';
// Personality of each computer player. Edit the table below to tune a character.
//
// Every skill is a probability from 0 to 1 that the bot "gets it right" when that situation comes up (a skill of
// 0.8 means it misses it one time in five). Skills are rolled once per turn for the same situation, so a bot that
// misses something stays blind to it for that turn and gets another chance on the next one.
//
//   memory        remembers a discard from before the last full round (the last round is always remembered)
//   spotDiscard   notices that the top discard would help (a spread now, or a promising pair or run)
//   layoffOthers  notices that a card fits another player's spread (its own it rarely misses, see the ownMiss trait)
//   planAhead     does not throw away a card that is part of a promising pair or run
//   denyHelp      checks whether a discard helps the opponents (next player counts most)
//   goDownRisk    judges whether going down is safe; a low skill means gut feeling and wishful thinking
//   finishHand    sees a way to put down every card and win the hand, and chases it when close
//   danger        notices an opponent who is close to emptying their hand
//
// `speed` scales the thinking time (below 1 is quick, above 1 is slow). `tag` is how hard the character is meant to be.
// Profiles are keyed by the bot's id from botnames.js, not by its display name, so a bot can be renamed or translated.
//
// Besides skills a character has traits: habits, slips and moods that make it play like a person with a personality
// instead of a flat accuracy number. They are the same for every hand, except that the mood (see Room.updateMoods) moves
// boldness up and down during the game.
//
//   boldness      -1 to 1: how readily it goes down (a bold bot dares on a thinner edge, a timid one wants a sure thing)
//   thumbRate     0 to 1: how often it ignores the calculation and goes down by a fixed rule of thumb, at `thumbAt`...
//   thumbAt       ...this total or lower (a conservative bot: thumbRate 0.9, thumbAt 12)
//   dumpHigh      0 to 1: how often it just throws away its dearest card without thinking about the rest of the hand
//   panic         0 to 1: how often it panics when an opponent is nearly out and goes down with a middling hand
//   sloppiness    0 to 1: how much its discard choice is blurred, so it sometimes throws the second-best card
//   ownMiss       0 to 1: how often it overlooks that a card fits its own spread
//   blur          0 to 1: how often an old memory has the right rank but the wrong suit
//   moodiness     0 to 1: how much winning, losing and being behind on coins sways its boldness (0 = steady)
const { BOT_IDS } = require('./botnames');

const BASE_SKILL = 0.8;
const SKILL_KEYS = ['memory', 'spotDiscard', 'layoffOthers', 'planAhead', 'denyHelp', 'goDownRisk', 'finishHand', 'danger'];
const BASE = Object.fromEntries(SKILL_KEYS.map((key) => [key, BASE_SKILL]));
const TAGS = ['easy', 'normal', 'hard'];

// The allowed range of every trait, and the value of a plain character.
const TRAIT_RANGES = {
  boldness: [-1, 1],
  thumbRate: [0, 1],
  thumbAt: [0, 50],
  dumpHigh: [0, 1],
  panic: [0, 1],
  sloppiness: [0, 1],
  ownMiss: [0, 1],
  blur: [0, 1],
  moodiness: [0, 1],
};
const TRAIT_KEYS = Object.keys(TRAIT_RANGES);
const BASE_TRAITS = {
  boldness: 0,
  thumbRate: 0,
  thumbAt: 12,
  dumpHigh: 0,
  panic: 0.1,
  sloppiness: 0.25,
  ownMiss: 0.05,
  blur: 0.25,
  moodiness: 0.5,
};

// Croaker is written out in full: copy his entry as a template. The others override a few skills and traits like this:
// skills: { ...BASE, memory: 0.95 }, traits: { ...BASE_TRAITS, boldness: 0.5 }
const PROFILES = {
  croaker: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8, //       remembers discards older than the last full round
      spotDiscard: 0.8, //  notices that the top discard helps
      layoffOthers: 0.8, // notices that a card fits another player's spread
      planAhead: 0.8, //    keeps cards that are part of a promising pair or run
      denyHelp: 0.8, //     avoids discarding a card that helps the opponents
      goDownRisk: 0.8, //   calculates the risk of going down (low: gut feeling)
      finishHand: 0.8, //   finds a way to empty its hand, and chases it when close
      danger: 0.8, //       notices opponents about to empty their hand
    },
    traits: {
      boldness: 0, //       neither bold nor timid
      thumbRate: 0, //      always calculates, no fixed rule of thumb
      thumbAt: 12, //       (only matters when thumbRate is above 0)
      dumpHigh: 0, //       never just dumps its dearest card
      panic: 0.1, //        rarely panics when an opponent is nearly out
      sloppiness: 0.25, //  now and then throws a close second-best card
      ownMiss: 0.05, //     one time in twenty overlooks a card for its own spread
      blur: 0.25, //        a quarter of old memories get the suit wrong
      moodiness: 0.5, //    moderately swayed by how the game is going
    },
  },
  // Reckless: dares on thin edges, panics, takes it badly when behind. Easy to bluff into trouble.
  goblin: {
    tag: 'easy',
    speed: 0.8,
    skills: { ...BASE, goDownRisk: 0.6, danger: 0.6, planAhead: 0.7 },
    traits: { ...BASE_TRAITS, boldness: 0.8, thumbRate: 0.3, thumbAt: 15, panic: 0.5, sloppiness: 0.5, moodiness: 0.9 },
  },
  // Sharp and watchful: remembers everything, slow to move, rarely slips.
  'one-eye': {
    tag: 'hard',
    speed: 1.3,
    skills: { ...BASE, memory: 0.95, spotDiscard: 0.9, layoffOthers: 0.95, denyHelp: 0.9 },
    traits: { ...BASE_TRAITS, boldness: -0.1, panic: 0, sloppiness: 0.1, ownMiss: 0.02, blur: 0.05, moodiness: 0.3 },
  },
  // Scatterbrained and cheerful: misses things, forgets things, goes along with its feelings.
  elmo: {
    tag: 'easy',
    speed: 0.9,
    skills: { ...BASE, memory: 0.6, spotDiscard: 0.6, layoffOthers: 0.6, planAhead: 0.6 },
    traits: { ...BASE_TRAITS, boldness: 0.2, sloppiness: 0.7, ownMiss: 0.15, blur: 0.4 },
  },
  // Calm and unreadable: quick, steady, never panics, hardly moved by wins or losses.
  silent: {
    tag: 'hard',
    speed: 0.7,
    skills: { ...BASE, goDownRisk: 0.95, danger: 0.9, finishHand: 0.9 },
    traits: { ...BASE_TRAITS, panic: 0, sloppiness: 0.1, moodiness: 0.1 },
  },
  // By the book: always goes down at 12 or lower, dumps the high cards, plays timid and steady.
  lieutenant: {
    tag: 'normal',
    speed: 1.1,
    skills: { ...BASE, planAhead: 0.7, denyHelp: 0.7 },
    traits: { ...BASE_TRAITS, boldness: -0.4, thumbRate: 0.9, thumbAt: 12, dumpHigh: 0.7, sloppiness: 0.15, moodiness: 0.2 },
  },
  // Always keeps its pairs and chases a finish; does not care what it hands the others.
  otto: {
    tag: 'normal',
    speed: 1.2,
    skills: { ...BASE, planAhead: 1, finishHand: 0.9, denyHelp: 0.5 },
    traits: { ...BASE_TRAITS, boldness: -0.1, sloppiness: 0.1 },
  },
  // Grumpy: wary of danger, timid, and sulks for a long time after a bad hand.
  hagop: {
    tag: 'normal',
    speed: 1.2,
    skills: { ...BASE, danger: 0.9, goDownRisk: 0.7 },
    traits: { ...BASE_TRAITS, boldness: -0.3, moodiness: 0.9 },
  },
  // Graceful and strong all round, with few slips.
  'willow-swan': {
    tag: 'hard',
    speed: 1,
    skills: Object.fromEntries(SKILL_KEYS.map((key) => [key, 0.9])),
    traits: { ...BASE_TRAITS, boldness: 0.1, panic: 0.05, sloppiness: 0.1, ownMiss: 0.02, blur: 0.1 },
  },
  // Sneaky opportunist: spots every chance and every card the others need, a little bold.
  slink: {
    tag: 'normal',
    speed: 0.8,
    skills: { ...BASE, spotDiscard: 0.9, layoffOthers: 0.95, denyHelp: 0.9, planAhead: 0.6 },
    traits: { ...BASE_TRAITS, boldness: 0.3 },
  },
  // Methodical: slow, works the odds out and rarely goes by feel.
  gupta: {
    tag: 'hard',
    speed: 1.4,
    skills: { ...BASE, goDownRisk: 0.95, memory: 0.9, finishHand: 0.7, spotDiscard: 0.7 },
    traits: { ...BASE_TRAITS, panic: 0.05, sloppiness: 0.1, moodiness: 0.2 },
  },
  // Dreamy and slow: loses track of the game.
  puddle: {
    tag: 'easy',
    speed: 1.8,
    skills: { ...BASE, memory: 0.5, danger: 0.5, layoffOthers: 0.6 },
    traits: { ...BASE_TRAITS, boldness: 0.1, sloppiness: 0.6, blur: 0.5 },
  },
  // Eager beginner: fast, bold, panics, and falls back on a rule of thumb.
  corey: {
    tag: 'easy',
    speed: 0.7,
    skills: Object.fromEntries(SKILL_KEYS.map((key) => [key, 0.65])),
    traits: { ...BASE_TRAITS, boldness: 0.5, thumbRate: 0.5, thumbAt: 15, panic: 0.4, sloppiness: 0.5, ownMiss: 0.15 },
  },
  // Impatient gambler: plays fast and loose, goes down by feel.
  buzz: {
    tag: 'normal',
    speed: 0.5,
    skills: { ...BASE, goDownRisk: 0.65 },
    traits: { ...BASE_TRAITS, boldness: 0.6, thumbRate: 0.4, thumbAt: 14, panic: 0.3, sloppiness: 0.5, moodiness: 0.7 },
  },
  // Steady veteran: remembers, careful with what it hands over, goes down at 12 half the time, dumps high cards now and then.
  murgen: {
    tag: 'normal',
    speed: 1.2,
    skills: { ...BASE, memory: 0.9, danger: 0.9, denyHelp: 0.85 },
    traits: { ...BASE_TRAITS, boldness: -0.2, thumbRate: 0.5, thumbAt: 12, dumpHigh: 0.4, moodiness: 0.3 },
  },
  // Forgetful and slow: nods off.
  sleepy: {
    tag: 'easy',
    speed: 1.8,
    skills: { ...BASE, memory: 0.4, danger: 0.5, spotDiscard: 0.6 },
    traits: { ...BASE_TRAITS, sloppiness: 0.5, blur: 0.6 },
  },
  // Watches the others: knows what they hold and does not give them what they need.
  raven: {
    tag: 'hard',
    speed: 0.9,
    skills: { ...BASE, denyHelp: 0.95, layoffOthers: 0.9, memory: 0.9, planAhead: 0.7 },
    traits: { ...BASE_TRAITS, blur: 0.1 },
  },
  // Chases the big win: goes for an empty hand, takes risks to get it.
  case: {
    tag: 'normal',
    speed: 1,
    skills: { ...BASE, finishHand: 0.95, goDownRisk: 0.7 },
    traits: { ...BASE_TRAITS, boldness: 0.4 },
  },
};

// Plays for a human who is away or disconnected (they have no character of their own).
const SUBSTITUTE = { tag: 'normal', speed: 1, skills: { ...BASE }, traits: { ...BASE_TRAITS } };

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// The profile for a seat. `difficulty` scales every skill of every bot by the same factor, so the gaps between
// characters stay (1 = as written; the table does not expose it yet). Traits are a personality and do not scale.
function profileFor(player, difficulty = 1) {
  const profile = player.isBot ? (PROFILES[player.botId] ?? SUBSTITUTE) : SUBSTITUTE;
  const skills = {};
  for (const key of SKILL_KEYS) skills[key] = clamp01((profile.skills[key] ?? BASE_SKILL) * difficulty);
  const traits = {};
  for (const key of TRAIT_KEYS) traits[key] = profile.traits[key] ?? BASE_TRAITS[key];
  return { tag: profile.tag, speed: profile.speed, skills, traits };
}

// Problems in the table above (empty when it is fine); a test keeps it honest after manual edits.
function profileProblems() {
  const problems = [];
  for (const id of BOT_IDS) if (!PROFILES[id]) problems.push(`${id} has no profile`);
  for (const [id, profile] of Object.entries({ ...PROFILES, SUBSTITUTE })) {
    if (id !== 'SUBSTITUTE' && !BOT_IDS.includes(id)) problems.push(`${id} is not a bot id`);
    if (!TAGS.includes(profile.tag)) problems.push(`${id}: unknown tag ${profile.tag}`);
    if (!(profile.speed > 0)) problems.push(`${id}: speed must be above 0`);
    for (const key of Object.keys(profile.skills)) if (!SKILL_KEYS.includes(key)) problems.push(`${id}: unknown skill ${key}`);
    for (const key of SKILL_KEYS) {
      const value = profile.skills[key];
      if (!(value >= 0 && value <= 1)) problems.push(`${id}: ${key} must be from 0 to 1`);
    }
    for (const key of Object.keys(profile.traits)) if (!TRAIT_KEYS.includes(key)) problems.push(`${id}: unknown trait ${key}`);
    for (const key of TRAIT_KEYS) {
      const [low, high] = TRAIT_RANGES[key];
      const value = profile.traits[key];
      if (!(value >= low && value <= high)) problems.push(`${id}: ${key} must be from ${low} to ${high}`);
    }
  }
  return problems;
}

module.exports = { PROFILES, SKILL_KEYS, BASE, TRAIT_KEYS, BASE_TRAITS, profileFor, profileProblems };
