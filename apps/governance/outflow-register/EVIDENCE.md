# EVIDENCE — Outflow Register

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/register.test.ts` (16 tests) written against a stub whose exports throw `not implemented`. First run (`qa/red-register.txt`): suite fails at collection with `Error: not implemented`.
2. After implementing `register.ts`: `2 failed | 24 passed`. (a) Issue ids collided when one agreement had two obligations without evidence — ids now include the obligation id, and the "stable unique ids" test guards it. (b) My packet test expected 2 flows but the engine correctly returned 3 (an inactive, vendor-mismatched flow also references the agreement); the expectation was corrected and documented in the test. → `26 passed`.
3. Demo-fixture test (every detector kind present; queue head is the expired backup agreement) → `27 passed`.

4. Review round of 2026-10-01: an active flow under a `draft` agreement raised nothing, and obligation `kind` was not validated. Three failing tests added first (`qa/red-draft-flow.txt`: `3 failed | 16 passed`), then `flow_under_draft` (high), the obligation enum check and an as-of guard on renewal end dates were implemented → `30 passed` (`qa/green-draft-flow.txt`). The demo gained `fl-15` (pilot flow under draft `ag-11`); the register now reports 14 high / 10 medium / 3 low issues.

## Final test run

```
$ npm test
 ✓ src/engine/safe.test.ts (10 tests)
 ✓ src/engine/register.test.ts (19 tests)
 ✓ src/fixtures/validate-demo.test.ts (1 test)
 Test Files  3 passed (3)
      Tests  30 passed (30)
```

## Build

`npm run build` → `tsc --noEmit` clean, `vite build ✓`. `npm audit`: 0 vulnerabilities.

## Browser workflow (`qa/workflow.mjs`, Chromium, vite preview :6144) — `qa/screens/workflow-log.txt`

- Initial: 12 agreements · 6 vendors · 13 active flows · 12 high / 10 medium / 3 low issues; queue head `Backup storage 70 · ended`.
- Vendor filter from the flow map (BenefitBridge) → 1 agreement; cleared.
- Backup storage detail lists `deletion_obligation_unmet`, `expired_but_active`, `flow_after_end`. Terminate without reason → `A reason is required…`; with reason but no acknowledgement → `1 active flow still reference this agreement (fl-09). Acknowledge…`; acknowledged → terminated, history #1 (`02-terminated.png`).
- Activate draft renewal → active, history #2. Activate draft without categories → `List at least one permitted data category before activation.`
- Renewing agreement: new end date before current → rejected; `2027-10-14` → active, history #3 `(renewed to 2027-10-14)` (`03-renewed.png`).
- Exports: evidence packet Markdown (31 lines, `# Evidence packet — Product analytics`), register JSON `outflow.register/v1` (26 issues, 9 queued, 3 history), issues CSV 27 lines.
- Clock to 2027-03-01 → 24 high / 3 medium / 1 low.
- Invalid import → `Register rejected: agreements[0] is not an object. · flow f: system undefined is missing · …`
- `mobile scrollWidth=375`, `tablet 768`, `pageErrors=[]`. Axe found three `color-contrast` nodes (muted grey text); `--slate-soft` darkened to `#55637a`; re-run: **0 violations** at 1440/768/375.

## Measured facts for resume use

- 30 automated tests (as of 2026-10-01; 61 after the October 2026 round below); 12 issue detectors; 5-factor explained priority; 4-state guarded lifecycle with history.
- Synthetic register: 12 agreements, 6 vendors, 14 flows (14 active of 15 declared), 26 issues detected as of 2026-10-01.

## Upgrade round — October 2026 (lab-wide)

Commands run 2026-10-04 with Node v20.20.1 / npm 10.8.2 through the lab's per-app runner (`npx vitest run --reporter=verbose`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`); every quoted line below is copied from the saved output. Paths are repo-relative to this app.

### Hygiene (contracts C1–C3)

- `vercel.json` now carries the lab-wide canonical header set — CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP, CORP and HSTS (full text in `AUDIT.md`, "Security headers"); `cleanUrls: true` kept.
- `package.json` gains `"engines": { "node": ">=20.19" }`.
- `index.html` `<meta name="color-scheme">` changed from `light dark` to `light`: the stylesheet has no `prefers-color-scheme` query and `html, body { background: var(--desk) }` resolves to `#eef1f4` (the "pale desk").

### Breach-window normalisation (test-first)

