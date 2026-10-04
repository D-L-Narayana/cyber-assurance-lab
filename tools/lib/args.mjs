// Minimal argument parser shared by the tools. `--name value`, `--name=value`, repeatable multi-value options
// (also comma-separated), boolean flags, `--` to end option parsing. Unknown options are reported as errors so the
// callers can exit 2 (usage).
export function parseArgs(argv, { flags = [], options = [], multi = [] } = {}) {
  const values = {};
  for (const f of flags) values[f] = false;
  for (const o of options) values[o] = undefined;
  for (const m of multi) values[m] = [];
  values.help = false;
  const positional = [];
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (name === 'help' || name === 'h') {
      values.help = true;
      continue;
    }
    if (flags.includes(name)) {
      if (inline !== undefined) errors.push(`--${name} does not take a value`);
      values[name] = true;
      continue;
    }
    if (options.includes(name) || multi.includes(name)) {
      let v = inline;
      if (v === undefined) {
        if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
          errors.push(`--${name} requires a value`);
          continue;
        }
        v = argv[++i];
      }
      if (multi.includes(name)) values[name].push(...v.split(',').map((s) => s.trim()).filter(Boolean));
      else if (values[name] !== undefined) errors.push(`--${name} given more than once`);
      else values[name] = v;
      continue;
    }
    errors.push(`unknown option --${name}`);
  }
  return { values, positional, errors };
}

/** Parse a positive integer option; returns [value, error]. */
export function intOption(raw, name, { min = 1, max = 64, fallback } = {}) {
  if (raw === undefined) return [fallback, null];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return [fallback, `--${name} must be an integer between ${min} and ${max}`];
  return [n, null];
}
