# EVIDENCE.md — Firstlight

All commands run from this directory on 1 Oct 2026 (Node v20.20.1, npm 10.8.2). Logs referenced live in `qa/`.

| Command | Result |
|---|---|
| `npm ci` | clean install from the committed lockfile (`qa/npm-ci.log`) |
| `npx vitest run` | **36 passed (36)**, 2 files (`src/engine/engine.test.ts` 30, `src/App.test.tsx` 6) |
| `npx tsc -b` | no errors |
| `npm run build` | `dist/` 608 K; `index-*.js` 305 kB (96 kB gzip), `index-*.css` 16 kB; relative base `./` |
| `npm audit` / `npm audit --omit=dev` | found 0 vulnerabilities (`qa/npm-audit.log`, `qa/npm-audit-prod.log`) |
| `node ../qa-harness/audit.mjs http://127.0.0.1:6104/ qa/screens flows/firstlight.mjs` | 3 viewports: 0 axe violations, 0 page overflow, 0 console/page errors; 8 flow steps; only host contacted `127.0.0.1:6104` |

## Test-first record

1. Engine stubs + 27 tests written → `npx vitest run` → `qa/tdd-red-engine.log`: **Tests 27 failed (27)**.
2. Implementations (`timeline.ts`, `clock.ts`, `severity.ts`, `readiness.ts`, `packet.ts`, `bundleIO.ts`) → `qa/tdd-green-engine.log`: **Tests 27 passed (27)**.
3. Review-driven tests added (California 30-calendar-day clock, phase on unrounded timestamps, `subjectsLowerBound` label, strict calendar-valid timestamps, strict `personalTokens`) → `qa/tdd-red-review-fixes.log`: **5 failed | 25 passed (30)** → fixes → `qa/tdd-green-review-fixes.log`: **36 passed (36)** (includes the 6 app tests).
4. App tests (6) were written *after* the UI and passed on first run after two test-side corrections (jsdom cannot type into `datetime-local`, so the test dispatches a change event; the `SE` selector was narrowed). They are integration coverage, not TDD.

## Browser QA findings → fixes

| Finding (axe / layout) | Fix |
|---|---|
| `color-contrast` serious: `.flag`, `.task-status.open` (`#f26d6d` on `#5a2626`, 4.13:1), `.task-status.in-progress` (`#f2a33a` on `#7a4f12`, 3.41:1) | text `#ffc7c7` on `#4a1f1f` (9.45:1), `#ffd48a` on `#4a3008` (8.76:1), checked with `track-notes/contrast.py` |
| `scrollable-region-focusable` serious: packet `<pre>` | `tabIndex=0` + `aria-label` |
| mobile `scrollWidth` 389 > 375 | `.sr-only` labels inside the containment table were absolutely positioned against the initial containing block; `.inline-form { position: relative }` |
| tablet `.pin-time` labels past the band edge | `overflow-x: clip` on the band; times hidden under 720 px |

Final: desktop/tablet/mobile each `overflow: false`, `axeViolations: []`, `pageErrors: 0`, `consoleErrors: 0`.

## Workflow replay (observed text, `qa/browser-audit-summary.json`)

- Clock chips at demo "now" 2026-09-22T12:00Z: `EU-GDPR: 23.5 h left of 72 hours`, `UK-GDPR: 23.5 h left of 72 hours`.
- "Now" moved to 2026-09-25T12:00Z: `EU-GDPR: 72 hours exceeded by 48.5 h`.
- Confidentiality → unknown recipients, malicious intent on: `SE 3 high` (from `SE 2.25 medium`).
- Two missing facts filled: heading `12/12 required facts`.
- Redaction off: event stream contains `Priya Oduya`; preview label `Packet preview, full`.
- `ct-4` marked done with reference `archive-check-7731`: status `done`.
- Malformed import: `Import rejected. bundle.incidentType "alien" is not an allowed value · …` (8 errors listed).

