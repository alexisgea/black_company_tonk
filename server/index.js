'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Lobby } = require('./lobby');
const { RateLimiter, clientIp, originAllowed } = require('./limits');

const intEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const PORT = intEnv('PORT', 3000);
const HOST = process.env.HOST || undefined; // e.g. 127.0.0.1 when only a local tunnel/proxy should reach the server
// Only set TRUST_PROXY=1 when the server is reachable solely through the proxy (see docs/hosting.md).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMITS = {
  maxConnections: intEnv('MAX_CONNECTIONS', 300),
  maxConnectionsPerIp: intEnv('MAX_CONNECTIONS_PER_IP', 12),
  connectsPerMinutePerIp: intEnv('CONNECTS_PER_MINUTE_PER_IP', 60),
  messagesPer5Seconds: intEnv('MESSAGES_PER_5_SECONDS', 60),
  maxRooms: intEnv('MAX_ROOMS', 100),
};
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(data);
  });
});

const lobby = new Lobby({ maxRooms: LIMITS.maxRooms });
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
    lobby.disconnect(ws);
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
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`Tonk server listening on http://${HOST || 'localhost'}:${PORT}`);
  if (TRUST_PROXY) console.log('TRUST_PROXY is on: client IPs are read from proxy headers.');
});
