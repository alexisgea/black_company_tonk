'use strict';
// The smart computer player. It sees what a human sees (`view`, from viewRound) and what it remembers (`mind`, see
// botmind.js), never the opponents' hands. How well it does each part comes from its profile (botprofiles.js):
// `calculating` for working with the unseen cards, `focus` for watching the others, `sloppiness` for its own slips.
const { rankOf, suitOf, cardValue, handTotal, classifyMeld, layoffEnd } = require('../shared/cards');
const { findMeld, findLayoff: firstLayoff } = require('./botmelds');
const { estimateGoDown } = require('./botrisk');
const T = require('./bottuning');

const idOf = (suit, rank) => suit * 13 + rank - 1;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// A short name for a card, for the developer tools (thinking logs); players never see it.
const label = (card) => RANKS[rankOf(card) - 1] + 'CDHS'[suitOf(card)];
const labels = (cards) => (cards.length ? cards.map(label).join(' ') : 'nothing');
const byValueDesc = (cards) => [...cards].sort((a, b) => cardValue(b) - cardValue(a));
const centered = (rng) => rng() * 2 - 1; // a random number from -1 to 1
// Same rank, or the same suit within a couple of ranks: the kind of card that goes with this one in a spread.
const related = (a, b) => rankOf(a) === rankOf(b) || (suitOf(a) === suitOf(b) && Math.abs(rankOf(a) - rankOf(b)) <= T.RELATED_RANK_GAP);

// Everything the bot can work with this turn. `trace`, when given, collects what the bot thinks, line by line (see smartThink).
function sightOf(view, id, mind, trace) {
  const hand = view.players[id].hand;
  const opponents = view.order.filter((p) => p !== id);
  const seen = new Set(hand);
  for (const meld of view.melds) for (const card of meld.cards) seen.add(card);
  const pile = mind.pileCards();
  for (const card of pile) seen.add(card);
  const held = {};
  for (const p of opponents) {
    held[p] = mind.heldBy(p);
    for (const card of held[p]) seen.add(card);
  }
  return { view, id, hand, opponents, seen, held, pile, mind, trace };
}

// How many cards could still complete a spread with `card` and a card from `others` (pairs and neighbours in the suit).
function linkOuts(card, others, sight) {
  const free = (suit, rank) => (rank >= 1 && rank <= 13 && !sight.seen.has(idOf(suit, rank)) ? 1 : 0);
  const r = rankOf(card);
  const s = suitOf(card);
  let outs = 0;
  for (const other of others) {
    if (rankOf(other) === r) {
      for (let suit = 0; suit < 4; suit++) if (suit !== s && suit !== suitOf(other)) outs += free(suit, r);
    } else if (suitOf(other) === s) {
      const lo = Math.min(r, rankOf(other));
      const hi = Math.max(r, rankOf(other));
      if (hi - lo === 1) outs += free(s, lo - 1) + free(s, hi + 1);
      else if (hi - lo === 2) outs += free(s, lo + 1);
    }
  }
  return outs;
}

// Spreads on the table it sees this turn: its own (barring a slip, see Mind.ownMiss), the others' only when it is watching them.
const noticedMelds = ({ view, id, mind }) =>
  view.melds.filter((m) => (m.owner === id ? !mind.chance(`ownMiss:${m.id}`, mind.ownMiss) : mind.watching()));

// The dearest card that fits a spread (laying it off sheds the most points).
const findLayoff = (hand, melds) => firstLayoff(byValueDesc(hand), melds);

function* subsets(cards) {
  for (let mask = 1; mask < 1 << cards.length; mask++) {
    const group = cards.filter((_, i) => mask & (1 << i));
    if (group.length >= 3) yield group;
  }
}

// The first move of a way to put down every card but one (that one is discarded) and win the hand, or null.
function findFinish(hand, melds) {
  const plan = (cards, spreads) => {
    if (cards.length <= 1) return [];
    for (const card of byValueDesc(cards)) {
      for (const spread of spreads) {
        const end = layoffEnd(spread, card);
        if (!end) continue;
        const extended = { ...spread, cards: end === 'low' ? [card, ...spread.cards] : [...spread.cards, card] };
        const rest = plan(
          cards.filter((c) => c !== card),
          spreads.map((s) => (s === spread ? extended : s)),
        );
        if (rest) return [{ type: 'layoff', card, meldId: spread.id }, ...rest];
      }
    }
    for (const group of subsets(cards)) {
      const meld = classifyMeld(group);
      if (!meld) continue;
      const rest = plan(
        cards.filter((c) => !group.includes(c)),
        [...spreads, { id: null, ...meld }],
      );
      if (rest) return [{ type: 'meld', cards: group }, ...rest];
    }
    return null;
  };
  return plan(hand, melds)?.[0] ?? null;
}

