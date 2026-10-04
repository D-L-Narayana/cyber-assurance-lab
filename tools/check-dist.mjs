#!/usr/bin/env node
// check-dist — hygiene of built `dist/` directories (browser-local, CSP-compatible, relative asset paths, bounded size).
//
// Per app with a dist/:
//   index.html present; every src/href attribute is `./`-relative (or `#...`/`data:`); referenced local assets exist;
//   no inline <script> without src and no inline event handlers (CSP script-src 'self');
//   no http(s):// references in index.html attributes (error) or text (warning);
//   JS bundles contain none of: fetch(, XMLHttpRequest, WebSocket(, localStorage, sessionStorage, indexedDB
//     (identifier-boundary matches; `prefetch(` does not count) unless allow-listed in tools/dist-allowlist.json;
//     the single `fetch(` inside Vite's modulepreload polyfill is recognised structurally (tools/lib/dist-tokens.mjs)
//     and reported as the note DIST_VITE_MODULEPRELOAD — it preloads the app's own same-origin chunks and is not
//     application code; every other `fetch(` is the error DIST_TOKEN;
//   inlined `data:` URLs in CSS (`url(data:…)`) and JS (string literals) are checked against the CSP the app ships
//     in vercel.json (first header block whose source matches `/`; the canonical lab CSP when none is present): the
//     mime type maps to a directive (font/*, application/font*, application/x-font* → font-src; image/* → img-src;
//     else default-src; a directive absent from the CSP falls back to default-src) and the URL is blocked unless that
//     directive lists `data:` → error DIST_CSS_DATA_URL_BLOCKED (tools/lib/dist-data-urls.mjs); permitted ones are the
//     note DIST_DATA_URL_ALLOWED. Fix: emit the asset as a file (vite `build.assetsInlineLimit: 0`), do not widen the CSP;
//   CSS contains no url(http...) / @import of external resources;
//   total dist size <= 2.0 MB (2 * 1024 * 1024 bytes).
// An app without dist/ prints "not built" (notice) unless --require-built is given (then an error).
//
// Usage: node tools/check-dist.mjs [--app <dir>...] [--require-built] [--allowlist <file>] [--budget-bytes N] [--json] [--strict]
//        node tools/check-dist.mjs --self-test      # runs tools/lib/dist-tokens.test-data.json through both scanners
// Exit: 0 pass, 1 findings, 2 usage.
import path from 'node:path';
import { REPO_ROOT, discoverApps, filterApps, appFromPath } from './lib/apps.mjs';
import { parseArgs } from './lib/args.mjs';
import { exists, isDir, readText, readJson, walkFiles, dirStats, formatBytes } from './lib/fsx.mjs';
import { Findings, emit, usage } from './lib/report.mjs';
import { formatTable } from './lib/table.mjs';
import { CANONICAL_HEADERS, DIST_BUDGET_BYTES, DIST_FORBIDDEN_TOKENS, DIST_WARN_TOKENS } from './lib/contracts.mjs';
import { scanBundle, runSelfTest } from './lib/dist-tokens.mjs';
import { evaluateDataUrls, describeDataUrl, runDataUrlSelfTest } from './lib/dist-data-urls.mjs';

const USAGE = `usage: node tools/check-dist.mjs [--app <dir>...] [--require-built] [--allowlist <file>] [--budget-bytes N] [--json] [--strict]
       node tools/check-dist.mjs --self-test
  --app            app directory (repo-relative, absolute or "." from inside the app); also accepts track/slug; repeatable
  --require-built  a missing dist/ is an error instead of a "not built" note
  --allowlist      allow-list file (default tools/dist-allowlist.json)
  --budget-bytes   per-app dist budget in bytes (default ${DIST_BUDGET_BYTES})
  --self-test      run the scanner cases in tools/lib/dist-tokens.test-data.json and exit
  --json           machine-readable output
  --strict         treat warnings as failures`;

