# EVIDENCE — Outflow Register

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/register.test.ts` (16 tests) written against a stub whose exports throw `not implemented`. First run (`qa/red-register.txt`): suite fails at collection with `Error: not implemented`.
2. After implementing `register.ts`: `2 failed | 24 passed`. (a) Issue ids collided when one agreement had two obligations without evidence — ids now include the obligation id, and the "stable unique ids" test guards it. (b) My packet test expected 2 flows but the engine correctly returned 3 (an inactive, vendor-mismatched flow also references the agreement); the expectation was corrected and documented in the test. → `26 passed`.
3. Demo-fixture test (every detector kind present; queue head is the expired backup agreement) → `27 passed`.

4. Sixth-Fable review (2026-10-01): an active flow under a `draft` agreement raised nothing, and obligation `kind` was not validated. Three failing tests added first (`qa/red-draft-flow.txt`: `3 failed | 16 passed`), then `flow_under_draft` (high), the obligation enum check and an as-of guard on renewal end dates were implemented → `30 passed` (`qa/green-draft-flow.txt`). The demo gained `fl-15` (pilot flow under draft `ag-11`); the register now reports 14 high / 10 medium / 3 low issues.

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

- 30 automated tests; 12 issue detectors; 5-factor explained priority; 4-state guarded lifecycle with history.
- Synthetic register: 12 agreements, 6 vendors, 14 flows, 26 issues detected as of 2026-10-01.