## Upgrade round — October 2026 (lab-wide)

Measured 4 Oct 2026 in the build sandbox (Node v20.20.1, npm 10.8.2), one command at a time through a small local wrapper script (not part of this repository) that runs the project-local command in this directory and saves the verbatim output (command, timestamp, Node version, exit code, full output) to the named `.txt` file. The host was shared with other builds, so durations are not representative. Paths are relative to this directory. Counts in the older sections above (36 tests, 30 engine, 6 app) describe the 1 Oct 2026 state and are left as written.

| Command | Verbatim result lines | Evidence file |
|---|---|---|
| `npx vitest run --reporter=verbose` — RED, new tests against a stub `severitySensitivity` returning `[]` and an identity `applyFlip` | `Test Files  2 failed (2)` · `Tests  5 failed \| 38 passed (43)` | `qa/red-severity-sensitivity.txt` |
| `npx vitest run --reporter=verbose` — GREEN | `Test Files  2 passed (2)` · `Tests  43 passed (43)` | `qa/green-severity-sensitivity.txt` |
| `npm run build` (`tsc -b && vite build`; the `tsc -b` step is the typecheck) | exit 0; `✓ built in 5.86s`; `dist/assets/index-BQV8oU5H.js  309.56 kB │ gzip: 97.67 kB`; `dist/assets/index-D30eQs_y.css  16.91 kB │ gzip: 3.94 kB`; `dist/` 26 files, 613,913 bytes (self-hosted woff2 and `THIRD_PARTY_LICENSES.txt` included) | — |
| `npm audit --audit-level=high` | `found 0 vulnerabilities` | — |

### What changed

- `src/engine/types.ts`: `Band` extracted as a named type (the `SeverityBreakdown.band` union is unchanged) and a new `Flip { field, from, to, bandFrom, bandTo, seDelta }` interface. No schema change: the `firstlight.incident` v1 bundle is untouched.
- `src/engine/sensitivity.ts` (new, React-free): `severitySensitivity(bundle)` builds the candidate single-field changes — every other value of `confidentialityLoss`, `integrityLoss`, `availabilityLoss` and `easeOfIdentification`; the `maliciousIntent` toggle; `dpcAdjustment` one step down and up, only inside −3..+3 (after the same rounding/clamping `severity` applies); and the highest data class present one class down and up (modelled as reclassifying the items currently at that class) — applies each to a copy of the bundle, re-runs `severity`, keeps those whose band changed, and sorts by |ΔSE| descending, then `field`, then `to` (code-unit comparison, so the order is locale-independent). At most 14 candidates exist by construction, so no traversal budget or `truncated` flag is needed. `applyFlip(bundle, flip)` applies a flip only if it is a valid candidate for that bundle (same field/from/to); anything else returns the bundle unchanged.
- `src/App.tsx`: a text-only `<section class="flips" aria-labelledby tabIndex={0}>` titled "What would change the band" under the severity card, one `<li>` per flip ("Ease of identification maximum → limited: medium → low (SE −1)"), an explicit sentence when the list is empty, and a note that combinations are not explored. Human labels live in the UI (`FLIP_LABEL`); the engine returns field keys. `src/styles.css`: `.flips` rules using existing tokens only.
- Hygiene: canonical `vercel.json` header set with `cleanUrls: true` (see AUDIT.md "Security headers"); `engines.node >=20.19` in `package.json`; `color-scheme` stays `dark` (body background `--bg #0e1626`).

### Test-first record (red → green)

