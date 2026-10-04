# EVIDENCE — Seamline

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json` (not part of this repository — see the artefact inventory at the end).

## Test-first record

**RED — src/engine/__tests__/seamline.test.ts written before any engine code.** First run (`qa/red-run.txt`):

```
FAIL  src/engine/__tests__/seamline.test.ts
Error: Cannot find module '../scenario' imported from .../src/engine/__tests__/seamline.test.ts
Tests  no tests
```

**GREEN-phase corrections (two).** (1) The whole suite failed to load because the structural scan's depth cap (6) was below the schema's legitimate depth (`steps[].client.payload.items[].unitPrice` = 7); raised to 8. (2) `12 passed | 2 failed`: a test-side bug (`JSON.stringify` emits `"price":4.5`, not `"price": 4.5`, so the `1e999` substitution never happened — fixed in the test and asserted that the substitution occurred), and rejected redemption steps reported no `balanceAfter` — the engine now always reports the ledger. Re-run: 14 passed.

**GREEN** (`qa/green-run.txt`): 14 passed (14).

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 112 packages in 3s
$ npm run build
✓ built in 1.42s
$ npm test
 Test Files  1 passed (1)
      Tests  14 passed (14)
$ npm audit
found 0 vulnerabilities
```

Total: **14 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions. (Superseded: 17 tests after the review cycle below, 25 after the October 2026 upgrade round.)

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-trusting-s2-price-rewrite.png` | Trusting server accepts rewritten prices; CWE-602 finding |
| `desktop-02-trusting-replay.png` | Replayed reward accepted; balance goes negative |
| `desktop-03-enforcing-replay-rejected.png` | Enforcing server rejects the replay via `nonce-single-use` |
| `desktop-04-enforcing-role-neutralized.png` | Client-asserted role ignored (session-derived) |
| `desktop-05-import-errors.png` | Malformed scenario rejected with specific errors |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json`, parent review harness output, not in this repository). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session. These screenshots and the axe pass predate the October 2026 round (the fixture then had 11 steps; the twelfth step and the `quantity-valid` check are not in the captures).

## Measured facts that may support resume bullets

* 11 scripted events, 6 tampered. Trusting server: 11 accepted, 6 findings (CWE-602 ×2, CWE-294 ×2, CWE-269, CWE-639). Enforcing server: 5 accepted, 3 neutralized, 3 rejected, 0 findings. *(1 October fixture. Since 4 October 2026: 12 events, 7 tampered; trusting server 12 accepted, 7 findings adding CWE-20; enforcing server 5 accepted, 3 neutralized, 4 rejected, 0 findings — both summaries are asserted exactly in the test suite.)*
* Points ledger: trusting server ends at −90 after the replay; enforcing server stays at 30 (asserted).
* Limits: 96 KB UTF-8, 60 steps, 12 users, 40 catalog items, 10 order lines, depth 8.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`):

```
× flags an untampered step whose client total disagrees with the catalog …   expected undefined to be 'CWE-602'
× records divergences for every tampered step on the trusting server …      TypeError: Cannot read properties of undefined (reading 'length')
Tests  2 failed | 15 passed (17)
```

**GREEN** (`qa/green-run-sixth.txt`): after the first rewrite the replay step (s6) showed no divergence on the trusting server because the nonce ledger was only kept in enforcing mode; the ledger is now server truth in both modes (only the check is policy-dependent). Then `Tests 17 passed (17)`. Trusting-server findings on the fixture remained exactly six with the same CWEs (a seventh step and finding were added in the October 2026 round below).

Clean checkout re-run: 17/17, build ok, 0 vulnerabilities. Browser flow re-shot including `desktop-06-untampered-divergent-total-finding.png` (council repro via the import panel); axe 0 violations.

## Upgrade round — October 2026 (lab-wide)

Node v20.20.1, npm 10.8.2, Linux sandbox, 4 October 2026. Commands were run through the lab's helper, which executes the project-local commands shown below in this app directory and saves the verbatim output with a header (command, repo-relative cwd, UTC timestamp, Node version, exit code); the saved files are the evidence.

**Scope of this round:** canonical `vercel.json` headers (C1), `engines.node >=20.19` (C2), `color-scheme` verified `dark` against the stylesheet (`html, body { background: var(--field) }`, `#0e1520`); the eighth invariant **`quantity-bounds`** — `Invariant` gains `'quantity-bounds'`, `TamperKind` gains `'quantity-rewrite'` (optional `tamper.value`, default `-1`), `CatalogItem` gains optional `maxQty` (integer 1–10 000, default 99), the enforcing server runs `quantity-valid` before pricing and rejects invalid lines, the trusting server accepts them and the oracle raises `{ kind: 'quantity-unbounded', cwe: 'CWE-20', severity: 'medium' }`; `INVARIANT_PRIORITY` ends with the new invariant. The importer now accepts client line quantities that are zero, negative or fractional (bounded in magnitude) instead of rejecting them, because a schema that refuses invalid quantities would hide the weakness the tool exists to show. Fixture `brewline-scenario.json` gains step `s12` (quantity-rewrite to −1 on a beans order; `beans-1kg` carries `maxQty: 5`). Schema ids unchanged (`seamline.scenario/1`, `seamline.report/1`); the 1 October fixture and exports still import. No dependency was added or changed.

