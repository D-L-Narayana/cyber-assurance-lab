# EVIDENCE — Provenance Gate

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`.

## Test-first record

**RED — src/engine/__tests__/gate.test.ts written before any engine code.** First run (`qa/red-run.txt`):

```
FAIL  src/engine/__tests__/gate.test.ts
Error: Cannot find module '../schema' imported from .../src/engine/__tests__/gate.test.ts
Tests  no tests
```

**GREEN-phase correction.** The first implementation run showed `16 passed | 1 failed`: *releases with accepted risk and no requirement problems* failed because the threat model was asked to cover `package-lock.json`. The scope rule was narrowed to "paths of the classes that require that evidence type" (`classifyChanges` now returns `scopePathsByType`). Re-run: 17 passed.

**GREEN** (`qa/green-run.txt`): 17 passed (17) after the scope-rule correction described above.

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 127 packages in 4s
$ npm run build
✓ built in 1.56s
$ npm test
 Test Files  1 passed (1)
      Tests  17 passed (17)
$ npm audit
found 0 vulnerabilities
```

Total: **17 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions.

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-blocked-140.png` | 1.4.0: red signals on four stages, gate BLOCKED with blockers list |
| `desktop-02-evidence-detail-hash-mismatch.png` | Unit-test ticket selected: hash mismatch and inline artifact |
| `desktop-03-accepted-risk-141.png` | 1.4.1: amber gate, RELEASE WITH ACCEPTED RISK |
| `desktop-04-asof-stale.png` | 1.4.1 evaluated as of 2026-12-01: blocked by staleness/expiry |
| `desktop-05-policy-errors.png` | Invalid policy JSON rejected with field-level errors |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json`). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* Release 1.4.0 is blocked with 8 blockers: threat-model `stale` (88 days) + `scope-gap`; code-review `self-review`, `reviewer-role`, `insufficient-reviewers` (0 eligible of 2); unit-tests `hash-mismatch`; sast `wrong-commit`; security-retest `missing`; SAST-17 open high with no acceptance; DEP-4 acceptance `expired`.
* Release 1.4.1 evaluates to `release-with-accepted-risk` (all requirements satisfied; DEP-4 carried by a 56-day acceptance ≤ 90-day policy). Evaluating the same manifest as of 2026-12-01 blocks it (stale evidence, expired acceptance).
* SHA-256 is computed with Web Crypto; the test vector `sha256("abc") = ba7816bf…f20015ad` passes.
* Limits: 128 KB UTF-8; 60 evidence, 50 identities, 500 changes, 60 acceptances, 20 change classes; artifacts ≤ 4000 chars; depth 6.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth-Fable review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`):

```
× chooses a valid acceptance regardless of list order …   expected 'blocked' to be 'release-with-accepted-risk'
× reports the least-broken acceptance when none is valid   expected 'ra-bad' to be 'ra-exp'
× fails closed when class-required evidence omits scope    expected 'release-with-accepted-risk' to be 'blocked'
Tests  3 failed | 19 passed (22)
```

(The test "1.4.0 has exactly 7 blockers carrying 8 problem codes" passed immediately, confirming the engine count; the README said "eight named blockers" and was corrected.)

**GREEN** (`qa/green-run-sixth.txt`): first run after the fix showed `dependency-review: scope-missing` on both fixtures — the rule is applied to every class-required type — so `scope` was added to the fixture's SAST, security-retest and dependency-review items. Then `Tests 22 passed (22)`. 1.4.0 still has exactly 7 blockers.

Clean checkout re-run: 22/22, build ok, 0 vulnerabilities; browser flow re-shot; axe 0 violations.
