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
//   finishHand    sees a way to put down every card and win the hand, and chases it when close
//   danger        notices an opponent who is close to emptying their hand
//
// `speed` scales the thinking time (below 1 is quick, above 1 is slow). `tag` is how hard the character is meant to be.
const { BOT_NAMES } = require('./botnames');

const BASE_SKILL = 0.8;
const SKILL_KEYS = ['memory', 'spotDiscard', 'layoffOthers', 'planAhead', 'denyHelp', 'goDownRisk', 'finishHand', 'danger'];
const BASE = Object.fromEntries(SKILL_KEYS.map((key) => [key, BASE_SKILL]));
const TAGS = ['easy', 'normal', 'hard'];

// Croaker is written out in full: copy his entry as a template. The others use the base skills (all 0.8) until they
// are written out the same way. Override single skills like this: skills: { ...BASE, memory: 0.95 }
const PROFILES = {
  Croaker: {
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
  },
  Goblin: { tag: 'normal', speed: 1, skills: { ...BASE } },
  'One-Eye': { tag: 'normal', speed: 1, skills: { ...BASE } },
  Elmo: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Silent: { tag: 'normal', speed: 1, skills: { ...BASE } },
  'The Lieutenant': { tag: 'normal', speed: 1, skills: { ...BASE } },
  Otto: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Hagop: { tag: 'normal', speed: 1, skills: { ...BASE } },
  'Willow Swan': { tag: 'normal', speed: 1, skills: { ...BASE } },
  Slink: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Gupta: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Puddle: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Corey: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Buzz: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Murgen: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Sleepy: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Raven: { tag: 'normal', speed: 1, skills: { ...BASE } },
  Case: { tag: 'normal', speed: 1, skills: { ...BASE } },
};

// Plays for a human who is away or disconnected (they have no character of their own).
const SUBSTITUTE = { tag: 'normal', speed: 1, skills: { ...BASE } };

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

module.exports = { PROFILES, SKILL_KEYS, BASE, profileFor, profileProblems };
