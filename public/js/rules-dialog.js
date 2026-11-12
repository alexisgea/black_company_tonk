// Rules popup: built once, lives outside #app so game updates never reset it.
import { h } from './dom.js';

const rulesEl = document.getElementById('rules');

function buildRules() {
  const section = (title, items) => [h('h3', null, title), h('ul', null, items.map((t) => h('li', null, t)))];
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rules' },
    h('div', { class: 'dialog-head' }, h('h2', null, 'Tonk rules'), h('span', { class: 'spacer' }), h('button', { onClick: closeRules }, 'Close')),
    section('Goal', ['Have the lowest hand total when someone goes down, or get rid of all your cards. Losers pay the winner.']),
    section('Card values', ['Ace = 1, 2\u201310 = face value, Jack / Queen / King = 10.']),
    section('The deal', [
      'Everyone gets 5 cards. One card is flipped to start the discard pile; the rest is the draw pile. Play starts to the left of the dealer.',
      'TONK: right after the deal, a hand totalling 15 or less, or 49 or more, wins on the spot and every other player pays double. If several players have Tonk it is a draw and the hand is redealt. Tonk can only happen on the deal.',
    ]),
    section('Your turn \u2013 choose one path', [
      'Go down (only at the start of your turn): your hand total is compared with everyone\u2019s. If yours is strictly the lowest, you win and each other player pays 1.',
      'If you are not strictly the lowest, you pay double (2) to every player whose total is equal or lower than yours, and the players with a higher total pay the lowest hand 1. Ties lose for the player who went down.',
      'Normal play: take the top card of the draw pile or the discard pile. Then you may put down melds and add to spreads (below). Finish by discarding one card.',
    ]),
    section('Putting cards down', [
      'Set: 3 or 4 cards of the same rank.',
      'Spread: 3 or more cards of the same suit in order (Ace is low only: A-2-3\u2026 J-Q-K, no wrapping from King to Ace).',
      'Select the cards in your hand and press \u201cPut down selected\u201d. Cards put down no longer count toward your total.',
      'You may add a card to either end of any spread on the table, including other players\u2019 spreads: select the card, then click the spread. Sets cannot be added to.',
    ]),
    section('Winning by emptying your hand', [
      'If you get rid of all your cards during your turn (by putting down, adding to a spread, or discarding your last card), you win and every other player pays you 1.',
    ]),
    section('Other', [
      'If the draw pile runs out, the discard pile (except its top card) is reshuffled.',
      'Scores in the side panel are a running total of what each player has won (+) or paid (\u2212) in this game.',
    ]),
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
