'use strict';
// Headless games for the developer tools: the real Room, rules and bot code, no network and no timers.
//
// A "seat" is { bot, key?, profile?, tuning? }:
//   bot      a character id from botprofiles.js (anything else plays with the default BASE profile)
//   key      what its results are filed under (default: bot), so copies of one character can be told apart
//   profile  overrides for the character's seven knobs, for this seat only
//   tuning   overrides for numbers from bottuning.js, for this seat only
//
// A session is one table playing hands until somebody is broke or maxHands is reached. Everything random (the
// shuffles, the bots' slips and memory rolls) comes from one seeded generator, so the same seed gives the same game.
const TUNING = require('../server/bottuning');
const { Room, DEFAULT_SETTINGS } = require('../server/room');
const { PROFILES, BASE } = require('../server/botprofiles');
const { BOTS } = require('../server/botnames');
const { legacyAction, fallbackAction } = require('../server/bot');

const DEFAULT_OPTIONS = Object.freeze({ coins: DEFAULT_SETTINGS.startingCoins, bet: DEFAULT_SETTINGS.bet, maxHands: 200 });
const BASE_TUNING = Object.freeze({ ...TUNING });
const MAX_STEPS_PER_HAND = 1000;

// A small, good seeded generator (mulberry32).
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom(rng, fn) {
  const real = Math.random;
  Math.random = rng; // the engine reshuffles the draw pile with Math.random
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

// A Room where each seat can run with its own copy of the tuning numbers. The bot logic reads them from the shared
// module, so they are swapped in for exactly the calls that belong to that seat.
class SimRoom extends Room {
  constructor(rng, settings, tunings) {
    super('SIM', 'Simulation', rng, { settings });
    this.tunings = tunings; // seat id -> overrides
  }

  withTuning(id, fn) {
    const own = this.tunings.get(id);
    if (!own) return fn();
    Object.assign(TUNING, own);
    try {
      return fn();
    } finally {
      Object.assign(TUNING, BASE_TUNING);
    }
  }

  botThink(user) {
    return this.withTuning(user.id, () => super.botThink(user));
  }

  boldnessOf(user, profile) {
    return this.withTuning(user.id, () => super.boldnessOf(user, profile));
  }

  // Each seat's mood is updated with that seat's own numbers.
  updateMoods(result) {
    const before = new Map(this.moods);
    const after = new Map();
    for (const id of this.round.order) {
      this.moods = new Map(before);
      this.withTuning(id, () => super.updateMoods(result));
      if (this.moods.has(id)) after.set(id, this.moods.get(id));
    }
    this.moods = new Map([...before, ...after]);
  }
}

const botName = (id) => BOTS.find((b) => b.id === id)?.name ?? id;

function emptySeatStats() {
  return { hands: 0, coins: 0, coinsSq: 0, wins: 0, downs: 0, downWins: 0, empties: 0, tonks: 0, fallbacks: 0, sessionWins: 0 };
}

// One move for a bot, as the lobby plays it: the smart player, then the simple one, then a plain legal move.
function playMove(room, user, onFallback) {
  const attempts = [() => room.botThink(user).action, () => legacyAction(room.round, user.id), () => fallbackAction(room.round, user.id)];
  let lastError;
  for (let i = 0; i < attempts.length; i++) {
    try {
      room.act(user, attempts[i]());
      if (i > 0) onFallback(lastError);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function recordHand(room, seatOf, stats) {
  const result = room.round.result;
  for (const [id, delta] of Object.entries(result.deltas)) {
    const s = stats.get(seatOf.get(id));
    s.hands++;
    s.coins += delta;
    s.coinsSq += delta * delta;
    if (delta > 0) s.wins++;
  }
  const actor = result.actor && stats.get(seatOf.get(result.actor));
  if (result.type === 'down') {
    actor.downs++;
    if (result.success) actor.downWins++;
  } else if (result.type === 'empty') {
    actor.empties++;
  } else if (result.type === 'tonk') {
    stats.get(seatOf.get(result.winners[0])).tonks++;
  }
}

// Plays one session. Returns { hands, seats: [{ key, ...stats }], errors }.
function playSession({ seats, seed, ...options }) {
  const { coins, bet, maxHands } = { ...DEFAULT_OPTIONS, ...options };
  const registered = [];
  const tunings = new Map();
  const users = seats.map((seat, i) => {
    let botId = seat.bot;
    if (seat.profile) {
      botId = `dev-seat-${i}`;
      PROFILES[botId] = { ...BASE, ...(PROFILES[seat.bot] ?? {}), ...seat.profile };
      registered.push(botId);
    }
    const user = { id: `s${i}`, botId, name: botName(seat.bot), isBot: true, conn: null, room: null };
    if (seat.tuning) tunings.set(user.id, seat.tuning);
    return user;
  });
  const rng = seeded(seed);
  const errors = new Set();
  try {
    return withSeededRandom(rng, () => {
      const room = new SimRoom(rng, { startingCoins: coins, bet }, tunings);
      for (const user of users) room.join(user);
      const stats = new Map(seats.map((seat, i) => [i, emptySeatStats()]));
      const seatOf = new Map(users.map((user, i) => [user.id, i]));
      let hands = 0;
      while (hands < maxHands && room.players.length === users.length) {
        room.startHand(room.players[0]);
        for (const p of room.pendingTonkers) room.declareTonk(p);
        for (let steps = 0; room.status === 'playing'; steps++) {
          if (steps > MAX_STEPS_PER_HAND) throw new Error(`seed ${seed} hand ${hands + 1} did not finish`);
          const user = room.players.find((p) => p.id === room.round.order[room.round.turn]);
          const index = seatOf.get(user.id);
          playMove(room, user, (err) => {
            stats.get(index).fallbacks++;
            if (err)
              errors.add(
                String(err.stack ?? err)
                  .split('\n')
                  .slice(0, 3)
                  .join(' | '),
              );
          });
        }
        recordHand(room, seatOf, stats);
        hands++;
      }
      // A broke seat has left the room by now, so the final stacks are counted from the hands.
      const finalCoins = (i) => coins + stats.get(i).coins;
      const best = Math.max(...seats.map((_, i) => finalCoins(i)));
      const leaders = seats.map((_, i) => i).filter((i) => finalCoins(i) === best);
      for (const i of leaders) stats.get(i).sessionWins += 1 / leaders.length;
      return {
        hands,
        seats: seats.map((seat, i) => ({ key: seat.key ?? seat.bot, ...stats.get(i) })),
        errors: [...errors],
      };
    });
  } finally {
    for (const id of registered) delete PROFILES[id];
  }
}

// ---- Totals over many sessions ----

// Adds up the records of sessions into one entry per key.
function aggregate(sessions) {
  const totals = new Map();
  for (const session of sessions) {
    for (const { key, ...stats } of session.seats) {
      const t = totals.get(key) ?? { ...emptySeatStats(), sessions: 0 };
      for (const field of Object.keys(stats)) t[field] += stats[field];
      t.sessions++;
      totals.set(key, t);
    }
  }
  return totals;
}

// Per hand, in coins: the mean and its standard error (treating hands as independent, which is close enough to rank by).
function summarize(t) {
  const mean = t.hands ? t.coins / t.hands : 0;
  const variance = t.hands > 1 ? Math.max(0, t.coinsSq / t.hands - mean * mean) : 0;
  return {
    sessions: t.sessions,
    hands: t.hands,
    coinsPerHand: mean,
    stdError: t.hands ? Math.sqrt(variance / t.hands) : 0,
    winRate: t.hands ? t.wins / t.hands : 0,
    downsPerHand: t.hands ? t.downs / t.hands : 0,
    downSuccess: t.downs ? t.downWins / t.downs : 0,
    emptiesPerHand: t.hands ? t.empties / t.hands : 0,
    sessionWinRate: t.sessions ? t.sessionWins / t.sessions : 0,
    fallbacks: t.fallbacks,
  };
}

module.exports = { DEFAULT_OPTIONS, BASE_TUNING, seeded, withSeededRandom, SimRoom, botName, playSession, aggregate, summarize };
