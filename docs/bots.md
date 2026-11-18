# How the bots think

This page explains, in plain language, how a computer player decides what to do. The code is in `server/`:

| File             | What is in it                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `botsmart.js`    | The decisions themselves (draw, go down, spread, add to a spread, discard).                                                                                         |
| `botmind.js`     | What a bot remembers about the current hand (including half-remembered cards) and how its character numbers turn into slips and habits.                             |
| `botrisk.js`     | The "is going down a good idea?" estimate.                                                                                                                          |
| `botmelds.js`    | Finding a set or run in a hand and a card that fits a spread on the table. Used by both the smart bot and the original bot.                                         |
| `botprofiles.js` | The character of each bot (keyed by its id from `botnames.js`): **seven numbers**, and the overall `LEVEL`. **Edit this to make a bot better, worse or different.** |
| `bottuning.js`   | Every fixed number behind the decisions, with a comment on what it means. **Edit this to change how the logic behaves for every bot.**                              |
| `bot.js`         | The original, simple bot. It is only used as a safety net (see the end of this page).                                                                               |

## The big idea: a bot plays like a person who is not perfect

A bot only knows what a human sitting in its seat knows:

- its own cards,
- the cards on the table (spreads, the top of the discard pile),
- how many cards each opponent holds,
- what it **remembers** from watching the game (see "Memory").

It never sees an opponent's hand or the order of the draw pile.

On top of that, every bot has a **character**: seven numbers, each one knob that does one job. Most are a number from 0 to 1. A quality like `calculating` of 0.8 means the bot gets that part of the game right four times out of five. The chance is rolled **once per turn** for each situation, so a bot that misses a chance stays blind to it for that turn and gets a fresh chance on the next turn. That is what makes the mistakes look human instead of random flicker.

## The seven numbers

