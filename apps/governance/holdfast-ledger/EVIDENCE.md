# EVIDENCE — Holdfast Ledger

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/ledger.test.ts` (13 tests) written against a stub whose exports throw `not implemented`. First run (`qa/red-ledger.txt`): suite fails at collection inside `computeDue` — `Error: not implemented`.
2. After implementing `ledger.ts`: `2 failed | 21 passed`. One failure was a wrong expectation in the test (I had assumed 2 555 days ≈ 7 years lands on 2025-01-01; it lands on 2024-12-30 because of two leap days — the test now asserts the exact value). The other was `exportAudit` not verifying the chain itself; it became async and verifies at export time → `23 passed`.
3. Fixture test added → `24 passed`.

4. Sixth-Fable review (2026-10-01): a hold placed after planning but before execution was ignored. Two failing tests added first (`qa/red-stale-plan.txt`: `2 failed | 13 passed`), then `executePlan` re-derives the plan id and rejects stale plans atomically → `26 passed` (`qa/green-stale-plan.txt`). UI shows the rejection and clears the plan; the workflow log confirms the execute control is also invalidated when a hold changes.

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

- 26 automated tests; SHA-256 known-answer test; tamper/reorder/gap detection and stale-plan rejection covered.
- Synthetic fixture: 68 records, 4 systems, 3 schedules, 4 holds; 28 receipts produced in the scripted session.