// How close the opponents are to emptying their hand (0 = nobody, up to THREAT_CAP). Only if it is watching them.
function threatOf({ view, opponents, mind }) {
  if (!mind.watching()) return 0;
  let threat = 0;
  for (const p of opponents) {
    const count = view.players[p].count;
    if (count <= 1) threat += T.THREAT_ONE_CARD;
    else if (count === 2) threat += T.THREAT_TWO_CARDS;
  }
  return Math.min(T.THREAT_CAP, threat);
}

const unseenCards = ({ seen }) => [...Array(52).keys()].filter((c) => !seen.has(c));

// The chance (0 to 1) that a hand of `cards` can be emptied on the next turn: the share of the cards it has not
// seen that, drawn, let it put down everything (see findFinish).
function finishOdds(cards, melds, sight) {
  const unseen = unseenCards(sight);
  if (!unseen.length) return 0;
  return unseen.filter((card) => findFinish([...cards, card], melds)).length / unseen.length;
}

// What chasing an empty hand is worth, in bets, compared with going down: the chance to empty it next turn times
// what every opponent pays for that. Zero unless the bot sees the chance (calculating) and has few cards left.
function chaseWorth(sight) {
  const { hand, opponents, mind } = sight;
  if (hand.length > T.CHASE_MAX_CARDS || !mind.decide('calculating', 'finish')) return 0;
  return finishOdds(hand, noticedMelds(sight), sight) * T.PAY_EMPTY_HAND * opponents.length;
}

function shouldGoDown(sight) {
  const { view, hand, opponents, held, mind, trace } = sight;
  // The draw pile ran out again after the allowed number of reshuffles: nobody is getting low enough, so end the hand.
  if (view.deckCount === 0 && (mind.reshuffles >= T.RESHUFFLES_BEFORE_FORCED_DOWN || mind.pileSize <= 1)) {
    trace?.push('Go down? The draw pile has run out again, nobody is getting low enough: yes, ends the hand.');
    return true;
  }
  const total = handTotal(hand);
  const rng = mind.rng;
  // Panic: an opponent is nearly out, so a nervous bot goes down with whatever looks lowish without working it out.
  if (mind.panic > 0 && threatOf(sight) > 0 && mind.chance('panic', mind.panic)) {
    sight.effort = T.THINK_EASY;
    const down = total <= T.PANIC_DOWN_AT;
    trace?.push(
      `Go down? PANIC: an opponent is nearly out, so by gut feeling it goes down at ${T.PANIC_DOWN_AT} or less. Total ${total}: ${down ? 'yes' : 'no'}.`,
    );
    return down;
  }
  // Tunnel vision: it is not looking at what the others hold, so it cannot work out the risk and goes by a rule of
  // thumb: down at 12 or lower, a little higher when it is bold and lower when it is timid.
  if (!mind.watching()) {
    sight.effort = T.THINK_EASY;
    const limit = T.GO_DOWN_AT + T.THUMB_SPAN * mind.boldness;
    trace?.push(
      `Go down? Not watching the table (tunnel vision), so a rule of thumb: ${T.GO_DOWN_AT} + ${T.THUMB_SPAN} x boldness ${mind.boldness.toFixed(2)} = down at ${limit.toFixed(1)} or less. Total ${total}: ${total <= limit ? 'yes' : 'no'}.`,
    );
    return total <= limit;
  }
  const rivals = opponents.map((p) => ({ count: view.players[p].count, known: held[p] }));
  const lowBias = Math.min(T.LOW_BIAS_MAX, (T.LOW_BIAS_PER_ROUND * mind.turnEnds) / view.order.length);
  const estimate = estimateGoDown(total, rivals, unseenCards(sight), rng, undefined, lowBias);
  // The worse it counts, the further its estimate can be off; a poor memory adds to that (it is working from a hazy picture
  // of what is left). A perfect memory costs no roll.
  const slip = centered(rng) * (1 - mind.profile.calculating) * T.NOISE;
  const hazy = mind.blur > 0 ? centered(rng) * mind.blur * T.MEMORY_NOISE : 0;
  const noise = slip + hazy;
  const perOpponent = estimate / opponents.length + noise;
  const threat = threatOf(sight);
  const margin = T.GO_MARGIN - T.BOLD_MARGIN * mind.boldness - T.THREAT_GO_DOWN_BONUS * threat;
  sight.effort = 1 - Math.min(1, Math.abs(perOpponent - margin) / T.GO_CLOSE_RANGE); // a close call takes longer to think over
  if (trace) {
    const raw = estimate / opponents.length;
    trace.push(
      `Go down? Watching the table. Going down with ${total} is worth ${raw.toFixed(2)} bets per opponent (${rivals.map((r) => r.count - r.known.length).join('+')} unknown cards, hands lean ${lowBias.toFixed(2)} low), ` +
        `it counts ${perOpponent.toFixed(2)} after a slip of ${noise.toFixed(2)}. It needs ${margin.toFixed(2)} (${T.GO_MARGIN} - boldness ${mind.boldness.toFixed(2)} x ${T.BOLD_MARGIN} - threat ${threat.toFixed(2)} x ${T.THREAT_GO_DOWN_BONUS}).`,
    );
  }
  if (perOpponent < margin) {
    trace?.push('  Below the margin: carries on.');
    return false;
  }
  const worth = perOpponent * opponents.length;
  const chase = chaseWorth(sight);
  trace?.push(
    `  Good enough. Going down is worth ${worth.toFixed(2)} bets; chasing an empty hand is worth ${chase.toFixed(2)}: ${worth >= chase ? 'goes down' : 'keeps chasing'}.`,
  );
  return worth >= chase;
}