| Number         | What it is                                                                           | What it changes                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`       | How well it remembers. 1 = perfect.                                                  | Whether it still knows an old discard or who took a card, how often a remembered card has the wrong suit (`1 - memory`), and how hazy its go-down estimate is (a poor memory misjudges the odds).   |
| `calculating`  | How well it works with the cards it cannot see. 1 = sharp.                           | Keeping a promising pair or run, finding a way to empty its hand, and how noisy its go-down estimate is.                                                                                          |
| `tunnelVision` | How much it only watches its own game. 0 = always watches the table, 1 = never does. | Whether, this turn, it looks at what the others are doing: their spreads, what they need, who is nearly out, and so whether it works out the go-down risk at all or just goes by a rule of thumb. |
| `sloppiness`   | How carelessly it plays its own cards. 0 = never slips, 1 = always sloppy.           | Not even looking at a useful top discard, throwing the second-best card by mistake, and overlooking a card that fits its own spread.                                                              |
| `riskTaker`    | How ready it is to take a risk. 0.5 = neutral, 0 = timid, 1 = reckless.              | How thin an edge it goes down on, and how high its rule-of-thumb total is.                                                                                                                        |
| `moodSwing`    | How much it is swayed by how the game goes. 0 = steady.                              | How much wins, losses and being behind on coins move its boldness, and how readily it panics when an opponent is nearly out.                                                                      |
| `thinkSpeed`   | How fast it thinks. 1 = normal, above 1 is quicker, below 1 is slower.               | The pause before a move (the table's base delay divided by this).                                                                                                                                 |

Each number has its own job, so tuning one does not change what another does. Where two ideas used to overlap they were folded into one: the **tunnel vision** roll is a single "is it looking at the others this turn?" question, and everything about the others (their spreads, what they need, who is nearly out, and the risk calculation) depends on it. `calculating` only says how well it reasons once it looks.

### Choosing values

Each skill is rolled once per turn, so a value is the share of turns the bot gets that part right. Slips add up over a whole hand, so 0.8 is already fairly sloppy.

|                                                        | very bad | bad | average | good | very good |
| ------------------------------------------------------ | -------- | --- | ------- | ---- | --------- |
| `memory` / `calculating`                               | 0.2      | 0.4 | 0.65    | 0.8  | 0.95      |
| `tunnelVision` / `sloppiness` (flaws, lower is better) | 0.8      | 0.6 | 0.35    | 0.2  | 0.05      |

`riskTaker`, `moodSwing` and `thinkSpeed` are personality, not skill, so they have no good or bad end (a higher `thinkSpeed` only means quicker):

|                                       | one end | next | middle | next | other end |
| ------------------------------------- | ------- | ---- | ------ | ---- | --------- |
| `riskTaker` (timid → reckless)        | 0.1     | 0.3  | 0.5    | 0.7  | 0.9       |
| `moodSwing` (steady → volatile)       | 0.1     | 0.3  | 0.5    | 0.7  | 0.9       |
| `thinkSpeed` (very slow → very quick) | 0.6     | 0.8  | 1.0    | 1.25 | 1.6       |

Keep skill values above 0.95 for a character that is meant to be near perfect. `LEVEL` multiplies the skills, so values near 1 get clipped if it is raised above 1.

### The level

`LEVEL` in `botprofiles.js` (and the `level` argument of `profileFor(player, level)`) makes every bot easier (below 1) or harder (above 1) at once. It scales `memory`, `calculating`, how well it watches the table (the opposite of `tunnelVision`) and how carefully it plays its own cards (the opposite of `sloppiness`) by the same factor, so the differences between the characters stay. `riskTaker`, `moodSwing` and `thinkSpeed` are personalities, not skill, and are not scaled.

## A turn, step by step

### 1. At the start of the turn (before taking a card)

The bot goes through these questions in order and stops at the first "yes":

1. **Can I win right now by taking the top discard?** If taking it lets the bot put down every card (all but one, which it discards), it takes it. Emptying the hand pays 2 bets per opponent, so nothing beats it. _(`calculating`)_
2. **Should I go down?** See "Going down" below.
3. **Is the top discard worth taking?** It takes it if the card fits a spread already on the table, completes a spread with its hand, or makes a pair or a two-card run with a cheap card (7 or less) that still has enough cards left to complete it. _(`sloppiness`)_
4. Otherwise it **draws** from the pile. (If the draw pile is empty and only the discard pile is left, it takes the discard.)

### 2. After taking a card

1. **Can I empty my hand this turn?** The bot looks for a way to put down every card except one, using sets, runs and cards added to spreads on the table, and does the first step of it. This finds combinations the simple "biggest spread first" rule misses (for example a run plus three of a kind from six cards). _(`calculating`)_
2. **Can I add a card to a spread?** It adds cards to runs on the table. Other players' spreads are only noticed when it is watching the table (`tunnelVision`: people tend to focus on their own game). Its own spreads it nearly always sees, but with a higher `sloppiness` it now and then overlooks one for a turn, as people do.
3. **Can I put down a spread?** A set or a run from its hand, the biggest one first.
4. Otherwise it **discards** one card (see "Choosing the discard").

## Memory

A bot builds its memory from the public log, the same one a human can read. It remembers:

- every card that was discarded this hand,
- who took a card from the discard pile (that player probably holds it until they put it down),
- who drew from the pile instead of taking the discard (they probably did not want it).

Everything from the **last full round** (one turn per player) is remembered perfectly. Anything older is kept or forgotten by **one roll of `memory`**, made the first time the bot thinks about that fact. A forgotten card stays forgotten. A card that is kept can still be **half remembered**, more often the lower the memory: the bot knows a king went by, but gets the suit wrong, and it stays wrong. When the draw pile runs out and the discards are reshuffled, the bot forgets the discards, because those cards are back in the pile.

The bot uses its memory to guess which cards are still out there (`seen` cards are those in its hand, on the table, in the remembered discard pile, or known to be in an opponent's hand). Forgetting does more than lose a few facts: a bot with a poor memory has a hazy picture of what is left, so its go-down estimate is off by a random amount that grows as `memory` falls (see "Calculating").

## Choosing the discard

Each card in the hand gets a score, and the bot throws away the card with the **highest** score.

- **Base:** the card's value. dear cards (kings, queens, jacks, tens) score high, so by default the bot sheds them.
- **Keep promising cards** _(`calculating`)_: a card loses score for every card that could still complete a spread with it and another card in the hand (a pair, or two cards in the same suit that are close together). Cards the bot has seen go by do not count: if both other kings are gone, a pair of kings is not worth keeping.
- **Don't help the opponents** _(`tunnelVision`)_: a card that would help an opponent loses score, so the bot keeps it and throws something else. "Helps" means: it completes a spread with two cards the bot knows an opponent holds, or it goes with one card they hold. The player sitting next after the bot counts the most, the others less. If the opponent threw away or turned down a similar card before, the worry is halved. The bot ignores this worry when the rest of its hand is not above 12 (low enough to go down with): helping the next player is fine if it lets the bot win. A bot that is not watching does not think about the opponents' cards at all.
- **Chase an empty hand** _(`calculating`)_: when the bot would keep three cards or fewer, a card gains score if throwing it away leaves a hand that has a good chance of being emptied next turn. See "Chasing an empty hand".
- **Danger** _(`tunnelVision`)_: if an opponent has one or two cards left (and the bot is watching), dear cards score even higher (the bot sheds them fast) and planning ahead counts less, because there is no time to build a spread.
- **Slips** _(`sloppiness`)_: a little random noise is added to every score. When two cards score about the same, the bot may throw the other one; when one card is clearly the right choice, the noise almost never changes it.

## Going down

Going down early wins 1 bet from each opponent if the bot has the lowest total, but costs 2 bets to each opponent with an equal or lower total if it is wrong. Ties lose. So the bot has to judge the risk.

It checks these in order and stops at the first that applies:

1. **Cycling:** the draw pile is reshuffled once when it runs out. When it runs out **a second time**, nobody is getting low enough, so the bot goes down regardless. This stops a table from going round in circles. It is a fixed rule, not a character trait.
2. **Panic** _(`moodSwing`)_: if an opponent is nearly out of cards (and the bot is watching), a moody bot may panic and go down in a hurry if its total is 20 or lower, without calculating.
3. **Rule of thumb** _(`tunnelVision`, `riskTaker`)_: if the bot is not watching the table this turn, it does not work out the risk. It goes down if its total is 12 or lower, a few points higher if it is bold and lower if it is timid. This is how a tunnel-vision bot such as Silent goes down at 12 or lower without a calculation four turns out of five.
4. **Calculating**, when it is watching.

**Calculating.** The bot takes all the cards it cannot account for, deals each opponent's hidden cards at random from them (using what it knows about cards they hold), and works out the payoff of going down with its own total using the real rules. It repeats this 120 times and averages. The deal leans towards **low cards**, more so the longer the hand has lasted, because opponents keep their low cards and throw away the dear ones (measured: opponents' cards average about 6.4 at the deal and about 4 after eight rounds). The lower `calculating` is, the more **noise** is added to the result, so a weak counter misjudges by a bit; a poor `memory` adds noise of its own on top (`NOISE` and `MEMORY_NOISE`, in bets per opponent, at a value of 0). It goes down when the average is worth at least 0.9 bets **per opponent** (1 would be a sure win). Why 0.9 and not just "more than 0": going down ends the hand early, and carrying on has its own chances of winning, so a small edge is not enough. There is no fixed limit on the total: a bot with 18 goes down if it calculates that the opponents are very likely to hold more, which is rare.

Adjustments to the calculation:

- **Danger:** if opponents are about to empty their hand, the margin shrinks and the bot goes down sooner. _(`tunnelVision`: only if it is watching)_
- **Boldness and mood:** a bold bot (or one that is feeling confident, or is behind on coins) accepts a smaller margin; a timid or gun-shy one wants more. See "Mood".
- **Chasing:** if the bot is close to emptying its hand, it compares going down with chasing that (see below) and only goes down if going down is worth at least as much. _(`calculating`)_

## Chasing an empty hand

Emptying your hand pays **2 bets per opponent**, but a successful go-down only **1 per opponent**. So when a bot holds few cards (three or fewer) and sees the chance, it works towards emptying its hand. This is part of `calculating`.

The chance of emptying the hand next turn is worked out by trying every card the bot has not seen as the card it draws, and counting how often that lets it put down everything (all but one card, which it discards). For a pair of fives where two other fives are still unseen, that is about 2 cards in 35, roughly 6%. For one card that fits a run on the table, it is 100%: whatever it draws, it adds the card to the run and discards the other.

The chance is used in three places:

1. **Discarding:** a card that leaves the better chance is thrown away first, so the bot keeps the pair and drops a loose card instead of dropping a card of the pair because it is worth more.
2. **Taking the discard:** if the top discard lets it finish right now, it takes it.
3. **Going down:** the value of chasing is `chance × 2 bets × number of opponents`. The bot only goes down if that is not worth more than going down.

A small chance is a weak reason to hold on, so the chase mostly changes discards and finishing moves. It only stops a go-down when the chance is large (for example one card that fits a spread on the table).

## Mood

Boldness is not fixed during a game. It starts from the character's `riskTaker` (0.5 is neutral, below is timid, above is reckless), and at the start of every hand it is moved by:

- **Confidence** (carried from hand to hand): a win adds a little, a loss takes a little away, and a **failed go-down of its own** takes a lot (it becomes gun-shy). Confidence fades back to normal by 30% after every hand.
- **Being behind**: the further its coins are below the other players' average, the more reckless it gets.

Both are multiplied by the character's `moodSwing`, so a steady bot (Silent, Hagop) hardly changes and a moody one (One-Eye, Goblin) swings. Boldness moves the go-down margin by `BOLD_MARGIN` bets per opponent per point, and the rule-of-thumb total by `THUMB_SPAN` points.

## Pace

A bot waits before it moves so humans can follow the game. The wait is the table's base delay divided by the bot's `thinkSpeed`, a little longer for drawing than for putting down cards, with a random 75% to 125% so no two moves take exactly the same time. It also follows how **hard the decision was**: an obvious move (a rule of thumb, laying down a spread, discarding a king instead of a two) takes about 60% of the usual time, a close call (a go-down that is almost worth it, two discards that score about the same) takes up to 180%. This does not change how the bot plays; it makes the mistakes look like thinking.

The move is worked out once for each position: the room keeps it while the bot pauses and then plays that same move.

## When the smart logic fails

Every bot move tries, in order:

1. the smart logic described here,
2. the original simple bot (`bot.js`: draw, put down spreads, add to spreads, discard the highest card, go down at 12 or less),
3. a plain legal move (draw, then discard the highest card).

If a bug makes one of them fail, the next one plays, so a table can never freeze. The same logic also plays for a human who is away or disconnected, using the default character and no mood.

## Measuring a change

Do not guess what a number does: `npm run dev:tournament` plays the bots against each other and ranks them by coins won per hand (the `rank` of each character in `botprofiles.js` (rookie, regular, veteran or expert, a quarter of the roster each) is set by hand, in the same order as `BOT_IDS`), and `npm run dev:sensitivity` shows how much each knob and each constant in `bottuning.js` moves that figure. `npm run dev:balance` gives the **swing** of each knob (what a seat gains by having it at its best instead of its worst, in bets per hand), and the skills (`memory`, `calculating`, `tunnelVision`, `sloppiness`) should have about the same swing: a knob with a swing near zero is only flavour. It can try other `bottuning.js` numbers without editing the file (`--set NOISE=1.5,MEMORY_NOISE=1.8`). Run it after changing a skill number or a constant behind one, and bring a skill back into line by moving its constant (`NOISE`, `MEMORY_NOISE`, `DISCARD_NOISE`, `TOP_MISS_RATIO`). `npm run dev:table` lets you watch one table a move at a time, with every hand face up and the bot's reasoning for each move. See "Developer tools for the bots" in the README.

At the time of writing, against copies of Otto, the four skills swing between about 0.11 and 0.16 bets per hand each. The personalities do not: `moodSwing` swings about 0.2, but `riskTaker` only about 0.02, because a bold or timid bot changes how often and how luckily it wins far more than what it wins on average.

## Tuning cheat sheet

| I want...                                                                           | Change                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| One bot to remember more or less                                                    | Its `memory` in `botprofiles.js`                                                               |
| One bot to be better or worse with odds, pairs and finishing                        | Its `calculating`                                                                              |
| One bot to watch the table more or less (and so calculate or go by a rule of thumb) | Its `tunnelVision`                                                                             |
| One bot to slip more or less with its own cards                                     | Its `sloppiness`                                                                               |
| One bot to be bolder or more timid                                                  | Its `riskTaker`                                                                                |
| One bot to be moodier or steadier (and panic more or less)                          | Its `moodSwing`                                                                                |
| One bot to think for a shorter or longer time                                       | Its `thinkSpeed` (higher is quicker)                                                           |
| All bots to be harder or easier                                                     | `LEVEL` in `botprofiles.js`                                                                    |
| Bots to go down more or less eagerly                                                | `GO_MARGIN` (lower is more eager) in `bottuning.js`                                            |
| The rule-of-thumb total to move more or less with boldness                          | `THUMB_SPAN` (and `GO_DOWN_AT` for the middle)                                                 |
| Mood to swing more or less                                                          | `MOOD_WIN`, `MOOD_LOSS`, `MOOD_FAILED_DOWN`, `MOOD_DECAY`, `BOLD_MARGIN`, `DESPERATION_WEIGHT` |
| Slips to be bigger or smaller                                                       | `DISCARD_NOISE`, `TOP_MISS_RATIO`, `OWN_MISS_RATIO`, `PANIC_PER_MOOD_SWING`, `PANIC_DOWN_AT`    |
| Thinking time to follow the decision more or less                                   | `THINK_EFFORT_MIN`, `THINK_EFFORT_MAX`                                                         |
| Bots to expect lower or higher cards in the opponents' hands                        | `LOW_BIAS_PER_ROUND`, `LOW_BIAS_MAX`                                                           |
| A weak counter's or forgetful bot's go-down estimate to be more or less noisy       | `NOISE` (calculating), `MEMORY_NOISE` (memory)                                                 |
| Bots to chase an empty hand harder                                                  | `CHASE_WEIGHT` (higher: they keep pairs of dearer cards), `CHASE_MAX_CARDS`                    |
| Bots to care more or less about helping opponents                                   | `HELP_WEIGHT` and the `HELP_*` values                                                          |
