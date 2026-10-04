# EVIDENCE — wireglass

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated. *(The October 2026 lab-wide upgrade round is recorded in its own section at the end of this file; the sections before it describe the original build and are kept as written, with annotations in italics where this round changed the facts.)*

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './parse' imported from '<original-build>/defense/wireglass/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design. Paths and the review-round label in this file were neutralised on 2026-10-04 (`<original-build>/` stands for the original build environment's directory, which is not a repository path; the file here is `src/engine/engine.test.ts`); results unchanged. The same path substitution, with a header note, was applied to the retained capture `qa/red-run.txt`.

**RED, review round (new assertion-level tests before the fix)** — `npx vitest run`:
```
× rejects HTTP byte counts above the 13-digit bound instead of parsing them as huge numbers 8ms
     × cdn-noise reliably raises DNS-001 on CDN content-hash hostnames for every seed, and the suffix allowlist silences it 40ms
     × mixed-day CDN hostnames sit under an allowlisted suffix and only alert once that suffix is removed 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected [ { id: 'e1', line: 1, …(7) } ] to have a length of +0 but got 1
AssertionError: seed 10: expected 0 to be greater than 0
AssertionError: expected [ { id: 'DNS-001-9fdec490', …(11) } ] to have a length of +0 but got 1
      Tests  3 failed | 17 passed (20)
```

**Iterations**
- Intermediate assertion-level iteration during implementation: none beyond the initial module-resolution RED; all 17 tests passed on the first implementation run. Post-GREEN refactor: DNS-001 was regrouped from one alert per event to one alert per source + parent zone (tests stayed green, re-run recorded below), and the scenario was adjusted so the demo contains one real multi-protocol chain.
- **Sixth review round (2026-10-01)** — three new failing tests first (`qa/red-run-2.txt`), then: HTTP `bytes` bounded to 13 digits (previously `99999999999999999999999` parsed); the `cdn-noise` teaching scenario now uses 44-character content-hash labels under a non-allowlisted suffix so DNS-001 fires on every seed (asserted for seeds 0–24) and is silenced by adding the suffix to the allowlist; the `mixed-day` scenario text and README now say the CDN hostnames are suppressed by the default allowlist rather than calling them an "expected false positive" that never fired.

**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  14:29:22
   Duration  434ms (transform 142ms, setup 0ms, import 161ms, tests 111ms, environment 0ms)
```
*(October 2026: the suite is now 27 tests in two files; see below.)*

## Clean-checkout verification (`qa-tools/verify-all.sh`)
*(External harness used during the original build; not part of this repository — see the artefact inventory below.)*
```
## npm ci
added 129 packages in 5s
## npm run build
dist/index.html                                                     0.62 kB │ gzip:  0.38 kB
✓ built in 1.93s
## npm test
 Test Files  1 passed (1)
      Tests  20 passed (20)
   Duration  544ms (transform 173ms, setup 0ms, import 194ms, tests 117ms, environment 0ms)
