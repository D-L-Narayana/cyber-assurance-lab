# EVIDENCE — hashledger

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

> **Annotation (October 2026 round).** The sections below are the original build record and are kept verbatim. The `qa-tools/*` scripts, `HANDOFF.md` and `hl-adverse.mjs` they cite belong to external build/review harnesses that are **not** part of this repository (see `### Artefact inventory` at the end), so the browser, keyboard, axe and adverse-review measurements quoted there cannot be re-run from the repository alone. The absolute path quoted in the original RED output named the original build environment, not a repository path; the file it refers to is `src/engine/engine.test.ts`. Paths and review-round labels in the quoted output and prose below were neutralised on 2026-10-04 (`<original-build>/…`, "Sixth review round"); results, dates and counts are unchanged. The test total quoted below (17) is the original count; the current measured total is in the October 2026 section.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './hash' imported from '<original-build>/defense/hashledger/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design.

**RED, review round (new assertion-level tests before the fix)** — `npx vitest run`:
```
× binds takenAt and id into the chain so forged metadata fails verification 6ms
     × rejects "." path segments as well as ".." 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected true to be false // Object.is equality
AssertionError: expected true to be false // Object.is equality
      Tests  2 failed | 15 passed (17)
```

**Iterations**
- All 15 tests passed on the first implementation run after the module-resolution RED. One type-level failure surfaced in `npm run build` (`tsc`): the test read `brokenAt` from a union type without narrowing; fixed in the test.
- **Sixth review round (2026-10-01)** — `hl-adverse.mjs` showed forged `takenAt`/`id` verifying OK. Two failing tests first (`qa/red-run-2.txt`: forged time, forged id, reversed entry order; `.` path segments), then: chain hash now covers `(prev | takenAt | entries)` and the id is re-derived from the digest during verification; `validateManifest` rejects `.` segments and backslashes. Docs now state integrity ≠ authenticity (no signatures).

**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  14:28:30
   Duration  312ms (transform 106ms, setup 0ms, import 128ms, tests 31ms, environment 0ms)
```

## Clean-checkout verification (`qa-tools/verify-all.sh`)
```
## npm ci
added 127 packages in 4s
## npm run build
dist/index.html                                                  0.62 kB │ gzip:  0.38 kB
✓ built in 1.65s
## npm test
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  373ms (transform 140ms, setup 0ms, import 160ms, tests 33ms, environment 0ms)
## npm audit
found 0 vulnerabilities
## storage-api grep (expect no matches in src)
none
## fetch/XHR grep (expect none)
none
## dist size
536K
```
Dependency note: the first install pulled vitest 3.2.7, for which `npm audit` reported 2 moderate advisories in `@vitest/mocker` (dev-only, not shipped). Upgraded to vitest ^4.1.11; the suite passed unchanged and `npm audit` reports 0 vulnerabilities (above).

## Browser workflow (`qa-tools/browser_qa.mjs`, Playwright Chromium, reduced motion)
Preview served with `vite preview --port 6132`. Log:
```
snapshot: Baseline snapshot snap-4867ef083278 with 12 files.
diff: snap-4867ef083278 → snap-dc6c4fe3652b: 0 added · 0 removed · 1 modified · 0 permission · 11 unchanged
decision: BLOCK DLP-RESTRICTED-EGRESS · hr/payroll_q3.csv

BLOCKED BECAUSE

file classified restricted (signals: national-id-pattern, payroll-keyword)
channel: Removable 
replay: Replay rejected: event egress-1-hr/payroll_q3.csv-usb-webmail.example already in the ledger (1 rejected so far).
cases: 1
chain: Chain intact across 2 snapshots. · simulate tamper
after tamper: Chain broken at #0: entries or takenAt do not match stored chain hash · reset demo
export schema=hashledger.report/1 snapshots=2 cases=1
[desktop] horizontal overflow px=0 errors=0 
[tablet] horizontal overflow px=0 errors=0 
[mobile] horizontal overflow px=0 errors=0
```
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three.

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
```
hashledger: reached .file after 6 Tabs, visible focus outline=true, activation changed detail=true ("README.md")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
```
desktop: 0 violations, 27 rule groups passed, 0 incomplete (needs manual review)
mobile: 0 violations, 28 rule groups passed, 1 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- SHA-256 via Web Crypto, pinned to the published test vector for "abc".
- 12 synthetic fixture files; bounds ≤ 200 files, ≤ 65,536 chars each, no `..` paths. *(October 2026 annotation: paths are now also restricted to `[A-Za-z0-9._/-]` and owners to printable 1–64 character strings; the fixture passes unchanged.)*
- Browser workflow exercised: baseline snapshot → edit payroll file → second snapshot (diff: 1 modified, 11 unchanged) → USB egress blocked by `DLP-RESTRICTED-EGRESS` with case opened → replay rejected (1) → simulate tamper → verify reports `Chain broken at #0` → export JSON (`hashledger.report/1`, 2 snapshots, 1 case).

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.

