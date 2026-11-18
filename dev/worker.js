'use strict';
// A worker thread for pool.js: plays the sessions it is sent.
const { parentPort } = require('worker_threads');
const { playSession } = require('./sim');

parentPort.on('message', ({ id, sessions }) => {
  try {
    parentPort.postMessage({ id, records: sessions.map(playSession) });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err.stack ?? err) });
  }
});