1. Tests added first: in `src/engine/register.test.ts` a new block "breach-window normalisation" with 17 phrasings that must parse (`72h`, `72 h`, `72 hours`, `72hrs`, `72 hr`, `24 hour`, `3 days`, `3d`, `1 day`, `1 week`, `1w`, `2 weeks`, `2 wks`, `within 72 hours`, `no later than 3 days`, `Within 48 Hours of becoming aware`, `notify in 72h; weekly summary`), 10 that must return `null` (`without undue delay`, `immediately`, `two days`, empty, blanks, `ASAP`, `24 business hours`, `quarterly`, bare `72`, `h72`), no contradiction between `72h`/`3 days`, `1 week`/`7 days`, `within 24 hours`/`1d`, a cross-unit contradiction whose detail must read `24h (24 h)` vs `3 days (72 h)` and `not compared: "without undue delay"`, and no contradiction from unparseable text alone; in `src/fixtures/validate-demo.test.ts` a test that PayCo's windows are `24h` and `3 days` and the contradiction still fires.
2. `scripts/generate-fixture.mjs` changed `ag-02`'s window from `72h` to `3 days` and `src/fixtures/demo.json` was regenerated from it (one line differs).
3. RED (`qa/red-breach-window.txt`): `parseWindowHours` was exported as a stub returning `null` and `findIssues` was unchanged, so the suite collected and failed on assertions only — `expected null to be 72 // Object.is equality` (and 24, 48, 168, 336), `expected [] to have a length of 1 but got +0` (no cross-unit contradiction) and `expected undefined to be defined` (the regenerated fixture no longer produced PayCo's contradiction). Result line: `Tests  19 failed | 42 passed (61)`. Honesty note: with a stub that always returns `null`, the ten "returns null" cases and the two "no contradiction" tests pass trivially; they are guards for the GREEN implementation, not RED evidence.
4. GREEN (`qa/green-breach-window.txt`) after implementing `parseWindowHours` (first number + hours/days/weeks unit, case-insensitive, digits capped at six, word-bounded so `h72` is not a window) and the "not compared" wording in `findIssues`: `Tests  61 passed (61)`.

### Final measurements (2026-10-04)

- `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) → exit 0.
- `npx vitest run` → `Test Files  3 passed (3)` / `Tests  61 passed (61)` (`src/engine/register.test.ts` 49, `src/engine/safe.test.ts` 10, `src/fixtures/validate-demo.test.ts` 2).
- `npm run build` → `✓ 37 modules transformed.` … `dist/assets/index-tj87E-wT.js  263.40 kB │ gzip: 81.42 kB`, `dist/assets/index-CsVZRigC.css  13.98 kB │ gzip: 4.75 kB`, `✓ built in 8.70s`; `dist/` holds 15 files, 623,316 bytes.
- `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### Production-CSP defect found by the integration browser run, and the fix (2026-10-04, later the same day)

- Finding: serving the built `dist/` with this app's own `vercel.json` headers, the browser reported 2 Content-Security-Policy violations and 1 console error per page load at both the desktop and the mobile viewport. Cause: Vite inlines assets under 4 KiB, and one Hanken Grotesk subset (the Cyrillic-extended face, 1.67 kB) had been inlined into the stylesheet as `url(data:font/woff2;base64,…)`; the canonical policy is `font-src 'self'` with no `data:` source, so the browser blocked that face. The other two apps in this worker's scope were unaffected because all of their font subsets exceed the inline limit. The CSP is correct and was **not** widened.
- Fix: `vite.config.ts` `build.assetsInlineLimit: 0` (fonts and any other asset ship as files). Rebuild (`npm run build`, log kept by the integrator): `✓ 37 modules transformed.` … `dist/assets/hanken-grotesk-cyrillic-ext-wght-normal-D_UHSL_T.woff2  1.67 kB` now emitted as a file, `dist/assets/index-B895deHo.css  11.79 kB │ gzip: 2.87 kB`, `dist/assets/index-BXf8JIkb.js  263.40 kB │ gzip: 81.42 kB`, `✓ built in 3.70s`; `grep -c "data:font"` over the new stylesheet prints `0`. Before the fix the same count on the previous stylesheet was `1`. The two measurement lines in "Final measurements" above describe the earlier build; the figures in this paragraph supersede them for the stylesheet and script names.

### UI and contrast

- The agreement detail's obligation list now annotates each breach-notification requirement with its normalised value (`= 72 h`) or `window not comparable`; the annotation reuses the existing `.mono` style and inherits `--slate #2b3a4a` on the white sheet (`#ffffff`), 11.62:1. No new colour token, no motion, no new interactive control.
- Browser QA was **not** re-run in this round (the `playwright` package is not installed in the working environment). `qa/workflow.mjs` was reviewed line by line against the regenerated fixture and the UI: it asserts no PayCo text and its interactions are unchanged, so it was left as is; the lead runs it against the built app at integration. The screenshots in `qa/screens/` and `qa/screens/workflow-log.txt` predate this round; the issue counts in that log are expected to be unchanged because the mixed-unit contradiction keeps the same issue id (`contradictory_breach_window:ag-01:-`).

### Artefact inventory

Paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that do not resolve as written, with the reason:

- `02-terminated.png`, `03-renewed.png` (this file, "Browser workflow"): short names for `qa/screens/02-terminated.png` and `qa/screens/03-renewed.png`, which are present.
- `register.ts` (this file, "Test-first"): short name for `src/engine/register.ts`, which is present. The README "Tests" section used the short names `register.test.ts`, `safe.test.ts` and `validate-demo.test.ts` for `src/engine/register.test.ts`, `src/engine/safe.test.ts` and `src/fixtures/validate-demo.test.ts` (all present); it now uses the full paths.
- `qa/workflow.mjs` is present but depends on the external `playwright` package, which is not a dependency of this app; it was not executed in this round (see above).
- No `*.log` file is referenced by this app's documents; all RED/GREEN captures are `.txt` files under `qa/` and are present (`qa/red-register.txt`, `qa/red-draft-flow.txt`, `qa/green-draft-flow.txt`, `qa/red-breach-window.txt`, `qa/green-breach-window.txt`).
- `qa/red-breach-window.txt` (this round) carries a header note: a pre-existing test-group label in `src/engine/register.test.ts` was reworded after the capture was taken, and the capture's label text was changed to match; the command, timestamps, results and counts are untouched. `qa/green-breach-window.txt` was re-run after the rewording and is a byte-exact capture.