const { values, positional, errors } = parseArgs(process.argv.slice(2), {
  flags: ['json', 'strict', 'require-built', 'self-test'],
  options: ['allowlist', 'budget-bytes'],
  multi: ['app'],
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (errors.length || positional.length) process.exit(usage(USAGE, [...errors, ...positional.map((p) => `unexpected argument ${p}`)]));

if (values['self-test']) {
  const data = readJson(path.join(REPO_ROOT, 'tools', 'lib', 'dist-tokens.test-data.json'));
  if (!data.ok) process.exit(usage(USAGE, [`tools/lib/dist-tokens.test-data.json: ${data.error}`]));
  const tokens = runSelfTest(data.value);
  const urls = runDataUrlSelfTest(data.value.dataUrlCases ?? []);
  const ok = tokens.ok && urls.ok;
  if (values.json) {
    process.stdout.write(JSON.stringify({ tool: 'check-dist --self-test', ok, tokens: tokens.results, dataUrls: urls.results }, null, 2) + '\n');
  } else {
    const print = (title, results) => {
      process.stdout.write(`${title}\n`);
      for (const r of results) process.stdout.write(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n       expected ${JSON.stringify(r.expect)} got ${JSON.stringify(r.got)}`}\n`);
    };
    print('token scanner', tokens.results);
    print('data: URL vs CSP', urls.results);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}: ${tokens.results.filter((r) => r.ok).length}/${tokens.results.length} token cases, ${urls.results.filter((r) => r.ok).length}/${urls.results.length} data-URL cases\n`);
  }
  process.exit(ok ? 0 : 1);
}

const budget = values['budget-bytes'] === undefined ? DIST_BUDGET_BYTES : Number(values['budget-bytes']);
if (!Number.isInteger(budget) || budget <= 0) process.exit(usage(USAGE, ['--budget-bytes must be a positive integer']));

const discovered = discoverApps();
let apps = discovered.apps;
if (values.app.length) {
  const chosen = new Map();
  const selectors = [];
  for (const a of values.app) {
    const direct = appFromPath(a);
    if (direct && exists(path.join(direct.abs, 'package.json'))) chosen.set(direct.dir, direct);
    else selectors.push(a);
  }
  if (selectors.length) {
    const { apps: matched, unmatched } = filterApps(discovered.apps, selectors);
    if (unmatched.length) process.exit(usage(USAGE, unmatched.map((u) => `--app ${u} is not an app directory (apps/<track>/<slug>) or a known track/slug`)));
    for (const m of matched) chosen.set(m.dir, m);
  }
  apps = [...chosen.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}
if (!apps.length) process.exit(usage(USAGE, ['no apps selected']));

const defaultAllowlist = path.join(REPO_ROOT, 'tools', 'dist-allowlist.json');
const allowlistPath = values.allowlist === undefined ? defaultAllowlist : path.resolve(process.cwd(), values.allowlist);
const allowlistLabel = values.allowlist === undefined ? 'tools/dist-allowlist.json' : values.allowlist;
const CANONICAL_CSP = CANONICAL_HEADERS.find((h) => h.key === 'Content-Security-Policy').value;
const findings = new Findings('check-dist');
const allowlist = loadAllowlist(allowlistPath, allowlistLabel);

const rows = [];
const details = {};
const usedAllow = new Set();

for (const app of apps) {
  const dist = path.join(app.abs, 'dist');
  const detail = { built: false, bytes: null, files: null, jsFiles: 0, tokenHits: {}, allowlisted: [], vitePolyfill: false, dataUrls: { total: 0, blocked: 0, cspOrigin: null, items: [] } };
  details[app.dir] = detail;
  if (!isDir(dist)) {
    if (values['require-built']) findings.error(app.dir, 'DIST_NOT_BUILT', 'dist/ is missing (run `npm run build` first)');
    else findings.notice(app.dir, 'DIST_NOT_BUILT', 'not built — dist/ is missing; nothing checked');
    rows.push({ dir: app.dir, built: 'no', size: '-', files: '-', js: '-', hits: '-', data: '-', result: values['require-built'] ? 'FAIL' : 'not built' });
    continue;
  }
  detail.built = true;
  const stats = dirStats(dist);
  detail.bytes = stats.bytes;
  detail.files = stats.files;
  if (stats.bytes > budget) findings.error(app.dir, 'DIST_SIZE_BUDGET', `dist/ is ${formatBytes(stats.bytes)} (${stats.bytes} bytes), over the ${formatBytes(budget)} budget`);
  const cspInfo = loadAppCsp(app);
  detail.dataUrls.cspOrigin = cspInfo.origin;

  // --- index.html
  const html = readText(path.join(dist, 'index.html'));
  if (html === null) findings.error(app.dir, 'DIST_INDEX_MISSING', 'dist/index.html is missing');
  else checkIndexHtml(app, dist, html);

  // --- bundles and styles
  let hits = 0;
  for (const f of walkFiles(dist, { skip: new Set() })) {
    const isJs = /\.(m?js|cjs)$/.test(f.rel);
    const isCss = /\.css$/.test(f.rel);
    if (isJs || isCss) {
      const text = readText(f.abs) ?? '';
      if (isJs) {
        detail.jsFiles += 1;
        const groups = new Map();
        for (const h of scanBundle(text)) {
          const key = `${h.kind}\u0000${h.token}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(h);
        }
        for (const list of groups.values()) {
          const { kind, token } = list[0];
          const snippets = list.slice(0, 3).map((h) => h.snippet);
          if (kind === 'vite-modulepreload') {
            detail.vitePolyfill = true;
            findings.notice(app.dir, 'DIST_VITE_MODULEPRELOAD', `${f.rel}: fetch() inside Vite's modulepreload polyfill (same-origin preload of the app's own chunks) — not a network call to another origin`, snippets);
            continue;
          }
          hits += list.length;
          detail.tokenHits[token] = (detail.tokenHits[token] ?? 0) + list.length;
          const justification = allowlist.entries[app.dir] && allowlist.entries[app.dir][token];
          if (justification) {
            usedAllow.add(`${app.dir}\u0000${token}`);
            detail.allowlisted.push(token);
            findings.notice(app.dir, 'DIST_TOKEN_ALLOWED', `${f.rel}: ${list.length}× "${token}" allow-listed: ${justification}`, snippets);
          } else if (kind === 'forbidden') {
            findings.error(app.dir, 'DIST_TOKEN', `${f.rel}: ${list.length}× "${token}" in shipped JS (browser-local contract)`, snippets);
          } else {
            findings.warn(app.dir, 'DIST_TOKEN_WARN', `${f.rel}: ${list.length}× "${token}" in shipped JS`, snippets);
          }
        }
      } else {
        const ext = [...text.matchAll(/url\(\s*["']?\s*(https?:)?\/\/[^)]*\)|@import\s+(?:url\()?\s*["']?https?:\/\/[^;)]*/gi)];
        if (ext.length) findings.error(app.dir, 'DIST_CSS_EXTERNAL', `${f.rel}: ${ext.length} external url()/@import reference(s)`, ext.slice(0, 3).map((m) => m[0].slice(0, 120)));
      }
      const dataUrls = evaluateDataUrls(text, f.rel, cspInfo.csp);
      if (dataUrls.length) reportDataUrls(app, f.rel, dataUrls, cspInfo, detail);
    } else if (/\.map$/.test(f.rel)) {
      findings.warn(app.dir, 'DIST_SOURCEMAP', `${f.rel}: source map shipped in dist/`);
    }
  }
  if (detail.jsFiles === 0) findings.warn(app.dir, 'DIST_NO_JS', 'dist/ contains no JavaScript bundle');
  const appFindings = findings.forApp(app.dir);
  const bad = appFindings.some((f) => f.severity === 'error' || (values.strict && f.severity === 'warn'));
  rows.push({ dir: app.dir, built: 'yes', size: formatBytes(stats.bytes), files: stats.files, js: detail.jsFiles, hits, data: detail.dataUrls.total ? `${detail.dataUrls.blocked}/${detail.dataUrls.total}` : '0', result: bad ? 'FAIL' : 'ok' });
}

for (const [appDir, tokens] of Object.entries(allowlist.entries)) {
  for (const token of Object.keys(tokens)) {
    if (!usedAllow.has(`${appDir}\u0000${token}`) && details[appDir] && details[appDir].built) {
      findings.notice(appDir, 'ALLOWLIST_UNUSED', `allow-list entry for "${token}" matched nothing in dist/ (stale entry?)`);
    }
  }
}

if (!values.json) {
  process.stdout.write(
    formatTable(rows, [
      { key: 'dir', label: 'app' },
      { key: 'built', label: 'built' },
      { key: 'size', label: 'dist size', align: 'right' },
      { key: 'files', label: 'files', align: 'right' },
      { key: 'js', label: 'js', align: 'right' },
      { key: 'hits', label: 'token hits', align: 'right' },
      { key: 'data', label: 'data: blocked/total', align: 'right' },
      { key: 'result', label: 'result' },
    ]) + '\n\n',
  );
}
process.exit(emit(findings, { json: values.json, strict: values.strict, apps: apps.map((a) => a.dir), extra: { budgetBytes: budget, allowlist: allowlistLabel, details }, quietOk: true }));

// ---------------------------------------------------------------- helpers

function loadAllowlist(file, label) {
  const out = { entries: {} };
  if (!exists(file)) {
    findings.warn(null, 'ALLOWLIST_MISSING', `${label} not found; no allow-list applied`);
    return out;
  }
  const parsed = readJson(file);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    findings.error(null, 'ALLOWLIST_INVALID', `${label}: ${parsed.ok ? 'must be a JSON object keyed by app dir' : parsed.error}`);
    return out;
  }
  const knownDirs = new Set(discovered.apps.map((a) => a.dir));
  const knownTokens = [...DIST_FORBIDDEN_TOKENS, ...DIST_WARN_TOKENS];
  for (const [appDir, tokens] of Object.entries(parsed.value)) {
    if (!knownDirs.has(appDir)) findings.warn(null, 'ALLOWLIST_UNKNOWN_APP', `allow-list key "${appDir}" is not an app directory`);
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
      findings.error(null, 'ALLOWLIST_INVALID', `allow-list entry "${appDir}" must be an object { "<token>": "<justification>" }`);
      continue;
    }
    out.entries[appDir] = {};
    for (const [token, justification] of Object.entries(tokens)) {
      if (!knownTokens.includes(token)) findings.warn(null, 'ALLOWLIST_UNKNOWN_TOKEN', `allow-list "${appDir}" names unknown token "${token}"`);
      if (typeof justification !== 'string' || justification.trim().length < 20) {
        findings.error(null, 'ALLOWLIST_INVALID', `allow-list "${appDir}" → "${token}" needs a justification string of at least 20 characters`);
        continue;
      }
      out.entries[appDir][token] = justification.trim();
    }
  }
  return out;
}

