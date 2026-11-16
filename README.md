# Tonk (Black Company)

Small multiplayer web card game. Node server (`ws` + plain `http`), vanilla JS client, no build step, no accounts.

```
npm install
npm start        # http://localhost:3100  (PORT env var to change)
npm run dev      # same, but the server restarts itself when server files change
npm test
npm run lint           # ESLint
npm run format:check   # Prettier check (npm run format fixes); CI runs lint, format:check and tests
```

Open the page, enter a name, create a table or join one from the list (2-5 players). The host starts the game.

### Bots

The host of a table can fill empty seats with computer players: **Add bot** in the waiting room and between hands, and **Remove** next to each bot in the waiting room or on the scoreboard between hands (with a confirmation). Bots cannot be added or removed during a hand. Bots count toward the 2-5 players, so one human with one bot is enough to play alone. Each bot gets a random character from a fixed list (Croaker, Goblin, One-Eye, ...), each with a fixed internal id (`croaker`, `goblin`, ...) and a display name, followed by a small helmet icon so it can be told apart from a human; players cannot use those names (see `server/botnames.js`). The host (the table's creator, or the next human if they leave) is marked with a ★ next to their name. They run inside the server (see "How the bots play" below). A table is removed when its last human leaves.

Server code changes need a server restart (automatic with `npm run dev`); page changes only need a refresh.

### How the bots play

Every bot has a character in `server/botprofiles.js`, keyed by the bot's id from `server/botnames.js` (not its name, which can change or be translated); edit the table to tune one: a **speed** (how long it thinks) and a set of **skills**, each a probability from 0 to 1 that it gets that part of the game right (all start at 0.8). A skill is rolled once per turn for each situation, so a bot that misses something stays blind to it for that turn and gets another chance on the next one. A table-wide difficulty can later scale every skill with the same factor (`profileFor(player, difficulty)`), keeping the gaps between characters.

| Skill | What it does |
| --- | --- |
| `memory` | Remembers discards (and cards others took from the pile) older than the last full round. The last round is always remembered; an older fact is kept or forgotten by one roll. A reshuffle wipes the discard memory. |
| `spotDiscard` | Notices that the top discard helps: it fits a spread, or makes a pair or two-card run with a cheap card. |
| `layoffOthers` | Notices that a card fits another player's run (it never misses its own spreads). |
| `planAhead` | Keeps a card that is part of a promising pair or run, counting the cards it has not seen go by. |
| `denyHelp` | Avoids discarding a card that helps the opponents (the next player counts most). It still does it when the remaining hand is 12 or less. It uses cards it knows others hold, and cards they threw away or turned down. |
| `goDownRisk` | Estimates the payoff of going down by dealing the opponents' unknown cards at random (Monte Carlo) and goes down when it pays enough. The lower the skill, the noisier the estimate, and the more often it decides on gut feeling (a total of 5 or lower, stretched by wishful thinking up to 15). |
| `finishHand` | Looks for a way to put down every card and win the hand instead of just the biggest spread. With three cards or fewer it also chases an empty hand (which pays double a go-down): it keeps the cards most likely to finish, takes a discard that lets it finish, and does not go down when finishing is worth more. |
| `danger` | Notices opponents with one or two cards left: it goes down sooner and sheds high cards. |

Bots only use what a human at their seat sees (the view from `viewRound`) plus their own memory (`server/botmind.js`, fed by the public log), never the opponents' hands or the order of the draw pile. When the draw pile has run out for the second time they go down regardless, so a table never cycles forever. The original simple bot (draw, spread, discard the highest card, go down at 12 or lower) is kept as a safety net in `server/bot.js`: it plays if the smart logic ever fails. A plain-language walkthrough of the whole logic is in [docs/bots.md](docs/bots.md); every fixed number behind it is named and explained in `server/bottuning.js`.

### Tables: lifetime and hosts

- A table is deleted when its last **human** leaves, so an empty table and a table with only bots are removed immediately. A player who disconnects (closed tab, lost connection) mid-hand is replaced by a bot (it plays their turns and declares TONK for them) once the turn timer (see below) runs out, exactly like a connected player who is idle. Once a game has started they **keep their seat**, hand after hand, so they have every chance to reconnect and take it back; only the host's **Kick**, the idle timeout or the table closing removes them. In the waiting room (before the first deal) a disconnected player is removed after 60 seconds.
- The log shows what a player could have missed by looking away: the current hand only, limited to the last full round (one turn per player) plus the turn in progress. It only contains public information (draws from the pile do not say which card), see `PUBLIC_LOG_FIELDS` in `server/room.js`.
- If the creator leaves, the table continues and the host role passes to the next human, who gets the host controls (Start game, bots, Kick).
- A table nobody has touched for 30 minutes (any message from a player in it counts: moves, chat, button clicks, even reordering cards) is closed: everyone gets a warning 2 minutes before, then returns to the lobby. Change it with `ROOM_IDLE_MINUTES`.
- The host can **Kick** any human player at any time, with a confirmation (waiting room or the scoreboard during play). Kicked players cannot rejoin that table (as player or guest): the ban covers their account for this table and their **browser**, identified by a random device id kept in `localStorage` and sent with every `hello`, so reconnecting with a new token or opening a new tab does not get around it. Clearing the browser data or switching browser does; there is deliberately no IP ban, because players share addresses (families, schools) and behind a proxy the server may not see the real one. Kicking mid-hand removes their cards from play; if only one player would remain, the hand is cancelled with no payoff.
- **Names are unique at a table.** Someone arriving with a name that is already taken (by a player or a guest, ignoring case) is shown as "Alice the Second", "Alice the Third", ... for as long as they are at that table and gets their own name back when they leave.
- **Coins for latecomers:** until the first hand is dealt everybody gets the starting coins. Someone who joins (or a bot that is added) afterwards gets the average of the coins the seated players have at that moment (never less than one bet), so they neither start with an unfair head start nor with a handicap.
- **Turn timer:** a connected player who takes longer than 120 seconds (`TURN_TIMEOUT_SECONDS`, `0` turns it off) to finish their turn is "away": a bot plays their turns (and declares TONK for them) and the log says so. Nothing is shown for the first 60 seconds; then a countdown with a warning appears on their own turn (`TURN_WARNING_SECONDS` sets how long the countdown is). They get the seat back by making any move or pressing **Take back control**, and the countdown starts again. Disconnected players get the same timer before a bot plays for them (it restarts with each turn; if the timer is off, or only one human plays, a bot plays for a disconnected seat right away), and they keep their seat (see the first point under "Tables"). The turn timer is not used when only one human plays against bots; the idle timeout (`ROOM_IDLE_MINUTES`) closes such a table if nothing happens.
- **Password and invite link:** any player can copy the **invite link** of a table (`/#table=ABCD`); opening it takes a friend straight to that table (they join if there is a seat, otherwise they watch). The host can **lock** the table at any time just by typing a password (up to 32 characters, applied on Enter or when the field loses focus), and change it or unlock it (button or empty password) again; people already seated are not affected. Locked tables show a 🔒 in the lobby and ask newcomers (players and guests) for the password, with at most 5 attempts per minute per player. The host's invite link also carries the password, in the part after the `#`, which browsers never send to the server (the page removes it from the address bar after reading it). The server keeps the password in memory only and sends it back to the host alone.
- **Pause:** the host (table creator) can pause a hand with **Pause game** and resume it with **Resume game**. While paused nobody can move, bots wait, and the turn and TONK! timers stand still (they continue with the time they had left). The idle timeout still closes a table nobody touches.

### Guests (spectators)

Anyone can press **Watch** next to a table in the lobby, at any time (up to 20 guests per table). Guests see the table and the log, and can use the table chat (shown as "guest"), but they cannot play, start hands or add bots, and the server never sends them hidden cards: they only see a hand once its owner has put the cards down or the hand has ended. Guests do not keep a table alive (the idle timer ignores them), a table is closed if its last human player leaves while guests are watching, the host can **Kick** a guest like a player, and a guest who disconnects is removed after 60 seconds like a player.

A guest can sit down: **Take over** next to any bot on the scoreboard (also in the middle of a hand: the guest gets that bot's cards, coins and place in the turn order, and the log says so), or **Join the game** for a free seat (waiting room and between hands only; a newcomer's coins follow the "coins for latecomers" rule). The `takeSeat` message does both (`id` is the bot's id; without it a free seat is taken).

### Hosting

See [docs/hosting.md](docs/hosting.md): running on a Raspberry Pi with systemd, exposing it with a Cloudflare Tunnel, and the abuse-limit settings (environment variables such as `HOST`, `TRUST_PROXY`, `MAX_CONNECTIONS_PER_IP`).

## Layout

| Path | Purpose |
| --- | --- |
| `server/tonk.js` | Pure rules engine (deal, tonk, go down, spreads, layoffs, scoring). No I/O. |
| `server/room.js` | One table: seating, coins, settings, hand lifecycle, per-player views. |
| `server/lobby.js` | Connections, identity/reconnect, table list, message routing. |
| `server/index.js` | HTTP static server + WebSocket glue, connection-level abuse limits. |
| `server/limits.js` | Rate limiter, client-IP and Origin checks. |
| `server/bot.js` | The original simple bot (also the safety net) and the spread finder. |
| `server/botsmart.js` | The smart bot: draw, spread, layoff, discard and go-down decisions. |
| `server/botmind.js` | What one bot remembers about the hand (fed by the public log). |
| `server/botrisk.js` | Monte Carlo estimate of what going down is worth. |
| `server/botprofiles.js` | The character (speed and skills) of each bot. |
| `server/bottuning.js` | The named constants behind the bot decisions (margins, weights, payoffs, pace). |
| `server/botnames.js` | Bot name list, random pick, and the reserved-name check for players. |
| `shared/cards.js` | Card ids, hand totals, set/run validation. Loaded by the server (`require`) and the browser (`<script>`), so both always agree. |
| `public/js/` | UI as native ES modules (no build step): `main.js` (entry), `net.js` (WebSocket + messages), `state.js`, `views.js` (screens), `hand.js` (selection and drag-reorder), `chat.js`, `animation.js`, `rules-dialog.js`, `theme.js` (card drawing; `style.css` has a matching theme block). |

The server is authoritative; clients only send intents (`draw`, `takeDiscard`, `meld`, `layoff`, `discard`, `goDown`) and receive a per-player view (opponent hands are never sent until the hand ends). Hand order is stored server-side: dealt cards are unsorted, new cards are appended on the right, and players can drag cards to reorder (`reorder` message, never affects game state).

Identity is a random token kept in `sessionStorage` (per browser tab): refreshing or reconnecting a tab resumes its seat, and two tabs are two different players, handy for testing. If a seat is somehow taken over by a second connection with the same token, the old tab stops reconnecting and offers a "Use this tab" button. A disconnected player in the waiting room is removed after 60 s; once the game has started they keep their seat (a bot plays for them) until they come back or the host kicks them.

Chat is per table (waiting room and in game): messages are trimmed, capped at 200 characters, limited to 5 per 5 seconds per player, rendered as plain text, and the last 50 are replayed on rejoin.

Animations live in `public/js/animation.js`. The UI is rebuilt on every update but patched into the live DOM instead of replacing it (`patchChildren` in `public/js/dom.js`): matching elements are reused, so focus, scroll positions, the chat box and running animations survive, and event handlers are swapped through a per-element table (so handlers must use `e.currentTarget`). Tracked cards (`data-card`) have their positions captured before each render and compared afterwards (FLIP, via the Web Animations API). Server log events carry a `seq`, which tells the client which opponent just moved a card it has never seen, so it can fly in from their panel. Animations always play: they deliberately ignore the OS "reduce motion" flag.

The client reconnects with exponential backoff (1 s doubling to 30 s, ±25% jitter, reset after 5 s of a stable connection or when the browser comes back online) so a down server is not hammered by every open tab.

## Rules as implemented

Based on the [BSFS rules](https://www.bsfs.org/bsfstonk.htm) with the [Game Cabinet](http://www.gamecabinet.com/rules/Tonk.html) rules for the cases BSFS leaves open.

- 52-card deck, 5 cards each, one card flipped to start the discard pile. Play starts left of the dealer; the dealer rotates each hand.
- Card values: A = 1, 2-10 face value, J/Q/K = 10.
- **Tonk** (checked only on the deal, automatic): total <= 15 or >= 49. A single Tonk wins; every other player pays double. If several players have Tonk the hand is a draw: no coins change hands and the next hand is dealt as usual.
- On your turn, either **go down** (only at the start of the turn) or take the top of the draw pile or discard pile, then optionally put down spreads and add to existing ones, then discard.
  - Spread (also called a meld): a set (3-4 of a kind) or a run (3+ same-suit consecutive cards, Ace low only, no wrap-around).
  - Adding to a spread (also called laying off or hitting): you may extend any run on the table (yours or others') at either end; sets cannot be extended.
  - Emptying your hand (by putting down spreads, adding to a spread, or discarding) wins; everyone else pays 2 (double).
- **Going down:** the lowest total strictly wins and everyone pays 1. Otherwise the goer pays double to each player with an equal or lower total, and players with a higher total pay the lowest hand(s) 1 (BSFS wording). Ties therefore lose for the goer.
- Players start with coins and every payoff unit is worth one **bet**. The host sets both ("Table rules" in the waiting room, before the first deal; defaults 50 coins and bet 5). Nobody pays more than they have: when a loser is short the winners split what could be paid. A player who loses their last coin is out of the game after that hand: a human becomes a guest (can keep watching and chatting), a bot is removed, and the table is closed if no human player is left.
- If the draw pile runs out, the discard pile (minus its top card) is reshuffled.

## Known gaps / ideas

- A player who is idle or disconnected is only replaced after the turn timer (120 s by default); the bot that takes over plays like any other bot (see `server/botprofiles.js`).
- Players can join between hands, not mid-hand (guests can watch at any time). No persistent accounts yet.
- Single-process in-memory state; restarting the server drops all tables.
