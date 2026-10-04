# EVIDENCE — peerline

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

> **Annotation (October 2026 round).** The sections below are the original build record and are kept verbatim. The `qa-tools/*` scripts they cite belong to an external QA harness that is **not** part of this repository (see `### Artefact inventory` at the end), so the browser, keyboard and axe measurements quoted there cannot be re-run from the repository alone. The import-error wording quoted in the browser log (`#0: dept must be a 1–64 char string`) is the pre-round validator's; messages are now path-addressed (`records[0].dept: must be a printable string of 1–64 characters.`). The absolute path quoted in the original RED output named the original build environment, not a repository path; the file it refers to is `src/engine/engine.test.ts`. Paths in the quoted output were neutralised to `<original-build>/…` on 2026-10-04; results unchanged. The test total quoted below (12) is the original count; the current measured total is in the October 2026 section.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './stats' imported from '<original-build>/defense/peerline/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design.


**Iterations**
- Assertion-level RED during implementation (recorded): `recovers most injected anomalies … expected 0.4 to be greater than or equal to 0.8` — single-feature anomalies (logins, after-hours) never reached the alert threshold under flat weights. Fix: score = Σ weight × min(3, z/threshold).
- Second assertion-level RED: `expected 0.4444 to be greater than or equal to 0.5` — after switching baselines to active-days-only, a Saturday injection became unscored and sparse weekend baselines produced false positives. Fix: flagged fallback to the other day-type baseline when the same type has < 5 active days.


**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  13:14:24
   Duration  333ms (transform 92ms, setup 0ms, collect 97ms, tests 31ms, environment 0ms, prepare 63ms)
```

## Clean-checkout verification (`qa-tools/verify-all.sh`)
```
## npm ci

added 128 packages in 8s
## npm run build
dist/index.html                                                       0.62 kB │ gzip:   0.38 kB
✓ built in 1.62s
## npm test
 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  285ms (transform 77ms, setup 0ms, import 94ms, tests 32ms, environment 0ms)
## npm audit
found 0 vulnerabilities
## storage-api grep (expect no matches in src)
none
## fetch/XHR grep (expect none)
none
## dist size
704K
```
Dependency note: the first install pulled vitest 3.2.7, for which `npm audit` reported 2 moderate advisories in `@vitest/mocker` (dev-only, not shipped). Upgraded to vitest ^4.1.11; the suite passed unchanged and `npm audit` reports 0 vulnerabilities (above).

## Browser workflow (`qa-tools/browser_qa.mjs`, Playwright Chromium, reduced motion)
Preview served with `vite preview --port 6131`. Log:
```
opened anomaly: esme.example · finance · 2026-09-26 (weekend)
after suppression: Suppressed UPLOAD_SPIKE for esme.example; scores recomputed.
disposition: Recorded false positive for esme.example on 2026-09-26.
threshold now: 6
export schema=peerline.report/1 alerts=10 precision=0.5
import error: #0: dept must be a 1–64 char string
#0: day must be YYYY-MM-DD
#0: logins must be a number ≥ 0
#0: uploadMB must be a nu
[desktop] horizontal overflow px=0 errors=0 
[tablet] horizontal overflow px=0 errors=0 
[mobile] horizontal overflow px=0 errors=0
```
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three.

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
```
peerline: reached .card after 9 Tabs, visible focus outline=true, activation changed detail=true ("esme.example · finance · 2026-09-26 (weekend)")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
```
desktop: 0 violations, 30 rule groups passed, 2 incomplete (needs manual review)
mobile: 0 violations, 30 rule groups passed, 2 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- Population: 30 fictional users × 28 days × 4 features = 840 records; 210 scored user-days (days 22–28).
- Measured on seed 11 with default thresholds: recall 1.00 (5/5 injected), precision 0.50 (5 false positives, all `PEER_DEVIATION` for the habitual heavy uploader) — printed by the evaluation strip and asserted as floors (≥ 0.8 / ≥ 0.5) in the test suite.
- Browser workflow exercised: open anomaly → suppress UPLOAD_SPIKE with rationale → record false-positive disposition → move threshold slider by keyboard (5 → 6) → export JSON (`peerline.report/1`) → invalid import rejected with field-level messages.

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.

## Upgrade round — October 2026 (lab-wide)

Recorded 2026-10-04 on Node v20.20.1, npm 10.8.2, Linux sandbox. Commands were run from the app directory through the lab's lead helper, which records the command, timestamp, Node version and exit code as the first lines of every saved evidence file in `qa/`; the output below is copied verbatim from those files. No dependency was added or changed; `npm ci` was not re-run in this round (dependencies were installed once by the lead from the unchanged lockfile).

### Hygiene
- `vercel.json` replaced by the lab-wide canonical header set (CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, HSTS) — described in `AUDIT.md`.
- `package.json`: `"engines": { "node": ">=20.19" }` added.
- `index.html`: `color-scheme` changed from `light dark` to `light` (the stylesheet implements one light palette: `body` background `#fafbfc`, no `prefers-color-scheme` query).

### Test-first record — bounded record import
Tests written first in `src/engine/validate.test.ts` (6 tests). So that the file could collect, `validate.ts` was given the real `parseRecords(text)` signature returning the placeholder `{ ok: false, errors: ['not implemented'] }` and the new `LIMITS` keys; the existing `validateRecords` was left untouched for the RED run.

