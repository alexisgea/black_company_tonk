'use strict';
// The odd remark a computer player makes at the table. The lines are in the locale files, as lists under
// "banter.<tone>.<situation>"; this file decides who speaks, how, and when.
//
// A bot's tone is how it sounds: grumbling, jovial, sly, nervous or cold. The situation is how its luck is going,
// from the confidence the room keeps for it (see Room.updateMoods): ahead, behind, or neither ("turn"). A bot with no
// tone never says anything (Silent). When personality traits come, they can replace the table below.
const { lines } = require('./i18n');

const TONES = ['grumbling', 'jovial', 'sly', 'nervous', 'cold'];
const SITUATIONS = ['turn', 'ahead', 'behind'];

const BANTER_TONE = {
  'the-lady': 'cold',
  croaker: 'grumbling',
  silent: null,
  otto: 'jovial',
  bomanz: 'cold',
  'willow-swan': 'sly',
  goblin: 'sly',
  hagop: 'grumbling',
  case: 'nervous',
  'one-eye': 'sly',
  'the-lieutenant': 'jovial',
  cordy: 'nervous',
};

// The chance that a bot says something at the end of one of its turns (at most one line per turn).
const BANTER_CHANCE = 0.2;
// How far its confidence has to be from zero before it talks about winning or losing instead of the game at hand.
const MOOD_EDGE = 0.25;

const situationFor = (confidence) => (confidence >= MOOD_EDGE ? 'ahead' : confidence <= -MOOD_EDGE ? 'behind' : 'turn');

// What a bot says at the end of its turn, or null when it keeps quiet. `last` is the `id` of what it said before, so it
// does not say the same thing twice in a row. The result carries the `tone`, `situation` and `line` (the index into the
// list) that clients use to word it in their own language, and the English `text`.
function pickBanter(botId, confidence, rng = Math.random, last = null) {
  const tone = BANTER_TONE[botId];
  if (!tone || rng() >= BANTER_CHANCE) return null;
  const situation = situationFor(confidence);
  const pool = lines(`banter.${tone}.${situation}`);
  const choices = pool.map((_, i) => i).filter((i) => `${tone}.${situation}.${i}` !== last);
  if (!choices.length) return null;
  const line = choices[Math.floor(rng() * choices.length)];
  return { tone, situation, line, text: pool[line], id: `${tone}.${situation}.${line}` };
}

module.exports = { BANTER_TONE, BANTER_CHANCE, TONES, SITUATIONS, pickBanter };
