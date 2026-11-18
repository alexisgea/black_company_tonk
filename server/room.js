'use strict';
const crypto = require('crypto');
const tonk = require('./tonk');
const { pickBot, BOTS } = require('./botnames');
const { Mind } = require('./botmind');
const { smartThink } = require('./botsmart');
const { profileFor } = require('./botprofiles');
const { pickBanter } = require('./botbanter');
const T = require('./bottuning');

// Fields of each log event that every viewer (including guests) may see. Anything else is dropped,
// so a hidden card can never leak through the log. A draw from the pile deliberately has no card.
const PUBLIC_LOG_FIELDS = {
  join: ['pid', 'name', 'botId'],
  leave: ['pid', 'name', 'botId'],
  kick: ['pid', 'name'],
  takeover: ['pid', 'name', 'botId', 'botName'], // botId and botName are the bot whose seat was taken
  deal: ['pid', 'name', 'botId', 'hand'],
  draw: ['pid'],
  takeDiscard: ['pid', 'card'],
  discard: ['pid', 'card'],
  meld: ['pid', 'kind', 'cards'],
  layoff: ['pid', 'card', 'meldId'],
  goDown: ['pid', 'total'],
  broke: ['pid', 'name', 'botId', 'bot'],
  dynLeave: ['pid', 'name', 'botId', 'variant'], // a bot left a dynamic table; `variant` picks one of the in-lore lines
  dynJoin: ['pid', 'name', 'botId', 'variant'],
  timeout: ['pid', 'name'], // took too long: a bot plays their turns until they come back
  back: ['pid', 'name'],
  pause: ['pid', 'name'],
  unpause: ['pid', 'name'],
  restart: ['pid', 'name'],
  reshuffle: [],
};
// What the host can change in the waiting room. `bet` is what one payoff unit is worth in coins
// (a plain win is 1 bet, a Tonk, emptying your hand or a failed go-down is 2). `dynamicTable` makes bots come and go
// during play. The labels are in the locale files.
const DEFAULT_SETTINGS = { startingCoins: 50, bet: 5, dynamicTable: false };
// Dynamic table: the chance that after a hand one bot gets tired of the table and a new one takes its seat, and how
// many in-lore lines there are for it ("log.dynLeave.<n>" and "log.dynJoin.<n>" in the locale files).
const DYNAMIC_LEAVE_CHANCE = 0.15;
const DYNAMIC_LINES = 4;
const SETTING_LIMITS = {
  startingCoins: { min: 10, max: 10000, error: 'startingCoinsRange' },
  bet: { min: 1, max: 1000, error: 'betRange' },
};
// A turn ends with a discard (or going down, which ends the hand).
const TURN_END_EVENTS = new Set(['discard', 'goDown']);
const MAX_LOG = 200; // hard cap for the waiting room, where there are no hands to trim by
const MAX_CHAT = 50;
const MAX_CHAT_LENGTH = 200;
const MAX_SPECTATORS = 20;
const DEFAULT_TONK_TIMEOUT_MS = 15000;
const ORDINALS = ['Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const MAX_PASSWORD = 32;
const RANDOM_SEAT = { id: 'random', name: 'Random' }; // stands in for a bot until the table starts
const nameKey = (name) => name.normalize('NFKC').toLowerCase();
const digest = (text) => crypto.createHash('sha256').update(text).digest();
// Who a log event is about. A bot also carries its id, so each client can show its name in the player's language.
const whoIs = (user) => (user.botId ? { pid: user.id, name: user.name, botId: user.botId } : { pid: user.id, name: user.name });
const settingLimitsView = () => Object.fromEntries(Object.entries(SETTING_LIMITS).map(([key, { min, max }]) => [key, { min, max }]));

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// Checks table settings from a client. Unknown fields are ignored; anything invalid is an error.
function validateSettings(raw) {
  if (!raw || typeof raw !== 'object') throw new tonk.GameError('badSettings');
  const settings = {};
  for (const [key, { min, max, error }] of Object.entries(SETTING_LIMITS)) {
    const value = raw[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new tonk.GameError(error, { min, max });
    settings[key] = value;
  }
  if (settings.bet > settings.startingCoins) throw new tonk.GameError('betTooHigh');
  if (raw.dynamicTable !== undefined && typeof raw.dynamicTable !== 'boolean') throw new tonk.GameError('badSettings');
  settings.dynamicTable = raw.dynamicTable === true;
  return settings;
}

// An empty (or missing) password means the table is open.
function validatePassword(raw) {
  const password = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, '').trim() : '';
  if (password.length > MAX_PASSWORD) throw new tonk.GameError('passwordTooLong', { max: MAX_PASSWORD });
  return password || null;
}

// One table of players: seating, coins and the current hand.
class Room {
  constructor(
    id,
    name,
    rng = Math.random,
    { tonkTimeoutMs = DEFAULT_TONK_TIMEOUT_MS, turnWarningMs = null, settings = DEFAULT_SETTINGS, owner = null } = {},
  ) {
    this.id = id;
    this.name = name;
    this.owner = owner; // who made the table, so each client can word its default name ("X's table") in its own language
    this.rng = rng;
    this.settings = { ...settings };
    this.tonkTimeoutMs = tonkTimeoutMs; // how long a player has to press TONK! before it is done for them
    this.turnWarningMs = turnWarningMs; // the turn countdown is only shown to the player for this long at the end of the turn
    this.tonkDeadline = null; // epoch ms, only while a hand waits for TONK!
    this.paused = false; // the host stopped the game: no moves, no bots, no turn or TONK! timers
    this.tonkLeftMs = null; // time left on the TONK! timer when the game was paused
    this.turnResume = null; // { key, ms }: time left on the turn timer when the game was paused
    this.players = []; // users, in seating order
    this.spectators = []; // guests who only watch and chat; they never see hidden cards
    this.hostId = null;
    this.password = null; // when set, newcomers (players and guests) must give it to sit down or watch
    this.status = 'waiting'; // 'waiting' (never dealt) | 'playing' | 'between' (hand finished)
    this.round = null;
    this.minds = new Map(); // player id -> what that seat's computer player remembers of the hand (see botmind.js)
    this.moods = new Map(); // bot id -> { confidence } how its last hands went; carries over between hands (see updateMoods)
    this.lastBanter = new Map(); // bot id -> what it last said, so it does not repeat itself (see banter)
    this.handNo = 0;
    this.dealerIdx = 0;
    this.coins = {}; // player id -> coins left
    this.newlyBroke = [];
    this.restartIds = new Set(); // humans who may restart the table after the last human player lost their last coin
    this.restartDeadline = null; // epoch ms when that table closes if nobody restarts it
    this.log = [];
    this.logSeq = 0; // lets clients tell which events are new
    this.chat = [];
    this.chatSeq = 1;
    this.bannedIds = new Set(); // players the host removed; they cannot rejoin this game
    this.bannedDevices = new Set(); // the browsers they used, so a new tab or a cleared session does not undo the ban
    this.turnKey = null; // which turn the turn timer (kept by the lobby) is counting for
    this.turnDeadline = null; // epoch ms when a bot takes over the current human turn, if a timer is running
    this.lastActivity = Date.now(); // last time a human did anything here (drives the idle timeout)
    this.idleWarned = false;
  }

  touch(now = Date.now()) {
    this.lastActivity = now;
    this.idleWarned = false;
  }

  get joinable() {
    return this.status !== 'playing' && this.players.length < tonk.MAX_PLAYERS;
  }

  get humans() {
    return this.players.filter((p) => !p.isBot);
  }

  // Everyone with a connection to this table: human players and spectators.
  get audience() {
    return [...this.humans, ...this.spectators];
  }

  get watchable() {
    return this.spectators.length < MAX_SPECTATORS;
  }

  get locked() {
    return this.password !== null;
  }

  // Throws unless the table is open or `given` is its password. The client answers these two codes with a password prompt.
  checkPassword(given) {
    if (!this.locked) return;
    if (typeof given !== 'string' || given === '') throw new tonk.GameError('tableLocked');
    if (!crypto.timingSafeEqual(digest(given), digest(this.password))) throw new tonk.GameError('wrongPassword');
  }

  // The host locks the table with a password, or opens it again with an empty one. People already seated are not affected.
  setPassword(user, raw) {
    this.requirePlayer(user);
    this.password = validatePassword(raw);
  }

  requirePlayer(user) {
    if (!this.players.includes(user)) throw new tonk.GameError('spectatorsCannot');
  }

  // Adds a computer player: the character `wanted` (a bot id) or, without one, a random character that is not at the
  // table (nor in `avoid`). It has no connection; the lobby plays its turns. `entrance` is the log event for its arrival.
  addBot(wanted = null, { avoid = [], entrance = { type: 'join' }, random = false } = {}) {
    const taken = new Set(this.players.map((p) => p.botId));
    let pick;
    if (random) {
      pick = RANDOM_SEAT;
    } else if (wanted === null || wanted === undefined) {
      pick = pickBot(new Set([...taken, ...avoid]), this.rng);
    } else {
      pick = typeof wanted === 'string' ? BOTS.find((b) => b.id === wanted) : null;
      if (!pick) throw new tonk.GameError('unknownBot');
      if (taken.has(wanted)) throw new tonk.GameError('botAtTable');
    }
    const bot = {
      id: crypto.randomBytes(4).toString('hex'), // the seat's id at this table; botId says which character it is
      botId: pick.id,
      name: pick.name,
      isBot: true,
      conn: null,
      room: null,
    };
    if (random) bot.randomPick = true;
    this.join(bot, entrance);
    return bot;
  }

  // The host's "Random" pick. Before the first hand it only reserves a seat (shown as "Random") and the character is
  // chosen when the table starts (see resolveRandomBots), so the host cannot reroll by clearing and clicking again.
  addRandomBot() {
    if (this.status !== 'waiting') return this.addBot();
    return this.addBot(null, { random: true });
  }

  // Turns every reserved random seat into a real character that is not at the table.
  resolveRandomBots() {
    for (const bot of this.players.filter((p) => p.randomPick)) {
      const pick = pickBot(new Set(this.players.map((p) => p.botId)), this.rng);
      bot.botId = pick.id;
      bot.name = pick.name;
      delete bot.randomPick;
    }
  }

  // Dynamic table: bots that lost every coin are replaced, and now and then a bot gets tired of the table and leaves
  // too. Newcomers are new faces, so the table never fills with the same bots coming back.
  rotateBots(brokeBots) {
    const avoid = brokeBots.map((b) => b.botId);
    let arrivals = brokeBots.length;
    const bots = this.players.filter((p) => p.isBot);
    if (this.humans.length > 0 && bots.length > 0 && this.rng() < DYNAMIC_LEAVE_CHANCE) {
      const leaving = bots[Math.floor(this.rng() * bots.length)];
      this.leave(leaving, 'dynLeave', { variant: Math.floor(this.rng() * DYNAMIC_LINES) });
      avoid.push(leaving.botId);
      arrivals++;
    }
    for (; arrivals > 0 && this.joinable; arrivals--) {
      this.addBot(null, { avoid, entrance: { type: 'dynJoin', variant: Math.floor(this.rng() * DYNAMIC_LINES) } });
    }
  }

  // Only between hands (or before the first one), so a hand is never cut short or changed under the players.
  removeBot(id) {
    const bot = this.players.find((p) => p.id === id && p.isBot);
    if (!bot) throw new tonk.GameError('noSuchBot');
    if (this.status === 'playing') throw new tonk.GameError('botsBetweenHands');
    this.leave(bot);
  }

  // The log only needs to cover what a player could have missed by looking away: the current hand,
  // limited to the last full round (one turn per player) plus the turn in progress.
  addLog(event) {
    const pub = { seq: ++this.logSeq, type: event.type };
    for (const field of PUBLIC_LOG_FIELDS[event.type] ?? []) {
      pub[field] = Array.isArray(event[field]) ? [...event[field]] : event[field];
    }
    this.log.push(pub);
    // A fault in one bot's memory must not undo the move that was just played (the caller would think it failed).
    for (const mind of this.minds.values()) {
      try {
        mind.observe(pub);
      } catch (err) {
        console.error('Bot memory failed:', err);
      }
    }
    this.trimLog();
  }

  // A computer player (or an away human's seat) decides from what a human at that seat sees plus its own memory.
  botSight(user) {
    return { view: tonk.viewRound(this.round, user.id), mind: this.mindOf(user) };
  }

  // The smart move for a seat and how hard it is to decide. Worked out once per position (every public event moves
  // logSeq on), so the lobby can use it to time the pause and then play that same move, instead of thinking twice.
  botThink(user) {
    const key = `${this.logSeq}:${this.round.phase}:${user.id}`;
    if (this.botPlan?.key !== key) {
      const { view, mind } = this.botSight(user);
      this.botPlan = { key, ...smartThink(view, user.id, mind) };
    }
    return this.botPlan;
  }

  mindOf(user) {
    let mind = this.minds.get(user.id);
    if (!mind) {
      const profile = profileFor(user);
      mind = new Mind(user.id, profile, this.rng);
      mind.boldness = this.boldnessOf(user, profile);
      mind.start(tonk.viewRound(this.round, user.id));
      this.minds.set(user.id, mind);
    }
    return mind;
  }

  // How bold a bot feels at the start of a hand: its character, plus its mood (confidence from how its last hands
  // went) and how far behind the others it is on coins (it gets reckless), both scaled by how moody it is.
  boldnessOf(user, profile) {
    if (!user.isBot) return 0;
    const swing = profile.moodSwing * 2;
    const confidence = this.moods.get(user.id)?.confidence ?? 0;
    const others = this.players.filter((p) => p !== user).map((p) => this.coins[p.id]);
    const average = others.length ? others.reduce((sum, c) => sum + c, 0) / others.length : 0;
    const behind = average > 0 ? Math.min(1, Math.max(0, (average - this.coins[user.id]) / average)) : 0;
    return profile.boldness + swing * (confidence + T.DESPERATION_WEIGHT * behind);
  }

  // After a hand: a win makes a bot more confident, a loss less so, and a failed go-down of its own much less (it
  // becomes gun-shy). The confidence drifts back towards normal a little with every hand.
  updateMoods(result) {
    for (const id of this.round.order) {
      if (!this.players.some((p) => p.id === id && p.isBot)) continue;
      let confidence = (this.moods.get(id)?.confidence ?? 0) * T.MOOD_DECAY;
      const delta = result.deltas[id] ?? 0;
      if (delta > 0) confidence += T.MOOD_WIN;
      else if (delta < 0) confidence -= T.MOOD_LOSS;
      if (result.type === 'down' && result.actor === id && !result.success) confidence -= T.MOOD_FAILED_DOWN;
      this.moods.set(id, { confidence: Math.min(1, Math.max(-1, confidence)) });
    }
  }

  trimLog() {
    let start = this.log.findLastIndex((e) => e.type === 'deal');
    let turnEnds = 0;
    for (let i = this.log.length - 1; i >= Math.max(start, 0); i--) {
      if (TURN_END_EVENTS.has(this.log[i].type) && ++turnEnds > this.players.length) {
        start = i + 1;
        break;
      }
    }
    if (start > 0) this.log.splice(0, start);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  isBanned(user) {
    return this.bannedIds.has(user.id) || (!!user.device && this.bannedDevices.has(user.device));
  }

  ban(user) {
    this.bannedIds.add(user.id);
    if (user.device) this.bannedDevices.add(user.device);
  }

  // Names are unique at a table: a later arrival with a taken name becomes "Alice the Second", "... the Third", ...
  // The original name comes back when they leave (see restoreName).
  claimName(user) {
    const taken = new Set([...this.players, ...this.spectators].filter((p) => p !== user).map((p) => nameKey(p.name)));
    if (!taken.has(nameKey(user.name))) return;
    for (let i = 0; ; i++) {
      const candidate = `${user.name} ${i < ORDINALS.length ? `the ${ORDINALS[i]}` : `#${i + 2}`}`;
      if (!taken.has(nameKey(candidate))) {
        user.nameBase = user.name;
        user.name = candidate;
        return;
      }
    }
  }

  restoreName(user) {
    if (user.nameBase === undefined) return;
    user.name = user.nameBase;
    delete user.nameBase;
  }

  // Someone arriving after hands were played gets the average of what the players here have now, not a fresh
  // pile: a full stack would be an unfair head start over players who have been losing (or a handicap against winners).
  coinsForNewcomer() {
    const stacks = this.players.map((p) => this.coins[p.id]);
    if (this.handNo === 0 || stacks.length === 0) return this.settings.startingCoins;
    const average = Math.round(stacks.reduce((sum, c) => sum + c, 0) / stacks.length);
    return Math.max(this.settings.bet, average);
  }

  join(user, entrance = { type: 'join' }) {
    if (this.isBanned(user)) throw new tonk.GameError('banned');
    if (!this.joinable) throw new tonk.GameError('cannotJoin');
    this.claimName(user);
    this.coins[user.id] = this.coinsForNewcomer();
    this.players.push(user);
    if (!this.hostId) this.hostId = user.id;
    user.room = this;
    this.addLog({ ...entrance, ...whoIs(user) });
  }

  watch(user) {
    if (this.isBanned(user)) throw new tonk.GameError('banned');
    if (!this.watchable) throw new tonk.GameError('tooManySpectators');
    this.claimName(user);
    this.spectators.push(user);
    user.room = this;
  }

  // `reason` is the log event type: 'leave' normally, 'kick' when the host removes a player; `extra` adds fields to it.
  leave(user, reason = 'leave', extra = {}) {
    const spectatorIdx = this.spectators.indexOf(user);
    if (spectatorIdx !== -1) {
      this.spectators.splice(spectatorIdx, 1);
      user.room = null;
      this.restoreName(user);
      return;
    }
    const idx = this.players.indexOf(user);
    if (idx === -1) return;
    this.addLog({ type: reason, ...whoIs(user), ...extra });
    this.players.splice(idx, 1);
    delete this.coins[user.id];
    this.moods.delete(user.id);
    user.room = null;
    this.restoreName(user);
    if (this.hostId === user.id) this.hostId = this.humans[0]?.id ?? null;
    if (this.status === 'playing') {
      tonk.removePlayer(this.round, user.id);
      if (this.round.result) this.settle();
    }
  }

  // A guest sits down: at a bot's seat (taking over its cards and coins, even mid-hand) or, between hands, at a free one.
  takeSeat(user, botId) {
    const spectatorIdx = this.spectators.indexOf(user);
    if (spectatorIdx === -1) throw new tonk.GameError('onlyGuestsSit');
    if (botId === undefined || botId === null) {
      if (!this.joinable) throw new tonk.GameError('noFreeSeat');
      this.spectators.splice(spectatorIdx, 1);
      this.join(user);
      return;
    }
    const idx = this.players.findIndex((p) => p.id === botId && p.isBot);
    if (idx === -1) throw new tonk.GameError('botGone');
    const bot = this.players[idx];
    this.spectators.splice(spectatorIdx, 1);
    this.players[idx] = user;
    this.coins[user.id] = this.coins[bot.id];
    delete this.coins[bot.id];
    this.moods.delete(bot.id);
    const mind = this.minds.get(bot.id);
    if (mind) {
      for (const m of this.minds.values()) m.rename(bot.id, user.id);
      this.minds.delete(bot.id);
      mind.profile = profileFor(user); // if they go away, a stand-in plays their seat, not the bot's character
      mind.boldness = 0;
      this.minds.set(user.id, mind);
    }
    if (this.status === 'playing') tonk.renamePlayer(this.round, bot.id, user.id);
    bot.room = null;
    this.addLog({ type: 'takeover', pid: user.id, name: user.name, botId: bot.botId, botName: bot.name });
  }

  // The host can change the settings until the first hand is dealt. Everyone's coins are reset to the new pool.
  updateSettings(user, raw) {
    this.requirePlayer(user);
    if (this.status !== 'waiting') throw new tonk.GameError('settingsLocked');
    this.settings = validateSettings(raw);
    for (const p of this.players) this.coins[p.id] = this.settings.startingCoins;
  }

  startHand(user) {
    this.requirePlayer(user);
    if (this.status === 'playing') throw new tonk.GameError('handInProgress');
    if (this.status === 'waiting' && user.id !== this.hostId) {
      throw new tonk.GameError('onlyHostStarts');
    }
    if (this.players.length < tonk.MIN_PLAYERS) throw new tonk.GameError('notEnoughPlayers', { min: tonk.MIN_PLAYERS });
    this.resolveRandomBots();
    const n = this.players.length;
    this.dealerIdx = this.handNo === 0 ? Math.floor(this.rng() * n) : (this.dealerIdx + 1) % n;
    this.handNo++;
    this.round = tonk.startRound(
      this.players.map((p) => p.id),
      this.dealerIdx,
      this.rng,
      { deferTonk: true },
    );
    this.status = 'playing';
    this.minds = new Map();
    for (const p of this.players) this.mindOf(p);
    this.addLog({ type: 'deal', ...whoIs(this.players[this.dealerIdx]), hand: this.handNo });
    this.tonkDeadline = this.round.phase === 'tonk' ? Date.now() + this.tonkTimeoutMs : null;
  }

  // Players who still have to press TONK! (everyone who holds a Tonk and has not declared yet).
  get pendingTonkers() {
    if (this.status !== 'playing' || this.round.phase !== 'tonk') return [];
    return this.players.filter((p) => this.round.tonkers.includes(p.id) && !this.round.declared.includes(p.id));
  }

  // Puts the player's cards down and shouts it in the chat. Called by the button, or automatically
  // for bots and when the timer runs out.
  declareTonk(user) {
    this.requirePlayer(user);
    if (this.status !== 'playing') throw new tonk.GameError('noHand');
    this.requireNotPaused();
    tonk.declareTonk(this.round, user.id);
    this.pushChat(user, 'TONK!', 'tonk');
    if (this.round.result) this.settle();
  }

  requireNotPaused() {
    if (this.paused) throw new tonk.GameError('paused');
  }

  // The host can stop the game during a hand. Everything that counts down is frozen, and the time left is kept
  // so it carries on from there (the lobby restarts the turn timer from `turnResume`).
  pause(user) {
    this.requirePlayer(user);
    if (this.status !== 'playing') throw new tonk.GameError('nothingToPause');
    if (this.paused) return;
    const now = Date.now();
    this.tonkLeftMs = this.tonkDeadline ? Math.max(0, this.tonkDeadline - now) : null;
    this.turnResume = this.turnDeadline ? { key: this.turnKey, ms: Math.max(0, this.turnDeadline - now) } : null;
    this.paused = true;
    this.addLog({ type: 'pause', pid: user.id, name: user.name });
  }

  // After the last human player went broke, they can start over with a fresh table: the waiting room, everyone
  // who was knocked out back at the table with the starting coins. Bots were thrown out and can be added again.
  restart(user) {
    if (!this.restartIds.has(user.id) || !this.spectators.includes(user)) throw new tonk.GameError('cannotRestart');
    const returning = this.spectators.filter((s) => this.restartIds.has(s.id));
    this.spectators = this.spectators.filter((s) => !this.restartIds.has(s.id));
    this.clearRestart();
    this.status = 'waiting';
    this.round = null;
    this.handNo = 0;
    this.dealerIdx = 0;
    this.minds = new Map();
    this.moods = new Map();
    this.paused = false;
    this.hostId = null;
    for (const p of this.players) this.coins[p.id] = this.settings.startingCoins;
    for (const s of returning) {
      this.coins[s.id] = this.settings.startingCoins;
      this.players.push(s);
      this.hostId ??= s.id;
    }
    this.addLog({ type: 'restart', pid: user.id, name: user.name });
  }

  clearRestart() {
    this.restartIds.clear();
    this.restartDeadline = null;
  }

  unpause(user) {
    this.requirePlayer(user);
    if (!this.paused) return;
    this.paused = false;
    if (this.tonkLeftMs !== null) this.tonkDeadline = Date.now() + this.tonkLeftMs;
    this.tonkLeftMs = null;
    this.addLog({ type: 'unpause', pid: user.id, name: user.name });
  }

  act(user, action) {
    this.requirePlayer(user);
    if (this.status !== 'playing') throw new tonk.GameError('noHand');
    this.requireNotPaused();
    const events = tonk.applyAction(this.round, user.id, action);
    events.forEach((e) => this.addLog(e));
    if (this.round.result) this.settle();
  }

  addChat(user, raw) {
    if (!this.players.includes(user) && !this.spectators.includes(user)) throw new tonk.GameError('notAtThisTable');
    const text = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH) : '';
    if (!text) throw new tonk.GameError('emptyMessage');
    return this.pushChat(user, text);
  }

  // `kind` marks messages the game speaks for a player (like shouting TONK!), which each client words in its own language;
  // `extra` is whatever more the client needs for that (see banter).
  pushChat(user, text, kind = null, extra = null) {
    const message = { id: this.chatSeq++, pid: user.id, name: user.name, text };
    if (kind) message.kind = kind;
    if (extra) Object.assign(message, extra);
    if (this.spectators.includes(user)) message.spectator = true;
    if (user.isBot) {
      message.bot = true;
      message.botId = user.botId;
    }
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return message;
  }

  // Now and then a bot says something at the end of its turn (see botbanter.js). Returns the chat message, or null when
  // it keeps quiet.
  banter(bot, rng = Math.random) {
    if (!bot.isBot) return null;
    const pick = pickBanter(bot.botId, this.moods.get(bot.id)?.confidence ?? 0, rng, this.lastBanter.get(bot.id));
    if (!pick) return null;
    this.lastBanter.set(bot.id, pick.id);
    return this.pushChat(bot, pick.text, 'banter', { tone: pick.tone, situation: pick.situation, line: pick.line });
  }

  reorder(user, cards) {
    this.requirePlayer(user);
    if (this.status === 'waiting') throw new tonk.GameError('noHand');
    tonk.reorderHand(this.round, user.id, cards);
  }

  // Turns the payoff units of a finished hand into coins. Nobody can pay more than they have, so when
  // a loser is short the winners split what that loser could actually pay, in proportion to their wins.
  payout(units) {
    const raw = {};
    for (const [id, delta] of Object.entries(units)) if (id in this.coins) raw[id] = delta * this.settings.bet;
    const entries = Object.entries(raw);
    const losers = entries.filter(([, d]) => d < 0);
    const winners = entries.filter(([, d]) => d > 0);
    const owed = losers.reduce((sum, [, d]) => sum - d, 0);
    const paid = losers.reduce((sum, [id, d]) => sum + Math.min(-d, this.coins[id]), 0);
    if (paid === owed) return raw;
    const deltas = { ...raw };
    for (const [id, d] of losers) deltas[id] = -Math.min(-d, this.coins[id]);
    const wonTotal = winners.reduce((sum, [, d]) => sum + d, 0);
    let left = paid;
    for (const [id, d] of winners) {
      deltas[id] = Math.floor((d * paid) / wonTotal);
      left -= deltas[id];
    }
    for (let i = 0; left > 0; i = (i + 1) % winners.length, left--) deltas[winners[i][0]]++; // spread the rounding leftovers
    return deltas;
  }

  settle() {
    const result = this.round.result;
    this.updateMoods(result);
    result.deltas = this.payout(result.deltas);
    for (const [id, delta] of Object.entries(result.deltas)) this.coins[id] += delta;
    result.names = Object.fromEntries(this.round.order.map((id) => [id, this.nameOfPlayer(id)]));
    result.bots = Object.fromEntries(
      this.round.order.map((id) => [id, this.players.find((p) => p.id === id)?.botId]).filter(([, botId]) => botId),
    );
    const broke = this.players.filter((p) => this.coins[p.id] <= 0);
    result.broke = broke.map((p) => ({ id: p.id, bot: !!p.isBot }));
    this.status = 'between';
    this.paused = false; // a hand that ends while paused (the last opponent left) is no longer paused
    this.tonkLeftMs = null;
    this.turnResume = null;
    for (const user of broke) this.sendBroke(user);
    if (this.settings.dynamicTable) this.rotateBots(broke.filter((p) => p.isBot));
    this.newlyBroke.push(...broke);
  }

  // The players the last hand left without coins, once; the lobby uses this to tell them.
  takeBroke() {
    return this.newlyBroke.splice(0);
  }

  nameOfPlayer(id) {
    return this.players.find((p) => p.id === id)?.name ?? this.spectators.find((s) => s.id === id)?.name ?? 'Someone';
  }

  // A player with no coins left cannot play on: bots are sent away, humans keep watching as guests.
  sendBroke(user) {
    this.addLog({ type: 'broke', ...whoIs(user), bot: !!user.isBot });
    this.players.splice(this.players.indexOf(user), 1);
    delete this.coins[user.id];
    user.away = false;
    if (user.isBot) {
      user.room = null;
    } else {
      this.spectators.push(user);
      if (this.hostId === user.id) this.hostId = this.humans[0]?.id ?? null;
    }
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      owner: this.owner,
      players: this.players.map((p) => p.name),
      bots: this.players.map((p) => p.botId ?? null), // parallel to players: which character a bot is, for translated names
      max: tonk.MAX_PLAYERS,
      status: this.status,
      joinable: this.joinable,
      locked: this.locked,
      watchable: this.watchable,
      spectators: this.spectators.length,
      startingCoins: this.settings.startingCoins,
      bet: this.settings.bet,
    };
  }

  view(user) {
    return {
      t: 'room',
      you: user.id,
      room: {
        id: this.id,
        name: this.name,
        owner: this.owner,
        hostId: this.hostId,
        locked: this.locked,
        password: user.id === this.hostId ? this.password : null, // only the host can read it back (to put it in invite links)
        status: this.status,
        handNo: this.handNo,
        dealerId: this.players[this.dealerIdx % this.players.length]?.id ?? null,
        minPlayers: tonk.MIN_PLAYERS,
        maxPlayers: tonk.MAX_PLAYERS,
        settings: { ...this.settings },
        settingLimits: settingLimitsView(),
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          botId: p.botId ?? null,
          coins: this.coins[p.id],
          connected: p.isBot || !!p.conn,
          isBot: !!p.isBot,
          away: !!p.away,
        })),
        spectators: this.spectators.map((s) => ({ id: s.id, name: s.name, connected: !!s.conn })),
        round: this.round ? tonk.viewRound(this.round, user.id) : null,
        paused: this.paused,
        restartMsLeft: this.restartDeadline ? Math.max(0, this.restartDeadline - Date.now()) : null,
        canRestart: this.restartIds.has(user.id),
        tonkMsLeft: this.pendingTonkers.length ? Math.max(0, this.paused ? (this.tonkLeftMs ?? 0) : this.tonkDeadline - Date.now()) : null,
        turnMsLeft: this.status === 'playing' && this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : null,
        turnWarningMs: this.turnWarningMs,
        log: this.log,
        chat: this.chat,
      },
    };
  }
}

module.exports = { Room, DEFAULT_SETTINGS, SETTING_LIMITS, DYNAMIC_LINES, validateSettings, validatePassword };
