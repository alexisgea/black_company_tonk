#!/usr/bin/env node
'use strict';
// The dev table: a table of bots only, played one move at a time from a browser page (see devtable.js).
// Everybody's cards are face up, and each move comes with what the bot was thinking. Only for this machine.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PROFILES } = require('../server/botprofiles');
const { MAX_PLAYERS, MIN_PLAYERS } = require('../server/tonk');
const { parseArgs, fail } = require('./args');
const { DevTable } = require('./devtable');
const { botName, DEFAULT_OPTIONS } = require('./sim');

const opts = parseArgs(
  process.argv.slice(2),
  {
    port: { type: 'number', default: 3200, help: 'port to listen on (this machine only)' },
    bots: { type: 'list', default: [], help: 'the bots at the table, 2 to 5 character ids (default: the first four in botprofiles.js)' },
    seed: { type: 'number', default: undefined, help: 'the same seed deals the same cards (default: random)' },
    coins: { type: 'number', default: DEFAULT_OPTIONS.coins, help: 'starting coins' },
    bet: { type: 'number', default: DEFAULT_OPTIONS.bet, help: 'coins one bet is worth' },
  },
  {
    usage: 'npm run dev:table -- [options]',
    about: 'Opens a table where only bots play. Click "Next" and the next bot makes its move and shows how it thought.',
  },
);

const roster = Object.keys(PROFILES);
const MAX_BODY = 10000;
const FILES = { '/': 'table.html', '/table.js': 'table.js', '/table.css': 'table.css' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function makeTable({ bots, seed, coins, bet }) {
  if (bots.length < MIN_PLAYERS || bots.length > MAX_PLAYERS) throw new Error(`A table needs ${MIN_PLAYERS} to ${MAX_PLAYERS} bots.`);
  const unknown = bots.find((id) => !roster.includes(id));
  if (unknown) throw new Error(`"${unknown}" is not a bot in botprofiles.js.`);
  if (!Number.isInteger(coins) || !Number.isInteger(bet) || bet < 1 || coins < bet) {
    throw new Error('Coins and bet must be whole numbers, the bet at least 1 and no more than the coins.');
  }
  return new DevTable({ bots, seed, coins, bet });
}

let table;
try {
  table = makeTable({ bots: opts.bots.length ? opts.bots : roster.slice(0, 4), seed: opts.seed, coins: opts.coins, bet: opts.bet });
} catch (err) {
  fail(err.message);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('Request too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Not valid JSON.'));
      }
    });
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function handle(req, res) {
  // Only pages opened as localhost may talk to this server (a web page elsewhere must not be able to drive it).
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'Local use only.' });
  const url = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && FILES[url]) {
      const file = FILES[url];
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'table', file)), MIME[path.extname(file)]);
    }
    if (req.method === 'GET' && url === '/api/state') return send(res, 200, table.state());
    if (req.method === 'GET' && url === '/api/roster')
      return send(
        res,
        200,
        roster.map((id) => ({ id, name: botName(id) })),
      );
    if (req.method === 'POST' && url === '/api/next') {
      table.next();
      return send(res, 200, table.state());
    }
    if (req.method === 'POST' && url === '/api/new') {
      const body = await readJson(req);
      table = makeTable({
        bots: Array.isArray(body.bots) ? body.bots.filter((b) => typeof b === 'string') : [],
        seed: Number.isInteger(body.seed) ? body.seed : undefined,
        coins: Number.isInteger(body.coins) ? body.coins : opts.coins,
        bet: Number.isInteger(body.bet) ? body.bet : opts.bet,
      });
      return send(res, 200, table.state());
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (err) {
    console.error(err);
    return send(res, 400, { error: err.message });
  }
}

const server = http.createServer(handle);
server.on('error', (err) => fail(`Cannot listen on port ${opts.port}: ${err.message}`));
server.listen(opts.port, '127.0.0.1', () => console.log(`Dev table: http://localhost:${opts.port}  (Ctrl+C to stop)`));
