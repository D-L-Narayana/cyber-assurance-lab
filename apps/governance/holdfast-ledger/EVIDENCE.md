# EVIDENCE — Holdfast Ledger

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/ledger.test.ts` (13 tests) written against a stub whose exports throw `not implemented`. First run (`qa/red-ledger.txt`): suite fails at collection inside `computeDue` — `Error: not implemented`.
2. After implementing `ledger.ts`: `2 failed | 21 passed`. One failure was a wrong expectation in the test (I had assumed 2 555 days ≈ 7 years lands on 2025-01-01; it lands on 2024-12-30 because of two leap days — the test now asserts the exact value). The other was `exportAudit` not verifying the chain itself; it became async and verifies at export time → `23 passed`.
3. Fixture test added → `24 passed`.

4. Review round of 2026-10-01: a hold placed after planning but before execution was ignored. Two failing tests added first (`qa/red-stale-plan.txt`: `2 failed | 13 passed`), then `executePlan` re-derives the plan id and rejects stale plans atomically → `26 passed` (`qa/green-stale-plan.txt`). UI shows the rejection and clears the plan; the workflow log confirms the execute control is also invalidated when a hold changes.

## Final test run

```
$ npm test
 ✓ src/engine/safe.test.ts (10 tests)
 ✓ src/fixtures/validate-demo.test.ts (1 test)
 ✓ src/engine/ledger.test.ts (15 tests)
 Test Files  3 passed (3)
      Tests  26 passed (26)
```

## Build

`npm run build` → `tsc --noEmit` clean, `vite build ✓ built in ~1.3s`. `npm audit`: 0 vulnerabilities.

## Browser workflow (`qa/workflow.mjs`, Chromium, vite preview :6142) — `qa/screens/workflow-log.txt`

- Initial: Retained 29 · Due today 2 · Overdue 21 · On hold 8 · Disposed 2 · No schedule 6 (68 records, 4 holds).
- Generate plan → `Plan c2aa62869075… : 23 to dispose, 8 blocked by holds.`; generating again → same id (idempotent).
- Execute → `Simulated 23 disposals; 23 receipts in the chain.` Re-plan → `0 to dispose, 8 blocked by holds.`
- Release the HR-wide hold → new plan id, `5 to dispose, 3 blocked by holds`; execute → 28 receipts.
- Verify → `Chain intact: 28 receipts verified on the ledger.` Tamper demo (flip action on receipt #15 in a copy) → `Chain broken at receipt #15 on the tampered copy: Receipt 15 content does not match its hash (tampered).` (`03-tamper-detected.png`) Restore → intact again.
- Clock moved to 2027-10-01 → Retained 13 · Overdue 15 · On hold 4 · Disposed 30.
- Export audit JSON → `holdfast.audit/v1`, 2 plans, 28 receipts, `chain.ok=true`, all plans reconciled. Receipts CSV → 29 lines.
- Invalid import → `Fixture rejected: records[0] is not an object. · schedule s: category required · …`
- Mobile overflow found on first run (`scrollWidth=666` at 375 px: grid items inside `.col` had `min-width:auto`), fixed with `.col > section { min-width: 0 }`; re-run `mobile scrollWidth=375`, `tablet 768`, `pageErrors=[]`.

Axe (`qa/audit/browser-audit.json`) after the fix: 0 violations, 0 page errors, no overflow at 1440/768/375.

## Measured facts for resume use

- 26 automated tests (as of 2026-10-01; 33 after the October 2026 round below); SHA-256 known-answer test; tamper/reorder/gap detection and stale-plan rejection covered.
- Synthetic fixture: 68 records, 4 systems, 3 schedules, 4 holds; 28 receipts produced in the scripted session.

## Upgrade round — October 2026 (lab-wide)

Commands run 2026-10-04 with Node v20.20.1 / npm 10.8.2 through the lab's per-app runner (`npx vitest run --reporter=verbose`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`); every quoted line below is copied from the saved output. Paths are repo-relative to this app.

### Hygiene (contracts C1–C3)

- `vercel.json` now carries the lab-wide canonical header set — CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP, CORP and HSTS (full text in `AUDIT.md`, "Security headers"); `cleanUrls: true` kept.
- `package.json` gains `"engines": { "node": ">=20.19" }`.
- `index.html` `<meta name="color-scheme">` changed from `light dark` to `dark`: the stylesheet has no `prefers-color-scheme` query and `html, body { background: var(--vault) }` resolves to `#0f1f1a`.

### Guarded hold release / reinstatement with trail (test-first)