## npm audit
found 0 vulnerabilities
## storage-api grep (expect no matches in src)
none
## fetch/XHR grep (expect none)
none
## dist size
476K
```
Dependency note: the first install pulled vitest 3.2.7, for which `npm audit` reported 2 moderate advisories in `@vitest/mocker` (dev-only, not shipped). Upgraded to vitest ^4.1.11; the suite passed unchanged and `npm audit` reports 0 vulnerabilities (above).

## Browser workflow (`qa-tools/browser_qa.mjs`, Playwright Chromium, reduced motion)
*(External harness, original build, 2026-10-01; not re-run in the October 2026 round, so the log and screenshots below predate the pending-configuration what-if panel.)*
Preview served with `vite preview --port 6130`. Log:
```
selected DNS-002 alert: DNS-002 · NXDOMAIN burst
triage status: Status: closed · disposition true_positive
pivot heading: PIVOT: ALL 33 EVENTS FROM 10.0.4.27
export schema=wireglass.report/1 alerts=5 closed=1
paste error: No events parsed. Line 1: unrecognised line format
quiet baseline queue: No alerts for this input. Either the traffic is benign or the thresholds are too
cdn-noise alerts: 9
cdn-noise after allowlist tuning: No alerts for this input. Either the traffic is benign or th
chains shown: 1
[desktop] horizontal overflow px=0 errors=0 
[tablet] horizontal overflow px=0 errors=0 
[mobile] horizontal overflow px=0 errors=0
```
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three. *(These screenshots show the pre-round Rules tab, where threshold edits applied instantly; the what-if panel and Apply/Discard buttons are not in them.)*

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
*(External harness, original build; not re-run this round.)*
```
wireglass: reached .alert-row after 9 Tabs, visible focus outline=true, activation changed detail=true ("DNS-001 · High-entropy or very long DNS label")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
*(External harness, original build; not re-run this round.)*
```
desktop: 0 violations, 29 rule groups passed, 1 incomplete (needs manual review)
mobile: 0 violations, 30 rule groups passed, 1 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- 5 deterministic rules (DNS-001, DNS-002, HTTP-001, HTTP-002, SMTP-001) each with a positive and a negative/false-positive fixture.
- Default `mixed-day` seed 7: 331 parsed events, 0 parse errors, 5 alerts, 1 multi-protocol chain (10.0.4.27: DNS + HTTP) — read from the running UI during browser QA.
- Input bounds: 5,000 lines / 200,000 characters; malformed lines reported with line numbers.
- Browser workflow exercised: select alert → start investigating → close with evidence note → pivot → export JSON (`wireglass.report/1`, 5 alerts, 1 closed) → invalid paste rejected → quiet-baseline shows empty state.

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.

## Upgrade round — October 2026 (lab-wide)

Recorded 2026-10-04 on Node v20.20.1, npm 10.8.2, Linux sandbox, via the lead's per-app helper (`npx vitest run --reporter=verbose`, `npx tsc -p tsconfig.json --noEmit`, `npm run build`, `npm audit --audit-level=high`). Every line quoted below is copied from the saved command output; the `qa/*.txt` files are the helper's verbatim captures (command, UTC timestamp, Node version, exit code, full output). Paths are repository-relative.

### Hygiene (contracts C1–C3)
- `vercel.json` replaced with the lab-wide canonical header set: CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`. Previously: `frame-ancestors 'self'`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, no COOP/CORP/HSTS. `form-action 'none'` is safe: the only `<form>` (scenario/seed controls) calls `preventDefault()` in its submit handler. AUDIT.md updated to match.
- `package.json`: `"engines": { "node": ">=20.19" }` added.
- `index.html`: `<meta name="color-scheme">` changed from `light dark` to `light` — `src/styles.css` sets `html, body { background: var(--paper) }` with `--paper: #eef1f5` and has no `prefers-color-scheme` query.
- Baseline re-measured before any engine change (helper `test`, 09:18 UTC): `Tests  20 passed (20)`.

### Feature: tuning what-if (test-first)
New `src/engine/diff.ts` (`diffAlerts`, `recordTuning`), optional `tuning` input/field in `src/engine/report.ts`, and UI wiring in `src/App.tsx`: rule edits go to a pending configuration; a what-if panel lists the alerts that would be removed/added/kept for the current events; **Apply** commits (and records the configuration in force before the first applied change of the session), **Discard** drops the pending edits; the former "Reset thresholds" button now *stages* the defaults so their effect is previewed too; "Export JSON" stays enabled when a tuning record exists even if the applied configuration silenced every alert.

**RED — `qa/red-tuning-diff.txt` (18:40 UTC, full suite, with a stub `src/engine/diff.ts` exporting the real signatures and returning empty arrays / an empty record, so the tests collect and fail on behaviour):**
```
      Tests  7 failed | 20 passed (27)
AssertionError: expected [] to deeply equal [ 'DNS-001-9fdec490', …(4) ]            (identical configs: kept should hold every alert)
AssertionError: expected [] to deeply equal [ 'DNS-001-8e86f72d', …(8) ]            (cdn-noise allowlist: 9 DNS-001 alerts should be removed)
AssertionError: expected [] to deeply equal [ 'HTTP-001-704fbad5' ]                 (authFailBurst 20: HTTP-001 should be removed)
AssertionError: expected undefined to deeply equal { Object (from, to, ...) }       (report.tuning absent)
```
All seven failures are missing behaviour; no import or `is not a function` errors.

**GREEN — `qa/green-tuning-diff.txt` (19:02 UTC, full suite):**
```
 Test Files  2 passed (2)
      Tests  27 passed (27)
   Duration  2.73s (transform 607ms, setup 0ms, import 696ms, tests 960ms, environment 0ms)
```

### Measured facts for the what-if (from the GREEN run's fixtures)
- `cdn-noise`, seed 7: adding `.edge.media.example` to the allowlist removes exactly the 9 DNS-001 alerts (`DNS-001-8e86f72d`, `DNS-001-1355cb53`, `DNS-001-6e1ba970`, `DNS-001-5243658c`, `DNS-001-c6f5fdda`, `DNS-001-97d09e58`, `DNS-001-97794707`, `DNS-001-b13ad7e9`, `DNS-001-d7cfdccd`) and adds none; the report's `tuning.removed` lists those ids.
- `mixed-day`, seed 7: the 5 default alerts are `DNS-001-9fdec490`, `DNS-002-720955be`, `HTTP-001-704fbad5`, `HTTP-002-489e0a59`, `SMTP-001-7f6091e1`; raising `authFailBurst` to 20 removes only `HTTP-001-704fbad5`; clearing the DNS allowlist adds only CDN DNS-001 alerts; `nxdomainWindowSec: 61` + `dnsLabelMinLength: 21` yields an identical id list (empty diff).
- Report schema id unchanged (`wireglass.report/1`); `tuning` is absent unless supplied (asserted with `Object.keys(report)`).

### Typecheck, build, audit (2026-10-04)
- `npx tsc -p tsconfig.json --noEmit` → exit 0.
- `npm run build` (`tsc -p tsconfig.json && vite build`), first build of the round — superseded by the font fix below:
```
dist/assets/index-BwA9dJOh.css                                     15.38 kB │ gzip:   5.71 kB
dist/assets/index-Bc24R2rz.js                                     315.41 kB │ gzip: 100.11 kB
✓ built in 6.22s
```
  Built `dist/` totalled 520 870 bytes (508.7 KB, 12 files), measured with a small Node directory walker.
- `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### Build/CSP fix: fonts must ship as files (2026-10-04, after the lead's browser check)
- **Found by the lead's integration browser check**, which serves the built `dist/` with this app's own `vercel.json` response headers (the production CSP): 2 CSP violation reports and 1 console error per page load, in both viewports. Cause, confirmed on the first build above: the bundled CSS contained one `url(data:font/woff2;base64,…)` — Vite inlines assets under 4 KiB, and the 2.03 kB `jetbrains-mono-cyrillic-ext` subset is the only bundled font file below that limit (`grep -c "data:font" dist/assets/index-BwA9dJOh.css` → `1`). `font-src 'self'` has no `data:` source, so the browser blocked the subset (glyph fallback only, no functional impact — but a genuine policy violation). The lead's interim browser report is private integration state, not part of this repository.
- **Fix in the build, not in the policy** (the CSP was not widened): `vite.config.ts` → `build.assetsInlineLimit: 0`, with a comment stating why. Rebuild (`npm run build`):
```
dist/assets/jetbrains-mono-cyrillic-ext-wght-normal-EocZY2iu.woff2    2.03 kB
dist/assets/index-CZGIxqhQ.css                                       12.71 kB │ gzip:   3.40 kB
dist/assets/index-JN-i3jBy.js                                       315.41 kB │ gzip: 100.11 kB
✓ built in 3.00s
```
  `grep -c "data:font" dist/assets/index-CZGIxqhQ.css` → `0` (and `grep -c "data:"` → `0`); the subset is now the 13th file under `dist/assets`. Built `dist/` totals 520 227 bytes (508.0 KB, 13 files). `node tools/check-dist.mjs --app apps/defense/wireglass` → `PASS: 0 error(s), 0 warning(s), 1 note(s)` (the note is Vite's same-origin modulepreload polyfill). The test suite was re-run after the config change: `Tests  27 passed (27)`. The lead re-measures the rebuilt bundle under the production headers; this worker ran no browser.
- The lead's new-feature browser flow for this app (tuning what-if: stage `.edge.media.example` on `cdn-noise`, Discard, re-stage, Apply, export with the `tuning` record) passed 25/25 steps under the production CSP on the first build; the font `data:` URL was the only CSP violation in that run.

### Accessibility and contrast for the new UI (computed, WCAG 2.x relative luminance; not an axe run)
- The what-if panel is a `<section aria-labelledby>` with a heading, the counts sentence is a `role="status" aria-live="polite"` paragraph ("N alerts would be removed · M added · K kept", words not colour), the removed/added lists are plain lists naming rule, host, event count and alert id, and Apply/Discard are ordinary `<button>` elements in the existing focus style (`:focus-visible` outline `--focus #ffb703`, 3 px). The Rules tab trigger reads "Rules (pending change)" while edits are staged. No motion added.
- Panel text `--ink #16213a` on the panel background `#fff7e6`: **15.01:1**. Muted text `--ink-2 #4a5570` on `#fff7e6`: **6.97:1**. Tab trigger text `--ink` on `--panel #ffffff`: **16.00:1**.
- The panel border `#e5c56a` on `#fff7e6` is **1.57:1** — below the 3:1 non-text floor — so the border is decorative only; the heading, the counts sentence and the buttons carry the meaning.

### Not measured in this round
- No browser, keyboard or axe run was performed by this worker in this round (no Playwright package in the repository; browser QA is the lead's integration step). The screenshots in `qa/` are from 2026-10-01 and predate the what-if panel.
- The what-if counts are a property of the loaded events, not a measure of rule precision; nothing here claims detection efficacy.

Every repository-relative file path named in README.md, AUDIT.md, INTERVIEW_GUIDE.md and this file exists in the repository, except the artefacts listed in the inventory below. The absolute path quoted in the original RED output at the top of this file (the module-resolution error) names the original build environment, not a repository path; the corresponding file here is `src/engine/engine.test.ts`.

### Artefact inventory
Referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE but **not** in this repository, with the reason:
- `qa-tools/verify-all.sh` — external clean-checkout harness used during the original build (2026-10-01); not part of this repository. Its measurements above cannot be re-run from the repository alone; the October 2026 section re-measures tests, build and audit with the lab's helper instead.
- `qa-tools/browser_qa.mjs` — external Playwright browser-QA harness (original build); not in this repository; not re-run by this worker this round.
- `qa-tools/keyboard_qa.mjs` — external keyboard-pass harness (original build); not in this repository; not re-run this round.
- `qa-tools/axe_qa.mjs` — external axe-core harness (original build); not in this repository; not re-run this round. The retained result summary is the committed axe JSON file in the qa folder.
- `HANDOFF.md` — the original build's hand-off note where the first axe findings were recorded; it was not committed to this repository.
