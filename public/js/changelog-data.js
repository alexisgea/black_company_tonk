// Newest first. Add an entry here whenever the version in package.json is bumped.
export const CHANGELOG = [
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