1. Seven tests were added to `src/engine/ledger.test.ts` (new `describe` block "guarded hold release and reinstatement with trail"): every refusal (unknown hold, already released, not released, date before `placedOn` / before `releasedOn`, `2026-02-30` and `01/10/2026`, empty / blank / 121-character actor, 9-character and blank reason, full 2 000-event trail), the release and reinstatement happy paths with contiguous `seq` and input immutability, determinism, validator behaviour (legacy fixture without `holdHistory` accepted; `'x'`, `[null]`, unknown hold, non-contiguous `seq`, bad date, bad action, empty actor, numeric reason and 2 001 events rejected with a `holdHistory[0]` path; unknown keys dropped), `holdHistory` in the export (`[]` for a legacy fixture) and release-after-planning → stale plan.
2. A first RED attempt was discarded: the tests were run before any export existed and every failure read `releaseHold is not a function` — an import error, not missing behaviour. That capture was overwritten.
3. RED (`qa/red-hold-trail.txt`): with `releaseHold`/`reinstateHold` exported as stubs returning `{ ok: false, error: 'not implemented' }`, `LIMITS.holdHistory = 2000` and the optional `holdHistory` type in place, the suite collected and failed on assertions only, e.g. `expected { ok: false, error: 'not implemented' } to match object { ok: false, error: StringMatching /actor/i }`, `expected true to be false // Object.is equality` (the validator accepted a malformed trail) and `expected undefined to deeply equal [ { seq: 1, holdId: 'h-old', …(4) } ]` (the export had no `holdHistory`). Result line: `Tests  7 failed | 26 passed (33)`.
4. GREEN (`qa/green-hold-trail.txt`) after implementing the guards, the trail, the validator branch and the export field: `Tests  33 passed (33)`.

Design decision recorded: reinstatement clears `releasedOn` and keeps the original `placedOn`; *when* the hold was released and brought back is read from the trail, not from the hold record.

### Final measurements (2026-10-04)

- `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) → exit 0.
- `npx vitest run` → `Test Files  3 passed (3)` / `Tests  33 passed (33)` (`src/engine/ledger.test.ts` 22, `src/engine/safe.test.ts` 10, `src/fixtures/validate-demo.test.ts` 1).
- `npm run build` → `✓ 36 modules transformed.` … `dist/assets/index-DnNTB6KI.js  261.84 kB │ gzip: 80.85 kB`, `dist/assets/index-CTr1BNPB.css  10.26 kB │ gzip: 2.76 kB`, `✓ built in 1.42s`; `dist/` holds 17 files, 475,150 bytes.
- `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### UI, accessibility and contrast

- The one-click "Release as of …" / "Reinstate" buttons became "Release…" / "Reinstate…" buttons (accessible names `Release <hold id>` / `Reinstate <hold id>`) that open an inline `<form>` with labelled Actor, Reason and Effective-date fields, a `role="alert"` refusal line and Confirm / Cancel buttons; the form submits through `preventDefault` (compatible with `form-action 'none'`). A "Hold history" list follows the holds. No animation was added, so there is nothing for `prefers-reduced-motion` to suppress.
- Contrast ratios (WCAG 2.x relative-luminance formula, computed from the stylesheet tokens — no new colours were introduced): refusal text `#f6c9bd` on `--vault-2 #152a23` 10.10:1; field labels `--parch-dim #b9b2a1` on `#152a23` 7.17:1; body and input text `--parch #ede7d6` on `#152a23` 12.26:1; hold-button text `#f1b7a8` on `#152a23` 8.71:1; brass accents `#c59a3b` on `#152a23` 5.81:1; `--parch-dim` on `--vault #0f1f1a` 8.08:1.
- Browser QA was **not** re-run in this round (the `playwright` package is not installed in the working environment). `qa/workflow.mjs` was rewritten to drive the new form — short reason → refusal text in the status line, proper actor and reason → release, reinstatement through the form, a second release, the hold-history text and `holdHistory` count in the exported JSON — and keeps the stale-plan check; it is meant to be run against the built app by the integrator. The screenshots in `qa/screens/`, the log `qa/screens/workflow-log.txt` and the axe result in `qa/audit/browser-audit.json` predate this round's UI change.

### Artefact inventory

Paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that do not resolve as written, with the reason:

- `03-tamper-detected.png` (this file, "Browser workflow"): short name for `qa/screens/03-tamper-detected.png`, which is present.
- `ledger.ts` (this file, "Test-first"): short name for `src/engine/ledger.ts`, which is present. The README "Tests" section used the short names `ledger.test.ts`, `safe.test.ts` and `validate-demo.test.ts` for `src/engine/ledger.test.ts`, `src/engine/safe.test.ts` and `src/fixtures/validate-demo.test.ts` (all present); it now uses the full paths.
- `qa/workflow.mjs` is present but depends on the external `playwright` package, which is not a dependency of this app; it was not executed in this round (see above).
- No `*.log` file is referenced by this app's documents; all RED/GREEN captures are `.txt` files under `qa/` and are present (`qa/red-ledger.txt`, `qa/red-stale-plan.txt`, `qa/green-stale-plan.txt`, `qa/red-hold-trail.txt`, `qa/green-hold-trail.txt`).
- `qa/red-ledger.txt` (capture of 2026-10-01): its first line originally quoted the absolute working directory of the original build environment, which is not a repository path. On 2026-10-04 that directory was replaced by a neutral marker and a note line was inserted above it; the command output, failure and counts are untouched. The test file it refers to is `src/engine/ledger.test.ts`.
- `qa/red-hold-trail.txt` (this round) carries a header note: a pre-existing test-group label in `src/engine/ledger.test.ts` was reworded after the capture was taken, and the capture's label text was changed to match; the command, timestamps, results and counts are untouched. `qa/green-hold-trail.txt` was re-run after the rewording and is a byte-exact capture.
