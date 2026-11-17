'use strict';
// The smart computer player. It sees what a human sees (`view`, from viewRound) and what it remembers (`mind`, see
// botmind.js), never the opponents' hands. How well it does each part comes from its profile (botprofiles.js):
// `counting` for working with the unseen cards, `focus` for watching the others, `attention` for its own slips.
const { rankOf, suitOf, cardValue, handTotal, classifyMeld, layoffEnd } = require('../shared/cards');
const { findMeld, findLayoff: firstLayoff } = require('./botmelds');
const { estimateGoDown } = require('./botrisk');
const T = require('./bottuning');

const idOf = (suit, rank) => suit * 13 + rank - 1;
const byValueDesc = (cards) => [...cards].sort((a, b) => cardValue(b) - cardValue(a));
const centered = (rng) => rng() * 2 - 1; // a random number from -1 to 1
// Same rank, or the same suit within a couple of ranks: the kind of card that goes with this one in a spread.
const related = (a, b) => rankOf(a) === rankOf(b) || (suitOf(a) === suitOf(b) && Math.abs(rankOf(a) - rankOf(b)) <= T.RELATED_RANK_GAP);

// Everything the bot can work with this turn.
function sightOf(view, id, mind) {
  const hand = view.players[id].hand;
  const opponents = view.order.filter((p) => p !== id);
  const seen = new Set(hand);
  for (const meld of view.melds) for (const card of meld.cards) seen.add(card);
  for (const card of mind.pileCards()) seen.add(card);
  const held = {};
  for (const p of opponents) {
    held[p] = mind.heldBy(p);
    for (const card of held[p]) seen.add(card);
  }
  return { view, id, hand, opponents, seen, held, mind };
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
// what every opponent pays for that. Zero unless the bot sees the chance (counting) and has few cards left.
function chaseWorth(sight) {
  const { hand, opponents, mind } = sight;
  if (hand.length > T.CHASE_MAX_CARDS || !mind.decide('counting', 'finish')) return 0;
  return finishOdds(hand, noticedMelds(sight), sight) * T.PAY_EMPTY_HAND * opponents.length;
}

function shouldGoDown(sight) {
  const { view, hand, opponents, held, mind } = sight;
  // The draw pile ran out again after the allowed number of reshuffles: nobody is getting low enough, so end the hand.
  if (view.deckCount === 0 && (mind.reshuffles >= T.RESHUFFLES_BEFORE_FORCED_DOWN || mind.pileSize <= 1)) return true;
  const total = handTotal(hand);
  const rng = mind.rng;
  // Panic: an opponent is nearly out, so a nervous bot goes down with whatever looks lowish without working it out.
  if (mind.panic > 0 && threatOf(sight) > 0 && mind.chance('panic', mind.panic)) {
    sight.effort = T.THINK_EASY;
    return total <= T.PANIC_DOWN_AT;
  }
  // Tunnel vision: it is not looking at what the others hold, so it cannot work out the risk and goes by a rule of
  // thumb: down at 12 or lower, a little higher when it is bold and lower when it is timid.
  if (!mind.watching()) {
    sight.effort = T.THINK_EASY;
    return total <= T.GO_DOWN_AT + T.THUMB_SPAN * mind.boldness;
  }
  const rivals = opponents.map((p) => ({ count: view.players[p].count, known: held[p] }));
  const lowBias = Math.min(T.LOW_BIAS_MAX, (T.LOW_BIAS_PER_ROUND * mind.turnEnds) / view.order.length);
  const estimate = estimateGoDown(total, rivals, unseenCards(sight), rng, undefined, lowBias);
  // The worse it counts, the further its estimate can be off.
  const perOpponent = estimate / opponents.length + centered(rng) * (1 - mind.profile.counting) * T.NOISE;
  const margin = T.GO_MARGIN - T.BOLD_MARGIN * mind.boldness - T.THREAT_GO_DOWN_BONUS * threatOf(sight);
  sight.effort = 1 - Math.min(1, Math.abs(perOpponent - margin) / T.GO_CLOSE_RANGE); // a close call takes longer to think over
  if (perOpponent < margin) return false;
  return perOpponent * opponents.length >= chaseWorth(sight);
}

// Would taking `card` let the hand put down some spread that uses it? (Not only the biggest spread in the hand.)
const completesSpread = (hand, card) => [...subsets([...hand, card])].some((group) => group.includes(card) && classifyMeld(group));

function wantsDiscard(sight, top) {
  const { hand, mind } = sight;
  if (!mind.decide('counting', 'spot')) return false;
  if (findLayoff([top], noticedMelds(sight))) return true;
  if (completesSpread(hand, top)) return true;
  return cardValue(top) <= T.POTENTIAL_MAX_VALUE && linkOuts(top, hand, sight) >= T.POTENTIAL_MIN_OUTS;
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
  const planAhead = mind.decide('counting', 'plan');
  const denyHelp = mind.watching();
  const chase = hand.length - 1 <= T.CHASE_MAX_CARDS && mind.decide('counting', 'finish');
  const melds = chase ? noticedMelds(sight) : [];
  const total = handTotal(hand);
  const scored = hand.map((card) => {
    const rest = hand.filter((c) => c !== card);
    let score = cardValue(card) * (1 + T.THREAT_HIGH_CARD_BOOST * threat);
    if (planAhead) score -= T.KEEP_WEIGHT * linkOuts(card, rest, sight) * (1 - T.THREAT_PLAN_DAMPING * Math.min(1, threat));
    if (chase) score += T.CHASE_WEIGHT * finishOdds(rest, melds, sight);
    // Helping the next player is accepted when it leaves a hand low enough to go down with.
    if (denyHelp && total - cardValue(card) > T.GO_DOWN_AT) score -= T.HELP_WEIGHT * helpOf(card, sight);
    // A sloppy bot misjudges the scores a little, so a close second can win.
    if (mind.sloppiness > 0) score += centered(mind.rng) * T.DISCARD_NOISE * mind.sloppiness;
    return { card, score };
  });
  scored.sort((a, b) => b.score - a.score);
  sight.effort = 1 - Math.min(1, (scored[0].score - scored[1].score) / T.DISCARD_CLOSE_GAP);
  return scored[0].card;
}

function drawPhase(sight) {
  const { hand, view, mind } = sight;
  const top = view.discardTop;
  // The discard would let it empty its hand this very turn: nothing beats that.
  if (top !== null && mind.decide('counting', 'finish') && findFinish([...hand, top], noticedMelds(sight))) {
    sight.effort = T.THINK_EASY;
    return { type: 'takeDiscard' };
  }
  if (shouldGoDown(sight)) return { type: 'goDown' };
  const canDraw = view.deckCount > 0 || mind.pileSize > 1;
  if (top !== null && (!canDraw || wantsDiscard(sight, top))) return { type: 'takeDiscard' };
  return { type: 'draw' };
}

function playPhase(sight) {
  const { hand, mind } = sight;
  const melds = noticedMelds(sight);
  sight.effort = T.THINK_EASY; // putting cards down is rarely a hard decision
  if (hand.length > 1 && mind.decide('counting', 'finish')) {
    const step = findFinish(hand, melds);
    if (step) return step;
  }
  const layoff = findLayoff(hand, melds);
  if (layoff) return { type: 'layoff', ...layoff };
  const meld = findMeld(hand);
  if (meld) return { type: 'meld', cards: meld };
  return { type: 'discard', card: chooseDiscard(sight) };
}

// One move for player `id` and how hard it was to decide (0 = obvious, 1 = a close call): the lobby thinks longer over
// the hard ones. `view` is viewRound(round, id); `mind` is that player's memory of the hand.
function smartThink(view, id, mind) {
  const sight = sightOf(view, id, mind);
  const action = view.phase === 'draw' ? drawPhase(sight) : playPhase(sight);
  return { action, effort: sight.effort ?? T.THINK_EASY };
}

const smartAction = (view, id, mind) => smartThink(view, id, mind).action;

module.exports = { smartAction, smartThink, linkOuts, findFinish };
