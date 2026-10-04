#!/usr/bin/env node
// check-duplicates — frozen helper files that are copied between apps must stay byte-identical (rule R9), and every
// app LICENSE must equal the root LICENSE.
//
// Groups:
//   governance   apps/governance/*/src/engine/safe.ts, .../safe.test.ts, .../src/ui/download.ts
//   assurance    apps/assurance/*/src/ui/files.ts
//   sha256       apps/assurance/packetsmith/src/engine/sha256.ts vs apps/assurance/weft/src/engine/sha256.ts
//   license      apps/*/*/LICENSE vs LICENSE (root is the reference)
//
// Usage: node tools/check-duplicates.mjs [--json] [--strict]
// Exit: 0 all identical, 1 findings, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, discoverApps } from './lib/apps.mjs';
import { parseArgs } from './lib/args.mjs';
import { exists, sha256, firstDifferingLine } from './lib/fsx.mjs';
import { Findings, emit, usage } from './lib/report.mjs';

const USAGE = `usage: node tools/check-duplicates.mjs [--json] [--strict]
  --json     machine-readable output
  --strict   treat warnings as failures`;

const { values, positional, errors } = parseArgs(process.argv.slice(2), { flags: ['json', 'strict'] });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (errors.length || positional.length) process.exit(usage(USAGE, [...errors, ...positional.map((p) => `unexpected argument ${p}`)]));

const { apps } = discoverApps();
const byTrack = (track) => apps.filter((a) => a.track === track);

/** @type {{ name: string, members: { app: string|null, rel: string }[], reference?: string }[]} */
const groups = [
  { name: 'governance src/engine/safe.ts', members: byTrack('governance').map((a) => ({ app: a.dir, rel: `${a.dir}/src/engine/safe.ts` })) },
  { name: 'governance src/engine/safe.test.ts', members: byTrack('governance').map((a) => ({ app: a.dir, rel: `${a.dir}/src/engine/safe.test.ts` })) },
  { name: 'governance src/ui/download.ts', members: byTrack('governance').map((a) => ({ app: a.dir, rel: `${a.dir}/src/ui/download.ts` })) },
  { name: 'assurance src/ui/files.ts', members: byTrack('assurance').map((a) => ({ app: a.dir, rel: `${a.dir}/src/ui/files.ts` })) },
  {
    name: 'assurance src/engine/sha256.ts (packetsmith, weft)',
    members: ['apps/assurance/packetsmith', 'apps/assurance/weft'].map((d) => ({ app: d, rel: `${d}/src/engine/sha256.ts` })),
  },
  { name: 'LICENSE (root is the reference)', members: apps.map((a) => ({ app: a.dir, rel: `${a.dir}/LICENSE` })), reference: 'LICENSE' },
];

const findings = new Findings('check-duplicates');
const groupResults = [];

for (const g of groups) {
  const result = { group: g.name, reference: null, members: [], differing: [], missing: [] };
  const loaded = [];
  for (const m of g.members) {
    const abs = path.join(REPO_ROOT, m.rel);
    if (!exists(abs)) {
      result.missing.push(m.rel);
      findings.error(m.app, 'DUP_MISSING', `${m.rel} is missing (frozen copy expected)`);
      continue;
    }
    const buf = fs.readFileSync(abs);
    loaded.push({ ...m, abs, buf, hash: sha256(buf) });
  }
  if (loaded.length === 0) {
    groupResults.push(result);
    continue;
  }
  let reference;
  if (g.reference) {
    const abs = path.join(REPO_ROOT, g.reference);
    if (!exists(abs)) {
      findings.error(null, 'DUP_REFERENCE_MISSING', `${g.reference} (reference for "${g.name}") is missing`);
      groupResults.push(result);
      continue;
    }
    const buf = fs.readFileSync(abs);
    reference = { rel: g.reference, buf, hash: sha256(buf) };
  } else {
    // Majority hash wins; ties resolve to the alphabetically first member so the output is deterministic.
    const tally = new Map();
    for (const l of loaded) tally.set(l.hash, (tally.get(l.hash) ?? 0) + 1);
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || loaded.find((l) => l.hash === a[0]).rel.localeCompare(loaded.find((l) => l.hash === b[0]).rel))[0][0];
    reference = loaded.find((l) => l.hash === best);
  }
  result.reference = { path: reference.rel, sha256: reference.hash };
  for (const l of loaded) {
    const same = l.hash === reference.hash;
    result.members.push({ path: l.rel, sha256: l.hash, identical: same });
    if (!same) {
      const diff = firstDifferingLine(reference.buf.toString('utf8'), l.buf.toString('utf8'));
      const detail = diff
        ? [`first difference at line ${diff.line}`, `reference (${reference.rel}): ${truncate(diff.a)}`, `this file: ${truncate(diff.b)}`]
        : ['byte content differs (line text identical — line endings or encoding)'];
      result.differing.push({ path: l.rel, firstDifferingLine: diff ? diff.line : null });
      findings.error(l.app, 'DUP_DIFFERS', `${l.rel} differs from ${reference.rel}`, detail);
    }
  }
  groupResults.push(result);
}

function truncate(s, n = 140) {
  const t = String(s).replace(/\t/g, '  ');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

if (!values.json) {
  for (const g of groupResults) {
    const total = g.members.length + g.missing.length;
    const bad = g.differing.length + g.missing.length;
    process.stdout.write(`${bad === 0 ? 'OK   ' : 'FAIL '} ${g.group}: ${total} member(s), ${bad} differing/missing${g.reference ? `, reference ${g.reference.path}` : ''}\n`);
  }
}

process.exit(emit(findings, { json: values.json, strict: values.strict, apps: apps.map((a) => a.dir), extra: { groups: groupResults }, quietOk: true }));
