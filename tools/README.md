# tools/ — repo-level verification

Dependency-free Node scripts (ESM `.mjs`, Node ≥ 20, nothing to install) that measure what this repository's
documentation claims: test totals, builds, security headers, built-output hygiene, frozen helper copies and
documentation links. They are the same checks the CI workflow (`.github/workflows/verify.yml`) runs. Run them from
the repository root; they never write inside `apps/**` (only `npm`/`vite` write `node_modules/` and `dist/`).

| Tool | What it verifies |
|---|---|
| `node tools/verify-all.mjs` | per app: `npm ci`, `vitest run`, `npm run build`, `npm audit --audit-level=high`; writes one JSON report |
| `node tools/check-docs.mjs` | PROJECTS.md inventory and links, README test counts, ports, documentation path references, `index.html` meta, `engines.node` |
| `node tools/check-headers.mjs` | every `apps/*/*/vercel.json` carries exactly the canonical security-header set |
| `node tools/check-duplicates.mjs` | frozen helper files copied between apps are byte-identical; every app `LICENSE` equals the root `LICENSE` |
| `node tools/check-dist.mjs` | built `dist/`: relative asset paths, no inline scripts, no external URLs, no network/storage identifiers, size budget |

Shared code lives in `tools/lib/` (app discovery, argument parsing, Markdown parsing, finding/report output, the
contracts, Vitest/npm-audit parsers, the dist token scanner). `tools/dist-allowlist.json` is the (currently empty)
allow-list for `check-dist`.

## Exit codes and output

All tools: **0** = pass, **1** = findings (or a failed step), **2** = usage error (bad option, unknown app).
Default output is a human-readable table/list; `--json` prints a single JSON document to stdout instead.
`--strict` turns warnings into failures. `--only <track|slug|apps/track/slug>` (repeatable or comma-separated)
restricts the app set; `--help` prints the options.

Finding severities: `ERROR` fails the run, `WARN` is printed (fails only with `--strict`), `note` is informational.
The `--json` document of a `check-*` tool is
`{ tool, generatedAt, ok, summary: { apps, appsWithFindings, errors, warnings, notices }, apps: [{ dir, ok, findings: [{ app, severity, code, message, detail? }] }], repo: [...repo-level findings], ...tool-specific }`.
All paths in reports are repository-relative.

## verify-all

```sh
node tools/verify-all.mjs                                   # everything, sequentially
node tools/verify-all.mjs --only appsec --report verify-report.json
node tools/verify-all.mjs --only tessera,weft --skip-install --skip-audit --log-dir .verify-logs
node tools/check-docs.mjs --report verify-report.json       # compare documented counts with the measured ones
```

Options: `--only`, `--skip-install`, `--skip-tests`, `--skip-build`, `--skip-audit`, `--report <file>`,
`--log-dir <dir>` (full per-step output as `<slug>.<step>.log`), `--concurrency N` (default 1; installs and builds
are memory-hungry), `--step-timeout <seconds>` (default 900), `--allow-scripts` (install without `--ignore-scripts`),
`--json`.

Steps per app (an app is an `apps/<track>/<slug>` directory with a `package-lock.json`):

1. `npm ci --ignore-scripts --no-fund --no-audit` — a failed install skips the remaining steps for that app.
2. `npx vitest run --reporter=default --reporter=json --outputFile.json=<tmp>` — counts come from Vitest's JSON
   reporter (`numTotalTests`, `numPassedTests`, `numFailedTests`, files = `testResults.length`). Fallback: the
   default reporter's summary line `Tests  N passed (N)` (also `N failed | N passed | N skipped (N)`); last resort:
   `npm test` stdout. An app with zero collected tests fails.
3. `npm run build` — must exit 0 and leave `dist/index.html`; `distBytes`/`distFiles` are measured afterwards.
4. `npm audit --audit-level=high --json` — `metadata.vulnerabilities.high + critical` must be 0.

Report (`--report`):