**RED** (`qa/red-quantity-bounds.txt`, `npx vitest run --reporter=verbose`, 2026-10-04T19:11:04Z, exit 1). Eight tests were added to `src/engine/__tests__/seamline.test.ts` and four existing assertions extended (seven findings, `s12` rejected by `quantity-valid`, `s12` in the report comparison, divergences on `s12`). To let the suite collect with the new fixture, the types and scenario validation were written together with the fixture, `applyTamper` had a `quantity-rewrite` case that returned the message unchanged (`note: 'not implemented'`), and `simulate.ts` had the `FINDINGS` entry and priority but no divergence check and no `quantity-valid` check. Nine tests failed at assertion level; the three new validation-only tests passed because the schema part already existed at that point (said here so the RED is not over-read):

```
× trusting server (client-authoritative) > raises one finding per tampered step with CWE mapping
   → expected { s2: 'CWE-602', s4: 'CWE-602', …(4) } to deeply equal { s2: 'CWE-602', s4: 'CWE-602', …(5) }
× enforcing server (server-authoritative) > rejects replay, backdated and cross-user requests with named checks
   → expected 'accepted' to be 'rejected' // Object.is equality
× … > trusting server accepts the rewritten quantity, bills a negative total and raises a CWE-20 finding keyed by the quantity-bounds invariant
   → expected 28 to be -28 // Object.is equality
× … > flags an untampered step whose client sends qty 0 exactly like the tampered one — divergence, not label
   → expected [] to deeply equal [ { …(3) } ]
× … > applies the per-item maxQty (default 99), accepts in-range rewrites silently, flags fractions, and lets price outrank quantity in the finding
   → expected undefined to be 'CWE-20' // Object.is equality
 Tests  9 failed | 16 passed (25)
```

Disclosed edit to that RED file: after the run, the pre-existing `describe` label of the 1 October regression block was renamed to `sixth-review regression — …` (text only); the four lines of the saved log that carry that label were updated to match the current test names and a header note saying so was inserted into the capture. No result line, count or timestamp was touched.

**GREEN-phase correction (first implementation run, 19:16 UTC, saved and then superseded):** `1 failed | 24 passed` — the test for the default `-1` rewrite listed only one of the two order lines in a `toMatchObject`; the expectation was completed (both lines plus `changedFields`), the engine was not changed.

**GREEN** (`qa/green-quantity-bounds.txt`, exit 0; first green run 19:18 UTC, capture re-saved after the label rename — timestamp in the file header):

