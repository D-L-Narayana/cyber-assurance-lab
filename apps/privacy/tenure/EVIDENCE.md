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

## Review-round hardening, 1 Oct 2026 (red first; the raw RED and GREEN logs of this run were not committed — `*.log` is gitignored — see the artefact inventory below)

Finding (fourth adverse-review round, raised by an external probe script that is not part of this repository): an exception with `approvedOn: 2030-01-01` (after `asOf`) and `expiresOn: 2076-01-01` imported cleanly and marked a critical `SPECIAL_CATEGORY_UNSCHEDULED` finding accepted. Four tests added (future approval, 50-year term, missing approval date, fixture exception still accepted): **RED `3 failed | 39 passed (42)`**. Fix: `exceptionPolicyViolation()` requires an approval date not after `asOf` and a term ≤ `MAX_EXCEPTION_TERM_DAYS` (365); violations emit `EXCEPTION_OUT_OF_POLICY` (medium) and never make the exception live; the UI form caps expiry. The importer still accepts such files so the violation is visible as a finding rather than silently rejected. **GREEN `42 passed (42)`.** Probe re-run: `critical finding accepted by 50-year exception approved in 2030 -> false`. Build and 9-step browser flow re-run clean.

## Upgrade round — October 2026 (lab-wide)

Commands run 2026-10-04 with Node v20.20.1 / npm 10.8.2 through the lab's per-app runner (`npx vitest run --reporter=verbose`, `npm run typecheck` = `tsc -b`, `npm run build`, `npm audit --audit-level=high`); every quoted line below is copied from the saved output. Paths are repo-relative to this app.

### Hygiene (contracts C1–C3)

