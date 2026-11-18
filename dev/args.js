'use strict';
// Tiny command-line option parser for the developer tools.
// spec: { name: { type: 'number' | 'string' | 'list' | 'boolean', default, help } }; options are written --name value
// (camelCase names are written with dashes: maxHands is --max-hands).

const dashed = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv, spec, { usage, about = '' }) {
  const out = {};
  for (const [name, def] of Object.entries(spec)) out[name] = def.default;
  const printHelp = () => {
    const lines = [`Usage: ${usage}`, '', about, '', 'Options:'];
    for (const [name, def] of Object.entries(spec)) {
      const shown = def.default === undefined || def.default === false ? '' : ` (default: ${[].concat(def.default).join(',')})`;
      lines.push(`  --${dashed(name)}${def.type === 'boolean' ? '' : ` <${def.type}>`}  ${def.help}${shown}`);
    }
    lines.push('  --help  show this text');
    console.log(lines.join('\n'));
  };
  const names = new Map(Object.keys(spec).map((name) => [dashed(name), name]));
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    const name = arg.startsWith('--') ? names.get(arg.slice(2)) : undefined;
    if (!name) fail(`Unknown option ${arg}. Try --help.`);
    const { type } = spec[name];
    if (type === 'boolean') {
      out[name] = true;
      continue;
    }
    const raw = argv[++i];
    if (raw === undefined) fail(`${arg} needs a value.`);
    if (type === 'number') {
      out[name] = Number(raw);
      if (!Number.isFinite(out[name])) fail(`${arg} must be a number, not "${raw}".`);
    } else if (type === 'list') {
      out[name] = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      out[name] = raw;
    }
  }
  return out;
}

module.exports = { parseArgs, fail };
