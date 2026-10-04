# Evidence — Tessera

Measured on 2026-10-01 in the build sandbox (Node v20.20.1, npm 10.8.2, Linux). Commands and outputs are reproduced verbatim where shown; nothing below is estimated.

## Test-first (RED → GREEN)

1. `tests/engine.test.ts` written first against the planned API (`src/engine/evaluate.ts`, `src/engine/validate.ts`).
2. First run: `Error: Cannot find module '../src/engine/evaluate'` (module missing).
3. Stub exports added so the suite could collect: **30 failed | 1 passed (31)** — only the catalog test could pass because the catalog existed. Verbatim list in `qa/red-engine.txt`.
4. Engine implemented → **29 passed, 2 failed**: both failures were a spec inconsistency in the status thresholds (`partial` vs `weak` for coverage 0.5). Resolved by fixing the engine rule (weak = coverage < 1; partial = coverage ≥ 1 with one type), not the tests.
5. Parent source review raised four points; regression tests were added **before** each fix and seen failing:
   - size limit counted UTF-16 length not UTF-8 bytes → `expected 'file is not valid JSON' to match /too large/i`
   - `subcategoryIds.slice(0,25)` / `priorities.slice(0,200)` silently truncated → `expected true to be false`
   - not-applicable could greenwash contradicted evidence → `expected 'not-applicable' to be 'contradicted'`
   - all-N/A function rolled up as low risk → `expected undefined to be +0` (new `assessed`/`not-assessed` fields)
   - CSV leading-whitespace formula cases → `expected false to be true`
6. Bundled fixture test added and failed first (`ID.AM-08` is not in the 25-subcategory subset; the validator caught a real fixture defect) → fixture corrected.

Final: `npm test`

```
 Test Files  2 passed (2)
      Tests  76 passed (76)
```

(48 engine/validation tests + 28 theme-contrast tests.)

## Build

`npm ci` → `added 97 packages`. `npm run build` → `tsc -p tsconfig.json && vite build` → `✓ built`, `dist/` 660 KB including self-hosted woff/woff2 fonts; JS bundle 266 kB (82.6 kB gzip).

## Dependency audit

Initial `npm audit`: 2 moderate (GHSA-82fw-gwwq-j7x9, `@vitest/mocker` redirect-mock path traversal; dev-only, not shipped). Upgraded to `vitest@4.1.11` (required `--legacy-peer-deps` because npm 10.8.2 crashes on vitest 4 peer resolution — `Cannot read properties of null (reading 'edgesOut')`). After upgrade: `found 0 vulnerabilities`; `npm ci` from the committed lockfile works.

## Browser QA

Preview served at `http://127.0.0.1:6120/` (vite preview).

- `tools/browser_audit.mjs` (parent harness; Playwright + axe, wcag2a/wcag2aa/wcag21aa — *not part of this repository; see the Artefact inventory at the end of this file*). **Correction of an earlier claim:** the first audit run reported 0 violations, but at that moment the bundled fixture failed validation (page error, item 6) so almost nothing rendered — the "0 violations" was measured on an empty page and was not re-run after the fixture fix. The parent's independent scan of the built assets then found `color-contrast` failures across 3 viewports (ochre `#b07a1f` on paper 3.49:1; muted ink `#6b7790` 4.23:1). Root cause: text roles reused the tile-fill hue and a too-light muted token; the build was not stale — the source itself was non-compliant.
  Fix, test-first: `tests/contrast.test.ts` (28 tests) computes WCAG 2.1 relative-luminance contrast for every text-role token against both surfaces and asserts the text-role CSS rules use text-safe tokens. RED: **10 failed | 18 passed** (`--ink-3`, `--pr`, `--rc`, `--good` on the ground surface, and the new `--de-text`/`--warn-text` tokens). GREEN after retinting (`--ink-3 #56627a`, `--pr/--good #276b5c`, `--rc #4f6a2c`, new `--de-text`/`--warn-text #8a5a10` for text while `--de`/`--warn` stay fill/border-only): **70 passed (70)** across both files.
  Re-audit with the parent's explicit `CHROMIUM_EXECUTABLE_PATH` (chromium-1217) on the rebuilt `dist/`: **0 violations, 0 page errors, no overflow at 1440 / 768 / 375** for the default view (`qa/audit/`) and for the `#/DE.CM-01` deep link exercising the ochre Detect function text (`qa/audit-de/`).
