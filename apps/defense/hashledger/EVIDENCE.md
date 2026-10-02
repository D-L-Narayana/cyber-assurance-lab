# EVIDENCE — hashledger

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './hash' imported from '/home/user/workspace/cyber-portfolio/candidates/defense/hashledger/src/engine/engine.test.ts'
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
- **Sixth-Fable review round (2026-10-01)** — `hl-adverse.mjs` showed forged `takenAt`/`id` verifying OK. Two failing tests first (`qa/red-run-2.txt`: forged time, forged id, reversed entry order; `.` path segments), then: chain hash now covers `(prev | takenAt | entries)` and the id is re-derived from the digest during verification; `validateManifest` rejects `.` segments and backslashes. Docs now state integrity ≠ authenticity (no signatures).

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
- 12 synthetic fixture files; bounds ≤ 200 files, ≤ 65,536 chars each, no `..` paths.
- Browser workflow exercised: baseline snapshot → edit payroll file → second snapshot (diff: 1 modified, 11 unchanged) → USB egress blocked by `DLP-RESTRICTED-EGRESS` with case opened → replay rejected (1) → simulate tamper → verify reports `Chain broken at #0` → export JSON (`hashledger.report/1`, 2 snapshots, 1 case).

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.
