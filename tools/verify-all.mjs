#!/usr/bin/env node
// verify-all — install, test, build and audit every standalone app (apps/<track>/<slug> with a package-lock.json)
// and write one machine-readable report that tools/check-docs.mjs can consume (--report).
//
// Per app, sequentially:
//   install  npm ci --ignore-scripts --no-fund --no-audit      (--allow-scripts drops --ignore-scripts)
//   tests    npx vitest run --reporter=default --reporter=json --outputFile.json=<tmp>
//            (counts from the JSON reporter; fallback: the `Tests  N passed (N)` summary on stdout; last resort:
//            `npm test` stdout)
//   build    npm run build                                      (dist/ bytes and file count measured afterwards)
//   audit    npm audit --audit-level=high --json                (high + critical must be 0)
//
// Report JSON: { generatedAt, node, npm, apps: [{ dir, track, slug, install, tests: { total, passed, failed, files },
//                build: { ok, distBytes, distFiles }, audit: { high, critical, ok } }], summary }
//
// Usage: node tools/verify-all.mjs [--only <track|slug>...] [--skip-install] [--skip-tests] [--skip-build] [--skip-audit]
//                                  [--report <file>] [--log-dir <dir>] [--concurrency N] [--step-timeout <seconds>]
//                                  [--allow-scripts] [--json]
// Exit: 0 every selected app passed every step run, 1 at least one failure, 2 usage.
// Notes: apps are processed with --concurrency workers (default 1 — installs and builds are memory-hungry);
//        nothing is written inside apps/ except what npm/vite write themselves (node_modules/, dist/).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, discoverApps, filterApps } from './lib/apps.mjs';
import { parseArgs, intOption } from './lib/args.mjs';
import { dirStats, formatBytes, isDir, readJson } from './lib/fsx.mjs';
import { EXIT_OK, EXIT_FINDINGS, usage } from './lib/report.mjs';
import { formatTable } from './lib/table.mjs';
import { parseVitestJson, parseVitestStdout, parseNpmAuditJson, parseNpmAuditText } from './lib/vitest.mjs';

const USAGE = `usage: node tools/verify-all.mjs [--only <track|slug>...] [--skip-install] [--skip-tests] [--skip-build] [--skip-audit]
                                 [--report <file>] [--log-dir <dir>] [--concurrency N] [--step-timeout <seconds>]
                                 [--allow-scripts] [--json]
  --only           restrict to tracks/slugs/dirs (repeatable or comma-separated)
  --skip-install   do not run npm ci (use the node_modules already present)
  --skip-tests     do not run vitest
  --skip-build     do not run npm run build
  --skip-audit     do not run npm audit
  --report         write the JSON report to this file (directories are created)
  --log-dir        save full per-step output as <dir>/<slug>.<step>.log
  --concurrency    apps processed in parallel (default 1, max 8)
  --step-timeout   kill a step after this many seconds (default 900)
  --allow-scripts  run npm lifecycle scripts during install (default: --ignore-scripts)
  --json           print the report JSON to stdout instead of the table`;