## Upgrade round — October 2026 (lab-wide)

Recorded 2026-10-04 on Node v20.20.1, npm 10.8.2, Linux sandbox. Commands were run from the app directory through the lab's lead helper, which records the command, timestamp, Node version and exit code as the first lines of every saved evidence file in `qa/`; the output below is copied verbatim from those files. No dependency was added or changed; `npm ci` was not re-run in this round (dependencies were installed once by the lead from the unchanged lockfile).

### Hygiene
- `vercel.json` replaced by the lab-wide canonical header set (CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, HSTS) — described in `AUDIT.md`.
- `package.json`: `"engines": { "node": ">=20.19" }` added.
- `index.html`: `color-scheme` changed from `light dark` to `dark` (the stylesheet implements one dark palette: `body` background `#141820`, no `prefers-color-scheme` query).

### Test-first record — manifest hardening
Tests written first in `src/engine/manifest.test.ts` (4 tests) against the existing `validateManifest`; the file imported only existing exports, so it collected without a stub.

**RED** — `npx vitest run --reporter=verbose src/engine/manifest.test.ts`, saved as `qa/red-manifest-hardening.txt` (exit 1):
```
 × src/engine/manifest.test.ts > manifest hardening > requires owner to be a printable string of 1–64 characters
   → expected true to be false // Object.is equality
 × src/engine/manifest.test.ts > manifest hardening > allows only [A-Za-z0-9._/-] in paths, after the existing segment checks
   → expected true to be false // Object.is equality
 × src/engine/manifest.test.ts > manifest hardening > rejects non-array manifests and non-object rows without throwing
   → expected [Function] to not throw an error but 'TypeError: Cannot read properties of …' was thrown
 ✓ src/engine/manifest.test.ts > manifest hardening > keeps the shipped fixture valid under the new rules
      Tests  3 failed | 1 passed (4)
```
Three behavioural failures (empty owner accepted, `team notes.md` accepted, a `null` row throwing `Cannot read properties of null (reading 'path')`). The fourth test is the regression guard that the shipped fixture stays valid; it passed at RED by design.

**GREEN** — same command after rewriting `validateManifest`, saved as `qa/green-manifest-hardening.txt`:
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### Final gates (2026-10-04, 18:54–18:55 UTC)
- `npx vitest run --reporter=verbose` (full suite), saved as `qa/green-full-suite.txt`:
```
 Test Files  2 passed (2)
      Tests  21 passed (21)
```
- `npx tsc -p tsconfig.json --noEmit` → exit 0 (no output).
- `npm run build` (`tsc -p tsconfig.json && vite build`) — superseded by the rebuild recorded under "Production-CSP defect" below (this earlier stylesheet still inlined one font subset):
```
dist/index.html                                                  0.62 kB │ gzip:  0.38 kB
dist/assets/index-Lvy1pdCR.css                                  15.92 kB │ gzip:  6.14 kB
dist/assets/index-DCw4SY3a.js                                  304.82 kB │ gzip: 96.17 kB
✓ built in 3.10s
```
- `npm audit --audit-level=high`:
```
found 0 vulnerabilities
```

