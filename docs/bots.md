# How the bots think

This page explains, in plain language, how a computer player decides what to do. The code is in `server/`:

| File             | What is in it                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `botsmart.js`    | The decisions themselves (draw, go down, spread, add to a spread, discard).                                                                                                                      |
| `botmind.js`     | What a bot remembers about the current hand (including half-remembered cards).                                                                                                                   |
| `botrisk.js`     | The "is going down a good idea?" estimate.                                                                                                                                                       |
| `botprofiles.js` | The character of each bot (keyed by its id from `botnames.js`): its skills, its personality traits (habits, slips, moods) and its speed. **Edit this to make a bot better, worse or different.** |
| `bottuning.js`   | Every fixed number behind the decisions, with a comment on what it means. **Edit this to change how the logic behaves for every bot.**                                                           |
| `bot.js`         | The original, simple bot. It is only used as a safety net (see the end of this page).                                                                                                            |
| `botmelds.js`    | Finding a set or run in a hand and a card that fits a spread on the table. Used by both the smart bot and the original bot.                                                                      |

## The big idea: a bot plays like a person who is not perfect

A bot only knows what a human sitting in its seat knows:

- its own cards,
- the cards on the table (spreads, the top of the discard pile),
- how many cards each opponent holds,
- what it **remembers** from watching the game (see "Memory").

It never sees an opponent's hand or the order of the draw pile.

On top of that, every bot has a set of **skills**. A skill is a number from 0 to 1: the chance that the bot gets that part of the game right. A skill of 0.8 means it spots the right thing four times out of five and misses it once. A skill is rolled **once per turn** for each situation, so a bot that misses a chance stays blind to it for that turn and gets a fresh chance on the next turn. That is what makes the mistakes look human instead of random flicker. On top of skills each character has a **personality** (habits, slips and a mood), see "Personality" below.

Each bot also has a **speed** (how long it thinks; below 1 is quick, above 1 is slow), and a **tag** (easy, normal, hard) that is only a label for now.

A table-wide difficulty can later multiply every skill by the same factor (`profileFor(player, difficulty)`), so all bots get easier or harder while the differences between characters stay. (Personality traits are not scaled.)

## The skills

Each skill is the chance (0 to 1) that the bot gets that part of the game right. Every character has its own value for each, set in `botprofiles.js`; the base is 0.8.

| Skill          | What it does                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `memory`       | Remembers discards and cards others took from the pile that are older than the last full round. The last round is always remembered. |
| `spotDiscard`  | Notices that the top discard would help: it fits a spread, or makes a pair or a two-card run with a cheap card.                      |
| `layoffOthers` | Notices that a card fits another player's spread. (Its own spreads it almost never misses, see `ownMiss` under "Personality".)       |
| `planAhead`    | Keeps a card that is part of a promising pair or run instead of throwing it away.                                                    |
| `denyHelp`     | Avoids discarding a card that would help the opponents, the next player most of all.                                                 |
| `goDownRisk`   | Judges whether going down is safe by calculating the odds. A low skill means more guessing on gut feeling and a noisier estimate.    |
| `finishHand`   | Finds a way to put down every card and win the hand, and chases an empty hand when it has few cards left.                            |
| `danger`       | Notices that an opponent is close to emptying their hand, so it sheds high cards and goes down sooner.                               |

## A turn, step by step

### 1. At the start of the turn (before taking a card)

The bot goes through these questions in order and stops at the first "yes":

1. **Can I win right now by taking the top discard?** If taking it lets the bot put down every card (all but one, which it discards), it takes it. Emptying the hand pays 2 bets per opponent, so nothing beats it. _(skill: `finishHand`)_
2. **Should I go down?** See "Going down" below.
3. **Is the top discard worth taking?** It takes it if the card fits a spread already on the table, completes a spread with its hand, or makes a pair or a two-card run with a cheap card (7 or less) that still has enough cards left to complete it. _(skill: `spotDiscard`)_
4. Otherwise it **draws** from the pile. (If the draw pile is empty and only the discard pile is left, it takes the discard.)

### 2. After taking a card

