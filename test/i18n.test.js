'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'public', 'locales');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const localeFiles = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const locales = Object.fromEntries(localeFiles.map((f) => [f.replace(/\.json$/, ''), JSON.parse(read('public', 'locales', f))]));
const en = locales.en;

// The client file is an ES module but the package is CommonJS, so load it from its source text.
const loadCore = () => import('data:text/javascript;base64,' + Buffer.from(read('public', 'js', 'i18n-core.js')).toString('base64'));

const PLURAL = /\.(zero|one|two|few|many|other)$/;
const baseKey = (key) => key.replace(PLURAL, '');
const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const hasKey = (key) => key in en || `${key}.other` in en;

test('format fills placeholders and leaves unknown ones visible', async () => {
  const { format } = await loadCore();
  assert.equal(format('{a} and {b}', { a: 1 }), '1 and {b}');
  assert.equal(format('no params'), 'no params');
});

test('pickLocale prefers the saved choice, then the browser languages, then English', async () => {
  const { pickLocale } = await loadCore();
  const supported = ['en', 'fr'];
  assert.equal(pickLocale(supported, 'fr', ['en']), 'fr');
  assert.equal(pickLocale(supported, null, ['de-DE', 'fr-CA', 'en']), 'fr');
  assert.equal(pickLocale(supported, 'xx', ['de']), 'en');
  assert.equal(pickLocale(['en'], null, []), 'en');
});

test('the translator picks plural forms, falls back to English and fills nodes', async () => {
  const { createTranslator } = await loadCore();
  const english = { 'a.one': '{count} card', 'a.other': '{count} cards', only: 'English only', list: ['x', 'y'], who: '{name}:' };
  const french = { 'a.one': '{count} carte', 'a.other': '{count} cartes' };
  const { t, tNodes, tList } = createTranslator('fr', french, english);
  assert.equal(t('a', { count: 1 }), '1 carte');
  assert.equal(t('a', { count: 3 }), '3 cartes');
  assert.equal(t('only'), 'English only');
  assert.equal(t('missing'), 'missing');
  assert.equal(t('missing', undefined, 'server text'), 'server text');
  assert.deepEqual(tList('list'), ['x', 'y']);
  const node = { tag: 'strong' };
  assert.deepEqual(tNodes('who', { name: node }), [node, ':']);
});

test('every locale file is listed in SUPPORTED and the other way round', () => {
  const listed = /SUPPORTED = \[([^\]]*)\]/.exec(read('public', 'js', 'i18n.js'))[1].match(/'([\w-]+)'/g);
  assert.deepEqual(listed.map((s) => s.slice(1, -1)).sort(), Object.keys(locales).sort());
});

test('every locale has the same messages as English, with the same placeholders', () => {
  const reference = new Map(Object.keys(en).map((k) => [baseKey(k), k]));
  for (const [code, messages] of Object.entries(locales)) {
    const keys = new Set(Object.keys(messages).map(baseKey));
    for (const key of reference.keys()) assert.ok(keys.has(key), `${code} is missing "${key}"`);
    for (const key of keys) assert.ok(reference.has(key), `${code} has "${key}" which English does not`);
    for (const [key, value] of Object.entries(messages)) {
      const source = en[key] ?? en[`${baseKey(key)}.other`];
      assert.equal(Array.isArray(value), Array.isArray(source), `${code} "${key}" must be a ${Array.isArray(source) ? 'list' : 'string'}`);
      if (Array.isArray(value)) assert.equal(value.length, source.length, `${code} "${key}" must have ${source.length} items`);
      else assert.deepEqual(placeholders(value), placeholders(source), `${code} "${key}" must use the same {placeholders}`);
    }
  }
});

