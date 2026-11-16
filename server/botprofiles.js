'use strict';
// Personality of each computer player. Edit the table below to tune a character.
//
// Every skill is a probability from 0 to 1 that the bot "gets it right" when that situation comes up (a skill of
// 0.8 means it misses it one time in five). Skills are rolled once per turn for the same situation, so a bot that
// misses something stays blind to it for that turn and gets another chance on the next one.
//
//   memory        remembers a discard from before the last full round (the last round is always remembered)
//   spotDiscard   notices that the top discard would help (a spread now, or a promising pair or run)
//   layoffOthers  notices that a card fits another player's spread (it never misses its own)
//   planAhead     does not throw away a card that is part of a promising pair or run
//   denyHelp      checks whether a discard helps the opponents (next player counts most)
//   goDownRisk    judges whether going down is safe; a low skill means gut feeling and wishful thinking
//   finishHand    sees a way to put down every card and win the hand
//   danger        notices an opponent who is close to emptying their hand
//
// `speed` scales the thinking time (below 1 is quick, above 1 is slow). `tag` is how hard the character is meant to be.
const { BOT_NAMES } = require('./botnames');

const BASE_SKILL = 0.8; // used only for a skill that is missing from a profile
const SKILL_KEYS = ['memory', 'spotDiscard', 'layoffOthers', 'planAhead', 'denyHelp', 'goDownRisk', 'finishHand', 'danger'];
const TAGS = ['easy', 'normal', 'hard'];

// TEMPLATE: copy this block to start a new character (or just edit the values of an existing one below).
// Every skill is a probability from 0 (never) to 1 (always).
//
//   tag:   easy | normal | hard (a label only, the skills decide how well it plays)
//   speed: thinking time factor, 0.5 = twice as fast as usual, 2 = twice as slow
//   {
//     tag: 'normal',
//     speed: 1,
//     skills: {
//       memory: 0.8, //       remembers discards older than the last full round
//       spotDiscard: 0.8, //  notices that the top discard helps
//       layoffOthers: 0.8, // notices that a card fits another player's spread
//       planAhead: 0.8, //    keeps cards that are part of a promising pair or run
//       denyHelp: 0.8, //     avoids discarding a card that helps the opponents
//       goDownRisk: 0.8, //   calculates the risk of going down (low: gut feeling)
//       finishHand: 0.8, //   finds a way to empty its hand, and chases it when close
//       danger: 0.8, //       notices opponents about to empty their hand
//     },
//   }
const PROFILES = {
  Croaker: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Goblin: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  'One-Eye': {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Elmo: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Silent: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  'The Lieutenant': {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Otto: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Hagop: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  'Willow Swan': {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Slink: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Gupta: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Puddle: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Corey: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Buzz: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Murgen: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Sleepy: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Raven: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
  Case: {
    tag: 'normal',
    speed: 1,
    skills: {
      memory: 0.8,
      spotDiscard: 0.8,
      layoffOthers: 0.8,
      planAhead: 0.8,
      denyHelp: 0.8,
      goDownRisk: 0.8,
      finishHand: 0.8,
      danger: 0.8,
    },
  },
};

// Plays for a human who is away or disconnected (they have no character of their own).
const SUBSTITUTE = {
  tag: 'normal',
  speed: 1,
  skills: {
    memory: 0.8,
    spotDiscard: 0.8,
    layoffOthers: 0.8,
    planAhead: 0.8,
    denyHelp: 0.8,
    goDownRisk: 0.8,
    finishHand: 0.8,
    danger: 0.8,
  },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// The profile for a seat. `difficulty` scales every skill of every bot by the same factor, so the gaps between
// characters stay (1 = as written; the table does not expose it yet).
function profileFor(player, difficulty = 1) {
  const profile = player.isBot ? (PROFILES[player.name] ?? SUBSTITUTE) : SUBSTITUTE;
  const skills = {};
  for (const key of SKILL_KEYS) skills[key] = clamp01((profile.skills[key] ?? BASE_SKILL) * difficulty);
  return { tag: profile.tag, speed: profile.speed, skills };
}

// Problems in the table above (empty when it is fine); a test keeps it honest after manual edits.
function profileProblems() {
  const problems = [];
  for (const name of BOT_NAMES) if (!PROFILES[name]) problems.push(`${name} has no profile`);
  for (const [name, profile] of Object.entries({ ...PROFILES, SUBSTITUTE })) {
    if (name !== 'SUBSTITUTE' && !BOT_NAMES.includes(name)) problems.push(`${name} is not a bot name`);
    if (!TAGS.includes(profile.tag)) problems.push(`${name}: unknown tag ${profile.tag}`);
    if (!(profile.speed > 0)) problems.push(`${name}: speed must be above 0`);
    for (const key of Object.keys(profile.skills)) if (!SKILL_KEYS.includes(key)) problems.push(`${name}: unknown skill ${key}`);
    for (const key of SKILL_KEYS) {
      const value = profile.skills[key];
      if (!(value >= 0 && value <= 1)) problems.push(`${name}: ${key} must be from 0 to 1`);
    }
  }
  return problems;
}

module.exports = { PROFILES, SKILL_KEYS, profileFor, profileProblems };
