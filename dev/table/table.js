'use strict';
// The page of the dev table (see dev/table.js). Plain script, no build step. Everything shown is for a developer.
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♣', '♦', '♥', '♠'];
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cardNode(card, extra = '') {
  const suit = Math.floor(card / 13);
  return el('span', `card${suit === 1 || suit === 2 ? ' red' : ''} ${extra}`.trim(), RANKS[card % 13] + SUITS[suit]);
}

function cardRow(cards) {
  const row = el('div', 'cards');
  if (!cards.length) row.append(el('span', 'total', 'no cards'));
  for (const card of cards) row.append(cardNode(card));
  return row;
}

const number = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

function renderPlayers(state) {
  const box = $('players');
  box.replaceChildren();
  for (const p of state.players) {
    const panel = el('div', `panel player${p.turn ? ' turn' : ''}${p.seated ? '' : ' gone'}`);
    const top = el('div', 'top');
    top.append(
      el('span', '', `${p.name}${p.turn ? '  ◀ to move' : ''}${p.seated ? '' : '  (broke)'}`),
      el('span', 'coins', `${p.coins} coins`),
    );
    panel.append(top);
    const knobs = Object.entries(p.knobs).map(([k, v]) => `${k} ${number(v)}`);
    const mood = p.boldness === null ? '' : ` | boldness now ${number(p.boldness)}, confidence ${number(p.confidence)}`;
    panel.append(el('div', 'knobs', knobs.join(', ') + mood));
    if (p.hand) {
      const cards = cardRow(p.hand);
      if (p.hand.length) cards.append(el('span', 'total', `total ${p.total}`));
      panel.append(cards);
    }
    box.append(panel);
  }
}

function renderBoard(state) {
  const box = $('board');
  box.replaceChildren();
  const panel = el('div', 'panel');
  const row = (label, content) => {
    const r = el('div', 'board-row');
    r.append(el('span', 'label', label), content);
    return r;
  };
  panel.append(row('Draw pile', el('span', '', `${state.deck} cards`)));
  const pile = el('span', 'cards');
  state.discard.slice(-8).forEach((card, i, list) => pile.append(cardNode(card, i === list.length - 1 ? 'top' : '')));
  if (!state.discard.length) pile.append(el('span', 'total', 'empty'));
  panel.append(row(`Discards (${state.discard.length}, top on the right)`, pile));
  if (!state.melds.length) panel.append(row('Spreads', el('span', 'total', 'none')));
  for (const meld of state.melds) {
    const cards = el('span', 'cards');
    for (const card of meld.cards) cards.append(cardNode(card));
    panel.append(row(`#${meld.id} ${meld.type} (${meld.owner})`, cards));
  }
  box.append(panel);
}

function renderLog(state) {
  const box = $('log');
  box.replaceChildren();
  const entries = [...state.entries].reverse();
  const latestMove = entries.find((e) => e.kind === 'move');
  for (const e of entries) {
    if (e.kind !== 'move') {
      box.append(el('div', `entry ${e.kind}`, e.text));
      continue;
    }
    const details = el('details', 'entry move');
    details.open = e === latestMove;
    const summary = el('summary');
    const meta = `(hand ${e.hand}, ${e.phase} phase${e.effort === null ? '' : `, effort ${number(e.effort)}`})`;
    summary.append(el('span', 'who', e.name), ` ${e.action} `, el('span', 'meta', meta));
    details.append(summary, el('pre', 'thinking', e.thinking.join('\n')));
    box.append(details);
  }
  if (!entries.length) box.append(el('div', 'entry note', 'Nothing has happened yet. Press Next to deal.'));
}

function render(state) {
  $('status').textContent = state.handNo
    ? `Hand ${state.handNo}, ${state.status === 'playing' ? state.phase : 'finished'} | seed ${state.options.seed}`
    : `Seed ${state.options.seed}`;
  $('next').textContent = `Next: ${state.upNext}`;
  renderPlayers(state);
  renderBoard(state);
  renderLog(state);
}

async function call(path, body) {
  const init =
    body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let busy = false;
async function next() {
  if (busy) return;
  busy = true;
  $('next').disabled = true;
  try {
    render(await call('/api/next', {}));
  } catch (err) {
    $('status').textContent = `Error: ${err.message}`;
  } finally {
    busy = false;
    $('next').disabled = false;
    $('next').focus();
  }
}

async function buildRoster(state) {
  const box = $('roster');
  for (const bot of await call('/api/roster')) {
    const label = el('label');
    const check = el('input');
    check.type = 'checkbox';
    check.value = bot.id;
    check.checked = state.options.bots.includes(bot.id);
    label.append(check, ` ${bot.name}`);
    box.append(label);
  }
  $('coins').value = state.options.coins;
  $('bet').value = state.options.bet;
}

$('next').addEventListener('click', next);
document.addEventListener('keydown', (event) => {
  const onControl = event.target.closest('input, button, summary');
  if (!onControl && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    next();
  }
});

$('new-table').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('form-error').textContent = '';
  const bots = [...document.querySelectorAll('#roster input:checked')].map((input) => input.value);
  const seed = $('seed').value === '' ? undefined : Number($('seed').value);
  try {
    render(await call('/api/new', { bots, seed, coins: Number($('coins').value), bet: Number($('bet').value) }));
    $('settings').open = false;
  } catch (err) {
    $('form-error').textContent = err.message;
  }
});

call('/api/state').then((state) => {
  render(state);
  return buildRoster(state);
});
