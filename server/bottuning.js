'use strict';
// Every number that shapes how the smart bots behave, in one place. The character of each bot (seven numbers) lives in
// botprofiles.js; these are the fixed constants behind the decisions. docs/bots.md
// explains what each part of the logic does.

// --- Payoffs of the rules, in bets per opponent (see goDown and winByEmptyHand in tonk.js) ---
const PAY_DOWN_WIN = 1; // a successful go-down: every opponent pays this
const PAY_DOWN_LOSS = 2; // a failed go-down: the goer pays this to each opponent with an equal or lower total
const PAY_EMPTY_HAND = 2; // emptying the hand: every opponent pays this

// --- Going down ---
const GO_DOWN_AT = 12; // the simple rule of thumb: a total this low is safe enough (the original bot, and a bot that is not looking at the table)
const GO_MARGIN = 0.9; // expected bets per opponent a go-down must be worth before the bot dares (1 is a sure win; carrying on is not free of risk either)
const RISK_SAMPLES = 120; // how many random deals of the opponents' unknown cards the estimate averages over
const LOW_BIAS_PER_ROUND = 0.04; // opponents keep low cards and throw dear ones: per round played, hidden cards are dealt leaning this much lower...
const LOW_BIAS_MAX = 0.15; // ...up to this much (a card of value v is dealt with weight exp(-bias * (v - 1)))
const NOISE = 1.5; // how far its estimate can be off, in bets per opponent, at a calculating of 0 (shrinks as it rises)
const MEMORY_NOISE = 1.8; // the same for a memory of 0: a bot that forgets what went by has a hazy picture of the unseen cards, so of the odds
const THUMB_SPAN = 6; // with no calculation (tunnel vision) it goes down at GO_DOWN_AT, plus or minus this much at full boldness
const MIN_CARD_VALUE = 1; // the least a card in an opponent's hand can count (an ace)
const MAX_CARD_VALUE = 10; // the most a card can count (a ten or a face card)
const RESHUFFLES_BEFORE_FORCED_DOWN = 1; // once the draw pile has run out again after this many reshuffles, it goes down

// --- Danger: opponents about to empty their hand ---
const THREAT_ONE_CARD = 1; // threat added per opponent with one card left
const THREAT_TWO_CARDS = 0.5; // threat added per opponent with two cards left
const THREAT_CAP = 2; // the most threat that counts
const THREAT_GO_DOWN_BONUS = 0.4; // bets per opponent knocked off the go-down margin per point of threat (it goes down sooner)
const THREAT_HIGH_CARD_BOOST = 0.4; // discard score of a card grows by this fraction per point of threat (shed the dear ones)
const THREAT_PLAN_DAMPING = 0.5; // under full threat planning ahead counts this much less (no time to build a spread)

// --- Discarding ---
const KEEP_WEIGHT = 2; // discard score lost per card that could still complete a spread with this one
const HELP_WEIGHT = 6; // discard score lost for handing the opponents a full spread
const RELATED_RANK_GAP = 2; // same suit within this many ranks counts as "goes with" another card

// How useful a discard would be to an opponent (0 to 1):
const HELP_COMPLETES = 0.9; // it completes a spread with two cards the bot knows they hold
const HELP_RELATED = 0.3; // it goes with a card the bot knows they hold
const HELP_BASE = 0.15; // any discard is a little useful to somebody
const HELP_TURNED_DOWN = 0.5; // multiplier when they threw away or turned down a similar card before
const HELP_FAR_SEAT = 0.1; // weight of an opponent more than four seats away (the next seat counts most)
const SEAT_WEIGHT = [0, 1, 0.5, 0.3, 0.15]; // weight of the player N seats after the bot

// --- Taking the discard ---
const POTENTIAL_MAX_VALUE = 7; // it only takes a discard for its potential if the card is this cheap or cheaper
const POTENTIAL_MIN_OUTS = 2; // ...and it makes a pair or a two-card run with at least this many cards left to complete it

// --- Chasing an empty hand (part of calculating) ---
const CHASE_MAX_CARDS = 3; // it chases an empty hand when it holds, or would keep after discarding, at most this many cards
const CHASE_WEIGHT = 60; // discard score gained per unit of chance (0 to 1) that the hand left after the discard can be emptied next turn

