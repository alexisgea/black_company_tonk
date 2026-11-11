# Tonk (Black Company)

Small multiplayer web card game. Node server (`ws` + plain `http`), vanilla JS client, no build step, no accounts.

```
npm install
npm start        # http://localhost:3000  (PORT env var to change)
npm run dev      # same, but the server restarts itself when server files change
npm test
```

Open the page, enter a name, create a game or join one from the list (2-6 players). The host starts the game.

### Bots

The host of a game can fill empty seats with computer players: **Add bot** in the waiting room and between hands, and **Remove** next to each bot at any time (in the waiting room, or on the scoreboard during play, with a confirmation). Removing a bot mid-hand takes its cards out of play and the hand carries on; if only one player would remain, the hand is cancelled with no payoff. Bots count toward the 2-6 players, so you can play alone against bots. They run inside the server: they draw (or take a useful discard), put down sets and runs, add to spreads, discard their highest card, and go down when their total is 12 or lower. See `server/bot.js`. A game is removed when its last human leaves.

Server code changes need a server restart (automatic with `npm run dev`); page changes only need a refresh.

### Games: lifetime and hosts

- A game is deleted when its last **human** leaves, so an empty game and a game with only bots are removed immediately. A player who disconnects (closed tab, lost connection) is removed after 60 seconds, which can trigger the same cleanup.
- If the creator leaves, the game continues and the host role passes to the next human, who gets the host controls (Start game, bots, Kick).
- A game nobody has touched for 30 minutes (any message from a player in it counts: moves, chat, button clicks, even reordering cards) is closed: everyone gets a warning 2 minutes before, then returns to the lobby. Change it with `ROOM_IDLE_MINUTES`.
- The host can **Kick** any human player at any time, with a confirmation (waiting room or the scoreboard during play). Kicked players cannot rejoin that game. Kicking mid-hand removes their cards from play; if only one player would remain, the hand is cancelled with no payoff.

### Hosting

See [docs/hosting.md](docs/hosting.md): running on a Raspberry Pi with systemd, exposing it with a Cloudflare Tunnel, and the abuse-limit settings (environment variables such as `HOST`, `TRUST_PROXY`, `MAX_CONNECTIONS_PER_IP`).

## Layout

| Path | Purpose |
| --- | --- |
| `server/tonk.js` | Pure rules engine (deal, tonk, go down, melds, layoffs, scoring). No I/O. |
| `server/room.js` | One table: seating, running scores, hand lifecycle, per-player views. |
| `server/lobby.js` | Connections, identity/reconnect, game list, message routing. |
| `server/index.js` | HTTP static server + WebSocket glue, connection-level abuse limits. |
| `server/limits.js` | Rate limiter, client-IP and Origin checks. |
| `server/bot.js` | Bot decision logic. |
| `public/client.js` | UI. Card drawing lives in the marked "Theme" section; `style.css` has a matching theme block. |

The server is authoritative; clients only send intents (`draw`, `takeDiscard`, `meld`, `layoff`, `discard`, `goDown`) and receive a per-player view (opponent hands are never sent until the hand ends). Hand order is stored server-side: dealt cards are unsorted, new cards are appended on the right, and players can drag cards to reorder (`reorder` message, never affects game state).

Identity is a random token kept in `sessionStorage` (per browser tab): refreshing or reconnecting a tab resumes its seat, and two tabs are two different players, handy for testing. If a seat is somehow taken over by a second connection with the same token, the old tab stops reconnecting and offers a "Use this tab" button. A disconnected player is removed after 60 s.

Chat is per table (waiting room and in game): messages are trimmed, capped at 200 characters, limited to 5 per 5 seconds per player, rendered as plain text, and the last 50 are replayed on rejoin.

Animations live in the "Animation" section of `public/client.js`. The UI re-renders from scratch on every update, so tracked cards (`data-card`) have their positions captured before each render and compared afterwards (FLIP, via the Web Animations API). Server log events carry a `seq`, which tells the client which opponent just moved a card it has never seen, so it can fly in from their panel. Animations always play: they deliberately ignore the OS "reduce motion" flag.

## Rules as implemented

Based on the [BSFS rules](https://www.bsfs.org/bsfstonk.htm) with the [Game Cabinet](http://www.gamecabinet.com/rules/Tonk.html) rules for the cases BSFS leaves open.

- 52-card deck, 5 cards each, one card flipped to start the discard pile. Play starts left of the dealer; the dealer rotates each hand.
- Card values: A = 1, 2-10 face value, J/Q/K = 10.
- **Tonk** (checked only on the deal, automatic): total <= 15 or >= 49. A single Tonk wins; every other player pays double. If several players have Tonk the hand is a draw and is redealt.
- On your turn, either **go down** (only at the start of the turn) or take the top of the draw pile or discard pile, then optionally put down melds and add to spreads, then discard.
  - Meld: 3-4 of a kind, or a run of 3+ same-suit consecutive cards (Ace low only, no wrap-around).
  - You may extend any spread on the table (yours or others') at either end; sets cannot be extended.
  - Emptying your hand (by melding, laying off, or discarding) wins; everyone else pays 1.
- **Going down:** the lowest total strictly wins and everyone pays 1. Otherwise the goer pays double to each player with an equal or lower total, and players with a higher total pay the lowest hand(s) 1 (BSFS wording). Ties therefore lose for the goer.
- Scores are a running zero-sum tally per game (payoff unit = 1).
- If the draw pile runs out, the discard pile (minus its top card) is reshuffled.

## Known gaps / ideas

- No turn timer: a connected but idle player stalls the table.
- Players can join between hands, not mid-hand. No spectating or persistent accounts yet.
- Single-process in-memory state; restarting the server drops all games.
