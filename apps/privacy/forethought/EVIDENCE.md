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

## Upgrade round — October 2026 (lab-wide)

Measured 4 Oct 2026 in the build sandbox (Node v20.20.1, npm 10.8.2), one command at a time through a small local wrapper script (not part of this repository) that runs the project-local command in this directory and saves the verbatim output (command, timestamp, Node version, exit code, full output) to the named `.txt` file. The host was shared with other builds, so durations are not representative. Paths are relative to this directory. Counts in the older sections above (37 tests, engine 31) describe the 1 Oct 2026 state and are left as written.

| Command | Verbatim result lines | Evidence file |
|---|---|---|
| `npx vitest run --reporter=verbose` — RED, new tests against the unchanged `snapshot` plus a stub `fromCanonical` returning `undefined` | `Test Files  1 failed \| 1 passed (2)` · `Tests  6 failed \| 40 passed (46)` | `qa/red-version-content.txt` |
| `npx vitest run --reporter=verbose` — GREEN (fourth run; see the record below) | `Test Files  2 passed (2)` · `Tests  47 passed (47)` | `qa/green-version-content.txt` |
| `npm run build` (`tsc -b && vite build`; the `tsc -b` step is the typecheck) | exit 0; `✓ built in 7.28s`; `dist/assets/index-DSTc8h1h.js  330.41 kB │ gzip: 103.28 kB`; `dist/assets/index-BjbfQ3bh.css  18.53 kB │ gzip: 6.65 kB`; `dist/` 16 files, 648,640 bytes (self-hosted woff2 and `THIRD_PARTY_LICENSES.txt` included) | — |
| `npm run build` after `assetsInlineLimit: 0` (see "Fonts under the production CSP" below) | exit 0; `✓ built in 6.99s`; `dist/assets/index-BddbxdfC.css  15.15 kB │ gzip: 3.77 kB`; 13 woff2 files (was 12 — `manrope-cyrillic-ext-wght-normal-*.woff2`, 2.55 kB, is now a file); `grep -c "data:font"` on the CSS → `0` | — |
| `npx vitest run --reporter=verbose` after the config change | `Test Files  2 passed (2)` · `Tests  47 passed (47)` | — |

### Fonts under the production CSP

The browser review of this round served the built `dist/` with the app's own `vercel.json` headers. Under `font-src 'self'`, one small Manrope subset (2.55 kB, below Vite's default 4 KiB inline threshold) had been inlined into the CSS as `url(data:font/woff2;base64,…)` and was blocked: 2 CSP violations and 1 console error per load, in both viewports. Reproduced locally before the fix: `grep -c "data:font" dist/assets/index-BjbfQ3bh.css` → `1`. Fix: `build.assetsInlineLimit: 0` in `vite.config.ts` so every asset ships as a file; the CSP was not widened. After the rebuild the grep prints `0`, `tools/check-dist.mjs --app apps/privacy/forethought` passes (its `data: blocked/total` column reads `0`), and the test suite is unchanged (`47 passed (47)`).
| `npm audit --audit-level=high` | `found 0 vulnerabilities` | — |

### What changed

- `src/engine/types.ts`: `Version.content?: string` — the canonical content JSON the version's hash covers (additive; the `forethought.assessment` v1 schema id is unchanged and files without the field import as before).
- `src/engine/approval.ts`: the module-level `snapshotStore` `Map` is gone. `snapshot` writes `content` when the canonical content is ≤ 64 KiB (`MAX_VERSION_CONTENT_BYTES`), otherwise omits it and appends "Version content too large to retain (… bytes > 65,536); the next summary will not have field-level detail." Before diffing, it re-hashes the previous version's stored content and uses it only if the hash equals that version's `contentHash`; otherwise the summary reads "Content changed (previous snapshot content unavailable: …)" with the reason (no retained content / hash mismatch / unreadable). New `fromCanonical(content)` reconstructs `{ answers, mitigations, flows, acceptances, dpoConsulted, title, owner, description }` from a canonical string and returns `undefined` for anything malformed; `diffSummary` now takes that shape. `canonicalContent` output is byte-for-byte unchanged (the flow/acceptance row builders were only factored out), so existing hashes and signatures stay valid.
- `src/engine/assessmentIO.ts`: `versions[].content` is optional; when present it must be a string ≤ 64 KiB that `fromCanonical` accepts, otherwise the file is rejected with the path (`assessment.versions[0].content …`). Legacy files import unchanged.
- `src/App.tsx`: the version history line states whether a version carries retained content ("content retained for field-level diffs" / "no retained content (next summary will be hash-only)"). No new colour tokens; no new import path (the field rides on the existing assessment import).
- Hygiene: canonical `vercel.json` header set with `cleanUrls: true` (see AUDIT.md "Security headers"); `engines.node >=20.19` in `package.json`; `color-scheme` stays `light` (body background `--paper #f4f2f7`).

