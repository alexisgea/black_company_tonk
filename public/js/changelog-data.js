// Newest first. Add an entry here whenever the version in package.json is bumped.
export const CHANGELOG = [
  {
    version: '0.54.0',
    date: '2026-11-22',
    changes: ['Emote buttons and chat messages now use single-word keywords.'],
  },
  {
    version: '0.53.0',
    date: '2026-11-22',
    changes: ['The Bots window now keeps all seats visible so the bot picker stays in place.'],
  },
  {
    version: '0.52.0',
    date: '2026-11-22',
    changes: ['Cheating bots now attempt cheats five times less often.'],
  },
  {
    version: '0.51.0',
    date: '2026-11-22',
    changes: ['Emote buttons and chat messages now use single-word keywords.'],
  },
  {
    version: '0.50.0',
    date: '2026-11-21',
    changes: [
      'Cheating bots can make up a card to complete a spread, and only palm a card when their new hand size matches another player.',
      'The cheating table rule now explains where to find accusations.',
    ],
  },
  {
    version: '0.49.0',
    date: '2026-11-20',
    changes: ['Each player’s current coin balance now appears beside their seat throughout the game.'],
  },
  {
    version: '0.48.0',
    date: '2026-11-20',
    changes: [
      'Hosts can rename their table before starting the game.',
      'Leave table and Start game now sit below the table name. Starting the game scrolls back to the top.',
      'The four lobby footer buttons stay in one row or a two-by-two grid. The waiting room has smaller rule checkboxes and no emote button.',
      'The end-of-hand summary panel is gone again. Each player’s revealed cards show their hand total and coin change at their seat; the result and Deal next hand controls remain by the piles.',
    ],
  },
  {
    version: '0.47.2',
    date: '2026-11-20',
    changes: ['The playing area no longer collapses at medium window widths when the side panels move below it.'],
  },
  {
    version: '0.47.1',
    date: '2026-11-20',
    changes: [
      'On narrow screens, four opponents now sit in clockwise turn order. When only one opponent wraps, their seat lines up with the rightmost seat above.',
    ],
  },
  {
    version: '0.47.0',
    date: '2026-11-20',
    changes: [
      'Bots now have more lines for their usual chatter, turn nudges and accusation replies.',
      'Cards are now dealt from the middle of the dealer instead of the right-hand corner.',
      "The extra pause between bot turns is a little shorter, with a small variation based on the next bot's speed.",
      'A bot that cheats can no longer go down in the same turn; it must finish that turn normally first.',
      'The checkmarks for Dynamic table and Cheating are a little smaller.',
    ],
  },
  {
    version: '0.46.0',
    date: '2026-11-19',
    changes: [
      'Leave table now asks for confirmation, including when watching.',
      'The open-table list wraps on phones so Join and Watch stay on screen. The waiting-room Bots button has more space, empty seats are easier to read, and table-rule explanations use larger text.',
      'Dynamic tables are now on by default; the host can still switch them off before starting.',
      'Emotes now sit on your hand panel instead of in the chat box, including when watching. The waiting room keeps them above chat, and Well played is available again.',
      'Hand summaries keep hand values and coin changes beside the cards, with a Went down or Caught tag beside the player who called it.',
      'Bots play about a third more slowly, with an extra pause before each new turn so back-to-back bot turns are easier to follow.',
    ],
  },
  {
    version: '0.45.0',
    date: '2026-11-19',
    changes: [
      'The waiting room now has a "Bots" button, and the host can click an empty seat to open the bot picker. Removing a bot there no longer asks for confirmation.',
      '"Tonk rules" now has a book icon and sits at the bottom beside Settings and Full screen. The lobby Changelog is there too, with a pen-and-paper icon.',
      'During a game, invite links and table passwords now live in Table settings, alongside the host controls for kicking players and watching guests.',
      'Current coin balances are no longer repeated beside players on the table. The end-of-hand summary panel is back, with every hand, total and coin change together; the outcome and Deal next hand button stay in the center.',
      'Bot nudges now rotate through every speaking bot, and ordinary chatter avoids repeating the last speaker when another bot can talk.',
    ],
  },
  {
    version: '0.44.0',
    date: '2026-11-19',
    changes: [
      'The "Accuse" button next to each bot is gone, so cheating stays in the background. To accuse someone, open "Emotes" and pick "Accuse someone of cheating\u2026" (the last entry, shown during a hand), then click the bot you suspect and confirm.',
    ],
  },
  {
    version: '0.43.0',
    date: '2026-11-19',
    changes: [
      'Cheating is now harder to spot: the log only says a player "took the top discard" without naming the card, so watch whether the top card changes. The "two discards" cheat is gone (it was the same as hiding a card), and a bot may now also hide a card before drawing.',
      'Accusing a bot now shows "NAME, you filthy cheater!" in the log, and the accused bot answers in the chat and in a speech bubble, one way if you were right and another if you were wrong. A wrong accusation also logs the coins you paid.',
    ],
  },
  {
    version: '0.42.0',
    date: '2026-11-19',
    changes: [
      'Some bots now cheat, now and then: One-Eye the most, then Willow Swan, Goblin and Cordy. A cheat is never announced, so watch the table: a hand with fewer cards than it should have, two discards in one turn, a card added to a run in the wrong suit or with a rank skipped, or a card taken from under the top of the discard pile.',
      'New "Accuse" button next to each bot during a hand, with a confirmation. If you are right, the hand stops and the cheater pays everyone double. If you are wrong, you pay the bot double and the hand goes on.',
      'Cheats nobody caught are revealed when the hand ends. The rules have a new "Cheating" section.',
      'The host can switch cheating off with the new "Cheating" table rule.',
    ],
  },
  {
    version: '0.41.1',
    date: '2026-11-19',
    changes: [
      'Weak bots no longer make impossible calls: they never go down when an opponent with few cards cannot possibly hold more, and they always go down when their hand is certain to be the lowest.',
    ],
  },
  {
    version: '0.41.0',
    date: '2026-11-19',
    changes: [
      'Each player\u2019s current coins are now shown right next to them on the table.',
      'New "Table settings" button (in the waiting room and beside the scores during a game): see who is at the table, open bot profiles, and, for the host, kick players, remove bots and add bots, which now lives in one popup.',
    ],
  },
  {
    version: '0.40.1',
    date: '2026-11-19',
    changes: [
      'Reworded some quick lines: a plainer "Hello there.", "Damn, shouldn\u2019t have done that.", "The coins are as good as mine." and "I\u2019m never going to financially recover from this.".',
      'The "good game" quick line is now a "Well played!" congratulation.',
    ],
  },
  {
    version: '0.40.0',
    date: '2026-11-19',
    changes: [
      'New "Emotes" button next to Send in the chat: thirteen quick lines (greetings, "your move", luck, surprise, a laugh, "I\u2019m winning / losing", goodbyes) you can say with one click. They show in the chat and as a speech bubble.',
      'Quick lines cannot be spammed: one every 4 seconds per player.',
    ],
  },
  {
    version: '0.39.1',
    date: '2026-11-19',
    changes: [
      'The player who went down now wears a "Went down" tag (or "Caught" if they were caught) at the end of the hand, like the dealer tag.',
    ],
  },
  {
    version: '0.39.0',
    date: '2026-11-19',
    changes: [
      'The end-of-hand summary panel is gone: everyone\u2019s cards are turned over on the table, with their hand value and the coins won or lost right beside them.',
      'The "Deal next hand" button now sits under the draw and discard piles.',
    ],
  },
  {
    version: '0.38.3',
    date: '2026-11-19',
    changes: ['When you take your time, the bots now take turns hurrying you instead of the same one nagging every time.'],
  },
  {
    version: '0.38.2',
    date: '2026-11-19',
    changes: ["The dealer chip no longer pushes that player's cards down; all opponents' cards sit on the same level."],
  },
  {
    version: '0.38.1',
    date: '2026-11-19',
    changes: ['Cards only start to overlap from seven in a row, so drawing a card no longer makes the row jump around.'],
  },
  {
    version: '0.38.0',
    date: '2026-11-19',
    changes: [
      'A little gold coin now sits next to every coin amount: the lobby stakes, the side panel totals and bet, the hand results and the table rules.',
    ],
  },
  {
    version: '0.37.0',
    date: '2026-11-19',
    changes: [
      'The side panel is a bit wider.',
      'Removing or kicking a player is now a small "x" button next to the "i", with a tick and a cross to confirm or cancel, and the coin totals have more room.',
      'The full screen button shows the usual four-arrow icon.',
    ],
  },
  {
    version: '0.36.1',
    date: '2026-11-19',
    changes: [
      'Only the dealer is marked now; the "First player" chip is gone.',
      'During the deal the deck sits just below the dealer (above you, when you deal) instead of covering their panel, so their name stays readable.',
    ],
  },
  {
    version: '0.36.0',
    date: '2026-11-19',
    changes: [
      'A "Dealer" chip and a "First player" chip now sit next to the players who deal and who play first this hand, and move on to the next seat every hand.',
      'Every hand is now dealt on screen: the deck goes to the dealer, is shuffled, the cards fly out face down and yours are turned over, then the first discard is turned up and the "First player" chip slides to its seat. Nobody can move until it is over.',
    ],
  },
  {
    version: '0.35.0',
    date: '2026-11-18',
    changes: [
      'The chat and the log in the side panel are roomier on taller windows, and still compact on small ones.',
      'Each of them has an arrow in its heading to fold it away, and a handle at the bottom to drag (or use the arrow keys) to the height you like; double-click the handle to go back to the default. The browser remembers your choice.',
    ],
  },
  {
    version: '0.34.0',
    date: '2026-11-18',
    changes: [
      'The "TONK!" shout now shows as a speech bubble on the player who declared it.',
      'Speech bubbles have a small pointy tail towards the player who is talking, like in a comic.',
      'When a player takes a long time on their turn, the bots at the table now hurry them along ("What are you waiting for?").',
    ],
  },
  {
    version: '0.33.1',
    date: '2026-11-18',
    changes: ['The Random bot card now reserves a seat marked "Random"; the actual bot is picked when the table starts.'],
  },
  {
    version: '0.33.0',
    date: '2026-11-18',
    changes: [
      'A player who loses their last coin and leaves the table is now announced on the banner across the table, no longer in the end-of-hand summary.',
    ],
  },
  {
    version: '0.32.0',
    date: '2026-11-18',
    changes: [
      'On phones, opponents now sit two side by side, so a table of five fits as a square.',
      'The card count and hand total next to opponents\u2019 names are gone; the end-of-hand summary shows the totals.',
      'Spreads and hands of more than five cards now overlap slightly, like cards on a real table.',
    ],
  },
  {
    version: '0.31.0',
    date: '2026-11-18',
    changes: [
      'Bots now talk now and then: at the end of a turn a bot may say a short line, in the chat and in a bubble on its seat. Each character has its own voice (Croaker grumbles, the Lieutenant is cheerful, Goblin gloats, Case frets, the Lady is cold), and what it says depends on whether it is winning or losing.',
      'Silent stays silent.',
    ],
  },
  {
    version: '0.30.0',
    date: '2026-11-18',
    changes: [
      'What a player says in the chat now also pops up for a few seconds in a small bubble on their seat at the table (long messages are shortened).',
      'When a bot walks in or out of a dynamic table, the line from the log is also shown on the table for a few seconds.',
    ],
  },
  {
    version: '0.29.2',
    date: '2026-11-18',
    changes: ['The rules now say that emptying your hand paying double is a house rule: the original rules pay the normal bet.'],
  },
  {
    version: '0.29.1',
    date: '2026-11-18',
    changes: ['Croaker plays a little better and is no longer described as conservative.'],
  },
  {
    version: '0.29.0',
    date: '2026-11-18',
    changes: [
      'During a game, every player now has a small avatar frame on the left of their name, and bots have an i button that shows their profile, both on the table and in the coins list.',
      'The bots are listed from strongest to weakest when the host picks one.',
      'The table rules are easier to read: each rule has its explanation underneath, with a capital letter and a full stop, and the Dynamic table tick box is bigger and more tactile.',
    ],
  },
  {
    version: '0.28.0',
    date: '2026-11-18',
    changes: [
      'The host now picks bots in the waiting room: the table shows its five seats and a grid of every bot with its tag and rank (for example "stoic regular"), plus a Random card. Click a bot to seat it, click a bot in a seat to clear it, and press the i on a card for a short profile of the bot.',
      'Seats and bots have an empty frame ready for profile pictures.',
      'New table rule "Dynamic table": bots that lose their last coin are replaced by new ones, and now and then a bot leaves and another sits down, with a short line in the log.',
    ],
  },
  {
    version: '0.27.3',
    date: '2026-11-18',
    changes: [
      'Otto is a little stronger and Hagop a little weaker (and less sloppy), Croaker plays better, and The Lieutenant is now a quick, chatty guesser, so the strength levels from rookie to expert are clearer.',
    ],
  },
  {
    version: '0.27.2',
    date: '2026-11-18',
    changes: [
      'Willow Swan is a little weaker, closer to Otto and Bomanz, and Croaker a little stronger, so the gap between veterans and experts is clearer.',
    ],
  },
  {
    version: '0.27.1',
    date: '2026-11-18',
    changes: [
      'Computer players are truer to their characters: Silent ignores the table again, Bomanz has a poor memory again, The Lieutenant remembers better but guesses and slips more, Goblin is sloppier and Cordy a little less so. Their overall strength is about the same.',
    ],
  },
  {
    version: '0.27.0',
    date: '2026-11-18',
    changes: [
      'Every computer player now has a rank (rookie, regular, veteran or expert) that follows how well it does against the others: Expert are The Lady, Croaker and Silent, Veteran are Otto, Willow Swan and Bomanz, Regular are Hagop, Goblin and Case, and Rookie are One-Eye, The Lieutenant and Cordy.',
      'Silent now keeps up with Croaker, Bomanz is stronger, and Willow Swan and Hagop sit closer together.',
    ],
  },
  {
    version: '0.26.1',
    date: '2026-11-18',
    changes: [
      'Rebalanced the computer players: The Lady is the strongest, then Croaker, Silent and Otto, with Goblin in the middle and One-Eye, The Lieutenant and Cordy struggling at the bottom.',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-11-18',
    changes: [
      'The computer players are now twelve: Willow Swan, Case, One-Eye, Bomanz, Silent, Cordy, Otto, The Lady, Hagop, The Lieutenant, Goblin and Croaker. Elmo, Murgen, Gambler, Coward, Tilter, Amnesiac, Savant, Rookie and Veteran have left the table, and Croaker is reworked.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-11-18',
    changes: [
      'Bots with a poor memory or weak card counting now misjudge the odds of going down much more, so memory and calculating matter as much as table awareness and careless play do.',
      'Careless bots slip a little less: sloppiness used to outweigh every other skill.',
      'Moody bots panic a little more when an opponent is nearly out.',
      'New developer tool, npm run dev:balance, measures how much each bot number decides; the other tools are unchanged.',
    ],
  },
  {
    version: '0.24.1',
    date: '2026-11-18',
    changes: [
      'The table now always fits the window height instead of making the whole page scroll; if the side panels are too tall, only they scroll.',
      'The side panels are more compact, so a five-player table fits a normal full-HD browser window without scrolling.',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-11-18',
    changes: [
      'When the last human player loses their last coin, the table no longer closes at once: you can look at the last hand and press "Restart the table" within a minute to start over with fresh coins.',
    ],
  },
  {
    version: '0.23.2',
    date: '2026-11-17',
    changes: [
      'The bot character number observant is now called sloppiness and works the other way round: a higher value means a sloppier bot.',
      'The bot character number thinkTime is now called thinkSpeed and works the other way round: a higher value means a quicker bot.',
    ],
  },
  {
    version: '0.23.1',
    date: '2026-11-17',
    changes: ['The bot character number called speed is now called thinkTime, since a higher value makes a bot think for longer.'],
  },
  {
    version: '0.23.0',
    date: '2026-11-17',
    changes: [
      'Sleepy and The Lady have left the table, and seven new computer players have joined: Gambler, Coward, Tilter, Amnesiac, Savant, Rookie and Veteran.',
      'The Lieutenant now almost always goes by the book and goes down at 12 or lower without working out the risk, and Goblin is more reckless (though still less than One-Eye).',
    ],
  },
  {
    version: '0.22.2',
    date: '2026-11-17',
    changes: [
      'The computer players are now a smaller cast of 12 characters, including The Lady; Slink, Gupta, Puddle, Corey, Buzz, Raven and Case are gone and their names are free to use.',
      'The bot character numbers were renamed: counting is now calculating, attention is observant, risk is riskTaker and mood is moodSwing.',
    ],
  },
  {
    version: '0.22.1',
    date: '2026-11-17',
    changes: ['Whether a bot notices that the top discard would help it now depends on its attention instead of its counting.'],
  },
  {
    version: '0.22.0',
    date: '2026-11-17',
    changes: [
      'Computer players are now described by seven simple numbers (memory, counting, tunnel vision, attention, risk, mood and speed), so each one can be tuned on its own.',
      'A bot with tunnel vision now often ignores what the others are doing: it misses their spreads, what they need and who is nearly out, and goes down by a rule of thumb instead of working out the risk.',
      'Bots no longer have the odd habit of throwing away their dearest card without thinking; a bot that is poor at counting now simply plays by card value.',
    ],
  },
  {
    version: '0.21.1',
    date: '2026-11-17',
    changes: [
      'Computer players now work out their move once per turn instead of twice, so the pause before a move always matches the move they make.',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-16',
    changes: [
      'Every computer player now has a personality: some are reckless (Goblin, Buzz), some go by the book and always go down at 12 (The Lieutenant), some remember everything (One-Eye), some forget (Sleepy), and some are simply stronger or weaker than others.',
      'Bots now make human mistakes: they sometimes throw away the second-best card, overlook a card for their own spread, misremember the suit of an old card, or panic and go down in a hurry when an opponent is nearly out.',
      'Bots have moods: winning makes them bolder, a failed go-down makes them cautious, and being behind on coins makes them reckless.',
      'A bot now thinks longer over a close call (like a risky go-down) and moves quickly when the choice is obvious.',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-16',
    changes: [
      'The game can now be translated: all its text (including the rules and the computer players’ names) lives in language files, ready for a second language. Nothing changes in English, except that “1 cards” is now “1 card”.',
      'When the server turns down a request, the message now comes from the same language files.',
    ],
  },
  {
    version: '0.19.2',
    date: '2026-11-16',
    changes: [
      'Computer players judge going down better: they now know opponents keep low cards and throw away the dear ones, so they go down with a big hand much less often (though it can still happen, on a good calculation or a wild guess).',
      'A computer player in a two-player game can now go down; before, it almost never did.',
    ],
  },
  {
    version: '0.19.1',
    date: '2026-11-16',
    changes: [
      'Computer players now have a fixed internal id besides their name, so characters keep their skills if a name changes.',
      'A computer player now notices a discard that completes a spread even when its hand holds a bigger spread, and a fault in a bot memory can no longer undo a move that was played.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-16',
    changes: ['A table can now be played by just two players (for example one human and one bot).'],
  },
  {
    version: '0.18.0',
    date: '2026-11-16',
    changes: [
      'Computer players now go for an empty hand (which pays double) when they are down to a few cards: they keep a pair that could finish the hand, grab a discard that lets them finish, and do not rush to go down when emptying their hand is worth more.',
    ],
  },
  {
    version: '0.17.1',
    date: '2026-11-16',
    changes: ['When a computer player goes down on a gut feeling it now does so at a total of 5 to 15 instead of 12 to 20.'],
  },
  {
    version: '0.17.0',
    date: '2026-11-16',
    changes: [
      "The computer players are much smarter: they remember discards, avoid helping the next player, add to other players' spreads, keep promising pairs and runs, and weigh the risk before going down.",
      'They also go for a win when they can put down all their cards, and play it safe when an opponent is about to empty their hand.',
      'Bots are not perfect: each one sometimes forgets a card, misses a spread or misjudges a hand, and some think faster than others.',
      'When the draw pile runs out for the second time, the bots go down so a table never goes round in circles.',
    ],
  },
  {
    version: '0.16.1',
    date: '2026-11-16',
    changes: ['The "Lock table" button is gone: the host just types a password to lock the table (clear it to unlock).'],
  },
  {
    version: '0.16.0',
    date: '2026-11-16',
    changes: [
      'New Full screen button (where the browser allows it) to get more room on phones.',
      'The Settings button is no longer stuck at the top of the screen: it now sits at the bottom of the page, next to Full screen.',
      'On phones the table now fits the screen without scrolling: less padding at the top, and Go down, Spread and Discard sit side by side on one line.',
      '"Put down selected" is now called "Spread" so it is no longer confused with "Go down"; "Discard selected" is now "Discard". Both show "(selection)" underneath.',
      'Fixed the hint on greyed-out buttons staying on screen after a tap on touch screens.',
      'The strip at the bottom of the screen on phones now matches the table background instead of showing white.',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-11-15',
    changes: [
      'Emptying your hand now pays double: every other player pays you 2 bets.',
      'The default bet is now 5 coins (starting coins stay at 50).',
      'You can rearrange your cards again once a hand has finished.',
      'The message for a player who ran out of coins is shorter.',
    ],
  },
  {
    version: '0.14.1',
    date: '2026-11-15',
    changes: [
      'A player who disconnects now gets the full turn timer before a bot plays for them, just like an idle player.',
      'On phones, switching to another app no longer leaves you disconnected: the game reconnects as soon as you come back.',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-11-15',
    changes: [
      'A player who disconnects is no longer removed after the hand: a bot keeps playing their seat and they can come back at any time. The host can still kick them.',
      'The host can lock a table with a password. Locked tables show a lock in the lobby and ask for the password.',
      'Every table has an invite link you can copy and send to friends; it takes them straight to the table (with the password already filled in if the host has set one).',
      'Guests can now join the game: "Take over" a bot (even in the middle of a hand, keeping its cards and coins) or "Join the game" when a seat is free.',
    ],
  },
  {
    version: '0.13.1',
    date: '2026-11-13',
    changes: [
      '"Put down selected" and "Discard selected" are greyed out like "Go down" until you have drawn, and all three now explain why with a tooltip.',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-11-13',
    changes: [
      'The turn timer is now 2 minutes. Nothing is shown for the first minute; the countdown and warning only appear for the last minute. The host of the server can change both times.',
      'A single human playing against bots no longer has a turn timer; the table just closes if nothing happens for a while.',
      'The host can now pause and resume the game with a button in the side panel. While paused nobody can move and the timers wait.',
    ],
  },
  {
    version: '0.12.3',
    date: '2026-11-13',
    changes: ['The credits now stay at the very bottom of the screen instead of sitting right under the open tables.'],
  },
  {
    version: '0.12.2',
    date: '2026-11-13',
    changes: ['The credits (at the bottom of the main page) now also mention Gemini.'],
  },
  {
    version: '0.12.1',
    date: '2026-11-13',
    changes: ['Bots are now marked with a small helmet icon instead of a star, and the star now marks the host (the table creator).'],
  },
  {
    version: '0.12.0',
    date: '2026-11-13',
    changes: [
      'A player who takes longer than 90 seconds on their turn is now replaced by a bot until they make a move or press "Take back control"; the log tells everyone.',
      'Names are unique at a table: a second "Alice" shows up as "Alice the Second".',
      'Someone joining after hands were played starts with the average number of coins at the table instead of a full stack.',
      'Kicking a player now also blocks their browser from that table, not just their current tab.',
      'The page no longer redraws everything on each update, so scrolling, typing and animations are smoother.',
      'The game reconnects with growing pauses after a lost connection and shows a countdown.',
      'Fixed a way to crash the server with a bad web address, and a way to inflate the online player count.',
      'Fonts and pages are now cached much better, so the page loads faster on repeat visits.',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-13',
    changes: ['The lobby now shows how many players are connected next to the list of open tables.'],
  },
  {
    version: '0.10.5',
    date: '2026-11-13',
    changes: ['Fixed the Changelog dialog showing "[object HTMLHeadingElement]" text instead of the version entries.'],
  },
  {
    version: '0.10.4',
    date: '2026-11-13',
    changes: [
      'Script files are now requested with the version in their address, so a browser holding an old cached copy loads the new one after an update.',
    ],
  },
  {
    version: '0.10.3',
    date: '2026-11-13',
    changes: [
      'The "You can only go down at the start of your turn" hint now appears instantly when you hover the greyed-out Go down button.',
    ],
  },
  {
    version: '0.10.1',
    date: '2026-11-13',
    changes: ['The "new version available" note at the bottom is now clickable and reloads the page onto the new version.'],
  },
  {
    version: '0.10.0',
    date: '2026-11-13',
    changes: [
      'Body text now uses EB Garamond; Cinzel is kept for titles, buttons and cards.',
      'The table settings number boxes now match the dark theme instead of a plain white background.',
    ],
  },
  {
    version: '0.9.3',
    date: '2026-11-13',
    changes: [
      '"Settings" for the starting coins and the bet are now called "Table rules", and the bet is shown next to Coins during the game.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-13',
    changes: [
      'Switched the game font to Cinzel, a Trajan-style serif. The chat and game log keep a plainer serif so they stay easy to read.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-13',
    changes: ['New gritty dark-fantasy look: charcoal and slate, rust brown, worn parchment cards and tarnished brass accents.'],
  },
  {
    version: '0.7.1',
    date: '2026-11-13',
    changes: ['Added credits and a feedback address at the bottom of the main page.'],
  },
  {
    version: '0.7.0',
    date: '2026-11-13',
    changes: ['Added a Settings popup with sliders for the font size and the card size.'],
  },
  {
    version: '0.6.0',
    date: '2026-11-13',
    changes: ['Added this changelog, readable from the main page.'],
  },
  {
    version: '0.5.1',
    date: '2026-11-13',
    changes: ['Simpler wording for bot and TONK result messages.'],
  },
  {
    version: '0.5.0',
    date: '2026-11-13',
    changes: [
      'Points are now coins. The host sets the starting coins and the bet before the game starts.',
      'A player who loses their last coin becomes a guest and keeps watching; bots are thrown out.',
      'The hand panel is centered and the go-down warning is shown as a tooltip.',
    ],
  },
  {
    version: '0.4.1',
    date: '2026-11-13',
    changes: ['The default port changed from 3000 to 3100.', 'Plainer wording for laying off, and a glossary in the rules.'],
  },
  {
    version: '0.4.0',
    date: '2026-11-13',
    changes: [
      'Guests are shown in the chat and in the kick list.',
      'The Go down button is greyed out with a hint when it cannot be used, and the hand value line is styled.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-12',
    changes: [
      'Bots take over for disconnected players.',
      'Bots can only be removed between hands.',
      'Spreads you put down are shown in front of each player\u2019s hand.',
      'A shorter game log.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-12',
    changes: ['Kick and remove controls moved to the side player list.'],
  },
  {
    version: '0.1.1',
    date: '2026-11-12',
    changes: ['The game is now called Black Company Tonk.', 'The client and server version is shown at the bottom right.'],
  },
];