1. **Can I empty my hand this turn?** The bot looks for a way to put down every card except one, using sets, runs and cards added to spreads on the table, and does the first step of it. This finds combinations the simple "biggest spread first" rule misses (for example a run plus three of a kind from six cards). _(skill: `finishHand`)_
2. **Can I add a card to a spread?** It adds cards to runs on the table. Other players' spreads are only noticed with the `layoffOthers` skill (people tend to focus on their own game). Its own spreads it nearly always sees, but with the `ownMiss` trait it now and then overlooks one for a turn, as people do.
3. **Can I put down a spread?** A set or a run from its hand, the biggest one first.
4. Otherwise it **discards** one card (see "Choosing the discard").

## Memory

A bot builds its memory from the public log, the same one a human can read. It remembers:

- every card that was discarded this hand,
- who took a card from the discard pile (that player probably holds it until they put it down),
- who drew from the pile instead of taking the discard (they probably did not want it).

Everything from the **last full round** (one turn per player) is remembered perfectly. Anything older is kept or forgotten by **one roll of the `memory` skill**, made the first time the bot thinks about that fact. A forgotten card stays forgotten. A card that is kept can still be **half remembered** (the `blur` trait): the bot knows a king went by, but gets the suit wrong, and it stays wrong. When the draw pile runs out and the discards are reshuffled, the bot forgets the discards, because those cards are back in the pile.

The bot uses its memory to guess which cards are still out there (`seen` cards are those in its hand, on the table, in the remembered discard pile, or known to be in an opponent's hand).

## Choosing the discard

Each card in the hand gets a score, and the bot throws away the card with the **highest** score. Before any of that, a bot with the **`dumpHigh` habit** sometimes skips the weighing completely and just throws away its dearest card, even if that breaks a pair.

- **Base:** the card's value. Dear cards (kings, queens, jacks, tens) score high, so by default the bot sheds them.
- **Keep promising cards** _(skill: `planAhead`)_: a card loses score for every card that could still complete a spread with it and another card in the hand (a pair, or two cards in the same suit that are close together). Cards the bot has seen go by do not count: if both other kings are gone, a pair of kings is not worth keeping.
- **Don't help the opponents** _(skill: `denyHelp`)_: a card that would help an opponent loses score, so the bot keeps it and throws something else. "Helps" means: it extends a spread on the table (anyone can use that), it completes a spread with two cards the bot knows an opponent holds, or it goes with one card they hold. The player sitting next after the bot counts the most, the others less. If the opponent threw away or turned down a similar card before, the worry is halved. The bot ignores this worry when the rest of its hand is not above 12 (low enough to go down with): helping the next player is fine if it lets the bot win.
- **Chase an empty hand** _(skill: `finishHand`)_: when the bot would keep three cards or fewer, a card gains score if throwing it away leaves a hand that has a good chance of being emptied next turn. See "Chasing an empty hand".
- **Danger** _(skill: `danger`)_: if an opponent has one or two cards left, dear cards score even higher (the bot sheds them fast) and planning ahead counts less, because there is no time to build a spread.
- **Slips** _(trait: `sloppiness`)_: a little random noise is added to every score. When two cards score about the same, the bot may throw the other one; when one card is clearly the right choice, the noise almost never changes it.

## Going down

Going down early wins 1 bet from each opponent if the bot has the lowest total, but costs 2 bets to each opponent with an equal or lower total if it is wrong. Ties lose. So the bot has to judge the risk.

It checks these in order and stops at the first that applies:

1. **Cycling:** the draw pile is reshuffled once when it runs out. When it runs out **a second time**, nobody is getting low enough, so the bot goes down regardless. This stops a table from going round in circles. It is a fixed rule, not a skill.
2. **Panic** _(trait: `panic`)_: if an opponent is nearly out of cards (and the bot notices, see the `danger` skill), a nervous bot goes down in a hurry if its total is 20 or lower, without calculating.
3. **Habit** _(traits: `thumbRate`, `thumbAt`)_: a bot with a fixed habit skips the calculation and goes down if its total is at or below its own limit (for example 12), and does not if it is above. This is the character's habit, not a guess: the Lieutenant does it nine times in ten.
4. **Gut feeling** or **calculating**, chosen by a roll of the `goDownRisk` skill:

**Calculating** (the more skilled the bot, the more often). The bot takes all the cards it cannot account for, deals each opponent's hidden cards at random from them (using what it knows about cards they hold), and works out the payoff of going down with its own total using the real rules. It repeats this 120 times and averages. The deal leans towards **low cards**, more so the longer the hand has lasted, because opponents keep their low cards and throw away the dear ones (measured: opponents' cards average about 6.4 at the deal and about 4 after eight rounds). The lower the skill, the more **noise** is added to the result, so an unskilled bot misjudges by a bit. It goes down when the average is worth at least 0.9 bets **per opponent** (1 would be a sure win). Why 0.9 and not just "more than 0": going down ends the hand early, and carrying on has its own chances of winning, so a small edge is not enough. There is no fixed limit on the total: a bot with 18 goes down if it calculates that the opponents are very likely to hold more, which is rare.