```json
{ "tool": "verify-all", "generatedAt": "…", "node": "v20.20.1", "npm": "10.8.2", "platform": "linux-x64",
  "options": { "only": [], "concurrency": 1, "stepTimeoutSeconds": 900, "ignoreScripts": true },
  "apps": [ { "dir": "apps/appsec/permitmatrix", "track": "appsec", "slug": "permitmatrix", "ok": true,
              "install": { "ok": true, "exit": 0, "ms": 0 },
              "tests": { "ok": true, "exit": 0, "ms": 0, "total": 38, "passed": 38, "failed": 0, "skipped": 0, "files": 2, "source": "json" },
              "build": { "ok": true, "exit": 0, "ms": 0, "distBytes": 574895, "distFiles": 14, "builtIn": "7.53s" },
              "audit": { "ok": true, "exit": 0, "ms": 0, "high": 0, "critical": 0, "total": 0 } } ],
  "summary": { "apps": 25, "ok": true, "stepsRun": ["install","tests","build","audit"], "stepsSkipped": [],
               "testsTotal": 0, "testsPassed": 0, "testsFailed": 0, "buildsOk": 0, "auditsOk": 0, "distBytesTotal": 0, "failures": [] } }
```

Skipped steps appear as `null`; after a failed install the later steps are `{ ok: false, skipped: true, reason: "install failed" }`.

## check-docs

`node tools/check-docs.mjs [--only …] [--report <verify-report.json>] [--json] [--strict]`

| Code | Severity | Check |
|---|---|---|
| `PROJECTS_APP_MISSING` / `PROJECTS_APP_DUPLICATE` / `PROJECTS_UNKNOWN_APP` | error | every `apps/*/*` appears exactly once in `PROJECTS.md` (rows are recognised by a link into `apps/<track>/<slug>`) |
| `PROJECTS_LINK_DANGLING` | error | every `PROJECTS.md` link target exists |
| `PROJECTS_COUNT_MISSING` / `PROJECTS_TOTAL` / `PROJECTS_APP_COUNT` | error | each row has an integer test-count cell; the declared "N automated test cases" equals the table sum; the declared number of applications equals the directory count |
| `PROJECTS_ROW_ORDER` / `PROJECTS_TRACK_CELL` | note / warn | rows within a track in id order; track cell matches the path |
| `README_QUICKSTART_MISSING` / `README_QUICKSTART_COUNT_MISSING` / `README_QUICKSTART_COUNT` | error | the fenced quickstart `npm test` line carries a `# … N tests` comment equal to the authority |
| `README_TESTS_SECTION_MISSING` / `README_TESTS_COUNT_MISSING` / `README_TESTS_COUNT` | error | the README `## Tests` section states the same total (see heuristics); `README_TESTS_COUNT_DERIVED` (note) when the total is the sum of per-file counts |
| `REPORT_COUNT` / `REPORT_APP_MISSING` / `REPORT_TESTS_SKIPPED` | error / note | with `--report`: the measured total equals the `PROJECTS.md` count |
| `PORT_CONFIG_CONFLICT` / `PORT_README_MISMATCH` / `PORT_NOT_CONFIGURED` / `PORT_README_MISSING` | error / warn | one port across `package.json` scripts (`--port N`), `vite.config.ts` (`port: N`) and the README (`localhost:N`, `127.0.0.1:N`, `--port N`) |
| `DOC_PATH_DANGLING` / `DOC_LINK_DANGLING` | error | a referenced path does not exist and is not listed in the EVIDENCE.md artefact inventory |
| `DOC_PATH_UNRESOLVED` | warn | a tooling-looking reference whose first segment is not a directory of the app (likely an external harness) and is not in the inventory |
| `DOC_INVENTORY_MISSING` | error | dangling references exist but EVIDENCE.md has no `### Artefact inventory` heading |
| `DOC_INVENTORY_PRESENT` / `DOC_PATH_ELSEWHERE` | note | inventory entries that do exist; references that resolve only from the repository root or the track directory |
| `DOC_ABSOLUTE_PATH` | note | a doc quotes absolute filesystem paths (`/home/…`, `/Users/…`, `C:\…`) from an earlier environment; one note per file with line numbers, never a dangling-path error, no inventory entry needed |
| `C3_COLOR_SCHEME` / `C3_COLOR_SCHEME_MISSING` / `C3_COLOR_SCHEME_MEDIA` / `C3_LANG` / `C3_DESCRIPTION` / `C3_TITLE` | error / note | `<meta name="color-scheme">` is `light` or `dark` (anything else only with a `prefers-color-scheme` query in `index.html`, `src/**` or `public/**`); `lang="en"`, description and title present |
| `C2_ENGINES_MISSING` / `C2_ENGINES_VALUE` | error / warn | `package.json` has `engines.node`; it equals `>=20.19` |
| `DOC_FILE_MISSING` | error | README.md, AUDIT.md, EVIDENCE.md, INTERVIEW_GUIDE.md all present |
| `APPS_STRAY_DIR` | warn | a directory under `apps/<track>/` without `package.json` |

