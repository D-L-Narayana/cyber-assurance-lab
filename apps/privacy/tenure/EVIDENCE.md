# EVIDENCE.md — Tenure

Measured 1 Oct 2026 (Node v20.20.1, npm 10.8.2).

| Command | Result |
|---|---|
| `npm ci` | reproduces lockfile (final clean run in `qa/npm-ci.log`) |
| `npm run typecheck` | exit 0 |
| `npm test` | **2 files, 42 tests passed** (engine 37, UI integration 5) |
| `npm run build` | `index-*.js` 334.2 kB (103.1 kB gzip), CSS 11.5 kB, 11 woff2; `dist/` 548 kB |
| `npm audit` | 0 vulnerabilities |
| Browser QA (`../qa-harness/audit.mjs`, preview on 127.0.0.1:6102) | 3 viewports: 200, 0 page/console errors, 0 failed requests, only `127.0.0.1:6102` contacted, no overflow, **0 axe violations**; 9-step workflow replay, 0 errors |

## Test-first record

RED (`qa/tdd-red-engine.log`): `Tests  31 failed (31)` against stub modules.
GREEN (`qa/tdd-green-engine.log`): `Tests  31 passed (31)`.

One intermediate run was 30/31: `is clean for a consistent catalog` failed with `PURPOSE_DRIFT` because the minimal test fixture flowed a `service`-purpose element into an `analytics`-only system. The fixture was corrected (the engine was right); the test is kept as the guard against over-eager checks.

UI integration tests (5) were written after the UI; one initially matched two "Campaign Platform" buttons (map node and findings link) and was scoped to the map.

## Browser QA findings → fixes

1. `nested-interactive`: SVG `role="img"` with interactive children → `role="group"` with the same label.
2. `color-contrast`: muted text 4.37:1 → `#4f5e54` (5.57:1).
3. Visual: inspector elements table collapsed to its header inside a grid container with `max-height` → block layout + `min-height`.
4. Map initially needed horizontal scrolling at 1440 px → SVG now scales to container width; zoom controls remain.

## Workflow replay (observed text)

- Findings tab before/after accepting one RETENTION_INFLATION with a new exception: `Findings (30 open)` → `Findings (29 open)`; status `Exception ex-004 recorded…`.
- Review calendar after one "Mark reviewed today": `8 overdue` → `7 overdue`.
- Messy import (` CRM `, `Europe`, `PII`): `Imported 1 systems, 1 elements, 0 flows; 3 normalisation note(s).`
- Unknown vocabulary: `Import rejected. catalog.systems[0].region "Mars" is not a known region or synonym`.

## Facts usable in resume bullets (educational project, October 2026)

- Built a data-inventory and retention-graph tool in React/TypeScript with a layered SVG lineage map, 13 deterministic consistency checks (purpose drift, retention inflation, unmapped transfers, lapsed exceptions) and a review calendar.
- Implemented bounded JSON import with synonym normalisation and auditable notes, and injection-safe CSV export; 42 automated tests including a property test over random DAGs.
- 0 axe WCAG AA violations at three viewports; 0 `npm audit` findings.

## Review-driven fixes (`qa/tdd-red-review-fixes.log` → `qa/tdd-green-review-fixes.log`)

1. **Recursive depth check** (parent review, 1 Oct 2026): replaced by an iterative bounded `exceedsDepth`. The fix landed here before its test; the RED reproduction exists only in `consentry/qa/tdd-red-review-fixes.log`. Tenure's hostile-nesting test was added afterwards and passed immediately (GREEN-only evidence for this item).
2. **Regex-only dates** accepted `2026-02-30` and `2026-13-01`. RED: `1 failed | 37 passed` → `isStrictDate` in `catalogIO.ts` → GREEN `38 passed (38)`.
3. **Documentation correction, no code change:** `findCycles` collects cycle *witnesses* (one back-edge cycle per back edge met by a single DFS), not every elementary cycle; README, INTERVIEW_GUIDE and the source comment were corrected to say so.

## Sixth-Fable hardening (red first, `qa/tdd-red-sixth-fable.log` → `qa/tdd-green-sixth-fable.log`)

Finding (Round 4, `v2/tn-adverse.mjs`): an exception with `approvedOn: 2030-01-01` (after `asOf`) and `expiresOn: 2076-01-01` imported cleanly and marked a critical `SPECIAL_CATEGORY_UNSCHEDULED` finding accepted. Four tests added (future approval, 50-year term, missing approval date, fixture exception still accepted): **RED `3 failed | 39 passed (42)`**. Fix: `exceptionPolicyViolation()` requires an approval date not after `asOf` and a term ≤ `MAX_EXCEPTION_TERM_DAYS` (365); violations emit `EXCEPTION_OUT_OF_POLICY` (medium) and never make the exception live; the UI form caps expiry. The importer still accepts such files so the violation is visible as a finding rather than silently rejected. **GREEN `42 passed (42)`.** Probe re-run: `critical finding accepted by 50-year exception approved in 2030 -> false`. Build and 9-step browser flow re-run clean.