// Would taking `card` let the hand put down some spread that uses it? (Not only the biggest spread in the hand.)
const completesSpread = (hand, card) => [...subsets([...hand, card])].some((group) => group.includes(card) && classifyMeld(group));

function wantsDiscard(sight, top) {
  const { hand, mind, trace } = sight;
  if (!mind.chance('spot', 1 - mind.topMiss)) {
    trace?.push(`Discard ${label(top)}: not even looked at (sloppy this turn).`);
    return false;
  }
  if (findLayoff([top], noticedMelds(sight))) {
    trace?.push(`Discard ${label(top)}: it fits a spread on the table, takes it.`);
    return true;
  }
  if (completesSpread(hand, top)) {
    trace?.push(`Discard ${label(top)}: it completes a spread with its hand, takes it.`);
    return true;
  }
  const cheap = cardValue(top) <= T.POTENTIAL_MAX_VALUE;
  const outs = cheap ? linkOuts(top, hand, sight) : 0;
  trace?.push(
    cheap
      ? `Discard ${label(top)}: cheap, and it would leave ${outs} cards that could complete a spread (needs ${T.POTENTIAL_MIN_OUTS}): ${outs >= T.POTENTIAL_MIN_OUTS ? 'takes it' : 'draws instead'}.`
      : `Discard ${label(top)}: too dear to be worth it, draws instead.`,
  );
  return cheap && outs >= T.POTENTIAL_MIN_OUTS;
}

// How useful `card` would be to `pid` if it landed on the discard pile: what the bot knows they hold and what they
// have thrown away or turned down before, nothing else. (A card that fits a spread on the table never gets here: it
// would have been laid off first.)
function helpFor(card, pid, { held, mind }) {
  const cards = held[pid];
  let score = T.HELP_BASE;
  for (const a of cards) {
    if (related(a, card)) score = Math.max(score, T.HELP_RELATED);
    for (const b of cards) if (a < b && classifyMeld([a, b, card])) score = T.HELP_COMPLETES;
  }
  if (score < T.HELP_COMPLETES && mind.evidenceAgainst(pid).some((e) => related(e, card))) score *= T.HELP_TURNED_DOWN;
  return score;
}

function helpOf(card, sight) {
  const { view, id, opponents } = sight;
  const n = view.order.length;
  const me = view.order.indexOf(id);
  let total = 0;
  for (const p of opponents) {
    const distance = (view.order.indexOf(p) - me + n) % n;
    total += (T.SEAT_WEIGHT[distance] ?? T.HELP_FAR_SEAT) * helpFor(card, p, sight);
  }
  return total;
}

