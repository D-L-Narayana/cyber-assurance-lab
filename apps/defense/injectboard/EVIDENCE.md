# EVIDENCE — injectboard

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './engine' imported from '/home/user/workspace/cyber-portfolio/candidates/defense/injectboard/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design.


**Iterations**
- All 11 tests passed on the first implementation run after the module-resolution RED.


**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  13:28:54
   Duration  357ms (transform 115ms, setup 0ms, collect 128ms, tests 11ms, environment 0ms, prepare 56ms)
```

## Clean-checkout verification (`qa-tools/verify-all.sh`)
```
## npm ci

added 130 packages in 14s
## npm run build
dist/index.html                                                  0.62 kB │ gzip:  0.37 kB
✓ built in 1.88s
## npm test
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  492ms (transform 288ms, setup 0ms, import 303ms, tests 13ms, environment 0ms)
## npm audit
found 0 vulnerabilities
## storage-api grep (expect no matches in src)
none
## fetch/XHR grep (expect none)
none
## dist size
468K
```
Dependency note: the first install pulled vitest 3.2.7, for which `npm audit` reported 2 moderate advisories in `@vitest/mocker` (dev-only, not shipped). Upgraded to vitest ^4.1.11; the suite passed unchanged and `npm audit` reports 0 vulnerabilities (above).

## Browser workflow (`qa-tools/browser_qa.mjs`, Playwright Chromium, reduced motion)
Preview served with `vite preview --port 6133`. Log:
```
clock: 09:00Z
after decision: Committed "Isolate FS-01 from the network now" at +5m — within SLA.
clock: 09:10Z
role view: INJECT FEED — COMMUNICATIONS
task completed
lessons: 1
aar: After-action report  Generated from the exercise state. Markdown preview below; JSON follows schema injectboard.aar/1.  
export schema=injectboard.aar/1 decisions=1 breaches=0
[desktop] horizontal overflow px=0 errors=0 
[tablet] horizontal overflow px=0 errors=0 
[mobile] horizontal overflow px=0 errors=0
```
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three.

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
```
injectboard: reached .radio after 9 Tabs, visible focus outline=true, activation changed detail=true ("option chosen")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
```
desktop: 0 violations, 24 rule groups passed, 1 incomplete (needs manual review)
mobile: 0 violations, 24 rule groups passed, 1 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- Shipped scenario: 9 injects, 7 decisions (2 of them branch-only), 5 roles, 12 possible tasks; maxScore 52 (upper bound across all branches).
- Browser workflow exercised: advance 5 min → commit "Isolate FS-01" (within SLA, +5m) → jump to next inject (09:10Z) → Communications role view → mark task done → add lesson → open after-action report → download JSON (`injectboard.aar/1`, 1 decision, 0 breaches).

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.
