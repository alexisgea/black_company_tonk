// Newest first. Add an entry here whenever the version in package.json is bumped.
export const CHANGELOG = [
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
