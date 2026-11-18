'use strict';
// Comparing two runs of the same tables, for the tools that change one seat (the "subject") and watch what it wins.

const subjectOf = (record) => record.seats.find((s) => s.key === 'subject');
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const variance = (xs) => {
  const mean = sum(xs) / xs.length;
  return sum(xs.map((x) => (x - mean) ** 2)) / Math.max(1, xs.length - 1);
};

// Coins per hand of the subject in `records`, and how much it differs from `control`. Both ran the same tables, so the
// difference is worked out table by table (the ratio of coins to hands is linearised) to keep the noise of the deals out
// of it.
function compare(records, control) {
  const a = records.map(subjectOf);
  const c = control.map(subjectOf);
  const rate = (xs) => sum(xs.map((s) => s.coins)) / sum(xs.map((s) => s.hands));
  const meanHands = (xs) => sum(xs.map((s) => s.hands)) / xs.length;
  const [ra, rc, ha, hc] = [rate(a), rate(c), meanHands(a), meanHands(c)];
  const identical = a.every((s, i) => s.coins === c[i].coins && s.hands === c[i].hands);
  const diffs = a.map((s, i) => (s.coins - ra * s.hands) / ha - (c[i].coins - rc * c[i].hands) / hc);
  const stdError = Math.sqrt(variance(diffs) / diffs.length);
  const delta = ra - rc;
  return { coinsPerHand: ra, delta, stdError, z: stdError > 0 ? delta / stdError : 0, identical };
}

module.exports = { compare, subjectOf, sum, variance };
