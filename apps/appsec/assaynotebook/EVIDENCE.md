# EVIDENCE — Assay Notebook

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`.

## Test-first record

**RED — src/engine/__tests__/notebook.test.ts written before any engine code.** First run (`qa/red-run.txt`):

```
FAIL  src/engine/__tests__/notebook.test.ts
Error: Cannot find module '../lab' imported from .../src/engine/__tests__/notebook.test.ts
Tests  no tests
```

**GREEN-phase correction.** First implementation run: `18 passed | 1 failed` — the test's stack-frame regex expected `(receipts.ts:42)` while the lab emitted `(receipts.ts:42:19)`. The lab output was aligned to the test (the oracle regex accepts both forms). Re-run: 19 passed.

**GREEN** (`qa/green-run.txt`): 19 passed (19).

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 113 packages in 3s
$ npm run build
✓ built in 1.38s
$ npm test
 Test Files  1 passed (1)
      Tests  19 passed (19)
$ npm audit
found 0 vulnerabilities
```

Total: **19 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions.

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-initial.png` | Bench and empty notebook |
| `desktop-02-manual-probe.png` | Manual probe sent to v1, exchange shown as text, oracle "fired" |
| `desktop-03-catalog-v1.png` | Catalog run: four findings with CWE mapping and severity |
| `desktop-04-retest-fixed.png` | F-02 retested on v3: FIXED stamp, retest evidence, history |
| `desktop-05-invalid-input.png` | Traversal-style id rejected before sending |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json`). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* Four catalog cases produce 4 findings on build v1, 2 on v2, 0 on v3 (asserted by test).
* Finding state trail asserted exactly: `open → retest-requested → still-open → retest-requested → fixed`.
* Input bounds: relative lab paths only (absolute/protocol-relative refused with `External target refused`), ≤ 8 params, ≤ 512 printable-ASCII chars, no `..`; notebook caps 500 observations / 100 findings.
* Exported JSON contains no `sid=<value>`; cookies are redacted to `sid=[redacted]` (asserted).

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth-Fable review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`): `× logs a history entry when impact, likelihood or rationale changes … expected [ { …(3) } ] to have a length of 2 but got 1` — `Tests 1 failed | 19 passed (20)`.

**GREEN** (`qa/green-run-sixth.txt`): `Tests 20 passed (20)` — `rerate` now appends one history entry per actual change and none for no-op saves.

Clean checkout re-run: 20/20, build ok, 0 vulnerabilities; browser flow re-shot; axe 0 violations.