- `vercel.json` now carries the lab-wide canonical header set. It already had CORP and HSTS; the changes are CSP `default-src 'self'` → `'none'`, `base-uri` and `form-action` `'self'` → `'none'`, `manifest-src 'self'` added, `upgrade-insecure-requests` and `interest-cohort=()` dropped, and `cleanUrls: true` added (full text in `AUDIT.md`, "Security headers").
- `package.json` gains `"engines": { "node": ">=20.19" }`.
- `index.html` `<meta name="color-scheme" content="light">` verified and left unchanged: the stylesheet has no `prefers-color-scheme` query and `body { background: var(--field) }` resolves to `#e4e9e2`.
- `vite.config.ts` gains `test.testTimeout: 20_000`. Reason, measured: a first full run on 2026-10-04 (`qa/baseline-rerun.txt`) ended `Tests  1 failed | 41 passed (42)` because the jsdom test `accepting a finding with an exception marks it accepted and lowers the open count` hit `Test timed out in 5000ms.` while the host was loaded (the same test took 701 ms in the lead's baseline run of the unchanged code, and 1 535 ms / 1 898 ms in the two runs below). Only the budget changed; no assertion was touched.

### Exception route for flow-subject findings (test-first)

1. Tests added first. Engine (`src/engine/engine.test.ts`, block "flow-subject exceptions"): a flow exception accepts `UNMAPPED_TRANSFER`; `PURPOSE_DRIFT` needs the exact `flow/element` subject and a flow-wide exception does not blanket-accept it; a flow exception accepts `DANGLING_FLOW` while an element-kind exception never accepts a flow finding; flow exceptions obey expiry, approver activity and the 365-day cap, and their `EXCEPTION_*` findings attach to the receiving system; legacy `elementId` without `subject` still works and `subject` wins when both are present; `parseCatalog` validates `subject` (enum kind, known element / known flow / known `flow/element` after normalisation, unknown keys dropped, path-addressed errors, legacy unknown `elementId` still a warning); the demo fixture's `ex-004` accepts `PURPOSE_DRIFT:flow:flow-crm-billing/crm.customer-id`. UI (`src/App.test.tsx`): the findings table offers "Accept with exception" on an `UNMAPPED_TRANSFER` row and recording it reports `recorded for flow flow-crm-marketing (UNMAPPED_TRANSFER)`. The existing UI test's expected id moved from `ex-004` to `ex-005` because the fixture now ships four exceptions.
2. RED (`qa/red-flow-exception.txt`), with the new optional `subject` type in place but no behaviour: the suite collected and failed on assertions only — `expected false to be true // Object.is equality` (flow exceptions not applied), `expected undefined to be 'ex-fl'`, `expected 'Exception ex-old for undefined (UNMAP…' to match /flow f1/`, `expected true to be false` (legacy `elementId` still won over `subject`), the importer rejecting a valid `subject` file, and `expected undefined to be defined` (no accept button on a flow finding). Result line: `Tests  8 failed | 42 passed (50)`.
3. GREEN (`qa/green-flow-exception.txt`) after implementing `exceptionSubject`/`flowIdOfSubject` and subject-based matching in `checks.ts`, subject-id normalisation in `normalise.ts`, `subject` validation and id cross-checks in `catalogIO.ts`, the UI route and the fixture exception: `Tests  50 passed (50)`.

Design decisions recorded: matching is exact on code, subject kind and subject id; `PURPOSE_DRIFT` is accepted per flow/element pair (`flow-id/element-id`), never per flow; element exceptions created in the UI keep `elementId` next to `subject` so older importers can still read exports; new exception ids skip any `ex-NNN` already present.

### Final measurements (2026-10-04)

- `npm run typecheck` (`tsc -b`, app + node projects) → exit 0.
- `npx vitest run` → `Test Files  2 passed (2)` / `Tests  50 passed (50)` (`src/engine/engine.test.ts` 44, `src/App.test.tsx` 6).
- `npm run build` → `✓ 97 modules transformed.` … `dist/assets/index-DfkpAyax.js  337.93 kB │ gzip: 104.33 kB`, `dist/assets/index-Bv1h1o7K.css  11.47 kB │ gzip: 3.18 kB`, `✓ built in 7.28s`; `dist/` holds 15 files, 577,233 bytes.
- `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### UI, accessibility and contrast

- "Accept with exception" is now offered on flow-subject rows (`PURPOSE_DRIFT`, `UNMAPPED_TRANSFER`, `DANGLING_FLOW`) as well as element rows; the dialog description names the subject kind and id; the status line reads `Exception ex-NNN recorded for <kind> <id> (<code>)`. The dialog, form, buttons and colour tokens are the existing ones, so no new colour was introduced. Ratios computed from the stylesheet tokens with the WCAG 2.x relative-luminance formula: `--mute #4f5e54` on `--panel #f8faf7` 6.54:1 and on `--panel-2 #eef2ec` 6.06:1; `--ink #223125` on `--panel` 13.04:1; `--clay #a2401f` on `--clay-bg #f6e3dc` 5.15:1 (high pills); `--ochre #7d5e08` on `--ochre-bg #f5ecd0` 5.12:1 (medium pills).
- Browser/axe QA was **not** re-run in this round (the `playwright` package is not installed in the working environment); the screenshots in `qa/screens/` and the audit summaries predate this round.

### Artefact inventory

Paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that are **not** in the repository, with the honest reason (the original claims above are kept as written):

- `qa/tdd-*.log` — the original build's vitest logs, never committed (`*.log` is gitignored in this app); the runs are described in this file but the raw logs are not retained in this repository. By section: `qa/tdd-red-engine.log` / `qa/tdd-green-engine.log` ("Test-first record", `31 failed (31)` → `31 passed (31)`); `qa/tdd-red-review-fixes.log` / `qa/tdd-green-review-fixes.log` ("Review-driven fixes", `1 failed | 37 passed` → `38 passed (38)`); and the RED/GREEN logs of the 1 Oct 2026 review-round hardening (`3 failed | 39 passed (42)` → `42 passed (42)`), whose original file names are not repeated here.
- `consentry/qa/tdd-red-review-fixes.log` (this file, "Review-driven fixes", item 1): a gitignored log in the sibling Consentry app; not retained anywhere in this repository, so the RED reproduction for the iterative depth check is described but not evidenced by a file.
- `qa/npm-ci.log` (this file, measurement table): never committed (`*.log`); the clean `npm ci` of 1 Oct 2026 is asserted by the table but its log is not in this repository.
- `../qa-harness/audit.mjs` (this file, measurement table): an external browser-QA harness that is not part of this repository. Its outputs `qa/browser-audit-summary.json` and `qa/screens/browser-audit.json` *are* committed.
- The probe script of the fourth adverse-review round (section above): external review tooling, not part of this repository; only its observed output line is quoted.
- `catalogIO.ts`, `checks.ts`, `graph.ts`, `normalise.ts`, `review.ts` (README "Algorithm", this file): short names for `src/engine/catalogIO.ts`, `src/engine/checks.ts`, `src/engine/graph.ts`, `src/engine/normalise.ts` and `src/engine/review.ts`, all present.
- This round's captures `qa/baseline-rerun.txt`, `qa/red-flow-exception.txt` and `qa/green-flow-exception.txt` are `.txt` files and are present. The first two carry a header note: a pre-existing test-group label in `src/engine/engine.test.ts` was reworded after they were taken and their label text was changed to match (command, timestamps, results and counts untouched); `qa/green-flow-exception.txt` was re-run after the rewording and is a byte-exact capture.