// The card to throw away: the one with the highest score. Dear cards score high, and so does a card whose removal
// leaves a hand that can be emptied next turn; cards that are part of a promising spread or that would help the
// opponents score lower.
function chooseDiscard(sight) {
  const { hand, mind } = sight;
  if (hand.length === 1) return hand[0];
  const threat = threatOf(sight);
  const planAhead = mind.decide('calculating', 'plan');
  const denyHelp = mind.watching();
  const chase = hand.length - 1 <= T.CHASE_MAX_CARDS && mind.decide('calculating', 'finish');
  const melds = chase ? noticedMelds(sight) : [];
  const total = handTotal(hand);
  const scored = hand.map((card) => {
    const rest = hand.filter((c) => c !== card);
    const value = cardValue(card) * (1 + T.THREAT_HIGH_CARD_BOOST * threat);
    const keep = planAhead ? T.KEEP_WEIGHT * linkOuts(card, rest, sight) * (1 - T.THREAT_PLAN_DAMPING * Math.min(1, threat)) : 0;
    const chasing = chase ? T.CHASE_WEIGHT * finishOdds(rest, melds, sight) : 0;
    // Helping the next player is accepted when it leaves a hand low enough to go down with.
    const help = denyHelp && total - cardValue(card) > T.GO_DOWN_AT ? T.HELP_WEIGHT * helpOf(card, sight) : 0;
    // A sloppy bot misjudges the scores a little, so a close second can win.
    const noise = mind.sloppiness > 0 ? centered(mind.rng) * T.DISCARD_NOISE * mind.sloppiness : 0;
    return { card, score: value - keep + chasing - help + noise, parts: { value, keep, chasing, help, noise } };
  });
  scored.sort((a, b) => b.score - a.score);
  sight.effort = 1 - Math.min(1, (scored[0].score - scored[1].score) / T.DISCARD_CLOSE_GAP);
  if (sight.trace) {
    sight.trace.push(
      `Discard scores, highest goes (planning ${planAhead ? 'on' : 'off'}, chasing ${chase ? 'on' : 'off'}, denying help ${denyHelp ? 'on' : 'off'}, threat ${threat.toFixed(2)}):`,
    );
    for (const { card, score, parts } of scored) {
      const n = (x) => x.toFixed(1);
      sight.trace.push(
        `  ${label(card).padEnd(3)} ${n(score).padStart(5)}  = value ${n(parts.value)}, keep -${n(parts.keep)}, chase +${n(parts.chasing)}, help -${n(parts.help)}, slip ${parts.noise >= 0 ? '+' : '-'}${n(Math.abs(parts.noise))}`,
      );
    }
  }
  return scored[0].card;
}

function drawPhase(sight) {
  const { hand, view, mind, trace } = sight;
  const top = view.discardTop;
  // The discard would let it empty its hand this very turn: nothing beats that.
  if (top !== null && mind.decide('calculating', 'finish') && findFinish([...hand, top], noticedMelds(sight))) {
    sight.effort = T.THINK_EASY;
    trace?.push(`Discard ${label(top)} would let it empty its hand this turn: takes it.`);
    return { type: 'takeDiscard' };
  }
  if (shouldGoDown(sight)) return { type: 'goDown' };
  const canDraw = view.deckCount > 0 || mind.pileSize > 1;
  if (top !== null && (!canDraw || wantsDiscard(sight, top))) {
    if (!canDraw) trace?.push(`Discard ${label(top)}: nothing left to draw, takes it.`);
    return { type: 'takeDiscard' };
  }
  trace?.push('Draws from the pile.');
  return { type: 'draw' };
}

function playPhase(sight) {
  const { hand, mind, trace } = sight;
  const melds = noticedMelds(sight);
  sight.effort = T.THINK_EASY; // putting cards down is rarely a hard decision
  if (hand.length > 1 && mind.decide('calculating', 'finish')) {
    const step = findFinish(hand, melds);
    if (step) {
      trace?.push('Sees a way to put down every card but one: starts it.');
      return step;
    }
  }
  const layoff = findLayoff(hand, melds);
  if (layoff) {
    trace?.push(`Adds ${label(layoff.card)} to a spread on the table.`);
    return { type: 'layoff', ...layoff };
  }
  const meld = findMeld(hand);
  if (meld) {
    trace?.push(`Puts down a spread: ${labels(meld)}.`);
    return { type: 'meld', cards: meld };
  }
  return { type: 'discard', card: chooseDiscard(sight) };
}

// One move for player `id` and how hard it was to decide (0 = obvious, 1 = a close call): the lobby thinks longer over
// the hard ones. `view` is viewRound(round, id); `mind` is that player's memory of the hand.
// `trace` (an array, optional) is filled with what the bot works out, for the developer table; it never changes the move.
function smartThink(view, id, mind, trace) {
  const sight = sightOf(view, id, mind, trace);
  if (trace) {
    const total = handTotal(sight.hand);
    trace.push(
      `Hand: ${labels(sight.hand)} (total ${total}). Discard on top: ${view.discardTop === null ? 'none' : label(view.discardTop)}. Draw pile: ${view.deckCount}.`,
    );
    trace.push(`Remembers on the discard pile: ${labels(sight.pile)}.`);
    for (const p of sight.opponents)
      trace.push(`Remembers ${p} holding (taken from the pile): ${labels(sight.held[p])}; they have ${view.players[p].count} cards.`);
  }
  const action = view.phase === 'draw' ? drawPhase(sight) : playPhase(sight);
  if (trace) {
    const rolls = [...mind.rolls].map(([key, yes]) => `${key.replace(/^chance:/, '')} ${yes ? 'yes' : 'no'}`);
    trace.push(`This turn's rolls: ${rolls.length ? rolls.join(', ') : 'none'}.`);
  }
  return { action, effort: sight.effort ?? T.THINK_EASY };
}

const smartAction = (view, id, mind) => smartThink(view, id, mind).action;

module.exports = { smartAction, smartThink, linkOuts, findFinish, label };