- `qa/workflow.mjs` (own Playwright script; it imports `playwright` from an external `NODE_PATH` install, which is not a dependency of this app, so it is not runnable from this repository alone): **16/16 checks pass** — default contradicted outcome with refused acceptance banner; hash deep link; stale remediation; add evidence recomputes partial → sufficient; short not-applicable refused then substantive accepted; import of malformed pack rejected with path-addressed details; CSV export = header + 25 rows; report JSON schema; empty profile → 25 gaps; keyboard Enter selects tile; no console/page errors; mobile 375 no horizontal overflow. Screenshots `qa/screens/01…07`, results `qa/screens/workflow-results.json`.

## Sixth review fixes (test-first)

The sixth review round (2026-10-01; its selection-review note and adverse-input repro script are not part of this repository — see the Artefact inventory) showed: zero evidence + `accepted` decision dated 2020 → `sufficient`, residual 0.3, out of the gap register. Six regression tests written first — RED **6 failed | 42 passed** (`qa/red-engine.txt`). Fix: `DECISION_VALID_DAYS = 365` (decisions older than that, or dated after `asOf`, are ignored with a `stale decision` warning; boundary tested at 365/366 days); `accepted` on `none` now yields the new status `accepted-risk` (exposure 0.6, stays in the gap register, own remediation text) and never `sufficient`; report carries `decisionPolicy`; README documents the two-type rule as metadata-only. Fixture gained an accepted-risk (RC.CO-03) and a stale 2024 acceptance (GV.RM-02). GREEN **76 passed (76)** (48 engine + 28 contrast). Build ✓; workflow 16/16; axe 0 at 3 viewports on the default view and `#/RC.CO-03`.

## Facts usable in a resume bullet (measured)

(Counts below are as measured on 2026-10-01; after the October 2026 round the suite is 102 tests — see the section at the end of this file.)

- 76 unit tests, test-first, including 12 engine regression tests and a 28-test WCAG contrast guard, all driven by external review.
- 25 CSF 2.0 subcategories across all six Functions, statements transcribed from NIST CSWP 29.
- 0 axe WCAG 2.1 AA violations at 3 viewports on the final build (after a contrast correction found by independent review); 0 npm audit findings.
- Import validator bounded at 512 KiB UTF-8 / 500 artifacts / 25 refs with path-addressed errors.

## Not measured / not claimed

No user study, no real organisation data, no performance benchmark, no cross-browser matrix (Chromium headless only).

## Upgrade round — October 2026 (lab-wide)

Measured on 2026-10-04 in the build sandbox: Node v20.20.1, npm 10.8.2, Linux. All commands were run from this app's own directory; result lines are quoted verbatim. Nothing below was run in a browser.

### Toolchain (contract C2): Vite 6 → 7, @vitejs/plugin-react 4 → 5

`package.json`: `vite ^6.4.0 → ^7.3.6`, `@vitejs/plugin-react ^4.7.0 → ^5.2.0`. Unchanged: `vitest ^4.1.11`, `typescript ^5.9.0`, `react`/`react-dom ^19.2.0`, `@types/node ^20.19.43`, `engines.node >=20.19` (Vite 7 requires Node ≥ 20.19).

