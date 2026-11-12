'use strict';
// Boots the real server process with tiny limits and checks the abuse protections end to end.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
    child.on('exit', () => reject(new Error('server exited early')));
  });
  return { port, stop: () => child.kill() };
}

// Resolves { open: ws } or { status } when the handshake is refused.
function connect(port, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    ws.on('open', () => resolve({ open: ws }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.on('error', () => {});
  });
}

test('server abuse limits', async (t) => {
  const server = await startServer({
    MAX_CONNECTIONS_PER_IP: '3',
    MESSAGES_PER_5_SECONDS: '10',
    MAX_ROOMS: '100',
  });
  t.after(() => server.stop());
  const sockets = [];
  t.after(() => sockets.forEach((ws) => ws.terminate()));

  await t.test('wrong Origin is refused, matching or missing Origin is accepted', async () => {
    const bad = await connect(server.port, { Origin: 'https://evil.example.net' });
    assert.equal(bad.status, 403);
    const same = await connect(server.port, { Origin: `http://127.0.0.1:${server.port}` });
    assert.ok(same.open);
    same.open.close();
    const none = await connect(server.port);
    assert.ok(none.open);
    none.open.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  await t.test('static files carry hardening headers', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });

  await t.test('serves the client modules and the shared rules, and nothing outside those folders', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const shared = await fetch(`${base}/shared/cards.js`);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${base}/js/main.js`)).status, 200);
    assert.equal((await fetch(`${base}/shared/..%2fpackage.json`)).status, 403);
    assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
    assert.equal((await fetch(`${base}/shared/../package.json`)).status, 404); // normalised to /package.json, not in public
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  });

  await t.test('/version reports the server version and matches the client version', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/version`);
    assert.equal(res.status, 200);
    const { version } = await res.json();
    assert.equal(version, require('../package.json').version);
    const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'version.js'), 'utf8');
    assert.equal(clientSrc.match(/CLIENT_VERSION = '([^']+)'/)[1], version);
  });

  await t.test('too many connections from one address are refused', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await connect(server.port);
      assert.ok(c.open, `connection ${i + 1} accepted`);
      sockets.push(c.open);
    }
    const fourth = await connect(server.port);
    assert.equal(fourth.status, 429);
    sockets.splice(0).forEach((ws) => ws.close());
    await new Promise((r) => setTimeout(r, 150));
    const again = await connect(server.port); // slots are released when sockets close
    assert.ok(again.open);
    sockets.push(again.open);
  });

  await t.test('message floods get the connection closed', async () => {
    const ws = sockets[0];
    const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    for (let i = 0; i < 30; i++) ws.send('{"t":"hello","name":"x"}');
    assert.equal(await closed, 1008);
  });
});