Six engine tests and one App test were written first; `sensitivity.ts` was created as a stub (`severitySensitivity` → `[]`, `applyFlip` → the input) so the suite collected and failed on behaviour, not on a missing module. RED (`qa/red-severity-sensitivity.txt`), 5 failures: "lists at least one single-field change…" and "every flip really produces its bandTo…" (`expected 0 to be greater than 0`); "includes the highest data class moving one class up and one class down" (`expected [] to deeply equal [ 'financial→behavioural', …(1) ]`); "moves the context adjustment by ±1 only and never beyond −3..+3" (`expected [] to deeply equal [ '2' ]`); and the App test (`Unable to find an accessible element with the role "region" and name /What would change the band/`). Two new tests passed trivially against the empty stub, by construction: the no-flip test (an empty list is what it expects for its two bundles) and the determinism/sort test (an empty list is sorted); they are meaningful only together with the loop test, which checks every listed flip against the real formula. The RED file was saved twice: a first run with an earlier wording of the context-adjustment test (also `5 failed | 38 passed (43)`) was overwritten by the run against the final test file, which is the one retained. GREEN after implementing `sensitivity.ts` and the UI list: `Tests  43 passed (43)` (`qa/green-severity-sensitivity.txt`). No test was weakened.

### Accessibility of the new list (R10)

Text only, no colour-only meaning (bands are written as words, deltas as signed numbers); the section is keyboard-reachable (`tabIndex=0`, accessible name from its heading) and has no motion. Contrast of the token pairs used, by the WCAG 2.x relative-luminance formula (computed with a local script this round; no new colour tokens were introduced): list text `--text #e8eef7` on `--panel-2 #1d2a47` = 12.21:1; heading, note and SE delta `--mute #a9b6ca` on `--panel-2 #1d2a47` = 6.94:1. No browser or axe run was performed in this round.

### Browser QA

Not re-run in this round (the external harness is not part of this repository). `qa/screens/*.png` predate this round; the severity column gained the new list.

### Artefact inventory

Paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that are **not** in this repository, with the reason. The original claims above are retained as written.

- `qa/npm-ci.log`, `qa/npm-audit.log`, `qa/npm-audit-prod.log` (the `qa/npm-audit*.log` glob in AUDIT.md), `qa/tdd-red-engine.log`, `qa/tdd-green-engine.log`, `qa/tdd-red-review-fixes.log`, `qa/tdd-green-review-fixes.log` (README's `tdd-red/green-review-fixes.log`) — `*.log` is gitignored (see .gitignore), so these runs were never committed; the outcomes are described in the text above but the raw logs are not retained in this repository. From this round on, red/green evidence is saved as committed qa/*.txt files (qa/red-severity-sensitivity.txt, qa/green-severity-sensitivity.txt).
- `../qa-harness/audit.mjs` and `flows/firstlight.mjs` — external review harness (Playwright + axe-core) and its per-app flow script, which lived outside this app; not part of this repository. What survives of its output is qa/browser-audit-summary.json, qa/screens/browser-audit.json and the screenshots in qa/screens/.
- `track-notes/contrast.py` — a contrast-ratio script that lived outside this app and was used for the 1 Oct 2026 numbers; not part of this repository. This round's ratios were computed with an equivalent local script implementing the WCAG 2.x formula.

## Facts usable in resume bullets (educational project, October 2026)

- 36 automated tests including a fast-check property; engine tests failed before implementation (27 RED → GREEN) with logs retained.
- Defensive JSON importer: byte, depth (iterative), item, enum, strict-timestamp and duplicate-id checks; rejects rather than silently alters redaction tokens.
- Evidence clock implementing GDPR Art. 33 (72 h) and California SB 446 (30 calendar days from discovery) as dated teaching rules, with exact-timestamp phase logic.
- axe-core: 0 violations at 375/768/1440 after three measured contrast/focus/overflow fixes.

Sources: ENISA severity methodology https://www.enisa.europa.eu/sites/default/files/publications/Data%20breach%20severity%20methodology_1.0.pdf ; GDPR Art. 33 https://gdpr-text.com/read/article-33/ ; SB 446 text https://legiscan.com/CA/text/SB446/2025 ; Pillsbury summary https://www.pillsburylaw.com/en/news-and-insights/california-data-breach-notification-requirements.html