**RED** — `npx vitest run --reporter=verbose src/engine/validate.test.ts`, saved as `qa/red-record-import.txt` (exit 1):
```
 × … parseRecords enforces the byte cap before JSON.parse and reports invalid JSON
   → expected 'not implemented' to match /JSON/
 × … rejects nesting deeper than the record shape and oversized value counts without recursing
   → expected 'not implemented' to match /depth/i
 × … rejects impossible calendar days such as 2026-02-30 and accepts a real leap day
   → expected true to be false // Object.is equality
 × … rejects duplicate (user, day) rows naming both row indices
   → expected true to be false // Object.is equality
 × … restricts user and dept to printable characters
   → expected true to be false // Object.is equality
 × … addresses every error by path, requires finite numbers, drops unknown keys and caps the list at 20
   → expected '#0: logins must be a number ≥ 0' to match /records\[0\]\.logins/
      Tests  6 failed (6)
```
Two failures are against the placeholder `parseRecords`; four are the pre-existing validator's behaviour (`2026-02-30` accepted, duplicate `(user, day)` rows accepted, a NUL byte in `user` accepted, `#0: …` wording instead of `records[0].logins`).

**GREEN** — same command after implementing `parseRecords` and the strict `validateRecords`, saved as `qa/green-record-import.txt`:
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Test-first record — single decoding (defect found in review of the GREEN code)
`parseRecords` decoded the text and handed the value to `validateRecords`, which re-delegated *string* input back to `parseRecords` — so a JSON string literal containing a record array was decoded twice. One assertion was added to the existing parse test (a double-encoded array must be rejected as "not an array").

**RED** — `npx vitest run --reporter=verbose src/engine/validate.test.ts`, saved as `qa/red-single-decode.txt` (exit 1):
```
 × … parseRecords enforces the byte cap before JSON.parse and reports invalid JSON
   → expected true to be false // Object.is equality
      Tests  1 failed | 5 passed (6)
```
**GREEN** — same command after routing both entry points through an internal `validateParsed()` (strings are plain values after decoding), saved as `qa/green-single-decode.txt`:
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Final gates (2026-10-04, 19:12 UTC, after the single-decode fix)
- `npx vitest run --reporter=verbose` (full suite), saved as `qa/green-full-suite.txt`:
```
 Test Files  2 passed (2)
      Tests  18 passed (18)
```
- `npx tsc -p tsconfig.json --noEmit` → exit 0 (no output).
- `npm run build` (`tsc -p tsconfig.json && vite build`):
```
dist/index.html                                                       0.62 kB │ gzip:   0.38 kB
dist/assets/index-B0Idgeqs.css                                       12.06 kB │ gzip:   3.44 kB
dist/assets/index-DjYXgB2f.js                                       324.94 kB │ gzip: 104.47 kB
✓ built in 4.59s
```
- `npm audit --audit-level=high`:
```
found 0 vulnerabilities
```

### Schema and compatibility
- `peerline.report/1` unchanged; `ActivityRecord` unchanged. `validateRecords` now also accepts JSON text (delegating to `parseRecords`) and returns a sanitised copy with unknown keys dropped; the original `import validation` test in `engine.test.ts` passes unchanged. `LIMITS` gained `maxDepth`, `maxValues`, `maxErrors`, `maxName`, `maxCount`; `maxRecords` and `maxBytes` are unchanged (the byte cap is now a real UTF-8 byte count checked before `JSON.parse`, where the old UI compared characters after the fact).

### UI and accessibility notes
- The import dialog calls `parseRecords` and renders the returned error list in the existing `<ul role="alert" class="errors">`; its description text now states the byte cap, the one-row-per-`(user, day)` rule, the calendar-date rule and the printable-name rule. No new colour tokens or controls were introduced.
- Contrast ratios for the text tokens used by the changed dialog, computed with the WCAG 2.x relative-luminance formula (private helper script, not in the repo): `.errors` `--signal` `#b8324a` on the modal panel `#ffffff` = **5.84:1**; `.muted` `#5b6470` on `#ffffff` = **6.00:1**; body ink `#1f2328` on `#ffffff` = **15.80:1** — all ≥ 4.5:1. Errors are announced via `role="alert"`, so meaning is not colour-only.
- The screenshots in `qa/` (desktop-start.png, desktop-after-workflow.png, tablet-start.png, mobile-start.png) predate this round (only the import-dialog text changed). No browser, keyboard or axe run was performed in this round (no harness is available in the repository); nothing of that kind is claimed.

### Artefact inventory
Paths referenced in this app's README, AUDIT, EVIDENCE and INTERVIEW_GUIDE documents that are **not** in this repository, with the reason:
- `qa-tools/verify-all.sh` — part of an external QA harness used during the original build; not in this repository; the clean-checkout measurements quoted above cannot be re-run from the repo alone.
- `qa-tools/browser_qa.mjs` — external QA harness (Playwright workflow); not in this repository; the browser-workflow log above cannot be re-run from the repo alone.
- `qa-tools/keyboard_qa.mjs` — external QA harness (keyboard pass); not in this repository.
- `qa-tools/axe_qa.mjs` — external QA harness (axe-core scan); not in this repository; the axe results above cannot be re-run from the repo alone.
- `HANDOFF.md` — a working note of the original build's review harness; never committed to this repository.
Every other path referenced in those four documents resolves inside this app directory; the original evidence files, the October 2026 RED/GREEN/full-suite evidence files and the four screenshots are all committed.
