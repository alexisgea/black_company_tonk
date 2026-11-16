'use strict';
// The smart computer player. It sees what a human sees (`view`, from viewRound) and what it remembers (`mind`, see
// botmind.js), never the opponents' hands. Each skill in the bot's profile is the chance it gets that part right.
const { rankOf, suitOf, cardValue, handTotal, classifyMeld, layoffEnd } = require('../shared/cards');
const { findMeld, GO_DOWN_AT } = require('./bot');
const { estimateGoDown } = require('./botrisk');

const GO_MARGIN = 1.6; // expected bets a go-down must be worth before the bot dares (continuing the hand is not free of risk either)
const THREAT_MARGIN = 0.8; // how much sooner it goes down per opponent about to empty their hand
const LAPSE_RATE = 0.6; // chance of deciding on gut feeling instead of calculating, at a goDownRisk of 0
const GUT_BASE = 5; // on gut feeling it goes down at this total...
const WISHFUL = 10; // ...plus up to this much
const NOISE = 1.5; // how far its calculation can be off, in bets, at a goDownRisk of 0
const KEEP_WEIGHT = 2; // discard score lost per card that could still complete a spread with this one
const HELP_WEIGHT = 6; // discard score lost for giving the opponents a full spread
const BASE_HELP = 0.15; // any discard is a little useful to somebody
const POSITION_WEIGHT = [0, 1, 0.5, 0.3, 0.15]; // how much the player N seats after the bot matters
const POTENTIAL_MAX_VALUE = 7; // it only takes a discard for its potential if it is a cheap card
const POTENTIAL_MIN_OUTS = 2;

const idOf = (suit, rank) => suit * 13 + rank - 1;
const byValueDesc = (cards) => [...cards].sort((a, b) => cardValue(b) - cardValue(a));
// Same rank, or the same suit within two ranks: the kind of card that goes with this one in a spread.
const related = (a, b) => rankOf(a) === rankOf(b) || (suitOf(a) === suitOf(b) && Math.abs(rankOf(a) - rankOf(b)) <= 2);

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

// How close the opponents are to emptying their hand (0 = nobody, up to 2). Only if the bot pays attention.
function threatOf({ view, opponents, mind }) {
  if (!mind.decide('danger')) return 0;
  let threat = 0;
  for (const p of opponents) {
    const count = view.players[p].count;
    if (count <= 1) threat += 1;
    else if (count === 2) threat += 0.5;
  }
  return Math.min(2, threat);
}

function shouldGoDown(sight) {
  const { view, hand, opponents, held, seen, mind } = sight;
  // The draw pile ran out for the second time: nobody is getting low enough, so end the hand.
  if (view.deckCount === 0 && (mind.reshuffles >= 1 || mind.pileSize <= 1)) return true;
  const total = handTotal(hand);
  const skill = mind.skills.goDownRisk;
  const rng = mind.rng;
  // Gut feeling: a rule of thumb that wishful thinking stretches (a 15 can feel safe).
  if (rng() < (1 - skill) * LAPSE_RATE) return total <= GUT_BASE + Math.floor(rng() * (WISHFUL + 1));
  const unseen = [...Array(52).keys()].filter((c) => !seen.has(c));
  const rivals = opponents.map((p) => ({ count: view.players[p].count, known: held[p] }));
  const worth = estimateGoDown(total, rivals, unseen, rng) + (rng() * 2 - 1) * (1 - skill) * NOISE;
  return worth >= GO_MARGIN - THREAT_MARGIN * threatOf(sight);
}

function wantsDiscard(sight, top) {
  const { hand, mind } = sight;
  if (!mind.decide('spotDiscard', 'top')) return false;
  if (findLayoff([top], noticedMelds(sight))) return true;
  if (findMeld([...hand, top])?.includes(top)) return true;
  return cardValue(top) <= POTENTIAL_MAX_VALUE && linkOuts(top, hand, sight) >= POTENTIAL_MIN_OUTS;
}

// How useful `card` would be to `pid` if it landed on the discard pile: what the bot knows they hold and what they
// have thrown away or turned down before, nothing else.
function helpFor(card, pid, { view, held, mind }) {
  if (view.melds.some((m) => layoffEnd(m, card))) return 1;
  const cards = held[pid];
  let score = BASE_HELP;
  for (const a of cards) {
    if (related(a, card)) score = Math.max(score, 0.3);
    for (const b of cards) if (a < b && classifyMeld([a, b, card])) score = 0.9;
  }
  if (score < 0.9 && mind.evidenceAgainst(pid).some((e) => related(e, card))) score *= 0.5;
  return score;
}

function helpOf(card, sight) {
  const { view, id, opponents } = sight;
  const n = view.order.length;
  const me = view.order.indexOf(id);
  let total = 0;
  for (const p of opponents) {
    const distance = (view.order.indexOf(p) - me + n) % n;
    total += (POSITION_WEIGHT[distance] ?? 0.1) * helpFor(card, p, sight);
  }
  return total;
}

function chooseDiscard(sight) {
  const { hand, mind } = sight;
  if (hand.length === 1) return hand[0];
  const threat = threatOf(sight);
  const planAhead = mind.decide('planAhead');
  const denyHelp = mind.decide('denyHelp');
  const total = handTotal(hand);
  let best = null;
  for (const card of hand) {
    let score = cardValue(card) * (1 + 0.4 * threat);
    if (planAhead)
      score -=
        KEEP_WEIGHT *
        linkOuts(
          card,
          hand.filter((c) => c !== card),
          sight,
        ) *
        (1 - 0.5 * Math.min(1, threat));
    // Helping the next player is accepted when it leaves a hand low enough to go down with.
    if (denyHelp && total - cardValue(card) > GO_DOWN_AT) score -= HELP_WEIGHT * helpOf(card, sight);
    if (!best || score > best.score) best = { card, score };
  }
  return best.card;
}

function drawPhase(sight) {
  const { view, mind } = sight;
  if (shouldGoDown(sight)) return { type: 'goDown' };
  const canDraw = view.deckCount > 0 || mind.pileSize > 1;
  if (view.discardTop !== null && (!canDraw || wantsDiscard(sight, view.discardTop))) return { type: 'takeDiscard' };
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
