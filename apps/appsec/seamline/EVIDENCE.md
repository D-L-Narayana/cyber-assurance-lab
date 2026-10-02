# EVIDENCE — Seamline

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`.

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

Total: **14 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions.

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

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json`). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* 11 scripted events, 6 tampered. Trusting server: 11 accepted, 6 findings (CWE-602 ×2, CWE-294 ×2, CWE-269, CWE-639). Enforcing server: 5 accepted, 3 neutralized, 3 rejected, 0 findings.
* Points ledger: trusting server ends at −90 after the replay; enforcing server stays at 30 (asserted).
* Limits: 96 KB UTF-8, 60 steps, 12 users, 40 catalog items, 10 order lines, depth 8.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth-Fable review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`):

```
× flags an untampered step whose client total disagrees with the catalog …   expected undefined to be 'CWE-602'
× records divergences for every tampered step on the trusting server …      TypeError: Cannot read properties of undefined (reading 'length')
Tests  2 failed | 15 passed (17)
```

**GREEN** (`qa/green-run-sixth.txt`): after the first rewrite the replay step (s6) showed no divergence on the trusting server because the nonce ledger was only kept in enforcing mode; the ledger is now server truth in both modes (only the check is policy-dependent). Then `Tests 17 passed (17)`. Trusting-server findings on the fixture remain exactly six with the same CWEs.

Clean checkout re-run: 17/17, build ok, 0 vulnerabilities. Browser flow re-shot including `desktop-06-untampered-divergent-total-finding.png` (council repro via the import panel); axe 0 violations.