1. `npm install --ignore-scripts --no-fund --no-audit` → `changed 6 packages in 1m` (exit 0). **`--legacy-peer-deps` was not needed**: the npm 10.8.2 peer-resolution crash recorded above for the vitest 4 upgrade did not reproduce for this change.
2. `npm ci --ignore-scripts --no-fund --no-audit` from the regenerated lockfile → `added 99 packages in 49s` (exit 0). The lockfile was regenerated by npm only, never hand-edited.
3. Lockfile now resolves `vite 7.3.6`, `@vitejs/plugin-react 5.2.0`, `esbuild 0.28.2` (was 0.25.12); `rollup 4.63.6`, `vitest 4.1.11`, `typescript 5.9.3`, `react`/`react-dom 19.3.0` unchanged. `public/THIRD_PARTY_LICENSES.txt` lists production dependencies only (unchanged by this bump); `THIRD_PARTY_NOTICES.md` versions updated.
4. `npx vitest run --reporter=verbose` (before any feature work) → `Test Files  2 passed (2)` / `Tests  76 passed (76)`.
5. `npm run build` (`tsc -p tsconfig.json && vite build`) → `vite v7.3.6 building client environment for production...` … `✓ built in 6.27s`.
6. `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### Hygiene (contracts C1, C3)

- `vercel.json` now carries the lab-wide canonical header set exactly: it adds `Strict-Transport-Security: max-age=63072000; includeSubDomains`; the CSP and the other six headers were already identical. `AUDIT.md` → "Security headers" lists the set and states why `form-action 'none'` is safe here (every form calls `preventDefault()`).
- `index.html` `<meta name="color-scheme">` changed from `light dark` to `light`: `src/ui/styles.css` has no `prefers-color-scheme` query and the `html` background is the mineral ground `#e9ecef`.

### Evidence forecast (test-first)

**RED.** `tests/forecast.test.ts` (23 tests) and three new guards in `tests/contrast.test.ts` were written first against a stub `src/engine/forecast.ts` that exported the final signatures with placeholder returns (`[]`, the input date, empty horizons). The suite therefore collected and failed on assertions, not on missing modules:
`npx vitest run --reporter=verbose tests/forecast.test.ts tests/contrast.test.ts` → `Test Files  2 failed (2)` / `Tests  25 failed | 29 passed (54)` — the 23 forecast tests plus 2 contrast guards (the CSS rules did not exist yet); typical failure lines: `expected [] to have a length of 75 but got +0`, `row for PR.AA-05 at +90 days: expected undefined to be defined`, `expected '2026-10-01' to be '2026-10-31'`. Saved verbatim as `qa/red-forecast.txt`.

**GREEN.** After implementing `forecastPack`, `forecastSummary`, `degradingIds`, `forecastToCsvRows`, `normaliseHorizons`, `addDays` and `buildReportWithForecast` in `src/engine/forecast.ts`, the `Forecast` panel, the mosaic marker and the two exports: `npx vitest run --reporter=verbose` → `Test Files  3 passed (3)` / `Tests  102 passed (102)` = 48 engine + 23 forecast + 31 contrast. Saved verbatim as `qa/green-forecast.txt`. No existing test was changed or weakened.

What the forecast tests pin: `addDays` month/year/leap rollovers in UTC; horizons de-duplicated, sorted, bounded to 12 whole-day values ≤ 3650 (the budget for the extra evaluations); 25 rows per horizon in catalog order; fresh → aging exactly at `validDays + 1` (partial → weak, residual 1 → 1.6) and not at `validDays`; aging → stale exactly at `1.5 × validDays + 1` (weak → none); a valid override lapsing exactly at `DECISION_VALID_DAYS + 1` (sufficient → weak, `decisionLapses: true`) and not at `DECISION_VALID_DAYS`; accepted-risk → none and not-applicable → computed status on lapse; a decision already stale today never "lapses"; future-dated evidence or decisions becoming current are reported but never counted as degradation; equal-exposure changes (contradicted → refuted) are not degradation; nothing degrades when nothing changes; empty pack → zeros; byte-identical rows for identical packs and for permuted horizon input; drivers sorted by evidence id; summary ranks drivers by the number of degrading outcomes; forecast CSV rows pass through the existing neutralising `toCsv` (a `=HYPERLINK` evidence id arrives as `'=HYPERLINK…`); `buildReportWithForecast` leaves the base report byte-identical and adds only `forecast`; Harbourline degrades 1 outcome within 30 days (`PR.AA-05`, EV-002 aging → stale), 5 within 90 and 6 within 180, and its quarter-old acceptances lapse at day 365.