```
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

The enforcing server still accepts every untampered step of the fixture with zero findings (`accepts every untampered step and produces no findings` stays green), and the untampered `qty: 0` step is flagged with the same finding shape as the tampered one.

**Gates (after the UI text and documentation changes):**

```
$ npx tsc -p tsconfig.json --noEmit            # exit 0
$ npm run build
✓ 52 modules transformed.
dist/assets/index-BBA96yLt.css   17.08 kB │ gzip:  6.35 kB
dist/assets/index-CbB078Od.js   292.39 kB │ gzip: 91.86 kB
✓ built in 3.78s
$ npm audit --audit-level=high
found 0 vulnerabilities
```

`dist/` after the build: `index.html` 0.65 kB, CSS 17.08 kB, JS 292.39 kB plus twelve font files (sizes as printed by Vite above); the lab's dist checker reports 516 KB in 16 files, no network/storage tokens apart from Vite's same-origin modulepreload polyfill (informational note). A final rebuild after the test-label rename (which touches no shipped code) produced the same asset names and sizes (`index-BBA96yLt.css`, `index-CbB078Od.js`; `✓ built in 1.48s`). *(Superseded the same day by the font-file build below.)*

**Production-CSP font fix (same day; found by the lab's browser acceptance run, which serves the built `dist/` with this app's own `vercel.json` headers).** Under that policy every load, desktop and mobile, produced two CSP violations and one console error: Vite's default `assetsInlineLimit` (4 KB) had embedded the smallest Manrope subset (cyrillic-ext, 2.55 kB) into the stylesheet as `url(data:font/woff2;base64,…)`, and `font-src 'self'` (no `data:`) blocks it. Measured before the fix: `grep -c "data:font" dist/assets/index-BBA96yLt.css` → `1` (the rootstock-review stylesheet: `0`). Fix: `vite.config.ts` → `build.assetsInlineLimit: 0` (one-line comment in the file). The CSP was **not** widened. Rebuild:

```
$ npm run build
✓ 52 modules transformed.
dist/assets/manrope-cyrillic-ext-wght-normal-C8S-KRRz.woff2   2.55 kB   ← previously inlined into the CSS
… (twelve further font files, unchanged)
dist/assets/index-Kj0GbQ3s.css   13.70 kB │ gzip:  3.48 kB
dist/assets/index-C66gp99d.js   292.39 kB │ gzip: 91.86 kB
✓ built in 5.12s
```

After the fix: `grep -c "data:font" dist/assets/index-Kj0GbQ3s.css` → `0`; the lab's dist checker (now also counting `data:` URLs the CSP would block) reports 516 KB in 17 files, `data: blocked/total 0`, 0 errors, 1 informational note (Vite modulepreload); `npx vitest run` → `Tests  25 passed (25)` (20:52 UTC). The CSS shrank from 17.08 kB to 13.70 kB because the base64 blob is gone; the font now loads as a same-origin file like the others. Browser re-verification under the production headers is the lead's acceptance run, not measured here.

**Contrast:** no colour token was added or re-paired in this round; the changed UI strings (server description, tamper note for `quantity-rewrite`, footer) use the existing `--muted` #9fadc0 on `--panel` #16202e pairing, which computes to 7.20 : 1 (WCAG relative-luminance formula from the hex values; not browser-measured this round).

**Not measured this round:** no Playwright/axe run (browser QA is the lead's integration step; `qa/screens/` predates step `s12`), no `npm ci` from a clean checkout here (dependencies were pre-installed by the lead; the lockfile is unchanged), no performance benchmark.

**Portability edit to the historical capture (disclosed):** the 1 October RED log `qa/red-run.txt` quoted an absolute path in its "Cannot find module" line; that path named the original build environment, not a repository path (the file it refers to is `src/engine/__tests__/seamline.test.ts` here). On 2026-10-04 the lab's capture-neutralising helper replaced that directory prefix with the marker `<original-build>/` and inserted a header note saying so; the result line, count and everything else are unchanged. The helper-saved logs of this round print the checkout root as the portable marker `<repo>` for the same reason.

All other file paths referenced in the four documents of this app resolve inside the app directory (verified with the lab's documentation checker before hand-off).

### Artefact inventory

Artefacts referenced in this app's four documentation files that are **not** in this repository:

* `../_qa/axe-results.json` (and anything else under `../_qa/*`) — output of the parent review harness (axe-core results for the appsec apps), kept outside this repository; the 0-violation claim above is quoted from it and was not re-measured in October 2026.
* "Playwright 1.63.0 (parent's internal QA install)" — the browser-QA tooling lived in the parent workspace, not in this repository; no `playwright` package is a dependency here.
