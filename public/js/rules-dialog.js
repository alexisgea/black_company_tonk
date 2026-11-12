// Rules popup: built once, lives outside #app so game updates never reset it.
import { h } from './dom.js';

const rulesEl = document.getElementById('rules');

function buildRules() {
  const section = (title, items) => [
    h('h3', null, title),
    h(
      'ul',
      null,
      items.map((t) => h('li', null, t)),
    ),
  ];
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rules' },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', null, 'Tonk rules'),
      h('span', { class: 'spacer' }),
      h('button', { onClick: closeRules }, 'Close'),
    ),
    section('Goal', [
      'This game is played by 3 to 5 players.',
      'Win the hand in one of two ways: have the lowest total when a player goes down, or get rid of all your cards. The losers pay the winner.',
    ]),
    section('Card values', ['Ace = 1. Cards 2\u201310 = the number on the card. Jack, Queen and King = 10 each.']),
    section('The deal', [
      'Each player gets 5 cards. One card is turned face up to start the discard pile. The other cards form the draw pile. The player to the left of the dealer plays first.',
      'TONK: right after the deal, if your hand total is 15 or less, or 49 or more, you win immediately. Every other player pays you double (2). If two or more players have Tonk, nobody wins and the cards are dealt again. You can only get Tonk right after the deal, never later in the hand.',
    ]),
    section('Your turn \u2013 choose one option', [
      'Go down (only at the start of your turn): you show your hand and say its total. Everyone\u2019s totals are compared.',
      'If your total is lower than every other player\u2019s total, you win. Each other player pays you 1.',
      'If any other player has the same total as you or a lower one, you lose. A tie is a loss for you, not a win. You pay 2 to each player whose total is the same as yours or lower. Each player with a higher total pays 1 to the player with the lowest total.',
      'Normal play: take the top card of the draw pile or the top card of the discard pile. Then you may put down sets and spreads (see below) and add cards to spreads. At the end of your turn, discard one card.',
    ]),
    section('Putting cards down', [
      'Set: 3 or 4 cards with the same number or letter (for example 8-8-8).',
      'Spread: 3 or more cards of the same suit in number order (for example 4-5-6 of hearts). Ace is only low: A-2-3 is allowed, but Q-K-A is not. You cannot continue from King to Ace.',
      'To put cards down, select them in your hand and press \u201cPut down selected\u201d. Cards you put down do not count in your hand total.',
      'You can add cards to either end of any spread on the table, including spreads of other players: select a card, then click the spread. You cannot add cards to sets.',
    ]),
    section('Winning by emptying your hand', [
      'If you have no cards left during your turn (after putting cards down, adding to a spread, or discarding your last card), you win. Every other player pays you 1.',
    ]),
    section('Other', [
      'If the draw pile is empty, the discard pile is shuffled to make a new draw pile. The top discard card stays in place.',
      'The scores in the side panel are running totals for this game: money won (+) and money paid (\u2212).',
    ]),
    h('h3', null, 'Credits'),
    h(
      'ul',
      null,
      h('li', null, h('a', { href: 'https://www.bsfs.org/bsfstonk.htm', target: '_blank', rel: 'noopener noreferrer' }, 'BSFS \u2013 Tonk')),
      h('li', null, h('a', { href: 'http://www.gamecabinet.com/rules/Tonk.html', target: '_blank', rel: 'noopener noreferrer' }, 'Game Cabinet \u2013 Tonk')),
    ),
  );
  rulesEl.replaceChildren(dialog);
  rulesEl.addEventListener('click', (e) => e.target === rulesEl && closeRules());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeRules());
}

function openRules() {
  rulesEl.hidden = false;
  rulesEl.querySelector('.dialog').scrollTop = 0;
}

function closeRules() {
  rulesEl.hidden = true;
}

export const rulesButton = () => h('button', { class: 'secondary', onClick: openRules }, 'Rules');
buildRules();
