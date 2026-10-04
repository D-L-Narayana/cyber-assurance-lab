#!/usr/bin/env node
// check-docs — documentation consistency across apps/*/* and PROJECTS.md.
//
// Checks (see tools/README.md for the heuristics):
//   PROJECTS   every app appears exactly once in PROJECTS.md; every PROJECTS.md link resolves; the declared total
//              equals the sum of the table; (with --report) each row equals the measured total.
//   COUNTS     README quickstart `npm test  # ... N tests` comment and the README "Tests" section state the
//              PROJECTS.md count (or, with --report, the measured total). A "Tests" section without a single total
//              may list per-file counts (`file.test.ts` (N) / `file.test.ts` — N tests); their sum is accepted.
//   PORTS      package.json scripts, vite.config.ts and README agree on one preview/dev port.
//   PATHS      relative paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE resolve, or are listed under the
//              EVIDENCE.md `### Artefact inventory` heading. Inventory entries may be exact paths, parent
//              directories (`qa/` covers `qa/x.log`) or glob patterns (`qa/tdd-*.log`, `../_qa/*`, `notes/*.md`;
//              `*` = any run of non-slash characters, `**` = anything), so absent external evidence can be
//              described without spelling out every historical file name. Quoted absolute filesystem paths
//              (`/home/…`, `/Users/…`, `C:\…`) are never repository references: they get one DOC_ABSOLUTE_PATH note
//              per file and need no inventory entry.
//   C3         <meta name="color-scheme"> is `light` or `dark` unless the app styles use `prefers-color-scheme`;
//              lang="en", description and title present.
//   C2         package.json has engines.node (warning when it is not ">=20.19").
//
// Usage: node tools/check-docs.mjs [--only <track|slug>...] [--report <verify-report.json>] [--json] [--strict]
// Exit: 0 pass, 1 findings, 2 usage.
import path from 'node:path';
import { REPO_ROOT, discoverApps, filterApps } from './lib/apps.mjs';
import { parseArgs } from './lib/args.mjs';
import { exists, isDir, readText, readJson, expandGlob, globToRegExp, walkFiles } from './lib/fsx.mjs';
import { parseMarkdown, inlineCodeSpans, markdownLinks, section, textOf, isExternalTarget } from './lib/markdown.mjs';
import { Findings, emit, usage } from './lib/report.mjs';
import { ENGINES_NODE } from './lib/contracts.mjs';

const USAGE = `usage: node tools/check-docs.mjs [--only <track|slug>...] [--report <verify-report.json>] [--json] [--strict]
  --only     restrict to tracks/slugs/dirs (repeatable or comma-separated)
  --report   verify-all report; its per-app tests.total must equal the PROJECTS.md count
  --json     machine-readable output
  --strict   treat warnings as failures`;

const DOC_FILES = ['README.md', 'AUDIT.md', 'EVIDENCE.md', 'INTERVIEW_GUIDE.md'];
const ROOT_FILES = new Set([
  'LICENSE',
  'package.json',
  'package-lock.json',
  'vercel.json',
  'vite.config.ts',
  'index.html',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'THIRD_PARTY_NOTICES.md',
]);
const GENERATED_DIRS = new Set(['dist', 'node_modules', 'coverage', '.vite', '.vercel', 'test-results', 'playwright-report']);
// Any of these extensions makes a slash-containing token a path candidate.
const PATH_EXT = /\.(md|txt|log|json|mjs|cjs|js|ts|tsx|css|html|png|jpe?g|svg|webp|gif|csv|ya?ml|sh|py|pem|map|woff2?|webmanifest|sql|key|xlsx?)$/i;
// Unknown-root candidates are only reported when they look like tooling/evidence files (fixture-like data paths such
// as `sales/orders.csv` or `ops/key.pem` are skipped because they usually describe synthetic fixture content).
const TOOLING_EXT = /\.(md|txt|log|json|mjs|cjs|js|ts|tsx|css|html|png|jpe?g|svg|webp|gif|ya?ml|sh|py|map)$/i;
// Per-file counts in a "Tests" section, in either of the forms seen in the lab:
//   - `ledger.test.ts` (15): …            /  - `safe.test.ts` (10) and `validate-demo.test.ts` (1).
//   - `src/engine/campaign.test.ts` — 28 tests: …
// A backticked *.test.ts(x) file name followed by `(N)` or by a dash/colon and `N test(s)`.
const PER_FILE_COUNT_RE = /`[^`\n]+\.test\.(?:tsx?|m?js)`\s*(?:\((\d+)\)|[—–\-:]+\s*(\d+)\s+tests?\b)/g;
// Absolute filesystem paths quoted in docs (inline code or verbatim output): never repository references.
const ABSOLUTE_PATH_RE = /(?:^|[\s`"'(=:])((?:\/(?:home|Users|root|tmp|var|opt|mnt|srv|private|workspace)\/[^\s`"')]+)|(?:[A-Za-z]:\\[^\s`"')]+))/g;

