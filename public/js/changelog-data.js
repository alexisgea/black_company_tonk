// Newest first. Add an entry here whenever the version in package.json is bumped.
export const CHANGELOG = [
  {
    version: '0.9.3',
    date: '2026-11-13',
    changes: ['"Settings" for the starting coins and the bet are now called "Table rules", and the bet is shown next to Coins during the game.'],
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
