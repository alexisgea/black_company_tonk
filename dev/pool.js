'use strict';
// Plays many sessions at once on worker threads (one per core, less one) and hands the results back in order.
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { playSession } = require('./sim');

const defaultWorkers = () => Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1);

// sessions: [{ seats, seed, coins?, bet?, maxHands? }]. onProgress(done, total) is called as chunks finish.
async function playSessions(sessions, { workers = defaultWorkers(), onProgress } = {}) {
  if (workers <= 1 || sessions.length < 2) {
    return sessions.map((s, i) => {
      const result = playSession(s);
      onProgress?.(i + 1, sessions.length);
      return result;
    });
  }
  const chunkSize = Math.max(1, Math.min(50, Math.ceil(sessions.length / (workers * 4))));
  const chunks = [];
  for (let start = 0; start < sessions.length; start += chunkSize)
    chunks.push({ id: chunks.length, start, sessions: sessions.slice(start, start + chunkSize) });
  const results = new Array(sessions.length);
  let next = 0;
  let done = 0;
  await new Promise((resolve, reject) => {
    const pool = [];
    const finish = (err) => {
      for (const w of pool) w.terminate();
      if (err) reject(err);
      else resolve();
    };
    const feed = (worker) => {
      if (next < chunks.length) worker.postMessage(chunks[next++]);
    };
    for (let i = 0; i < Math.min(workers, chunks.length); i++) {
      const worker = new Worker(path.join(__dirname, 'worker.js'));
      pool.push(worker);
      worker.on('message', ({ id, error, records }) => {
        if (error) return finish(new Error(error));
        const chunk = chunks[id];
        records.forEach((record, k) => (results[chunk.start + k] = record));
        done += records.length;
        onProgress?.(done, sessions.length);
        if (done === sessions.length) finish();
        else feed(worker);
      });
      worker.on('error', finish);
      feed(worker);
    }
  });
  return results;
}

module.exports = { playSessions, defaultWorkers };
