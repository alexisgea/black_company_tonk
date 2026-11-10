# Tonk (Black Company)

Small multiplayer web card game. Node server (`ws` + plain `http`), vanilla JS client, no build step, no accounts.

```
npm install
npm start        # http://localhost:3000  (PORT env var to change)
npm test
```

Open the page, enter a name, create a game or join one from the list (2-6 players). The host starts the game.

## Layout

| Path | Purpose |
| --- | --- |
| `server/tonk.js` | Pure rules engine (deal, tonk, go down, melds, layoffs, scoring). No I/O. |
| `server/room.js` | One table: seating, running scores, hand lifecycle, per-player views. |
| `server/lobby.js` | Connections, identity/reconnect, game list, message routing. |
| `server/index.js` | HTTP static server + WebSocket glue. |
| `public/client.js` | UI. Card drawing lives in the marked "Theme" section; `style.css` has a matching theme block. |

The server is authoritative; clients only send intents (`draw`, `takeDiscard`, `meld`, `layoff`, `discard`, `goDown`) and receive a per-player view (opponent hands are never sent until the hand ends). Hand order is stored server-side: dealt cards are unsorted, new cards are appended on the right, and players can drag cards to reorder (`reorder` message, never affects game state).

Identity is a random token kept in `localStorage`; refreshing or reconnecting resumes your seat. A disconnected player is removed after 60 s.

Chat is per table (waiting room and in game): messages are trimmed, capped at 200 characters, limited to 5 per 5 seconds per player, rendered as plain text, and the last 50 are replayed on rejoin.

Animations live in the "Animation" section of `public/client.js`. The UI re-renders from scratch on every update, so tracked cards (`data-card`) have their positions captured before each render and compared afterwards (FLIP, via the Web Animations API). Server log events carry a `seq`, which tells the client which opponent just moved a card it has never seen, so it can fly in from their panel. Animations are controlled by an in-app "Animations: on/off" toggle (stored in `localStorage`) rather than the OS "reduce motion" flag, which is easy to have enabled without noticing.

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