### Test-first record (red → green)

Nine tests were written first (six under "version content persistence", three under "version content import"); `fromCanonical` was exported as a stub returning `undefined` so the suite collected and failed on behaviour. RED (`qa/red-version-content.txt`), 6 failures: "snapshot stores the canonical content on the version" (`expected undefined to be '{"id":"PIA-2026-014",…'`), "omits content above 64 KiB and says so" (`expected 'Initial version.' to match /content too large to retain/`), "does not leak snapshot content across assessments that share a content hash" (`expected 'Answer q-volume: 100k-1m → over-1m' to match /previous snapshot content unavailable/` — the old `Map` served one assessment's content to another with the same hash, which is the defect this round removes), "fromCanonical reconstructs…" (`expected undefined to be defined`), "accepts and round-trips a version with canonical content" (the importer dropped the unknown key: `expected undefined to be '{"id":…'`) and "rejects content that is not a string…" (`42: expected true to be false`). Three of the nine passed at RED and this is stated rather than hidden: "export → import → snapshot yields a field-level diff" passed only because the old module-level `Map` was still alive in the same test process (the hidden-state problem in miniature — it would not have passed after a page reload); "legacy files … unavailable" passed because the old code already emitted "previous snapshot content unavailable in this session" for an unknown hash; and "still imports legacy files whose versions have no content" pins existing importer behaviour.

GREEN: the first run after the implementation printed `Tests  46 passed (46)`. A tenth test was then added green-only — "ignores retained content whose hash does not match the version it sits on" — together with the per-reason "unavailable" wording and the version-history text in the UI; because it was written after the fix it has no RED and is declared as such. The next two full runs on the shared host reported, respectively, 1 and 3 failures, all of them pre-existing `App.test.tsx` tests ("changing an answer reveals a follow-up…", "signing binds a hash…", "refuses to sign while blockers exist…") failing with `Test timed out in 5000ms` at 5.1–5.7 s while the engine file was 41/41 green; nothing in this round touches those paths (the UI change only affects the version-history list, which the demo fixture does not render), no `testTimeout` was changed, and the fourth run printed `Tests  47 passed (47)`. Each run was saved to the same `qa/green-version-content.txt` path, so only the final run is retained; the intermediate outputs are described here from the run output and are not kept.

### Browser QA

Not re-run in this round (the external harness is not part of this repository). `qa/screens/*.png` predate this round; the version-history line gained a retained-content note.

### Artefact inventory

Paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that are **not** in this repository, with the reason. The original claims above are retained as written.

- `qa/npm-ci.log`, `qa/tdd-red-engine.log`, `qa/tdd-green-engine.log`, `qa/tdd-red-review-fixes.log`, `qa/tdd-green-review-fixes.log` — `*.log` is gitignored (see .gitignore), so these runs were never committed; the outcomes are described in the text above but the raw logs are not retained in this repository. From this round on, red/green evidence is saved as committed qa/*.txt files (qa/red-version-content.txt, qa/green-version-content.txt).
- `../qa-harness/audit.mjs` — external review harness (Playwright + axe-core) that lived outside this app; not part of this repository. What survives of its output is qa/browser-audit-summary.json, qa/screens/browser-audit.json and the screenshots in qa/screens/.
- `../consentry/qa/tdd-red-review-fixes.log` — the sibling app's gitignored log; not in the repository (Consentry's EVIDENCE.md describes that run).

## Review-driven import strictness (red first, `qa/tdd-red-review-fixes.log` → `qa/tdd-green-review-fixes.log`)

Parent source review (1 Oct 2026): `assessmentIO.ts` accepted `2026-02-30` / `2026-99-99` (regex only), silently filtered non-string `flows[].dataCategories` and sliced to 50, silently truncated `versions[].changeSummary` to 100, and did not reject duplicate `mitigationId`, flow `id`, acceptance `theme`, signature `role` or version `number` — which could make scores and canonical hashes ambiguous. Four tests were added and run: **RED `4 failed | 33 passed (37)`**. Fixes: `isStrictDate` (real calendar date), `strList` helper that rejects malformed or oversized string lists instead of altering signed content, and a `dupCheck` over the five lists. **GREEN `37 passed (37)`**, `tsc -b` clean.
