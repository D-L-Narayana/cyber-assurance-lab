# EVIDENCE.md — Forethought

Measured 1 Oct 2026 (Node v20.20.1, npm 10.8.2).

| Command | Result |
|---|---|
| `npm ci` | reproduces lockfile (final clean run in `qa/npm-ci.log`) |
| `npm run typecheck` | exit 0 |
| `npm test` | **2 files, 37 tests passed** (engine 31 incl. 2 rubric-shape tests, UI integration 6) |
| `npm run build` | `index-*.js` 296.8 kB (92.6 kB gzip), CSS 18.0 kB, self-hosted woff2; `dist/` 616 kB |
| `npm audit` | 0 vulnerabilities |
| Browser QA (`../qa-harness/audit.mjs`, preview on 127.0.0.1:6103) | 3 viewports: 200, 0 page/console errors, 0 failed requests, only `127.0.0.1:6103` contacted, no page overflow, **0 axe violations**; 10-step workflow replay, 0 errors |

## Test-first record

RED (`qa/tdd-red-engine.log`): `Tests  24 failed | 2 passed (26)` against stubs. The two passing tests check the shape of the rubric data (ten top-level questions, unique option ids), which existed before the engine.
GREEN (`qa/tdd-green-engine.log`): `Tests  26 passed (26)`.

Intermediate: the calibration test failed once (`expected 'very-high' to be 'high'`) because the demo's automated-decisions theme reached 15; the rubric weight for individual recommendations was lowered from L+3 to L+2 (calibration is the purpose of that test).

The hostile-nesting test (20,000 nested arrays) was added after the parent's review of a sibling project found a recursive depth check; the shared fix (iterative bounded traversal) was applied here before this test was run, so for this project the test passed on first run — the red run exists in `../consentry/qa/tdd-red-review-fixes.log`.

UI integration tests (6) were written after the UI; one query was tightened because "Inherent" appears in two places.

## Browser QA findings → fixes

1. `color-contrast` on the low band tag → `#3a5d4a` (6.20:1).
2. Overflow at 768/375: flows table → scrollable region; `<details>` import popover → Radix dialog.
Final: 0 violations, 0 overflow at all three widths.

## Workflow replay (observed text)

- Executive view: `Recommendation feature for the storefront (PIA-2026-014) is assessed at high inherent privacy risk, reduced to high after the controls currently in place. 1 theme(s) remain high or very high: children…`
- After signing then changing the volume answer: `Stale — content changed since signing: product-owner Tamsin Reyes at … · fef9a07b0873`.
- After choosing "automated decisions with legal effects": blocker `HIGH_RESIDUAL_WITHOUT_ACCEPTANCE Automated decisions and profiling is very-high after mitigations…`; sign attempt → `Sign-off blocked by 1 issue(s): HIGH_RESIDUAL_WITHOUT_ACCEPTANCE`.
- Very-high fixture: `DPIA-scale` tag shown; version recorded `v1 … Initial version.`
- Invalid import: `Import rejected. assessment.answers.q-purpose "nope" is not an option of that question`.

## Facts usable in resume bullets (educational project, October 2026)

- Built a PIA workbench in React/TypeScript with a weighted 10-theme likelihood × impact model, progressive-disclosure questionnaire, evidence-gated mitigations and six sign-off invariants.
- Implemented SHA-256 content hashing for signature staleness and versioned snapshots with change summaries; 37 automated tests including calibration fixtures and a property test.
- 0 axe WCAG AA violations at three viewports; 0 `npm audit` findings.

## Review-driven import strictness (red first, `qa/tdd-red-review-fixes.log` → `qa/tdd-green-review-fixes.log`)

Parent source review (1 Oct 2026): `assessmentIO.ts` accepted `2026-02-30` / `2026-99-99` (regex only), silently filtered non-string `flows[].dataCategories` and sliced to 50, silently truncated `versions[].changeSummary` to 100, and did not reject duplicate `mitigationId`, flow `id`, acceptance `theme`, signature `role` or version `number` — which could make scores and canonical hashes ambiguous. Four tests were added and run: **RED `4 failed | 33 passed (37)`**. Fixes: `isStrictDate` (real calendar date), `strList` helper that rejects malformed or oversized string lists instead of altering signed content, and a `dupCheck` over the five lists. **GREEN `37 passed (37)`**, `tsc -b` clean.
