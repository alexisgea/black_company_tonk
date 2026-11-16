'use strict';
// The smart computer player. It sees what a human sees (`view`, from viewRound) and what it remembers (`mind`, see
// botmind.js), never the opponents' hands. Each skill in the bot's profile is the chance it gets that part right.
const { rankOf, suitOf, cardValue, handTotal, classifyMeld, layoffEnd } = require('../shared/cards');
const { findMeld } = require('./bot');
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

// Spreads on the table it sees this turn: its own always, other players' with the layoffOthers skill.
const noticedMelds = ({ view, id, mind }) => view.melds.filter((m) => m.owner === id || mind.decide('layoffOthers', `meld${m.id}`));

function findLayoff(hand, melds) {
  for (const card of byValueDesc(hand)) {
    const meld = melds.find((m) => layoffEnd(m, card));
    if (meld) return { card, meldId: meld.id };
  }
  return null;
}

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

// How close the opponents are to emptying their hand (0 = nobody, up to THREAT_CAP). Only if the bot pays attention.
function threatOf({ view, opponents, mind }) {
  if (!mind.decide('danger')) return 0;
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
// what every opponent pays for that. Zero unless the bot sees the chance (finishHand) and has few cards left.
function chaseWorth(sight) {
  const { hand, opponents, mind } = sight;
  if (hand.length > T.CHASE_MAX_CARDS || !mind.decide('finishHand')) return 0;
  return finishOdds(hand, noticedMelds(sight), sight) * T.PAY_EMPTY_HAND * opponents.length;
}

function shouldGoDown(sight) {
  const { view, hand, opponents, held, mind } = sight;
  // The draw pile ran out again after the allowed number of reshuffles: nobody is getting low enough, so end the hand.
  if (view.deckCount === 0 && (mind.reshuffles >= T.RESHUFFLES_BEFORE_FORCED_DOWN || mind.pileSize <= 1)) return true;
  const total = handTotal(hand);
  const skill = mind.skills.goDownRisk;
  const rng = mind.rng;
  // Gut feeling: a rule of thumb that wishful thinking stretches (a 15 can feel safe, and now and then a 25).
  if (rng() < (1 - skill) * T.GUT_RATE) {
    const wishful = rng() < T.GUT_WILD_RATE ? T.GUT_WILD : T.GUT_WISHFUL;
    return total <= T.GUT_BASE + Math.floor(rng() * (wishful + 1));
  }
  const rivals = opponents.map((p) => ({ count: view.players[p].count, known: held[p] }));
  const lowBias = Math.min(T.LOW_BIAS_MAX, (T.LOW_BIAS_PER_ROUND * mind.turnEnds) / view.order.length);
  const estimate = estimateGoDown(total, rivals, unseenCards(sight), rng, undefined, lowBias);
  const perOpponent = estimate / opponents.length + centered(rng) * (1 - skill) * T.NOISE;
  if (perOpponent < T.GO_MARGIN - T.THREAT_GO_DOWN_BONUS * threatOf(sight)) return false;
  return perOpponent * opponents.length >= chaseWorth(sight);
}

// Would taking `card` let the hand put down some spread that uses it? (Not only the biggest spread in the hand.)
const completesSpread = (hand, card) => [...subsets([...hand, card])].some((group) => group.includes(card) && classifyMeld(group));

function wantsDiscard(sight, top) {
  const { hand, mind } = sight;
  if (!mind.decide('spotDiscard', 'top')) return false;
  if (findLayoff([top], noticedMelds(sight))) return true;
  if (completesSpread(hand, top)) return true;
  return cardValue(top) <= T.POTENTIAL_MAX_VALUE && linkOuts(top, hand, sight) >= T.POTENTIAL_MIN_OUTS;
}

// How useful `card` would be to `pid` if it landed on the discard pile: what the bot knows they hold and what they
// have thrown away or turned down before, nothing else.
function helpFor(card, pid, { view, held, mind }) {
  if (view.melds.some((m) => layoffEnd(m, card))) return T.HELP_LAYOFF;
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
  const planAhead = mind.decide('planAhead');
  const denyHelp = mind.decide('denyHelp');
  const chase = hand.length - 1 <= T.CHASE_MAX_CARDS && mind.decide('finishHand');
  const melds = chase ? noticedMelds(sight) : [];
  const total = handTotal(hand);
  let best = null;
  for (const card of hand) {
    const rest = hand.filter((c) => c !== card);
    let score = cardValue(card) * (1 + T.THREAT_HIGH_CARD_BOOST * threat);
    if (planAhead) score -= T.KEEP_WEIGHT * linkOuts(card, rest, sight) * (1 - T.THREAT_PLAN_DAMPING * Math.min(1, threat));
    if (chase) score += T.CHASE_WEIGHT * finishOdds(rest, melds, sight);
    // Helping the next player is accepted when it leaves a hand low enough to go down with.
    if (denyHelp && total - cardValue(card) > T.GO_DOWN_AT) score -= T.HELP_WEIGHT * helpOf(card, sight);
    if (!best || score > best.score) best = { card, score };
  }
  return best.card;
}

function drawPhase(sight) {
  const { hand, view, mind } = sight;
  const top = view.discardTop;
  // The discard would let it empty its hand this very turn: nothing beats that.
  if (top !== null && mind.decide('finishHand') && findFinish([...hand, top], noticedMelds(sight))) return { type: 'takeDiscard' };
  if (shouldGoDown(sight)) return { type: 'goDown' };
  const canDraw = view.deckCount > 0 || mind.pileSize > 1;
  if (top !== null && (!canDraw || wantsDiscard(sight, top))) return { type: 'takeDiscard' };
  return { type: 'draw' };
}

function playPhase(sight) {
  const { hand, mind } = sight;
  const melds = noticedMelds(sight);
  if (hand.length > 1 && mind.decide('finishHand')) {
    const step = findFinish(hand, melds);
    if (step) return step;
  }
  const layoff = findLayoff(hand, melds);
  if (layoff) return { type: 'layoff', ...layoff };
  const meld = findMeld(hand);
  if (meld) return { type: 'meld', cards: meld };
  return { type: 'discard', card: chooseDiscard(sight) };
}

// One move for player `id`. `view` is viewRound(round, id); `mind` is that player's memory of the hand.
function smartAction(view, id, mind) {
  const sight = sightOf(view, id, mind);
  return view.phase === 'draw' ? drawPhase(sight) : playPhase(sight);
}

module.exports = { smartAction, linkOuts, findFinish };
