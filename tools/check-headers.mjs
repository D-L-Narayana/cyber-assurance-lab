#!/usr/bin/env node
// check-headers — every apps/*/*/vercel.json must carry exactly the canonical header set (tools/lib/contracts.mjs).
//
// Usage: node tools/check-headers.mjs [--only <track|slug>...] [--json] [--strict]
// Exit: 0 all canonical, 1 findings, 2 usage.
import path from 'node:path';
import { discoverApps, filterApps } from './lib/apps.mjs';
import { parseArgs } from './lib/args.mjs';
import { readJson, exists } from './lib/fsx.mjs';
import { Findings, emit, usage } from './lib/report.mjs';
import { CANONICAL_HEADERS, CANONICAL_SOURCE, ALLOWED_TOP_LEVEL_KEYS, diffCsp } from './lib/contracts.mjs';

const USAGE = `usage: node tools/check-headers.mjs [--only <track|slug>...] [--json] [--strict]
  --only     restrict to tracks/slugs/dirs (repeatable or comma-separated)
  --json     machine-readable output
  --strict   treat warnings as failures`;

const { values, positional, errors } = parseArgs(process.argv.slice(2), { flags: ['json', 'strict'], multi: ['only'] });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (errors.length || positional.length) process.exit(usage(USAGE, [...errors, ...positional.map((p) => `unexpected argument ${p}`)]));

const discovered = discoverApps();
const { apps, unmatched } = filterApps(discovered.apps, values.only);
if (unmatched.length) process.exit(usage(USAGE, unmatched.map((u) => `--only ${u} matched no app`)));
if (!apps.length) process.exit(usage(USAGE, ['no apps found under apps/']));

const findings = new Findings('check-headers');
const canonicalByKey = new Map(CANONICAL_HEADERS.map((h) => [h.key.toLowerCase(), h]));

for (const app of apps) {
  const file = path.join(app.abs, 'vercel.json');
  if (!exists(file)) {
    findings.error(app.dir, 'HDR_FILE_MISSING', 'vercel.json is missing');
    continue;
  }
  const parsed = readJson(file);
  if (!parsed.ok) {
    findings.error(app.dir, 'HDR_FILE_INVALID', `vercel.json: ${parsed.error}`);
    continue;
  }
  const cfg = parsed.value;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    findings.error(app.dir, 'HDR_FILE_INVALID', 'vercel.json must contain a JSON object');
    continue;
  }
  for (const key of Object.keys(cfg)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) findings.error(app.dir, 'HDR_EXTRA_TOPLEVEL_KEY', `unexpected top-level key "${key}"`);
  }
  if (cfg.cleanUrls !== true) {
    findings.error(app.dir, 'HDR_CLEANURLS', cfg.cleanUrls === undefined ? '"cleanUrls": true is missing' : `"cleanUrls" must be true (is ${JSON.stringify(cfg.cleanUrls)})`);
  }
  if (!Array.isArray(cfg.headers) || cfg.headers.length === 0) {
    findings.error(app.dir, 'HDR_BLOCK_MISSING', '"headers" array is missing or empty');
    continue;
  }
  const blocks = cfg.headers.filter((b) => b && typeof b === 'object');
  const main = blocks.find((b) => b.source === CANONICAL_SOURCE);
  if (!main) {
    findings.error(app.dir, 'HDR_SOURCE', `no header block with "source": "${CANONICAL_SOURCE}" (found: ${blocks.map((b) => JSON.stringify(b.source)).join(', ') || 'none'})`);
    continue;
  }
  for (const b of blocks) {
    if (b !== main) findings.error(app.dir, 'HDR_EXTRA_SOURCE', `extra header block for source ${JSON.stringify(b.source)} (only "${CANONICAL_SOURCE}" is expected)`);
  }
  const actual = Array.isArray(main.headers) ? main.headers.filter((h) => h && typeof h === 'object' && typeof h.key === 'string') : [];
  const seen = new Map();
  for (const h of actual) {
    const lk = h.key.toLowerCase();
    if (seen.has(lk)) {
      findings.error(app.dir, 'HDR_DUPLICATE', `header "${h.key}" appears more than once`);
      continue;
    }
    seen.set(lk, h);
  }
  const missing = [];
  const differing = [];
  for (const c of CANONICAL_HEADERS) {
    const got = seen.get(c.key.toLowerCase());
    if (!got) {
      missing.push(c.key);
      continue;
    }
    if (got.key !== c.key) findings.error(app.dir, 'HDR_KEY_CASE', `header key spelled "${got.key}", expected "${c.key}"`);
    if (String(got.value) !== c.value) {
      const detail = [`expected: ${c.value}`, `actual:   ${got.value}`];
      if (c.key === 'Content-Security-Policy') detail.push(...diffCsp(c.value, String(got.value)).map((l) => `  ${l}`));
      differing.push({ key: c.key, detail });
    }
  }
  const extra = [...seen.values()].filter((h) => !canonicalByKey.has(h.key.toLowerCase())).map((h) => h.key);
  for (const key of missing) findings.error(app.dir, 'HDR_MISSING', `missing header ${key}`);
  for (const d of differing) findings.error(app.dir, 'HDR_VALUE', `header ${d.key} differs`, d.detail);
  for (const key of extra) findings.error(app.dir, 'HDR_EXTRA', `extra header ${key} is not part of the canonical set`);
}

process.exit(
  emit(findings, {
    json: values.json,
    strict: values.strict,
    apps: apps.map((a) => a.dir),
    extra: { canonical: { source: CANONICAL_SOURCE, headers: CANONICAL_HEADERS, allowedTopLevelKeys: [...ALLOWED_TOP_LEVEL_KEYS] } },
  }),
);
