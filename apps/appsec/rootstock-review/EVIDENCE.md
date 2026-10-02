# EVIDENCE — Rootstock Review

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`.

## Test-first record

**RED — src/engine/__tests__/rootstock.test.ts written before any engine code.** First run (`qa/red-run.txt`):

```
FAIL  src/engine/__tests__/rootstock.test.ts
Error: Cannot find module '../semver' imported from .../src/engine/__tests__/rootstock.test.ts
Tests  no tests
```

**GREEN** (`qa/green-run.txt`): 14 passed (14) on the first implementation run.

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 113 packages in 10s
$ npm run build
✓ built in 1.67s
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
| `desktop-01-initial-deepset.png` | Tree with derived tallies; `deepset` plan bump-in-range |
| `desktop-02-parent-conflict.png` | `colourkit@0.9.2`: parent conflict naming `uikit ~0.9.0` |
| `desktop-03-filter-advisories.png` | Tree filtered to advisories |
| `desktop-04-unknown-licence.png` | Unknowns filter; `tzdata-mini` empty licence → unknown |
| `desktop-05-import-errors.png` | Malformed snapshot rejected (bad version, severity, range) |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json`). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* Synthetic snapshot: 11 packages, 5 direct, two `colourkit` versions, one cycle (`pdfkit-lite ↔ fontparse`), one unresolved edge (`glyphcache ^1.0.0`), one empty licence, one denied licence (SSPL-1.0), one review licence (LGPL-3.0-only).
* Advisories matched: 3 packages (2 blocking at ≥ high). Plans: `deepset` bump-in-range → 1.2.3; `colourkit@0.9.2` parent-conflict (blocked by `uikit@3.2.4 ~0.9.0`); `fontparse` no-fix-available.
* Semver subset verified with 16 range assertions including 0.x caret rules and unions.
* Limits: 256 KB UTF-8, 400 packages, 60 deps/package, 200 advisories, depth 6.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Council and sixth-Fable review cycle (1 Oct 2026, ~14:25 UTC)

**RED** (`qa/red-run-license.txt`) — seven regression tests added before the fix; four failed at assertion level:

```
× respects parentheses: (MIT OR Apache-2.0) AND GPL-3.0-only is deny, not allow   expected 'allow' to be 'deny'
× fails closed to unknown on malformed or unbalanced expressions                   (MIT: expected 'allow' to be 'unknown'
× bounds tokens and nesting                                                        expected 'allow' to be 'unknown'
× explains the decision in the detail text                                         expected 'At least one option is on the allow l…' to match /GPL-3.0-only/
Tests  4 failed | 17 passed (21)
```

**GREEN** (`qa/green-run-license.txt`): `Tests 21 passed (21)` with the new bounded precedence parser (`src/engine/license.ts`).

Clean checkout re-run (`qa/verify-run.txt`): 21/21, build ok, 0 vulnerabilities. Browser licence workflow re-run: importing the demo snapshot with `iconset` relicensed to `(MIT OR Apache-2.0) AND GPL-3.0-only` through the import panel shows **deny** with the parsed form in the detail panel (`qa/screens/desktop-06-licence-grouped-expression-deny.png`); axe 0 violations.