const { values, positional, errors } = parseArgs(process.argv.slice(2), {
  flags: ['skip-install', 'skip-tests', 'skip-build', 'skip-audit', 'allow-scripts', 'json'],
  options: ['report', 'log-dir', 'concurrency', 'step-timeout'],
  multi: ['only'],
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const [concurrency, cErr] = intOption(values.concurrency, 'concurrency', { min: 1, max: 8, fallback: 1 });
const [stepTimeoutSec, tErr] = intOption(values['step-timeout'], 'step-timeout', { min: 10, max: 7200, fallback: 900 });
const argErrors = [...errors, ...positional.map((p) => `unexpected argument ${p}`), cErr, tErr].filter(Boolean);
if (argErrors.length) process.exit(usage(USAGE, argErrors));

const discovered = discoverApps({ requireLockfile: true });
const { apps, unmatched } = filterApps(discovered.apps, values.only);
if (unmatched.length) process.exit(usage(USAGE, unmatched.map((u) => `--only ${u} matched no app with a lockfile`)));
if (!apps.length) process.exit(usage(USAGE, ['no apps with a package-lock.json found under apps/']));

const steps = [];
if (!values['skip-install']) steps.push('install');
if (!values['skip-tests']) steps.push('tests');
if (!values['skip-build']) steps.push('build');
if (!values['skip-audit']) steps.push('audit');
if (!steps.length) process.exit(usage(USAGE, ['every step is skipped; nothing to do']));

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logDir = values['log-dir'] ? path.resolve(process.cwd(), values['log-dir']) : null;
if (logDir) fs.mkdirSync(logDir, { recursive: true });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-all-'));
const npmVersion = (spawnSync(NPM, ['--version'], { encoding: 'utf8' }).stdout || '').trim() || null;
const childEnv = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    let timedOut = false;
    const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, stepTimeoutSec * 1000);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('error', (e) => {
      out += `\n[spawn error] ${e.message}\n`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, out, ms: Date.now() - started, timedOut, command: `${cmd} ${args.join(' ')}` });
    });
  });
}

function saveLog(app, step, r) {
  if (!logDir) return;
  const header = `$ ${r.command}\n# cwd ${app.dir}\n# exit ${r.code === null ? (r.timedOut ? 'timeout' : 'spawn-failure') : r.code} after ${r.ms} ms\n\n`;
  fs.writeFileSync(path.join(logDir, `${app.slug}.${step}.log`), header + r.out);
}

function tail(text, lines = 40) {
  const arr = String(text).trimEnd().split('\n');
  return arr.slice(-lines).join('\n');
}

async function runInstall(app) {
  const args = ['ci', '--no-fund', '--no-audit'];
  if (!values['allow-scripts']) args.splice(1, 0, '--ignore-scripts');
  const r = await run(NPM, args, app.abs);
  saveLog(app, 'install', r);
  return { ok: r.code === 0, exit: r.code, ms: r.ms, timedOut: r.timedOut, out: r.out };
}