### Heuristics

**Count authority.** The measured total from `--report` when given, otherwise the `PROJECTS.md` row.

**Quickstart count.** Inside fenced code blocks, the first `npm test` line whose `#` comment contains a test count.

**Tests-section total.** The section is the first ATX heading starting with "Test"/"Tests" (also "Tests and
evidence"), up to the next heading of the same or higher level. The total is, in order: a quoted Vitest summary
`Tests  N passed (N)` (the number in parentheses); otherwise `N tests` / `N test cases` with at most one qualifier
from *automated, total, vitest, unit, engine, passing, green* (so "28 contrast tests" or "October 2026
extension-guard tests" are not mistaken for totals); otherwise the **sum of per-file counts** written as
``` `file.test.ts` (N) ``` or ``` `file.test.ts` — N tests ``` (status `derived`). Only when none of these exists does
`README_TESTS_COUNT_MISSING` fire.

**What counts as a path reference.** Inline code spans (outside fenced blocks) and Markdown link/image targets in
README/AUDIT/EVIDENCE/INTERVIEW_GUIDE. A span is a path candidate when it has no whitespace, none of
`| ( ) { } [ ] ^ $ \ < > … = , ; : " ' ` ` (which excludes URLs, regexes, `key=value`, ellipsis ranges and quoted
literals), does not start with `#`, `/`, `@`, `~` or `**/` (anchors, routes, npm scopes, home paths, glob roots), is
not a CIDR, does not contain `/./`, does not start with a generated directory (`dist`, `node_modules`, `coverage`,
…), does not end in a version-like tail (`schema.report/1`, `release/1.4.0`), and either contains `/` and ends with
a file extension or `/` (`qa/foo.txt`, `qa/screens/`), or starts with `./`/`../`, or contains a glob character
(`qa/*.png`), or is a bare root file name (`README.md`, `package.json`, `LICENSE`, `vite.config.ts`, …). Slash-free
file names elsewhere (`setup.ts`) and tokens like `median/MAD` or `fieldset/legend` are ignored.

**Resolution.** Relative to the app directory first (globs are expanded there; a bounded walk that skips
`node_modules`/`dist`). A reference that does not resolve is an **error** when it is anchored (`./`, `../`), a bare
root file, or its first segment is an existing app directory (`qa/…`, `src/…`); otherwise the repository root and the
track directory are tried (resolving there yields `DOC_PATH_ELSEWHERE`); otherwise tooling-looking references
(`.mjs`, `.sh`, `.py`, `.md`, `.json`, …) are **warnings** (`DOC_PATH_UNRESOLVED` — typically an external review
harness) and data-looking ones (`sales/orders.csv`, `ops/deploy_key.pem`) are skipped as fixture content.

**Artefact inventory.** Inline code spans under the EVIDENCE.md heading `### Artefact inventory` (or
"Artifact inventory"). An entry covers a reference when they are equal, when the entry is a parent directory
(`qa/` covers `qa/foo.log`), or when the entry is a glob pattern matching it — `*` is any run of non-slash
characters, `**` is anything, `?` one character — so `qa/tdd-*.log`, `../_qa/*`, `qa-tools/*.mjs` or `notes/*.md`
describe a family of absent external artefacts without listing every historical file name. Entries that exist in
the repository are reported as a note — the inventory is for artefacts that are *not* in the repository. Quoted
absolute paths are not references (see `DOC_ABSOLUTE_PATH`).

## check-headers

`node tools/check-headers.mjs [--only …] [--json] [--strict]` — compares each `apps/*/*/vercel.json` with the
canonical set in `tools/lib/contracts.mjs`: one block with `"source": "/(.*)"` and exactly these eight headers (order
irrelevant, values byte-exact): `Content-Security-Policy` (`default-src 'none'; script-src 'self'; style-src 'self'
'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'; object-src 'none'`), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(),
payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains`. `cleanUrls` must be `true`; the only other
top-level keys allowed are `$schema`, `buildCommand`, `outputDirectory`, `framework`. Codes: `HDR_MISSING`,
`HDR_VALUE` (with a directive-level CSP diff), `HDR_EXTRA`, `HDR_DUPLICATE`, `HDR_KEY_CASE`, `HDR_SOURCE`,
`HDR_EXTRA_SOURCE`, `HDR_CLEANURLS`, `HDR_EXTRA_TOPLEVEL_KEY`, `HDR_FILE_MISSING`, `HDR_FILE_INVALID`.

## check-duplicates

`node tools/check-duplicates.mjs [--json] [--strict]` — byte-identity groups (SHA-256; the majority copy is the
reference, ties go to the alphabetically first path; `LICENSE` uses the root file as reference):
`apps/governance/*/src/engine/safe.ts`, `…/safe.test.ts`, `…/src/ui/download.ts`; `apps/assurance/*/src/ui/files.ts`;
`apps/assurance/{packetsmith,weft}/src/engine/sha256.ts`; `apps/*/*/LICENSE` vs `LICENSE`. A differing member is
reported with the first differing line (`DUP_DIFFERS`); a missing member is `DUP_MISSING`.

## check-dist

`node tools/check-dist.mjs [--app <dir>…] [--require-built] [--allowlist <file>] [--budget-bytes N] [--json] [--strict]`

`--app` accepts `apps/<track>/<slug>`, an absolute path, `.` from inside an app, or a track/slug. Without `--app`
every app is examined; an app without `dist/` prints `not built` (note) unless `--require-built`.

| Code | Severity | Check |
|---|---|---|
| `DIST_INDEX_MISSING` | error | `dist/index.html` exists |
| `DIST_NOT_DOT_RELATIVE` / `DIST_ROOT_RELATIVE` / `DIST_ASSET_MISSING` | error | every `src`/`href` in `index.html` starts with `./` (Vite `base: './'`) and the file exists (`#…` and `data:` are ignored) |
| `DIST_EXTERNAL_URL` / `DIST_SCHEME_URL` / `DIST_URL_IN_TEXT` / `DIST_URL_IN_META` | error / warn / note | no `http(s)://` or other scheme in attributes; URLs in text or meta content are reported for review |
| `DIST_INLINE_SCRIPT` / `DIST_INLINE_HANDLER` | error | no `<script>` without `src`, no `on*=` attributes (CSP `script-src 'self'`) |
| `DIST_TOKEN` | error | a JS bundle contains `fetch(`, `XMLHttpRequest`, `WebSocket(`, `localStorage`, `sessionStorage` or `indexedDB` (identifier-boundary match, so `prefetch(` and `localStorageX` do not count) |
| `DIST_VITE_MODULEPRELOAD` | note | the `fetch(` inside Vite's modulepreload polyfill (see below) |
| `DIST_TOKEN_WARN` | warn | `document.cookie`, `sendBeacon` |
| `DIST_TOKEN_ALLOWED` / `ALLOWLIST_*` | note / warn / error | allow-listed hits and allow-list file problems (`ALLOWLIST_UNUSED` flags stale entries) |
| `DIST_CSS_DATA_URL_BLOCKED` | error | an inlined `data:` URL in a built CSS file (`url(data:…)`) or JS bundle (string literal) whose mime type maps to a CSP directive that does not list `data:` in the app's own `vercel.json` CSP — the browser refuses the asset in production (see below) |
| `DIST_DATA_URL_ALLOWED` | note | an inlined `data:` URL whose governing directive lists `data:` (e.g. inlined SVG under `img-src 'self' data: blob:`) |
| `DIST_CSS_EXTERNAL` | error | no `url(http…)`/`@import` of external resources in CSS |
| `DIST_SOURCEMAP` / `DIST_NO_JS` | warn | source maps shipped; no JS bundle at all |
| `DIST_SIZE_BUDGET` | error | total `dist/` size ≤ 2.0 MB (2 097 152 bytes; `--budget-bytes` overrides) |
| `DIST_NOT_BUILT` | note / error | `dist/` missing (error with `--require-built`) |

**Vite modulepreload polyfill.** Every Vite production entry chunk starts with an IIFE that polyfills
`<link rel="modulepreload">` for browsers without native support; its last statement is `fetch(link.href, opts)`
for links already present in the document, i.e. the app's own same-origin chunks. The scanner recognises that call
structurally — all of: the call has the shape `fetch(<ident>.href, <ident>)`; the preload marker `<ident>.ep=!0`
(or `= true`) occurs within 200 characters before it; `modulepreload` and `relList` occur within 1 500 characters
before it — and reports it as the note `DIST_VITE_MODULEPRELOAD` instead of an error. Any other `fetch(` stays an
error. The exact minified snippet, its unminified shape and nine contrasting cases (11 in total) are in
`tools/lib/dist-tokens.test-data.json`; `node tools/check-dist.mjs --self-test` runs them (this is also a CI step).

**Inlined `data:` URLs versus the production CSP.** Vite inlines imported assets smaller than
`build.assetsInlineLimit` (default 4 096 bytes) as `data:` URLs: small font subsets end up in the CSS as
`url(data:font/woff2;base64,…)`, small images imported from JS as string literals. The canonical CSP says
`font-src 'self'` (no `data:`), so a browser serving the app with its `vercel.json` headers refuses every inlined
font ("violates the following Content Security Policy directive: font-src 'self'") while inlined images pass
(`img-src 'self' data: blob:`). `check-dist` catches this class structurally (`tools/lib/dist-data-urls.mjs`): it
collects the `data:` URLs of every built CSS/JS file, maps the mime type to a directive (`font/*`,
`application/font*`, `application/x-font*`, `application/vnd.ms-fontobject` → `font-src`; `image/*` → `img-src`;
anything else → `default-src`), reads the CSP from the app's own `vercel.json` (the first header block whose
`source` matches `/`; the canonical lab CSP when the file has none), applies CSP fallback (a directive absent from
the policy is governed by `default-src`) and reports `DIST_CSS_DATA_URL_BLOCKED` with the mime type, encoded length
and approximate decoded size of each blocked URL — or `DIST_DATA_URL_ALLOWED` when the governing directive lists
`data:`. **The fix is to emit the assets as files**, `build: { assetsInlineLimit: 0 }` in `vite.config.ts`, not to
add `data:` to `font-src` (which would also admit attacker-supplied inline fonts). Ten CSS/JS cases for the rule are
part of `--self-test`.

**Allow-list** (`tools/dist-allowlist.json`): `{ "apps/<track>/<slug>": { "<token>": "<justification ≥ 20 chars>" } }`.
Add an entry only after inspecting the hit (library code may reference these identifiers in dead branches); the
justification is printed with every allow-listed hit. The file is `{}` today — the only hits ever observed were the
polyfill above.

## CI wiring

`.github/workflows/verify.yml`: the `inventory` job lists the apps with lockfiles; `repo-checks` runs
`check-headers`, `check-duplicates`, `check-docs` and `check-dist --self-test` on Node 20.19 and 22 (the tools'
supported floor and the current LTS); the `verify` matrix (max 4 parallel, 12-minute timeout, Node 22) runs
`npm ci --no-fund`, `npm test`, `npm run build`, `npm audit --audit-level=high` inside each app and then
`node tools/check-dist.mjs --require-built --app <that app>` from the repository root. A `concurrency` group cancels
superseded runs of the same ref. The only network use is npm.

## Findings observed on 2026-10-04 during the upgrade round (tree in flux)

These runs were made while other contributors were editing the apps, so they describe the tree at the stated
moment — not the baseline commit and not the final state. They are recorded here because they are the reason the
tools exist; the tools are re-run on the integrated tree.

**check-headers.** At ≈ 09:35 UTC (exit 1) 9 of 25 `vercel.json` files were still non-canonical:
`rootstock-review`, `seamline` (no `cleanUrls`, missing `Cross-Origin-Resource-Policy` and
`Strict-Transport-Security`, CSP with `default-src 'self'`, `img-src` without `blob:`, no `manifest-src`,
`base-uri 'self'`, `form-action 'self'`); `graceline`, `tierline` (missing `Strict-Transport-Security`);
`attestline`, `pathcaster` (missing `Cross-Origin-Resource-Policy`/`Strict-Transport-Security`, same CSP drift);
`consentry`, `firstlight`, `forethought` (no `cleanUrls`, CSP with `upgrade-insecure-requests` and `'self'`
defaults, `Permissions-Policy` with `interest-cohort=()`). At ≈ 18:40 UTC five remained (`attestline`,
`pathcaster`, `consentry`, `firstlight`, `forethought`); at 19:11 UTC all 25 were canonical (exit 0).

**check-duplicates** (19:11 UTC, exit 0): all six groups byte-identical (governance ×5 for three files, assurance
`files.ts` ×5, `sha256.ts` ×2, `LICENSE` ×25 against the root file).

**check-dist** (19:11 UTC, all 25 `dist/` present, exit 0): no errors or warnings; dist sizes 437–985 KB
(largest `packetsmith` 985 KB and `graceline` 873 KB — self-hosted fonts); every `index.html` `./`-relative with
no inline script and no external URL; the only token hits were the Vite modulepreload polyfill (one note per app).
Before the polyfill was recognised structurally the same run reported 25 `fetch(` errors — one per app, all the
polyfill — which is why the heuristic exists.

**check-dist, inlined fonts vs CSP** (rule added later the same day). Serving each `dist/` with its own
`vercel.json` headers in a browser showed fonts refused under `font-src 'self'` in 11 apps whose font subsets were
below Vite's 4 096-byte inline limit (`assaynotebook`, `seamline`, `graceline` with 6 fonts, `tierline` with 6,
`wireglass`, `hashledger`, `outflow-register`, `labelsmith`, `pathcaster`, `consentry`, `forethought`); a grep of
the built CSS at ≈ 20:40 UTC still showed `url(data:font/woff2` (tierline also `font/woff`) in 10 of them, graceline
having been rebuilt already. By the time the `DIST_CSS_DATA_URL_BLOCKED` rule first ran against the tree (≈ 20:50
UTC) all 11 had been rebuilt with `build.assetsInlineLimit: 0` and the run reported 0 blocked / 0 total data: URLs
(each affected `dist/` gained exactly its former inlined-font count in files). The rule's detection is exercised by
the ten `--self-test` cases, which include Vite's exact output form.

