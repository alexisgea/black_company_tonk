'use strict';
// The quick lines a player can say with one click. The wording is in the locale files under "emote.<id>"; this is the
// list of ids, in the order the picker shows them (greetings, the game, luck, mood, goodbyes).
const EMOTES = [
  'hello',
  'yourMove',
  'thinking',
  'oops',
  'wellPlayed',
  'goodLuck',
  'badLuck',
  'surprise',
  'hehe',
  'winning',
  'losing',
  'goodGame',
  'bye',
];

// One emote per player in this many milliseconds. The server enforces it and tells the clients (see `welcome`), who
// grey the buttons out meanwhile.
const EMOTE_COOLDOWN_MS = 4000;

module.exports = { EMOTES, EMOTE_COOLDOWN_MS };