// --- Slips and moods (the character's numbers live in botprofiles.js) ---
const DISCARD_NOISE = 2; // discard score noise at a sloppiness of 1 (a sloppy bot sometimes throws the second-best card)
const OWN_MISS_RATIO = 0.25; // the chance of overlooking a card for its own spread, as a share of the sloppiness
const TOP_MISS_RATIO = 0.5; // the chance of not even looking at the top discard, as a share of the sloppiness
const PANIC_PER_MOOD_SWING = 0.5; // the chance of panicking when an opponent is nearly out, at a moodSwing of 1
const PANIC_DOWN_AT = 20; // a bot that panics because an opponent is nearly out goes down with a total this low or lower
const BLUR_SPOTS = 4; // an old fact it recalls can be misremembered as the same rank in a random one of this many suits

// --- Mood: how a bot feels about the game changes between hands (see Room.updateMoods) ---
const MOOD_WIN = 0.3; // confidence gained for winning a hand
const MOOD_LOSS = 0.15; // confidence lost for losing a hand
const MOOD_FAILED_DOWN = 0.6; // extra confidence lost when its own go-down failed (it becomes gun-shy)
const MOOD_DECAY = 0.7; // how much of the confidence is left after each hand (it drifts back to normal)
const BOLD_MARGIN = 0.25; // bets per opponent knocked off the go-down margin per point of boldness (negative boldness raises it)
const DESPERATION_WEIGHT = 0.6; // boldness added when the bot has lost all its coins relative to the others (scales linearly with how far behind)

// --- Pace (see Lobby.thinkMs) ---
const THINK_DRAW = 1.3; // drawing or taking the discard is thought about a little longer...
const THINK_PLAY = 0.8; // ...than putting cards down or discarding
const THINK_JITTER_MIN = 0.75; // each move takes between this fraction...
const THINK_JITTER_SPREAD = 0.5; // ...and this much more of the usual time
const THINK_EFFORT_MIN = 0.6; // an obvious move takes this fraction of the usual time...
const THINK_EFFORT_MAX = 1.8; // ...a close call takes this much of it
const GO_CLOSE_RANGE = 0.5; // a go-down estimate within this many bets per opponent of the margin is a close call
const DISCARD_CLOSE_GAP = 4; // the two best discards within this many score points of each other are a close call
const THINK_EASY = 0.2; // effort (0 to 1) of a move made from habit, gut feeling or because there is nothing to decide

module.exports = {
  PAY_DOWN_WIN,
  PAY_DOWN_LOSS,
  PAY_EMPTY_HAND,
  GO_DOWN_AT,
  GO_MARGIN,
  RISK_SAMPLES,
  LOW_BIAS_PER_ROUND,
  LOW_BIAS_MAX,
  NOISE,
  MEMORY_NOISE,
  THUMB_SPAN,
  MIN_CARD_VALUE,
  MAX_CARD_VALUE,
  RESHUFFLES_BEFORE_FORCED_DOWN,
  THREAT_ONE_CARD,
  THREAT_TWO_CARDS,
  THREAT_CAP,
  THREAT_GO_DOWN_BONUS,
  THREAT_HIGH_CARD_BOOST,
  THREAT_PLAN_DAMPING,
  KEEP_WEIGHT,
  HELP_WEIGHT,
  RELATED_RANK_GAP,
  HELP_COMPLETES,
  HELP_RELATED,
  HELP_BASE,
  HELP_TURNED_DOWN,
  HELP_FAR_SEAT,
  SEAT_WEIGHT,
  POTENTIAL_MAX_VALUE,
  POTENTIAL_MIN_OUTS,
  CHASE_MAX_CARDS,
  CHASE_WEIGHT,
  THINK_DRAW,
  THINK_PLAY,
  THINK_JITTER_MIN,
  THINK_JITTER_SPREAD,
  THINK_EFFORT_MIN,
  THINK_EFFORT_MAX,
  GO_CLOSE_RANGE,
  DISCARD_CLOSE_GAP,
  THINK_EASY,
  DISCARD_NOISE,
  OWN_MISS_RATIO,
  TOP_MISS_RATIO,
  PANIC_PER_MOOD_SWING,
  PANIC_DOWN_AT,
  BLUR_SPOTS,
  MOOD_WIN,
  MOOD_LOSS,
  MOOD_FAILED_DOWN,
  MOOD_DECAY,
  BOLD_MARGIN,
  DESPERATION_WEIGHT,
};