/** The CSP the app ships: vercel.json's first header block whose source matches `/`; the canonical lab CSP otherwise. */
function loadAppCsp(app) {
  const parsed = readJson(path.join(app.abs, 'vercel.json'));
  if (!parsed.ok || !parsed.value || !Array.isArray(parsed.value.headers)) return { csp: CANONICAL_CSP, origin: 'the canonical lab CSP (vercel.json missing or without headers)' };
  const block = parsed.value.headers.find((b) => b && typeof b === 'object' && sourceMatchesRoot(b.source));
  const hdr = block && Array.isArray(block.headers) ? block.headers.find((h) => h && typeof h.key === 'string' && h.key.toLowerCase() === 'content-security-policy') : null;
  if (!hdr || typeof hdr.value !== 'string') return { csp: CANONICAL_CSP, origin: 'the canonical lab CSP (vercel.json has no Content-Security-Policy for /)' };
  return { csp: hdr.value, origin: `vercel.json (source ${JSON.stringify(block.source)})` };
}

function sourceMatchesRoot(source) {
  if (typeof source !== 'string') return false;
  if (source === '/' || source === '/(.*)' || source === '/:path*' || source === '/(.*)?') return true;
  try {
    const re = new RegExp(`^${source}$`);
    return re.test('/') || re.test('/index.html');
  } catch {
    return false;
  }
}

