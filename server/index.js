'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Lobby } = require('./lobby');
const { RateLimiter, clientIp, originAllowed } = require('./limits');
const { version: APP_VERSION } = require('../package.json');

const intEnv = (name, fallback, { allowZero = false } = {}) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && (n > 0 || (allowZero && n === 0)) ? n : fallback;
};

const PORT = intEnv('PORT', 3100);
const HOST = process.env.HOST || undefined; // e.g. 127.0.0.1 when only a local tunnel/proxy should reach the server
// Only set TRUST_PROXY=1 when the server is reachable solely through the proxy (see docs/hosting.md).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIMITS = {
  maxConnections: intEnv('MAX_CONNECTIONS', 300),
  maxConnectionsPerIp: intEnv('MAX_CONNECTIONS_PER_IP', 12),
  connectsPerMinutePerIp: intEnv('CONNECTS_PER_MINUTE_PER_IP', 60),
  messagesPer5Seconds: intEnv('MESSAGES_PER_5_SECONDS', 60),
  maxRooms: intEnv('MAX_ROOMS', 100),
  roomIdleMinutes: intEnv('ROOM_IDLE_MINUTES', 30),
  turnTimeoutSeconds: intEnv('TURN_TIMEOUT_SECONDS', 120, { allowZero: true }),
  turnWarningSeconds: intEnv('TURN_WARNING_SECONDS', 60),
};
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const HOST_HEADER = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d+)?$/i;
// The client has no inline scripts or styles and only talks to its own origin (HTTP and WebSocket).
// Some browsers do not let 'self' cover ws:/wss:, so the WebSocket origin is spelled out from the Host header
// of the request (a visitor can only widen the policy of their own page, to the host they already loaded it from).
function contentSecurityPolicy(host) {
  const sockets = typeof host === 'string' && HOST_HEADER.test(host) ? ` ws://${host} wss://${host}` : '';
  return `default-src 'self'; connect-src 'self'${sockets}; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

// IPv4 addresses other devices on the network can use to reach this machine.
const lanUrls = (port) =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// Appends ?v=<version> to every script and stylesheet URL (HTML <script src>, <link href>, module imports) so a new
// version means new URLs. Browsers and proxies that hold on to old copies then have nothing stale to reuse.
function stampVersion(file, body) {
  const ext = path.extname(file);
  const v = `?v=${encodeURIComponent(APP_VERSION)}`;
  if (ext === '.html') {
    return body
      .toString('utf8')
      .replace(/(<script[^>]*\ssrc="[^"?]+\.js)"/g, `$1${v}"`)
      .replace(/(<link[^>]*\shref="[^"?]+\.css)"/g, `$1${v}"`);
  }
  if (ext === '.js') return body.toString('utf8').replace(/(\b(?:from|import)\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g, `$1$2$3${v}$2`);
  return body;
}

// Fonts never change under the same name, so browsers may keep them for good. Everything else is revalidated
// on every load (cheap: an ETag match answers 304 with no body).
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// Sends a response body with its ETag, answering 304 when the browser already has this exact body.
function respond(req, res, headers, body) {
  const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
  const known = String(req.headers['if-none-match'] || '')
    .split(',')
    .map((s) => s.trim().replace(/^W\//, ''));
  if (known.includes(etag)) {
    res.writeHead(304, { ...headers, ETag: etag }).end();
    return;
  }
  res.writeHead(200, { ...headers, ETag: etag, 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function handleHttp(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  const base = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (pathname === '/version') {
    respond(req, res, { ...base, 'Content-Type': 'application/json' }, JSON.stringify({ version: APP_VERSION }));
    return;
  }
  const page = {
    ...base,
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': contentSecurityPolicy(req.headers.host),
  };
  // The version the client was loaded with, generated from package.json so it has a single source.
  if (pathname === '/js/app-version.js') {
    respond(req, res, { ...page, 'Content-Type': MIME['.js'] }, `export const LOADED_VERSION = ${JSON.stringify(APP_VERSION)};\n`);
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  // /shared/* (rules used by both sides) comes from the top-level shared folder, everything else from public.
  const shared = pathname.startsWith('/shared/');
  const root = shared ? SHARED_DIR : PUBLIC_DIR;
  const file = path.normalize(path.join(root, shared ? pathname.slice('/shared'.length) : pathname));
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const headers = { ...page, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
    if (!shared && pathname.startsWith('/fonts/')) headers['Cache-Control'] = IMMUTABLE_CACHE;
    respond(req, res, headers, stampVersion(file, body));
  });
}

const server = http.createServer((req, res) => {
  try {
    handleHttp(req, res);
  } catch (err) {
    console.error('HTTP request failed:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

const lobby = new Lobby({
  maxRooms: LIMITS.maxRooms,
  roomIdleMs: LIMITS.roomIdleMinutes * 60000,
  turnTimeoutMs: LIMITS.turnTimeoutSeconds * 1000,
  turnWarningMs: LIMITS.turnWarningSeconds * 1000,
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const openByIp = new Map(); // ip -> open connection count
const connectLimiters = new Map(); // ip -> RateLimiter for new connections

// Checks run before the WebSocket handshake is accepted, so abusive clients cost almost nothing.
server.on('upgrade', (req, socket, head) => {
  const reject = (code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };
  const ip = clientIp(req, TRUST_PROXY);
  if (!originAllowed(req.headers.origin, req.headers.host, ALLOWED_ORIGINS)) return reject(403, 'Forbidden');
  if (wss.clients.size >= LIMITS.maxConnections) return reject(503, 'Service Unavailable');
  if ((openByIp.get(ip) || 0) >= LIMITS.maxConnectionsPerIp) return reject(429, 'Too Many Requests');
  if (!connectLimiters.has(ip)) connectLimiters.set(ip, new RateLimiter(LIMITS.connectsPerMinutePerIp, 60000));
  if (!connectLimiters.get(ip).hit()) return reject(429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.ip = ip;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  openByIp.set(ws.ip, (openByIp.get(ws.ip) || 0) + 1);
  ws.isAlive = true;
  const messages = new RateLimiter(LIMITS.messagesPer5Seconds, 5000);
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (data) => {
    if (ws.readyState !== ws.OPEN) return;
    if (!messages.hit()) {
      ws.close(1008, 'Too many messages');
      return;
    }
    lobby.handle(ws, data.toString());
  });
  ws.on('close', () => {
    const left = (openByIp.get(ws.ip) || 1) - 1;
    if (left > 0) openByIp.set(ws.ip, left);
    else openByIp.delete(ws.ip);
    try {
      lobby.disconnect(ws);
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  });
  ws.on('error', () => {});
});

// Drop dead sockets so their players hit the disconnect grace timer, and forget idle rate limiters.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [ip, limiter] of connectLimiters) if (limiter.idle()) connectLimiters.delete(ip);
  try {
    lobby.sweepIdleRooms();
  } catch (err) {
    console.error('Idle sweep failed:', err);
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  const { address, port } = server.address();
  const loopbackOnly = address === '127.0.0.1' || address === '::1';
  console.log(`Tonk server listening on port ${port} (${loopbackOnly ? 'this machine only' : 'all network interfaces'})`);
  console.log(`  This machine:    http://localhost:${port}`);
  if (loopbackOnly) console.log('  Other devices cannot connect: HOST is set to a loopback address.');
  else for (const url of lanUrls(port)) console.log(`  On your network: ${url}`);
  if (TRUST_PROXY) console.log('TRUST_PROXY is on: client IPs are read from proxy headers.');
});
