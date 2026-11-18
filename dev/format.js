'use strict';
// Plain-text tables for the developer tools.

// columns: [{ title, align?: 'left' | 'right', get: (row) => string }]
function table(rows, columns) {
  const cells = rows.map((row) => columns.map((c) => String(c.get(row))));
  const widths = columns.map((c, i) => Math.max(c.title.length, ...cells.map((r) => r[i].length)));
  const pad = (text, i) => (columns[i].align === 'left' ? text.padEnd(widths[i]) : text.padStart(widths[i]));
  const lines = [columns.map((c, i) => pad(c.title, i)).join('  '), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const r of cells) lines.push(r.map((text, i) => pad(text, i)).join('  '));
  return lines.join('\n');
}

const signed = (x, digits = 2) => (x > 0 ? '+' : x < 0 ? '-' : ' ') + Math.abs(x).toFixed(digits);
const percent = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;

module.exports = { table, signed, percent };