function reportDataUrls(app, rel, items, cspInfo, detail) {
  detail.dataUrls.total += items.length;
  for (const i of items) detail.dataUrls.items.push({ file: rel, mime: i.mime, directive: i.directive, governing: i.governing, allowed: i.allowed, encodedLength: i.encodedLength, decodedBytes: i.decodedBytes });
  const groups = new Map();
  for (const i of items) {
    const k = `${i.allowed ? 'ok' : 'blocked'}\u0000${i.governing ?? '-'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const mimes = [...new Set(list.map((i) => i.mime))].join(', ');
    const lines = list.slice(0, 8).map(describeDataUrl);
    if (list.length > 8) lines.push(`… ${list.length - 8} more`);
    if (!first.allowed) {
      detail.dataUrls.blocked += list.length;
      findings.error(app.dir, 'DIST_CSS_DATA_URL_BLOCKED', `${rel}: ${list.length} inlined data: URL(s) (${mimes}) blocked by CSP ${first.governing} "${first.governingValue}" from ${cspInfo.origin} — no data: scheme; emit the asset as a file (vite build.assetsInlineLimit: 0) rather than widening the CSP`, lines);
    } else if (first.unrestricted) {
      findings.notice(app.dir, 'DIST_DATA_URL_ALLOWED', `${rel}: ${list.length} inlined data: URL(s) (${mimes}); the CSP from ${cspInfo.origin} has neither a ${first.directive} nor a default-src directive, so nothing restricts them`, lines);
    } else {
      findings.notice(app.dir, 'DIST_DATA_URL_ALLOWED', `${rel}: ${list.length} inlined data: URL(s) (${mimes}) permitted by CSP ${first.governing} "${first.governingValue}" from ${cspInfo.origin}`, lines);
    }
  }
}

function checkIndexHtml(app, dist, html) {
  for (const m of html.matchAll(/\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const attr = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (value === '' || value.startsWith('#')) continue;
    if (/^data:/i.test(value)) continue;
    if (/^(https?:)?\/\//i.test(value)) {
      findings.error(app.dir, 'DIST_EXTERNAL_URL', `index.html ${attr}="${value}" references an external origin`);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      findings.error(app.dir, 'DIST_SCHEME_URL', `index.html ${attr}="${value}" uses a URL scheme`);
      continue;
    }
    if (value.startsWith('/')) {
      findings.error(app.dir, 'DIST_ROOT_RELATIVE', `index.html ${attr}="${value}" is root-relative (vite base must be './')`);
      continue;
    }
    if (!value.startsWith('./')) {
      findings.error(app.dir, 'DIST_NOT_DOT_RELATIVE', `index.html ${attr}="${value}" must start with "./"`);
      continue;
    }
    const target = path.join(dist, decodeURIComponent(value.split(/[?#]/)[0]));
    if (!exists(target)) findings.error(app.dir, 'DIST_ASSET_MISSING', `index.html ${attr}="${value}" does not exist in dist/`);
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    const body = m[2];
    if (!/\bsrc\s*=/i.test(attrs) && body.trim().length > 0) {
      findings.error(app.dir, 'DIST_INLINE_SCRIPT', `index.html has an inline <script${attrs.trim() ? ' ' + attrs.trim() : ''}> (${body.trim().length} chars) — blocked by script-src 'self'`);
    }
  }
  for (const m of html.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)) findings.error(app.dir, 'DIST_INLINE_HANDLER', `index.html has an inline event handler attribute (${m[1]})`);
  const stripped = html.replace(/\b(?:src|href|content)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  const textUrls = [...stripped.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((m) => m[0]);
  if (textUrls.length) findings.warn(app.dir, 'DIST_URL_IN_TEXT', `index.html mentions ${textUrls.length} http(s) URL(s) outside attributes`, textUrls.slice(0, 3));
  const metaUrls = [...html.matchAll(/\bcontent\s*=\s*"([^"]*https?:\/\/[^"]*)"/gi)].map((m) => m[1]);
  if (metaUrls.length) findings.notice(app.dir, 'DIST_URL_IN_META', `index.html meta content mentions ${metaUrls.length} http(s) URL(s) (text only)`, metaUrls.slice(0, 3).map((u) => u.slice(0, 120)));
}
