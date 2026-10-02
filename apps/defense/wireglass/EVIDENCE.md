# EVIDENCE — wireglass

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './parse' imported from '/home/user/workspace/cyber-portfolio/candidates/defense/wireglass/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design.

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
- **Sixth-Fable review round (2026-10-01)** — three new failing tests first (`qa/red-run-2.txt`), then: HTTP `bytes` bounded to 13 digits (previously `99999999999999999999999` parsed); the `cdn-noise` teaching scenario now uses 44-character content-hash labels under a non-allowlisted suffix so DNS-001 fires on every seed (asserted for seeds 0–24) and is silenced by adding the suffix to the allowlist; the `mixed-day` scenario text and README now say the CDN hostnames are suppressed by the default allowlist rather than calling them an "expected false positive" that never fired.

**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  14:29:22
   Duration  434ms (transform 142ms, setup 0ms, import 161ms, tests 111ms, environment 0ms)
```

## Clean-checkout verification (`qa-tools/verify-all.sh`)
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
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three.

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
```
wireglass: reached .alert-row after 9 Tabs, visible focus outline=true, activation changed detail=true ("DNS-001 · High-entropy or very long DNS label")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
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