async function runTests(app, index) {
  const outputFile = path.join(tmpRoot, `${index}-${app.slug}.json`);
  const r = await run(NPX, ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${outputFile}`], app.abs);
  saveLog(app, 'tests', r);
  let parsed = null;
  const doc = readJson(outputFile);
  if (doc.ok) parsed = parseVitestJson(doc.value);
  if (!parsed) parsed = parseVitestStdout(r.out);
  let fallbackOut = null;
  if (!parsed) {
    // Last resort: the app's own test script (its stdout carries the default reporter summary).
    const f = await run(NPM, ['test'], app.abs);
    saveLog(app, 'tests-npm', f);
    fallbackOut = f.out;
    parsed = parseVitestStdout(f.out);
    if (parsed) {
      parsed.source = 'npm-test-stdout';
      r.code = f.code;
      r.ms += f.ms;
    }
  }
  try {
    fs.rmSync(outputFile, { force: true });
  } catch {
    /* ignore */
  }
  const result = {
    ok: r.code === 0 && !!parsed && parsed.failed === 0 && parsed.total > 0,
    exit: r.code,
    ms: r.ms,
    timedOut: r.timedOut,
    total: parsed ? parsed.total : null,
    passed: parsed ? parsed.passed : null,
    failed: parsed ? parsed.failed : null,
    skipped: parsed ? parsed.skipped : null,
    files: parsed ? parsed.files : null,
    source: parsed ? parsed.source : null,
    out: fallbackOut ?? r.out,
  };
  if (!parsed) result.error = 'could not determine test counts (no JSON reporter file and no "Tests  N passed (N)" summary)';
  else if (parsed.total === 0) result.error = 'no tests were collected';
  return result;
}

async function runBuild(app) {
  const r = await run(NPM, ['run', 'build'], app.abs);
  saveLog(app, 'build', r);
  const dist = path.join(app.abs, 'dist');
  const stats = r.code === 0 && isDir(dist) ? dirStats(dist) : null;
  const built = /✓ built in\s+([\d.]+\s*m?s)/.exec(r.out);
  const result = { ok: r.code === 0 && !!stats && fs.existsSync(path.join(dist, 'index.html')), exit: r.code, ms: r.ms, timedOut: r.timedOut, distBytes: stats ? stats.bytes : null, distFiles: stats ? stats.files : null, builtIn: built ? built[1] : null, out: r.out };
  if (r.code === 0 && !result.ok) result.error = 'build exited 0 but dist/index.html is missing';
  return result;
}

async function runAudit(app) {
  const r = await run(NPM, ['audit', '--audit-level=high', '--json'], app.abs);
  saveLog(app, 'audit', r);
  let counts = null;
  try {
    counts = parseNpmAuditJson(JSON.parse(r.out));
  } catch {
    counts = null;
  }
  let errorMsg = null;
  if (!counts) {
    const n = parseNpmAuditText(r.out);
    if (n !== null) counts = { high: null, critical: null, total: n };
    else {
      try {
        const doc = JSON.parse(r.out);
        if (doc && doc.error) errorMsg = `${doc.error.code ?? 'npm audit error'}: ${String(doc.error.summary ?? '').split('\n')[0]}`;
      } catch {
        errorMsg = r.code === 0 ? null : `npm audit exited ${r.code}: ${tail(r.out, 3).replace(/\s+/g, ' ').slice(0, 200)}`;
      }
    }
  }
  const high = counts ? counts.high : null;
  const critical = counts ? counts.critical : null;
  const ok = r.code === 0 && !!counts && (high === null ? counts.total === 0 : high + critical === 0);
  const result = { ok, exit: r.code, ms: r.ms, timedOut: r.timedOut, high, critical, total: counts ? counts.total : null, out: r.out };
  if (errorMsg) result.error = errorMsg;
  else if (!counts) result.error = 'could not parse npm audit output';
  return result;
}

const results = new Array(apps.length);
let next = 0;
async function worker() {
  while (next < apps.length) {
    const index = next++;
    const app = apps[index];
    const rec = { dir: app.dir, track: app.track, slug: app.slug, install: null, tests: null, build: null, audit: null, ok: true };
    const outputs = {};
    for (const step of steps) {
      let r;
      if (step === 'install') r = await runInstall(app);
      else if (step === 'tests') r = await runTests(app, index);
      else if (step === 'build') r = await runBuild(app);
      else r = await runAudit(app);
      outputs[step] = r.out;
      delete r.out;
      rec[step] = r;
      if (!r.ok) rec.ok = false;
      if (!values.json) process.stdout.write(`${r.ok ? 'ok  ' : 'FAIL'} ${app.dir.padEnd(34)} ${step.padEnd(8)} ${String(r.ms).padStart(7)} ms  ${stepSummary(step, r)}\n`);
      if (!r.ok) {
        process.stderr.write(`\n--- ${app.dir} ${step} failed (${r.timedOut ? `timed out after ${stepTimeoutSec}s` : `exit ${r.exit}`})${r.error ? `: ${r.error}` : ''} — last lines:\n${tail(outputs[step])}\n---\n\n`);
        if (step === 'install') break; // later steps cannot run without dependencies
      }
    }
    for (const step of steps) if (rec[step] === null) rec[step] = { ok: false, skipped: true, reason: 'install failed' };
    results[index] = rec;
  }
}

function stepSummary(step, r) {
  if (step === 'install') return r.ok ? 'installed' : 'install failed';
  if (step === 'tests') return r.total === null ? (r.error ?? 'no counts') : `${r.passed}/${r.total} passed${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''} (${r.files ?? '?'} files, ${r.source})`;
  if (step === 'build') return r.ok ? `dist ${formatBytes(r.distBytes)} / ${r.distFiles} files${r.builtIn ? `, built in ${r.builtIn}` : ''}` : r.error ?? 'build failed';
  return r.ok ? `0 high/critical (${r.total ?? 0} total)` : r.error ?? `${r.high ?? '?'} high, ${r.critical ?? '?'} critical`;
}

await Promise.all(Array.from({ length: Math.min(concurrency, apps.length) }, worker));
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  /* ignore */
}

const skippedSteps = ['install', 'tests', 'build', 'audit'].filter((s) => !steps.includes(s));
const summary = {
  apps: results.length,
  ok: results.every((r) => r.ok),
  stepsRun: steps,
  stepsSkipped: skippedSteps,
  testsTotal: results.reduce((n, r) => n + (r.tests && r.tests.total ? r.tests.total : 0), 0),
  testsPassed: results.reduce((n, r) => n + (r.tests && r.tests.passed ? r.tests.passed : 0), 0),
  testsFailed: results.reduce((n, r) => n + (r.tests && r.tests.failed ? r.tests.failed : 0), 0),
  buildsOk: results.filter((r) => r.build && r.build.ok).length,
  auditsOk: results.filter((r) => r.audit && r.audit.ok).length,
  distBytesTotal: results.reduce((n, r) => n + (r.build && r.build.distBytes ? r.build.distBytes : 0), 0),
  failures: results.filter((r) => !r.ok).map((r) => r.dir),
};
const report = {
  tool: 'verify-all',
  generatedAt: new Date().toISOString(),
  node: process.version,
  npm: npmVersion,
  platform: `${process.platform}-${process.arch}`,
  options: { only: values.only, concurrency, stepTimeoutSeconds: stepTimeoutSec, ignoreScripts: !values['allow-scripts'] },
  apps: results,
  summary,
};

if (values.report) {
  const file = path.resolve(process.cwd(), values.report);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
}

if (values.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  const rows = results.map((r) => ({
    dir: r.dir,
    install: cell(r.install, (s) => 'ok'),
    tests: cell(r.tests, (s) => (s.total === null ? 'no counts' : `${s.passed}/${s.total}`)),
    build: cell(r.build, (s) => formatBytes(s.distBytes)),
    audit: cell(r.audit, (s) => `${s.high ?? 0}h/${s.critical ?? 0}c`),
    result: r.ok ? 'ok' : 'FAIL',
  }));
  process.stdout.write(
    '\n' +
      formatTable(rows, [
        { key: 'dir', label: 'app' },
        { key: 'install', label: 'install' },
        { key: 'tests', label: 'tests', align: 'right' },
        { key: 'build', label: 'build (dist)', align: 'right' },
        { key: 'audit', label: 'audit', align: 'right' },
        { key: 'result', label: 'result' },
      ]) +
      '\n\n',
  );
  process.stdout.write(
    `${summary.ok ? 'PASS' : 'FAIL'}: ${summary.apps} app(s); tests ${summary.testsPassed}/${summary.testsTotal} passed${summary.testsFailed ? ` (${summary.testsFailed} failed)` : ''}; builds ${summary.buildsOk}/${steps.includes('build') ? summary.apps : 0}; audits ${summary.auditsOk}/${steps.includes('audit') ? summary.apps : 0}; node ${process.version}, npm ${npmVersion ?? '?'}` +
      (skippedSteps.length ? `; skipped: ${skippedSteps.join(', ')}` : '') +
      (values.report ? `; report: ${values.report}` : '') +
      '\n',
  );
  if (summary.failures.length) process.stdout.write(`failures: ${summary.failures.join(', ')}\n`);
}

function cell(step, fmt) {
  if (step === null || step === undefined) return '-';
  if (step.skipped) return 'skipped';
  return step.ok ? fmt(step) : step.timedOut ? 'TIMEOUT' : `FAIL${step.total !== undefined && step.total !== null && step.failed ? ` ${step.failed}✗` : ''}`;
}

process.exit(summary.ok ? EXIT_OK : EXIT_FINDINGS);
