# EVIDENCE — peerline

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './stats' imported from '/home/user/workspace/cyber-portfolio/candidates/defense/peerline/src/engine/engine.test.ts'
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
