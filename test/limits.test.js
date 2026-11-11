'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter, clientIp, originAllowed } = require('../server/limits');

test('RateLimiter: allows max hits per window then recovers', () => {
  const limiter = new RateLimiter(3, 1000);
  assert.equal(limiter.hit(0), true);
  assert.equal(limiter.hit(100), true);
  assert.equal(limiter.hit(200), true);
  assert.equal(limiter.hit(300), false);
  assert.equal(limiter.hit(900), false);
  assert.equal(limiter.hit(1001), true); // the first hit has left the window
  assert.equal(limiter.idle(1002), false);
  assert.equal(limiter.idle(5000), true);
});

test('clientIp: only trusts proxy headers when told to', () => {
  const req = (headers) => ({ headers, socket: { remoteAddress: '10.0.0.5' } });
  assert.equal(clientIp(req({ 'cf-connecting-ip': '1.2.3.4' }), false), '10.0.0.5');
  assert.equal(clientIp(req({ 'cf-connecting-ip': '1.2.3.4' }), true), '1.2.3.4');
  assert.equal(clientIp(req({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }), true), '5.6.7.8');
  assert.equal(clientIp(req({}), true), '10.0.0.5');
  assert.equal(clientIp({ headers: {}, socket: {} }, false), 'unknown');
});

test('originAllowed: same host, allow-list, missing origin; everything else refused', () => {
  assert.equal(originAllowed(undefined, 'game.example.com'), true); // not a browser
  assert.equal(originAllowed('https://game.example.com', 'game.example.com'), true);
  assert.equal(originAllowed('http://localhost:3000', 'localhost:3000'), true);
  assert.equal(originAllowed('https://evil.example.net', 'game.example.com'), false);
  assert.equal(originAllowed('https://game.example.com.evil.net', 'game.example.com'), false);
  assert.equal(originAllowed('not a url', 'game.example.com'), false);
  assert.equal(originAllowed('https://other.example.org', 'game.example.com', ['https://other.example.org']), true);
});