**Gut feeling** (the less skilled the bot, the more often). It does not calculate. It goes down when its total is at or below a rough limit (5 plus a random 0 to 10). This is how a bot can wrongly think a hand of 15 is safe. One gut feeling in twenty is wild (5 plus a random 0 to 20), so now and then a weak bot goes down with a big hand and gets it wrong.

Adjustments to the calculation:

- **Danger:** if opponents are about to empty their hand, the margin shrinks and the bot goes down sooner. _(skill: `danger`)_
- **Boldness and mood:** a bold bot (or one that is feeling confident, or is behind on coins) accepts a smaller margin; a timid or gun-shy one wants more. See "Personality".
- **Chasing:** if the bot is close to emptying its hand, it compares going down with chasing that (see below) and only goes down if going down is worth at least as much. _(skill: `finishHand`)_

## Chasing an empty hand

Emptying your hand pays **2 bets per opponent**, but a successful go-down only **1 per opponent**. So when a bot holds few cards (three or fewer) and sees the chance, it works towards emptying its hand. This is part of the `finishHand` skill.

The chance of emptying the hand next turn is worked out by trying every card the bot has not seen as the card it draws, and counting how often that lets it put down everything (all but one card, which it discards). For a pair of fives where two other fives are still unseen, that is about 2 cards in 35, roughly 6%. For one card that fits a run on the table, it is 100%: whatever it draws, it adds the card to the run and discards the other.

The chance is used in three places:

1. **Discarding:** a card that leaves the better chance is thrown away first, so the bot keeps the pair and drops a loose card instead of dropping a card of the pair because it is worth more.
2. **Taking the discard:** if the top discard lets it finish right now, it takes it.
3. **Going down:** the value of chasing is `chance × 2 bets × number of opponents`. The bot only goes down if that is not worth more than going down.

A small chance is a weak reason to hold on, so the chase mostly changes discards and finishing moves. It only stops a go-down when the chance is large (for example one card that fits a spread on the table).

## Personality: habits, slips and moods

Skills say how well a bot sees the game. A **personality** (the `traits` of each character in `botprofiles.js`) says how it behaves, including the mistakes a person makes even when they see perfectly well. Every character has its own mix, so Goblin, Lieutenant and One-Eye are easy to tell apart after a few hands.