test('every message key the client code uses exists in English', () => {
  const namespaces = [...new Set(Object.keys(en).map((k) => k.split('.')[0]))];
  const literal = new RegExp(`'((?:${namespaces.join('|')})\\.[\\w.-]+)'`, 'g');
  for (const file of fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js'))) {
    for (const [, key] of read('public', 'js', file).matchAll(literal))
      assert.ok(hasKey(key), `${file} uses "${key}", missing from en.json`);
  }
  // Keys the client builds from a list or a name.
  const sections = /SECTIONS = \[([^\]]*)\]/.exec(read('public', 'js', 'rules-dialog.js'))[1].match(/'(\w+)'/g);
  for (const s of sections.map((q) => q.slice(1, -1)))
    assert.ok(`rules.${s}.title` in en && `rules.${s}.items` in en, `rules section ${s}`);
  const { SETTING_LIMITS } = require('../server/room');
  for (const key of Object.keys(SETTING_LIMITS))
    assert.ok(`tableRules.${key}.label` in en && `tableRules.${key}.hint` in en, `setting ${key}`);
  const { BOT_IDS, BOT_TAGS } = require('../server/botnames');
  for (const id of BOT_IDS) assert.ok(`bot.${id}` in en && `bot.${id}.bio` in en, `bot ${id}`);
  for (const tag of Object.values(BOT_TAGS)) assert.ok(tag === null || `tag.${tag}` in en, `tag ${tag}`);
  for (const id of BOT_IDS) assert.ok(id in BOT_TAGS, `${id} needs a tag (or null) in BOT_TAGS`);
  const { RANKS } = require('../server/botprofiles');
  for (const rank of RANKS) assert.ok(`rank.${rank}` in en, `rank ${rank}`);
  const { DYNAMIC_LINES } = require('../server/room');
  for (let i = 0; i < DYNAMIC_LINES; i++) assert.ok(`log.dynJoin.${i}` in en && `log.dynLeave.${i}` in en, `dynamic table line ${i}`);
  assert.ok('tableRules.dynamicTable.label' in en && 'tableRules.dynamicTable.hint' in en);
  const { BANTER_TONE, TONES, SITUATIONS } = require('../server/botbanter');
  for (const id of BOT_IDS) assert.ok(id in BANTER_TONE, `${id} needs a tone (or null) in BANTER_TONE`);
  for (const tone of Object.values(BANTER_TONE)) assert.ok(tone === null || TONES.includes(tone), `unknown tone ${tone}`);
  const { EMOTES } = require('../server/emotes');
  for (const id of EMOTES) {
    assert.ok(`emote.${id}` in en, `emote ${id}`);
    assert.ok(`emoteButton.${id}` in en, `button label for ${id}`);
    assert.match(en[`emoteButton.${id}`], /^\S+$/, `"${id}" button label must be a single word`);
    assert.notEqual(en[`emoteButton.${id}`], en[`emote.${id}`], `"${id}" button and spoken text must differ`);
  }
  for (const tone of TONES)
    for (const situation of SITUATIONS) {
      const key = `banter.${tone}.${situation}`;
      assert.ok(Array.isArray(en[key]) && en[key].length >= 3, `${key} needs a few lines`);
      for (const line of en[key]) assert.ok(Array.from(line).length <= 80, `"${line}" is too long for a speech bubble`);
    }
});

test('every error and notice code the server can send has an English message', () => {
  const used = { err: new Set(), notice: new Set() };
  const patterns = [
    [/GameError\(\s*'(\w+)'/g, 'err'],
    [/sendError\(\s*\w+,\s*'(\w+)'/g, 'err'],
    [/requireHost\(\s*[\w, ]+?,\s*'(\w+)'/g, 'err'],
    [/'(hostOnly\w+)'/g, 'err'],
    [/'(tableLocked|wrongPassword)'/g, 'err'],
    [/closeRoom\(\s*\w+,\s*'(\w+)'/g, 'notice'],
    [/describe\(\s*'notice',\s*'(\w+)'/g, 'notice'],
    [/describe\(\s*'err',\s*'(\w+)'/g, 'err'],
  ];
  for (const file of fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js'))) {
    const source = read('server', file);
    for (const [pattern, kind] of patterns) for (const [, code] of source.matchAll(pattern)) used[kind].add(code);
  }
  assert.ok(used.err.size > 40 && used.notice.size >= 5, 'the scan should find the codes');
  for (const code of used.err) assert.ok(`err.${code}` in en, `err.${code} is missing from en.json`);
  for (const code of used.notice) assert.ok(`notice.${code}` in en, `notice.${code} is missing from en.json`);
});