const { values, positional, errors } = parseArgs(process.argv.slice(2), { flags: ['json', 'strict'], options: ['report'], multi: ['only'] });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (errors.length || positional.length) process.exit(usage(USAGE, [...errors, ...positional.map((p) => `unexpected argument ${p}`)]));

const discovered = discoverApps();
const { apps, unmatched } = filterApps(discovered.apps, values.only);
if (unmatched.length) process.exit(usage(USAGE, unmatched.map((u) => `--only ${u} matched no app`)));
if (!apps.length) process.exit(usage(USAGE, ['no apps found under apps/']));

let report = null;
if (values.report !== undefined) {
  const r = readJson(path.resolve(process.cwd(), values.report));
  if (!r.ok || !Array.isArray(r.value.apps)) process.exit(usage(USAGE, [`--report ${values.report}: ${r.ok ? 'not a verify-all report (apps[] missing)' : r.error}`]));
  report = new Map(r.value.apps.map((a) => [a.dir, a]));
}

const findings = new Findings('check-docs');
for (const dir of discovered.stray) findings.warn(null, 'APPS_STRAY_DIR', `${dir} has no package.json (not an app, not in PROJECTS.md)`);

// ---------------------------------------------------------------- PROJECTS.md
const projects = parseProjects(readText(path.join(REPO_ROOT, 'PROJECTS.md')));
if (!projects) {
  findings.error(null, 'PROJECTS_MISSING', 'PROJECTS.md is missing or unreadable');
} else {
  for (const link of projects.links) {
    if (isExternalTarget(link.target)) continue;
    const target = link.target.split('#')[0];
    if (target && !exists(path.join(REPO_ROOT, target))) findings.error(null, 'PROJECTS_LINK_DANGLING', `PROJECTS.md:${link.n} link "${link.target}" does not resolve`);
  }
  const allDirs = new Set(discovered.apps.map((a) => a.dir));
  const rowsByDir = new Map();
  for (const row of projects.rows) {
    if (!rowsByDir.has(row.dir)) rowsByDir.set(row.dir, []);
    rowsByDir.get(row.dir).push(row);
    if (!allDirs.has(row.dir)) findings.error(null, 'PROJECTS_UNKNOWN_APP', `PROJECTS.md:${row.line} lists ${row.dir}, which is not an app directory`);
    if (row.count === null) findings.error(null, 'PROJECTS_COUNT_MISSING', `PROJECTS.md:${row.line} (${row.dir}) has no integer test-count cell`);
    if (row.trackCell && row.trackCell !== row.track) findings.warn(null, 'PROJECTS_TRACK_CELL', `PROJECTS.md:${row.line} track cell "${row.trackCell}" differs from path track "${row.track}"`);
  }
  for (const a of discovered.apps) {
    const rows = rowsByDir.get(a.dir) ?? [];
    if (rows.length === 0) findings.error(a.dir, 'PROJECTS_APP_MISSING', `${a.dir} is not listed in PROJECTS.md`);
    else if (rows.length > 1) findings.error(a.dir, 'PROJECTS_APP_DUPLICATE', `${a.dir} is listed ${rows.length} times in PROJECTS.md (lines ${rows.map((r) => r.line).join(', ')})`);
  }
  const sum = projects.rows.reduce((n, r) => n + (r.count ?? 0), 0);
  if (projects.declaredTotal !== null && projects.declaredTotal !== sum) {
    findings.error(null, 'PROJECTS_TOTAL', `PROJECTS.md declares ${projects.declaredTotal} automated test cases but the table sums to ${sum}`);
  }
  if (projects.declaredApps !== null && projects.declaredApps !== discovered.apps.length) {
    findings.error(null, 'PROJECTS_APP_COUNT', `PROJECTS.md declares ${projects.declaredApps} applications but ${discovered.apps.length} app directories exist`);
  }
  // Row order within a track (ids like DG1..DG5 should ascend) — informational.
  const byTrack = new Map();
  for (const r of projects.rows) {
    if (!byTrack.has(r.track)) byTrack.set(r.track, []);
    byTrack.get(r.track).push(r);
  }
  for (const [track, rows] of byTrack) {
    const nums = rows.map((r) => Number((/(\d+)$/.exec(r.id ?? '') ?? [])[1]));
    if (nums.every((n) => Number.isFinite(n)) && nums.some((n, i) => i > 0 && n < nums[i - 1])) {
      findings.notice(null, 'PROJECTS_ROW_ORDER', `PROJECTS.md ${track} rows are not in id order (${rows.map((r) => r.id).join(', ')})`);
    }
  }
}