### Production-CSP defect found in browser review and fixed (2026-10-04)
- **Finding (RED).** Serving the built `dist/` with this app's own `vercel.json` headers — i.e. under the production CSP — produced 2 `securitypolicyviolation` events and 1 console error per page load in both viewports: the compiled stylesheet inlined one small font subset (Manrope cyrillic-ext, ≈ 2.5 KB — below Vite's default 4 KiB `assetsInlineLimit`) as `url(data:font/woff2;base64,…)`, and `font-src 'self'` has no `data:` scheme, so the browser blocked it. Reproduced in the repository with `node tools/check-dist.mjs --app apps/defense/hashledger` → `DIST_CSS_DATA_URL_BLOCKED  assets/index-Lvy1pdCR.css: 1 inlined data: URL(s) (font/woff2) blocked by CSP font-src "'self'"` (FAIL), and `grep -c "data:font"` on that stylesheet → `1`. Injectboard and Peerline were unaffected (all their subsets are larger than the inline limit).
- **Fix.** `vite.config.ts`: `build.assetsInlineLimit: 0` with a comment stating why (fonts must ship as files under `font-src 'self'`). The CSP was **not** widened. Rebuild (`npm run build`):
```
dist/assets/manrope-cyrillic-ext-wght-normal-C8S-KRRz.woff2      2.55 kB
dist/assets/index-DkQxCykB.css                                  12.54 kB │ gzip:  3.28 kB
dist/assets/index-Bw4r4I-s.js                                  304.82 kB │ gzip: 96.17 kB
✓ built in 9.76s
```
The previously inlined subset is now the 2.55 kB file above (17 files in `dist/`). `grep -c "data:font"` on the new stylesheet → `0`; `node tools/check-dist.mjs --app apps/defense/hashledger` → PASS (only the informational Vite modulepreload note remains). The test suite was re-run afterwards (`Tests  21 passed (21)`, `qa/green-full-suite.txt` re-saved). The browser-review report itself is held in the lead's private review logs, not in this repository.

### Schema and compatibility
- `hashledger.report/1` unchanged. `FileEntry` unchanged (`owner` was already a required field; it is now validated). `validateManifest` now accepts `unknown` — every existing caller passes a `FileEntry[]`, so nothing else changed. The shipped fixture passes the stricter rules unmodified.

### UI and accessibility notes
- The Add-file dialog gained an **Owner** text input (labelled, default `svc-user`) and now renders the validator's full error list (`<ul role="alert" class="errors">`) instead of only the first message; the row index of the new file is stripped so messages read `owner: must be a printable string of 1–64 characters.`
- One new CSS rule (`.errors`) reuses the existing `--coral` token (`#ff8a8a`) on the dialog panel `--panel` (`#1b212c`). Contrast ratios computed with the WCAG 2.x relative-luminance formula (private helper script, not in the repo): `#ff8a8a` on `#1b212c` = **7.12:1**; `.muted` `#9aa4b5` on `#1b212c` = **6.42:1**; body ink `#e6e9ef` on `#1b212c` = **13.28:1** — all ≥ 4.5:1. Errors are also announced via `role="alert"`, so meaning is not colour-only.
- The screenshots in `qa/` (desktop-start.png, desktop-after-workflow.png, tablet-start.png, mobile-start.png) predate this round. No browser, keyboard or axe run was performed in this round (no harness is available in the repository); nothing of that kind is claimed.

### Artefact inventory
Paths referenced in this app's README, AUDIT, EVIDENCE and INTERVIEW_GUIDE documents that are **not** in this repository, with the reason:
- `qa-tools/verify-all.sh` — part of an external QA harness used during the original build; not in this repository; the clean-checkout measurements quoted above cannot be re-run from the repo alone.
- `qa-tools/browser_qa.mjs` — external QA harness (Playwright workflow); not in this repository; the browser-workflow log above cannot be re-run from the repo alone.
- `qa-tools/keyboard_qa.mjs` — external QA harness (keyboard pass); not in this repository.
- `qa-tools/axe_qa.mjs` — external QA harness (axe-core scan); not in this repository; the axe results above cannot be re-run from the repo alone.
- `hl-adverse.mjs` — the sixth review's adverse-input repro script (external review harness, not part of this repository); its finding is captured by the tests `binds takenAt and id into the chain…` and `rejects "." path segments…`.
- `HANDOFF.md` — a working note of the original build's review harness; never committed to this repository.
- `hr/payroll_q3.csv`, `sales/orders_export.csv`, `ops/deploy_key.pem`, `legal/memo_vendor_review.txt` and the other names quoted from the fixture directory — these are **synthetic in-memory manifest entries** defined in the engine's fixtures module, not files in this repository; they exist only as strings inside the app.
- `a/./b.txt`, `ok-1_2/File.TXT`, `team notes.md`, `a$b.txt`, `résumé.txt`, `../etc/passwd` — example manifest paths quoted from the test suites to illustrate the validator's rules; they are test inputs, not files in this repository.
Every other path referenced in those four documents resolves inside this app directory; the original evidence files, the October 2026 RED/GREEN/full-suite evidence files and the four screenshots are all committed.
