'use strict';
// Abuse-protection helpers. Pure functions/classes so they can be unit tested.

// Allows at most `max` hits per `windowMs` (sliding window).
class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = [];
  }

  // Records an attempt. Returns true if it is allowed, false if over the limit.
  hit(now = Date.now()) {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }

  // True when no hit is recent enough to matter, so the limiter can be forgotten.
  idle(now = Date.now()) {
    return this.hits.every((t) => now - t >= this.windowMs);
  }
}

// The address to limit by. Behind a trusted proxy (e.g. Cloudflare Tunnel) the socket address is
// the proxy itself, so the real client comes from a header. Only enable `trustProxy` when the
// server is reachable exclusively through that proxy, otherwise clients can spoof the header.
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Browsers always send Origin on WebSocket handshakes, so this stops other websites from opening
// connections as a visitor. Clients with no Origin header (bots, scripts) are not browsers and are allowed.
function originAllowed(origin, host, allowedOrigins = []) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

module.exports = { RateLimiter, clientIp, originAllowed };