// ---------------------------------------------------------------- per app
const perAppExtra = {};
for (const app of apps) {
  const extra = { projectsCount: null, readmeQuickstartCount: null, readmeTestsSectionCount: null, readmeTestsSectionStatus: null, reportTotal: null, ports: {}, colorScheme: null, engines: null, paths: { checked: 0, inventoryCovered: 0 } };
  perAppExtra[app.dir] = extra;
  const docs = {};
  for (const f of DOC_FILES) {
    const text = readText(path.join(app.abs, f));
    if (text === null) findings.error(app.dir, 'DOC_FILE_MISSING', `${f} is missing`);
    else docs[f] = parseMarkdown(text);
  }

  // --- counts
  // Authority: the measured total from --report when given, otherwise the PROJECTS.md count.
  const row = projects ? projects.rows.find((r) => r.dir === app.dir) : null;
  const projectsCount = row && row.count !== null ? row.count : null;
  extra.projectsCount = projectsCount;
  let reportEntry = null;
  let reportTotal = null;
  if (report) {
    reportEntry = report.get(app.dir) ?? null;
    reportTotal = reportEntry && reportEntry.tests && typeof reportEntry.tests.total === 'number' ? reportEntry.tests.total : null;
    extra.reportTotal = reportTotal;
  }
  const authority = reportTotal !== null ? { value: reportTotal, label: 'the measured total (verify-all report)' } : projectsCount !== null ? { value: projectsCount, label: 'PROJECTS.md' } : null;
  if (docs['README.md']) {
    const q = quickstartCount(docs['README.md']);
    extra.readmeQuickstartCount = q.count;
    if (q.status === 'no-npm-test') findings.error(app.dir, 'README_QUICKSTART_MISSING', 'README.md has no fenced `npm test` line (quickstart)');
    else if (q.status === 'no-count') findings.error(app.dir, 'README_QUICKSTART_COUNT_MISSING', `README.md:${q.line} \`npm test\` line has no "N tests" comment`);
    else if (authority && q.count !== authority.value) {
      findings.error(app.dir, 'README_QUICKSTART_COUNT', `README.md:${q.line} quickstart says ${q.count} tests; ${authority.label} says ${authority.value}`);
    }
    const t = testsSectionCount(docs['README.md']);
    extra.readmeTestsSectionCount = t.count;
    extra.readmeTestsSectionStatus = t.status;
    if (t.status === 'no-section') findings.error(app.dir, 'README_TESTS_SECTION_MISSING', 'README.md has no "Tests" section');
    else if (t.status === 'no-count') findings.error(app.dir, 'README_TESTS_COUNT_MISSING', `README.md:${t.line} "Tests" section states no "N tests" total and no per-file counts`);
    else {
      const parts = `${t.parts} per-file count${t.parts === 1 ? '' : 's'}`;
      const how = t.status === 'derived' ? ` (sum of ${parts})` : '';
      if (authority && t.count !== authority.value) {
        findings.error(app.dir, 'README_TESTS_COUNT', `README.md:${t.line} "Tests" section says ${t.count} tests${how}; ${authority.label} says ${authority.value}`);
      }
      if (t.status === 'derived') findings.notice(app.dir, 'README_TESTS_COUNT_DERIVED', `README.md:${t.line} "Tests" section states no single total; ${t.count} derived as the sum of ${parts}`);
    }
  }
  if (report) {
    if (!reportEntry) findings.notice(app.dir, 'REPORT_APP_MISSING', 'app is not in the verify-all report');
    else if (reportTotal === null) findings.notice(app.dir, 'REPORT_TESTS_SKIPPED', 'verify-all report has no test total for this app (tests skipped or failed to parse)');
    else if (projectsCount !== null && reportTotal !== projectsCount) findings.error(app.dir, 'REPORT_COUNT', `PROJECTS.md says ${projectsCount} tests; measured ${reportTotal} (verify-all report)`);
  }

  // --- ports
  const pkg = readJson(path.join(app.abs, 'package.json'));
  const pkgPorts = new Set();
  if (pkg.ok && pkg.value.scripts) {
    for (const s of Object.values(pkg.value.scripts)) for (const m of String(s).matchAll(/--port[= ](\d{2,5})\b/g)) pkgPorts.add(Number(m[1]));
  }
  const viteText = readText(path.join(app.abs, 'vite.config.ts')) ?? readText(path.join(app.abs, 'vite.config.mts')) ?? '';
  const vitePorts = new Set([...viteText.matchAll(/\bport\s*:\s*(\d{2,5})\b/g)].map((m) => Number(m[1])));
  const readmePorts = new Set();
  if (docs['README.md']) {
    for (const m of textOf(docs['README.md']).matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b|--port[= ](\d{2,5})\b/g)) readmePorts.add(Number(m[1] ?? m[2]));
  }
  const configured = new Set([...pkgPorts, ...vitePorts]);
  extra.ports = { packageJson: [...pkgPorts], viteConfig: [...vitePorts], readme: [...readmePorts] };
  if (configured.size > 1) findings.error(app.dir, 'PORT_CONFIG_CONFLICT', `package.json scripts (${[...pkgPorts].join(', ') || 'none'}) and vite.config.ts (${[...vitePorts].join(', ') || 'none'}) name different ports`);
  if (configured.size === 0) findings.warn(app.dir, 'PORT_NOT_CONFIGURED', 'no port is configured in package.json scripts or vite.config.ts (Vite default 5173 would apply)');
  if (readmePorts.size === 0) findings.warn(app.dir, 'PORT_README_MISSING', 'README.md does not name the local preview port');
  else {
    const bad = [...readmePorts].filter((p) => !configured.has(p));
    if (bad.length && configured.size > 0) findings.error(app.dir, 'PORT_README_MISMATCH', `README.md names port(s) ${bad.join(', ')} but the configured port is ${[...configured].join(', ')}`);
    else if (bad.length) findings.error(app.dir, 'PORT_README_MISMATCH', `README.md names port(s) ${bad.join(', ')} but no port is configured`);
  }

  // --- C3 index.html
  const html = readText(path.join(app.abs, 'index.html'));
  if (html === null) findings.error(app.dir, 'C3_INDEX_MISSING', 'index.html is missing');
  else {
    const meta = /<meta\b[^>]*\bname\s*=\s*["']color-scheme["'][^>]*>/i.exec(html);
    const content = meta ? (/\bcontent\s*=\s*["']([^"']*)["']/i.exec(meta[0]) ?? [])[1] : undefined;
    extra.colorScheme = content ?? null;
    if (!meta || content === undefined) findings.error(app.dir, 'C3_COLOR_SCHEME_MISSING', 'index.html has no <meta name="color-scheme" content="..."> tag');
    else {
      const scheme = content.trim().toLowerCase();
      if (scheme !== 'light' && scheme !== 'dark') {
        const usesMedia = stylesMentionPrefersColorScheme(app.abs, html);
        if (usesMedia) findings.notice(app.dir, 'C3_COLOR_SCHEME_MEDIA', `color-scheme "${content}" accepted: a prefers-color-scheme media query exists in ${usesMedia}`);
        else findings.error(app.dir, 'C3_COLOR_SCHEME', `color-scheme is "${content}" but no stylesheet uses prefers-color-scheme; must be "light" or "dark"`);
      }
    }
    if (!/<html\b[^>]*\blang\s*=\s*["']en(-[A-Za-z]+)?["']/i.test(html)) findings.error(app.dir, 'C3_LANG', 'index.html <html> lacks lang="en"');
    if (!/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["'][^"']+["']/i.test(html) && !/<meta\b[^>]*\bcontent\s*=\s*["'][^"']+["'][^>]*\bname\s*=\s*["']description["']/i.test(html)) {
      findings.error(app.dir, 'C3_DESCRIPTION', 'index.html has no non-empty <meta name="description">');
    }
    if (!/<title>\s*[^<\s][^<]*<\/title>/i.test(html)) findings.error(app.dir, 'C3_TITLE', 'index.html has no non-empty <title>');
  }

  // --- C2 engines
  if (!pkg.ok) findings.error(app.dir, 'C2_PACKAGE_JSON', `package.json: ${pkg.error}`);
  else {
    const node = pkg.value.engines && pkg.value.engines.node;
    extra.engines = node ?? null;
    if (typeof node !== 'string' || !node.trim()) findings.error(app.dir, 'C2_ENGINES_MISSING', 'package.json has no engines.node');
    else if (node.trim() !== ENGINES_NODE) findings.warn(app.dir, 'C2_ENGINES_VALUE', `engines.node is "${node}", contract is "${ENGINES_NODE}"`);
  }

  // --- paths
  checkPaths(app, docs, extra.paths);
}

process.exit(
  emit(findings, {
    json: values.json,
    strict: values.strict,
    apps: apps.map((a) => a.dir),
    extra: {
      projects: projects ? { declaredTotal: projects.declaredTotal, declaredApps: projects.declaredApps, tableSum: projects.rows.reduce((n, r) => n + (r.count ?? 0), 0), rows: projects.rows } : null,
      details: perAppExtra,
    },
  }),
);

// ---------------------------------------------------------------- helpers

function parseProjects(text) {
  if (text === null) return null;
  const lines = parseMarkdown(text);
  const rows = [];
  for (const l of lines) {
    if (l.inFence || !l.text.trim().startsWith('|')) continue;
    const cells = l.text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const linkIdx = cells.findIndex((c) => /\]\(apps\/[^/)]+\/[^/)]+(?:\/[^)]*)?\)/.test(c));
    if (linkIdx === -1) continue;
    const m = /\[([^\]]*)\]\((apps\/([^/)]+)\/([^/)]+))(?:\/[^)]*)?\)/.exec(cells[linkIdx]);
    const countIdx = cells.findIndex((c, i) => i > linkIdx && /^\d+$/.test(c));
    rows.push({
      line: l.n,
      id: linkIdx > 0 ? cells[linkIdx - 1] : null,
      name: m[1],
      dir: m[2],
      track: m[3],
      slug: m[4],
      trackCell: cells[linkIdx + 1] ?? null,
      count: countIdx === -1 ? null : Number(cells[countIdx]),
    });
  }
  const total = /(\d[\d,]*)\s+automated test cases/i.exec(text);
  const appsDeclared = /(\d+)\s+independent\s+(?:educational\s+)?applications/i.exec(text);
  return {
    rows,
    links: markdownLinks(lines),
    declaredTotal: total ? Number(total[1].replace(/,/g, '')) : null,
    declaredApps: appsDeclared ? Number(appsDeclared[1]) : null,
  };
}