| Trait                  | What it does                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boldness`             | From -1 to 1. A bold bot goes down on a thinner edge, a timid one wants a near-sure thing.                                                                                                                                                                                                                                                                       |
| `thumbRate`, `thumbAt` | A **rule of thumb**: with this chance per turn the bot skips the calculation and goes down if its total is `thumbAt` or lower (and does not if it is higher). A conservative bot is `thumbRate` 0.9, `thumbAt` 12. This differs from the gut feeling (see "Going down"): the gut feeling is a weak bot guessing, the rule of thumb is a habit the character has. |
| `dumpHigh`             | With this chance per turn the bot throws away its dearest card without weighing anything else, even if that breaks a pair.                                                                                                                                                                                                                                       |
| `panic`                | When an opponent is nearly out of cards (and the bot notices, see the `danger` skill) it goes down with up to 20 points instead of calculating.                                                                                                                                                                                                                  |
| `sloppiness`           | Noise on every card's discard score, so now and then the second-best card is thrown. Close calls flip often, clear ones almost never.                                                                                                                                                                                                                            |
| `ownMiss`              | The chance that the bot overlooks that a card fits its **own** spread.                                                                                                                                                                                                                                                                                           |
| `blur`                 | An old memory (older than the last full round) that is still remembered can have the right rank but the wrong suit: "a king went by", but which one?                                                                                                                                                                                                             |
| `moodiness`            | How much the mood (below) sways the bot. 0 is steady.                                                                                                                                                                                                                                                                                                            |

### Mood

Boldness is not fixed during a game. At the start of every hand a bot's boldness is its character plus:

- **Confidence** (carried from hand to hand): a win adds a little, a loss takes a little away, and a **failed go-down of its own** takes a lot (it becomes gun-shy). Confidence fades back to normal by 30% after every hand.
- **Being behind**: the further its coins are below the other players' average, the more reckless it gets.

Both are multiplied by the character's `moodiness`, so a steady bot (Silent) hardly changes and a moody one (Goblin, Hagop) swings. Boldness moves the go-down margin by `BOLD_MARGIN` bets per opponent per point.

## Pace

A bot waits before it moves so humans can follow the game. The wait is the table's base delay times the bot's `speed`, a little longer for drawing than for putting down cards, with a random 75% to 125% so no two moves take exactly the same time. It also follows how **hard the decision was**: an obvious move (a habit, a gut feeling, laying down a spread, discarding a king instead of a two) takes about 60% of the usual time, a close call (a go-down that is almost worth it, two discards that score about the same) takes up to 180%. This does not change how the bot plays; it makes the mistakes look like thinking.

## When the smart logic fails

Every bot move tries, in order:

1. the smart logic described here,
2. the original simple bot (`bot.js`: draw, put down spreads, add to spreads, discard the highest card, go down at 12 or less),
3. a plain legal move (draw, then discard the highest card).

If a bug makes one of them fail, the next one plays, so a table can never freeze. The same logic also plays for a human who is away or disconnected, using the default skill level and a plain personality (no mood).

## Tuning cheat sheet

| I want...                                                    | Change                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| One bot to be better or worse at something                   | Its skill in `botprofiles.js`                                                                              |
| One bot to be bolder, more habit-driven, sloppier or moodier | Its traits in `botprofiles.js`                                                                             |
| One bot to play faster or slower                             | Its `speed` in `botprofiles.js`                                                                            |
| All bots to be harder or easier                              | The `difficulty` factor passed to `profileFor` (not exposed in the game yet; it scales skills, not traits) |
| Bots to go down more or less eagerly                         | `GO_MARGIN` (lower is more eager) in `bottuning.js`                                                        |
| Mood to swing more or less                                   | `MOOD_WIN`, `MOOD_LOSS`, `MOOD_FAILED_DOWN`, `MOOD_DECAY`, `BOLD_MARGIN`, `DESPERATION_WEIGHT`             |
| Slips to be bigger or smaller                                | `DISCARD_NOISE`, `PANIC_DOWN_AT`                                                                           |
| Thinking time to follow the decision more or less            | `THINK_EFFORT_MIN`, `THINK_EFFORT_MAX`                                                                     |
| Bots to expect lower or higher cards in the opponents' hands | `LOW_BIAS_PER_ROUND`, `LOW_BIAS_MAX`                                                                       |
| A mistaken gut feeling to be more or less wild               | `GUT_RATE`, `GUT_BASE`, `GUT_WISHFUL`, `GUT_WILD_RATE`, `GUT_WILD`                                         |
| Bots to chase an empty hand harder                           | `CHASE_WEIGHT` (higher: they keep pairs of dearer cards), `CHASE_MAX_CARDS`                                |
| Bots to care more or less about helping opponents            | `HELP_WEIGHT` and the `HELP_*` values                                                                      |
