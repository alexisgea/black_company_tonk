'use strict';
// Turns a tournament ranking into the `rank` of each character in server/botprofiles.js and writes it there.
const fs = require('fs');
const path = require('path');
const { RANKS } = require('../server/botprofiles');

const PROFILES_FILE = path.join(__dirname, '..', 'server', 'botprofiles.js');

// `ids` are the characters from best to worst. They are cut into equal groups, the best group being the last of RANKS
// (expert) and the worst the first (rookie).
function rankOfEach(ids) {
  const out = {};
  ids.forEach((id, i) => {
    out[id] = RANKS[RANKS.length - 1 - Math.floor((i * RANKS.length) / ids.length)];
  });
  return out;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sets `rank: '...'` in the entry of every character in `ranks`, adding the line when an entry has none yet.
// Returns the ids whose rank changed.
function writeRanks(ranks, file = PROFILES_FILE) {
  let source = fs.readFileSync(file, 'utf8');
  const changed = [];
  for (const [id, rank] of Object.entries(ranks)) {
    const entry = new RegExp(`^(  (?:'${escapeRegExp(id)}'|${escapeRegExp(id)}): \\{\\r?\\n)((?:    .*\\r?\\n)*?)(  \\},?)`, 'm');
    const match = source.match(entry);
    if (!match) throw new Error(`No entry for "${id}" in ${file}`);
    const [whole, open, body, close] = match;
    const line = /^ {4}rank: '(\w+)',\r?$/m;
    const old = body.match(line)?.[1];
    if (old === rank) continue;
    const eol = open.endsWith('\r\n') ? '\r\n' : '\n';
    const newBody = old ? body.replace(line, `    rank: '${rank}',`) : `    rank: '${rank}',${eol}${body}`;
    source = source.replace(whole, open + newBody + close);
    changed.push(id);
  }
  if (changed.length) fs.writeFileSync(file, source);
  return changed;
}

module.exports = { rankOfEach, writeRanks };