**check-docs** (19:35 UTC, exit 1: 67 errors, 4 warnings, 17 notes across 25/25 apps; an 18:40 UTC run of the
first version had reported 100 errors — the difference is partly parser refinements described above and partly
apps being fixed in between). Repo level: `PROJECTS.md` governance rows are not in id order (DG4, DG1, DG5, DG3,
DG2). Per app ("README says / PROJECTS.md says" — PROJECTS.md still held the baseline totals while READMEs had
been updated to new measured totals, so the count findings resolve when PROJECTS.md is regenerated from the
verify-all report):

| App | README counts vs PROJECTS.md | Documentation path references |
|---|---|---|
| appsec/assaynotebook | quickstart 24/20; Tests 24/20 | — |
| appsec/permitmatrix | quickstart 38/28; Tests 38/28 | — |
| appsec/provgate | quickstart 27/22; Tests 27/22 | — |
| appsec/rootstock-review | quickstart 45/21; Tests 45/21 | inventory names 18 paths that exist (note) |
| appsec/seamline | quickstart 25/17; Tests 25/17 | `../_qa/axe-results.json` dangling; no artefact inventory |
| assurance/graceline | quickstart 27/34; Tests section states no total | `tools/browser_audit.mjs` unresolved (warn); no inventory |
| assurance/packetsmith | quickstart 80/35; Tests 80/35 | inventory names 5 paths that exist; `apps/assurance/packetsmith/` resolves from the repo root (notes) |
| assurance/tessera | quickstart 102/76; Tests 102/76 | inventory names 9 paths that exist (note) |
| assurance/tierline | quickstart 66/33; Tests 66/33 | `qa/green-forecast.txt` (README) dangling; `tools/browser_audit.mjs` unresolved (warn); no inventory |
| assurance/weft | quickstart 52/36; Tests 52/36 | inventory names 8 paths that exist (note) |
| defense/hashledger | quickstart 21/17; Tests 21/17 | 1 quoted absolute path in EVIDENCE.md (note) |
| defense/injectboard | quickstart 22/11; Tests 22/11 | 1 quoted absolute path in EVIDENCE.md (note) |
| defense/peerline | quickstart 18/12; Tests 18/12 | 1 quoted absolute path in EVIDENCE.md (note) |
| defense/ruleshadow | quickstart 47/25; Tests 47/25 | 2 quoted absolute paths in EVIDENCE.md (note) |
| defense/wireglass | quickstart 27/20; Tests 27/20 | 2 quoted absolute paths in EVIDENCE.md (note) |
| governance/attestline | quickstart 48/39; Tests 48/39 | `../_qa/audit.mjs` (AUDIT.md), `../HANDOFF.md` (EVIDENCE.md) dangling; no inventory |
| governance/holdfast-ledger | quickstart 33/26; Tests 33/26 | inventory names 12 paths that exist (note) |
| governance/labelsmith | quickstart 58/34; Tests 58/34 | — |
| governance/outflow-register | quickstart 61/30; Tests 61/30 | inventory names 13 paths that exist (note) |
| governance/pathcaster | quickstart 39/30; Tests 39/30 | — |
| privacy/consentry | quickstart 61/51; Tests 61/51 | inventory names 8 paths that exist (note) |
| privacy/firstlight | quickstart 43/36; Tests 43/36 | inventory names 6 paths that exist (note) |
| privacy/forethought | quickstart 47/37; Tests 47/37 | inventory names 6 paths that exist (note) |
| privacy/petitio | quickstart 79/68; Tests 79/68 | inventory names 8 paths that exist (note) |
| privacy/tenure | quickstart 50/42; Tests 50/42 | `../qa-harness/audit.mjs`, `qa/npm-ci.log` and three RED/GREEN `qa/tdd-*.log` pairs dangling (`*.log` is gitignored); `consentry/qa/tdd-red-review-fixes.log`, `v2/tn-adverse.mjs` unresolved (warn); no inventory |

Earlier runs the same day had also reported: `color-scheme "light dark"` and missing `engines.node` in
`pathcaster` (18:40 UTC; both fixed by 19:11 UTC), four unresolved `qa-tools/*.mjs`/`qa-tools/verify-all.sh`
references in each defense app and eight dangling `qa/*.log` references in `firstlight`/`forethought`/`consentry`
(all covered by artefact inventories by 19:35 UTC). Ports agreed in all 25 apps throughout; `lang`, description and
title were present everywhere; `engines.node` was present everywhere by 19:11 UTC (missing in the defense,
governance and privacy apps at the start of the day).

**verify-all** smoke test (`--skip-install --skip-audit --only permitmatrix`, 19:07 UTC, exit 0): tests 38/38 in
2 files (JSON reporter), build ok, `dist/` 574 895 bytes / 14 files, "built in 7.53s"; the report parsed as JSON and
`check-docs --report` consumed it (reporting `REPORT_COUNT`: PROJECTS.md 28 vs measured 38). The stdout fallback
parser was checked against the 25 baseline `vitest run --reporter=verbose` logs and the matching `npm audit` logs:
all 25 `Tests  N passed (N)` lines and file counts parsed to the recorded totals, all audits to 0.