Test label wording (no behaviour change): the `describe` label of the earlier review-regression group in `tests/engine.test.ts` was reworded to neutral text ("sixth-review regressions …") in this round; its six assertions and the counts are unchanged. `qa/red-engine.txt` is the historical RED run from 2026-10-01; on 2026-10-04 the six group labels in its failure lines were neutralised in place and a one-line header note was inserted (text only — test ids, results and counts unchanged). `qa/green-engine.txt` never contained the label.

Schema: `tessera.report/1` keeps its id; `Report.forecast?: { horizons, rows, note }` is additive and optional (`buildReport` output is unchanged; the UI's "Export report JSON" uses `buildReportWithForecast`). The pack schema `tessera.pack/1` is untouched, so the bundled fixture and previously exported packs import as before.

### Final gates (after the forecast UI)

- `npm run build` (`tsc -p tsconfig.json && vite build`; the tsc step typechecks `src` and `tests`) → `vite v7.3.6 building client environment for production...` … `dist/assets/index-aVFF9OlB.js  274.47 kB │ gzip: 85.18 kB` … `✓ built in 2.01s` (`dist/` total 434 616 bytes including the self-hosted fonts).
- `npm audit --audit-level=high` (re-run after all changes) → `found 0 vulnerabilities`.

### Accessibility of the new UI (computed, not browser-measured)

No new colour token was introduced; the panel reuses tokens already guarded by `tests/contrast.test.ts`. Ratios computed with the same relative-luminance formula as that test:

| Text | Surface | Ratio |
|---|---|---|
| `--paper #f7f8f9` (solid buttons, incl. "Export forecast CSV") | `--ink #121a26` | 16.44:1 |
| `--ink #121a26` (horizon radio labels, table cells) | `--paper #f7f8f9` | 16.44:1 |
| `--ink #121a26` | `--ground #e9ecef` | 14.74:1 |
| `--ink-2 #44506a` (driver cells, help text) | `--paper` | 7.59:1 |
| `--ink-3 #56627a` (fieldset legend, table headers) | `--paper` | 5.77:1 |

The mosaic marker is a `↓` glyph plus a double bottom border that inherit each tile's existing text colour (status stays pattern-encoded; nothing is colour-only), and the meaning is in the tile's `aria-label` and `title` ("forecast: degrades within 90 days if no new evidence is collected"). The horizon selector is a labelled radio group; focus styles and `prefers-reduced-motion` handling are inherited. **Not measured:** no axe/Playwright run was performed from this repository in this round; the `qa/` screenshots and `qa/workflow.mjs` predate the forecast panel and do not cover it.

### Artefact inventory

Relative paths mentioned in `README.md`, `AUDIT.md`, this file or `INTERVIEW_GUIDE.md` that are **not** in the repository, with the reason:

- `tools/browser_audit.mjs` — the parent's external review harness (Playwright + axe); not part of this repository. Its outputs that were kept are in `qa/audit/` and `qa/audit-de/` (JSON + screenshots).
- An external selection-review note (`selection/*.md`, not in this repository) and the sixth review's adverse-input repro script (both cited under "Sixth review fixes") — external review material, not retained here. The behaviour they reproduced is pinned by the sixth-review regression tests in `tests/engine.test.ts`.
- `qa/workflow.mjs` — present, but it imports `playwright` from an external `NODE_PATH` install (not a dependency of this app); it is not runnable from this repository alone and was not re-run in this round.
- `qa/screens/01…07` — shorthand for the seven committed screenshots `qa/screens/01-desktop-initial.png` … `qa/screens/07-mobile.png`; they predate the October 2026 UI changes.
- `CHROMIUM_EXECUTABLE_PATH` — an environment variable of the external harness, not a file.
