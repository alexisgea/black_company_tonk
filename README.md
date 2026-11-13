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

Open the page, enter a name, create a table or join one from the list (2-6 players). The host starts the game.

### Bots

The host of a table can fill empty seats with computer players: **Add bot** in the waiting room and between hands, and **Remove** next to each bot in the waiting room or on the scoreboard between hands (with a confirmation). Bots cannot be added or removed during a hand. Bots count toward the 2-6 players, so you can play alone against bots. Each bot gets a random name from a fixed list (Croaker, Goblin, One-Eye, ...) followed by a ★ so it can be told apart from a human; players cannot use those names (see `server/botnames.js`). They run inside the server: they draw (or take a useful discard), put down sets and runs, add to spreads, discard their highest card, and go down when their total is 12 or lower. See `server/bot.js`. A table is removed when its last human leaves.

Server code changes need a server restart (automatic with `npm run dev`); page changes only need a refresh.

### Tables: lifetime and hosts

- A table is deleted when its last **human** leaves, so an empty table and a table with only bots are removed immediately. A player who disconnects (closed tab, lost connection) mid-hand is replaced by a bot for the rest of that hand (it plays their turns and declares TONK for them) and gets the seat back if they reconnect before the hand ends. They are removed once 60 seconds have passed and the hand is over, which can trigger the same cleanup. Outside a hand they are simply removed after 60 seconds.
- The log shows what a player could have missed by looking away: the current hand only, limited to the last full round (one turn per player) plus the turn in progress. It only contains public information (draws from the pile do not say which card), see `PUBLIC_LOG_FIELDS` in `server/room.js`.
- If the creator leaves, the table continues and the host role passes to the next human, who gets the host controls (Start game, bots, Kick).
- A table nobody has touched for 30 minutes (any message from a player in it counts: moves, chat, button clicks, even reordering cards) is closed: everyone gets a warning 2 minutes before, then returns to the lobby. Change it with `ROOM_IDLE_MINUTES`.
- The host can **Kick** any human player at any time, with a confirmation (waiting room or the scoreboard during play). Kicked players cannot rejoin that table. Kicking mid-hand removes their cards from play; if only one player would remain, the hand is cancelled with no payoff.

### Guests (spectators)

Anyone can press **Watch** next to a table in the lobby, at any time (up to 20 guests per table). Guests see the table and the log, and can use the table chat (shown as "guest"), but they cannot play, start hands or add bots, and the server never sends them hidden cards: they only see a hand once its owner has put the cards down or the hand has ended. Guests do not keep a table alive (the idle timer ignores them), a table is closed if its last human player leaves while guests are watching, the host can **Kick** a guest like a player, and a guest who disconnects is removed after 60 seconds like a player.

### Hosting

See [docs/hosting.md](docs/hosting.md): running on a Raspberry Pi with systemd, exposing it with a Cloudflare Tunnel, and the abuse-limit settings (environment variables such as `HOST`, `TRUST_PROXY`, `MAX_CONNECTIONS_PER_IP`).

## Layout

| Path | Purpose |
| --- | --- |
| `server/tonk.js` | Pure rules engine (deal, tonk, go down, spreads, layoffs, scoring). No I/O. |
| `server/room.js` | One table: seating, running scores, hand lifecycle, per-player views. |
| `server/lobby.js` | Connections, identity/reconnect, table list, message routing. |
| `server/index.js` | HTTP static server + WebSocket glue, connection-level abuse limits. |
| `server/limits.js` | Rate limiter, client-IP and Origin checks. |
| `server/bot.js` | Bot decision logic. |
| `server/botnames.js` | Bot name list, random pick, and the reserved-name check for players. |
| `shared/cards.js` | Card ids, hand totals, set/run validation. Loaded by the server (`require`) and the browser (`<script>`), so both always agree. |
| `public/js/` | UI as native ES modules (no build step): `main.js` (entry), `net.js` (WebSocket + messages), `state.js`, `views.js` (screens), `hand.js` (selection and drag-reorder), `chat.js`, `animation.js`, `rules-dialog.js`, `theme.js` (card drawing; `style.css` has a matching theme block). |

The server is authoritative; clients only send intents (`draw`, `takeDiscard`, `meld`, `layoff`, `discard`, `goDown`) and receive a per-player view (opponent hands are never sent until the hand ends). Hand order is stored server-side: dealt cards are unsorted, new cards are appended on the right, and players can drag cards to reorder (`reorder` message, never affects game state).

Identity is a random token kept in `sessionStorage` (per browser tab): refreshing or reconnecting a tab resumes its seat, and two tabs are two different players, handy for testing. If a seat is somehow taken over by a second connection with the same token, the old tab stops reconnecting and offers a "Use this tab" button. A disconnected player is removed after 60 s (after the hand, if one is running; a bot plays for them meanwhile).

Chat is per table (waiting room and in game): messages are trimmed, capped at 200 characters, limited to 5 per 5 seconds per player, rendered as plain text, and the last 50 are replayed on rejoin.

Animations live in `public/js/animation.js`. The UI re-renders from scratch on every update, so tracked cards (`data-card`) have their positions captured before each render and compared afterwards (FLIP, via the Web Animations API). Server log events carry a `seq`, which tells the client which opponent just moved a card it has never seen, so it can fly in from their panel. Animations always play: they deliberately ignore the OS "reduce motion" flag.

## Rules as implemented

Based on the [BSFS rules](https://www.bsfs.org/bsfstonk.htm) with the [Game Cabinet](http://www.gamecabinet.com/rules/Tonk.html) rules for the cases BSFS leaves open.

- 52-card deck, 5 cards each, one card flipped to start the discard pile. Play starts left of the dealer; the dealer rotates each hand.
- Card values: A = 1, 2-10 face value, J/Q/K = 10.
- **Tonk** (checked only on the deal, automatic): total <= 15 or >= 49. A single Tonk wins; every other player pays double. If several players have Tonk the hand is a draw and is redealt.
- On your turn, either **go down** (only at the start of the turn) or take the top of the draw pile or discard pile, then optionally put down spreads and add to existing ones, then discard.
  - Spread (also called a meld): a set (3-4 of a kind) or a run (3+ same-suit consecutive cards, Ace low only, no wrap-around).
  - Adding to a spread (also called laying off or hitting): you may extend any run on the table (yours or others') at either end; sets cannot be extended.
  - Emptying your hand (by putting down spreads, adding to a spread, or discarding) wins; everyone else pays 1.
- **Going down:** the lowest total strictly wins and everyone pays 1. Otherwise the goer pays double to each player with an equal or lower total, and players with a higher total pay the lowest hand(s) 1 (BSFS wording). Ties therefore lose for the goer.
- Scores are a running zero-sum tally per game (payoff unit = 1).
- If the draw pile runs out, the discard pile (minus its top card) is reshuffled.

## Known gaps / ideas

- No turn timer: a connected but idle player stalls the table.
- Players can join between hands, not mid-hand (guests can watch at any time). No persistent accounts yet.
- Single-process in-memory state; restarting the server drops all tables.