/**
 * Stated test total in a piece of text: the vitest summary form `Tests  N passed (N)` first (total = the number in
 * parentheses), then `N tests` / `N test cases` with at most one whitelisted qualifier (automated, total, vitest,
 * unit, engine, passing, green). Other `N <word> tests` phrases ("28 contrast tests", "2026 extension-guard tests")
 * are parts or dates, not totals, and are ignored.
 */
function extractTestCount(text) {
  const vitest = /\bTests\s+(?:\d+\s+failed\s*\|\s*)?\d+\s+passed(?:\s*\|\s*\d+\s+skipped)?\s+\((\d+)\)/.exec(text);
  if (vitest) return Number(vitest[1]);
  const strict = /\b(\d+)\s+(?:(?:automated|total|vitest|unit|engine|passing|green)\s+)?tests?(?:\s+cases)?\b/i.exec(text);
  return strict ? Number(strict[1]) : null;
}

function quickstartCount(lines) {
  let firstLine = null;
  for (const l of lines) {
    if (!l.inFence || /^\s*(`{3,}|~{3,})/.test(l.text)) continue;
    if (!/\bnpm\s+(?:run\s+)?test\b/.test(l.text)) continue;
    if (firstLine === null) firstLine = l.n;
    const hash = l.text.indexOf('#');
    const comment = hash === -1 ? '' : l.text.slice(hash + 1);
    const count = extractTestCount(comment);
    if (count !== null) return { status: 'ok', count, line: l.n };
  }
  if (firstLine === null) return { status: 'no-npm-test', count: null, line: null };
  return { status: 'no-count', count: null, line: firstLine };
}

/**
 * Total stated by the README "Tests" section: an explicit "N tests" total wins ('ok'); otherwise the sum of per-file
 * counts ('derived', with `parts` = number of files); otherwise 'no-count'.
 */
function testsSectionCount(lines) {
  const sec = section(lines, (title) => /^tests?\b/i.test(title) || /^(automated\s+)?tests?\s+(and|&)\s+evidence/i.test(title));
  if (!sec) return { status: 'no-section', count: null, line: null, parts: 0 };
  const full = textOf(sec.lines); // fenced blocks included: a quoted `Tests  N passed (N)` line counts as the total
  const body = textOf(sec.lines.filter((l) => !l.inFence));
  const perFile = [...body.matchAll(PER_FILE_COUNT_RE)].map((m) => Number(m[1] ?? m[2]));
  const explicit = extractTestCount(full.replace(PER_FILE_COUNT_RE, ' '));
  if (explicit !== null) return { status: 'ok', count: explicit, line: sec.heading.n, parts: 0 };
  if (perFile.length) return { status: 'derived', count: perFile.reduce((a, b) => a + b, 0), line: sec.heading.n, parts: perFile.length };
  return { status: 'no-count', count: null, line: sec.heading.n, parts: 0 };
}

function stylesMentionPrefersColorScheme(appAbs, html) {
  if (/prefers-color-scheme/.test(html)) return 'index.html';
  for (const f of walkFiles(appAbs, { maxFiles: 5000 })) {
    if (!/\.(css|scss|ts|tsx)$/.test(f.rel)) continue;
    if (!f.rel.startsWith('src/') && !f.rel.startsWith('public/')) continue;
    const t = readText(f.abs);
    if (t && /prefers-color-scheme/.test(t)) return f.rel;
  }
  return null;
}

/** Classify an inline code span as a path candidate; returns { path, kind } or null. */
function classifyCodeSpan(code) {
  const s = code.trim();
  if (!s || /\s/.test(s)) return null;
  if (/[|(){}[\]^$\\<>…=,;:"'`]/.test(s)) return null; // regex, URL, key=value, ellipsis ranges, quotes
  if (s.includes('/./')) return null; // unnormalised example paths quoted as test literals
  if (/^[#/@~]/.test(s)) return null; // anchors, absolute paths / routes, npm scopes, home paths
  if (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(s)) return null; // CIDR
  if (/^\*\*?\//.test(s)) return null; // `**/x` patterns are not repository paths
  const segments = s.split('/').filter((x) => x !== '');
  if (segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const hasSlash = s.includes('/');
  if (GENERATED_DIRS.has(first) || first === 'node_modules') return null;
  if (hasSlash && /^v?\d+(\.\d+)*$/.test(last)) return null; // schema ids and version tails: `x.report/1`, `release/1.4.0`
  if (!hasSlash) {
    if (ROOT_FILES.has(s) || /\.md$/i.test(s)) return { path: s, kind: 'root-file' };
    return null; // bare file names elsewhere are too ambiguous
  }
  if (/[*?]/.test(s)) return { path: s, kind: 'glob' };
  if (first === '.' || first === '..') return { path: s, kind: 'relative' };
  if (PATH_EXT.test(last) || s.endsWith('/')) return { path: s, kind: 'path' };
  return null; // e.g. `median/MAD`, `fieldset/legend`
}

function literalPrefix(pattern) {
  const out = [];
  for (const seg of pattern.split('/')) {
    if (seg === '' || /[*?]/.test(seg)) break;
    out.push(seg);
  }
  return out;
}

/** Resolve a reference for an app. Returns { status: 'resolved'|'unresolved'|'skip', where?, tier? }. */
function resolveRef(app, ref) {
  const raw = ref.path.replace(/\/+$/, '') || '.';
  if (ref.kind === 'glob') {
    let base = app.abs;
    let pattern = ref.path;
    while (pattern.startsWith('./') || pattern.startsWith('../')) {
      base = path.resolve(base, pattern.startsWith('./') ? '.' : '..');
      pattern = pattern.replace(/^\.\.?\//, '');
    }
    const prefix = literalPrefix(pattern);
    const anchored = ref.path.startsWith('./') || ref.path.startsWith('../');
    if (prefix.length === 0 && !anchored) return { status: 'skip' };
    if (prefix.length > 0 && !isDir(path.join(base, ...prefix))) return anchored ? { status: 'unresolved', tier: 1 } : { status: 'skip' };
    const hits = expandGlob(base, pattern, { limit: 5 });
    return hits.length ? { status: 'resolved', where: 'app' } : { status: 'unresolved', tier: 1 };
  }
  if (exists(path.resolve(app.abs, raw))) return { status: 'resolved', where: 'app' };
  if (ref.kind === 'relative' || ref.kind === 'root-file') return { status: 'unresolved', tier: 1 };
  const first = raw.split('/')[0];
  if (isDir(path.join(app.abs, first))) return { status: 'unresolved', tier: 1 };
  if (exists(path.join(REPO_ROOT, raw))) return { status: 'resolved', where: 'repo' };
  if (exists(path.join(REPO_ROOT, 'apps', app.track, raw))) return { status: 'resolved', where: 'track' };
  if (TOOLING_EXT.test(raw)) return { status: 'unresolved', tier: 2 };
  return { status: 'skip' };
}

function normalisePath(p) {
  return p.trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Does an inventory cover a reference? Exact match, glob pattern (`*` = non-slash run, `**` = anything, `?` = one
 * character; see fsx.globToRegExp) or parent directory (`qa/` covers `qa/foo.log`).
 */
function inventoryCovers(entries, refPath) {
  const norm = normalisePath(refPath);
  for (const e of entries) {
    const ne = normalisePath(e);
    if (!ne) continue;
    if (ne === norm) return true;
    if (/[*?]/.test(ne) && globToRegExp(ne).test(norm)) return true;
    if (norm.startsWith(ne + '/')) return true;
  }
  return false;
}

function checkPaths(app, docs, stats) {
  // Artefact inventory (EVIDENCE.md `### Artefact inventory`): inline code spans in that section.
  let inventory = [];
  let hasInventory = false;
  if (docs['EVIDENCE.md']) {
    const inv = section(docs['EVIDENCE.md'], (title) => /^artefact inventory/i.test(title) || /^artifact inventory/i.test(title));
    if (inv) {
      hasInventory = true;
      inventory = inlineCodeSpans(inv.lines).map((c) => c.code.trim()).filter((c) => c && !/\s/.test(c));
      const present = [];
      for (const entry of new Set(inventory)) {
        const cls = classifyCodeSpan(entry);
        if (!cls) continue;
        const r = resolveRef(app, cls);
        if (r.status === 'resolved') present.push(entry);
      }
      if (present.length) {
        findings.notice(app.dir, 'DOC_INVENTORY_PRESENT', `EVIDENCE.md artefact inventory names ${present.length} path(s) that exist in the repository (the inventory is meant for artefacts that are NOT in the repository)`, present.map((p) => `\`${p}\``).join(', '));
      }
    }
  }
  // Quoted absolute paths: one note per file (line numbers only — the paths themselves are not repeated).
  for (const [file, lines] of Object.entries(docs)) {
    const hits = [];
    for (const l of lines) {
      const re = new RegExp(ABSOLUTE_PATH_RE.source, 'g');
      let m;
      while ((m = re.exec(l.text))) hits.push({ n: l.n, root: m[1].startsWith('/') ? `/${m[1].split('/')[1]}/…` : `${m[1].slice(0, 3)}…` });
    }
    if (hits.length) {
      const roots = [...new Set(hits.map((h) => h.root))].join(', ');
      const where = [...new Set(hits.map((h) => h.n))];
      findings.notice(app.dir, 'DOC_ABSOLUTE_PATH', `${file}: ${hits.length} quoted absolute path(s) from an earlier environment (${roots}); not repository references`, `lines ${where.slice(0, 12).join(', ')}${where.length > 12 ? ', …' : ''}`);
    }
  }
  // Collect references: inline code spans + markdown links in the four docs.
  const refs = new Map(); // normalised path -> { ref, locations: [] }
  const add = (ref, file, n) => {
    const key = `${ref.kind === 'glob' ? 'g:' : ''}${normalisePath(ref.path)}`;
    if (!refs.has(key)) refs.set(key, { ref, locations: [] });
    refs.get(key).locations.push(`${file}:${n}`);
  };
  for (const [file, lines] of Object.entries(docs)) {
    for (const span of inlineCodeSpans(lines)) {
      const cls = classifyCodeSpan(span.code);
      if (cls) add(cls, file, span.n);
    }
    for (const link of markdownLinks(lines)) {
      if (isExternalTarget(link.target)) continue;
      const target = decodeURIComponent(link.target.split('#')[0]);
      if (!target) continue;
      add({ path: target, kind: 'link' }, file, link.n);
    }
  }
  const unresolved = [];
  for (const { ref, locations } of refs.values()) {
    stats.checked += 1;
    let r;
    if (ref.kind === 'link') r = exists(path.resolve(app.abs, ref.path)) ? { status: 'resolved', where: 'app' } : { status: 'unresolved', tier: 1 };
    else r = resolveRef(app, ref);
    if (r.status === 'skip') continue;
    if (r.status === 'resolved') {
      if (r.where !== 'app') findings.notice(app.dir, 'DOC_PATH_ELSEWHERE', `\`${ref.path}\` resolves relative to the ${r.where === 'repo' ? 'repository root' : 'track directory'}, not the app (${locations[0]})`);
      continue;
    }
    if (inventoryCovers(inventory, ref.path)) {
      stats.inventoryCovered += 1;
      continue;
    }
    unresolved.push({ ref, locations, tier: r.tier });
  }
  unresolved.sort((a, b) => a.tier - b.tier || a.ref.path.localeCompare(b.ref.path));
  for (const u of unresolved) {
    const where = u.locations.length > 3 ? `${u.locations.slice(0, 3).join(', ')} (+${u.locations.length - 3} more)` : u.locations.join(', ');
    if (u.ref.kind === 'link') findings.error(app.dir, 'DOC_LINK_DANGLING', `link target "${u.ref.path}" does not exist`, `at ${where}`);
    else if (u.tier === 1) findings.error(app.dir, 'DOC_PATH_DANGLING', `\`${u.ref.path}\` does not exist and is not in the EVIDENCE.md artefact inventory`, `at ${where}`);
    else findings.warn(app.dir, 'DOC_PATH_UNRESOLVED', `\`${u.ref.path}\` looks like a file reference but nothing matches in the app, track or repository root (not in the artefact inventory)`, `at ${where}`);
  }
  if (unresolved.length && !hasInventory) {
    findings.error(app.dir, 'DOC_INVENTORY_MISSING', `EVIDENCE.md has no "### Artefact inventory" section although ${unresolved.length} referenced path(s) do not exist`);
  }
}
