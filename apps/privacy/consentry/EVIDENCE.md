# EVIDENCE.md — Consentry

Measured 1 Oct 2026 (Node v20.20.1, npm 10.8.2).

| Command | Result |
|---|---|
| `npm ci` | reproduces lockfile (final clean run logged in `qa/npm-ci.log`) |
| `npm run typecheck` | exit 0 |
| `npm test` | **3 files, 51 tests passed** (engine 45, UI integration 6) |
| `npm run build` | `index-*.js` 325.8 kB (100.8 kB gzip), CSS 15.4 kB, 8 woff2; `dist/` 488 kB |
| `npm audit` | 0 vulnerabilities |
| Browser QA (`../qa-harness/audit.mjs`, preview on 127.0.0.1:6101) | 3 viewports: 200, 0 page/console errors, 0 failed requests, only `127.0.0.1:6101` contacted, no horizontal overflow, **0 axe violations**; 9-step workflow replay, 0 errors |

## Test-first record

RED (`qa/tdd-red-engine.log`), stubs throwing `not implemented`:

```
 Test Files  2 failed (2)
      Tests  38 failed (38)
```

GREEN (`qa/tdd-green-engine.log`) after implementing `evaluate.ts`, `analysis.ts`, `workspace.ts`:

```
 Test Files  2 passed (2)
      Tests  38 passed (38)
```

One intermediate run was 37/38: the "drops unknown keys" test built a workspace with only one purpose, so records referenced unknown purposes and the import was correctly rejected. The *test* was corrected to keep all purposes; the engine was unchanged.

UI integration tests (6) were written after the UI. One initially failed because `user.type` treats `[` as a key descriptor; switched to `user.paste`.

## Review-driven fixes (red first, `qa/tdd-red-review-fixes.log` → `qa/tdd-green-review-fixes.log`)

An independent source review (parent agent, 1 Oct 2026) found that the recursive nesting check could overflow the call stack on hostile input. Reproduced as a failing test: 20,000 nested arrays inside the 2 MB limit threw `RangeError: Maximum call stack size exceeded` instead of returning a validation error. Fixed with an iterative, bounded `exceedsDepth` traversal; the test now passes with `Nesting deeper than 8 levels is not accepted.` The same reviewer asked whether an unknown age should pass silently; two failing tests were added and R05 now routes age-sensitive purposes to `review` (`AGE_UNKNOWN`) when the age band is unknown. RED: `3 failed | 45 passed`; GREEN: `48 passed`.

## Browser QA findings → fixes

- `color-contrast`: review pill `#9a6508` on `#fbf1dc` = 4.42:1 → `#7a4f05` (6.35:1); stamp sub-label opacity removed.
- 378 px scroll width at 375 px viewport → `<select>` width constrained; `.help` text wraps anywhere.
- Final: 0 violations, 0 overflow at 1440/768/375.

## Workflow replay (observed text)

- After GPC toggle on a Californian sale/share purpose: stamp `DENY GPC_OPT_OUT`.
- After adding a withdrawal before the event: `DENY CONSENT_WITHDRAWN`.
- After disabling R06 (with the session withdrawal still present): `2 of 20 expectations fail. ev-02: expected allow (CONSENT_VALID), observed deny (CONSENT_WITHDRAWN); ev-11: expected deny (GPC_OPT_OUT), observed allow (NOTICE_AND_OPT_OUT)`.
- Malformed import: `Import rejected. workspace.policy.childAgeThreshold must be an object; workspace.policy.id is required; …`.

## Facts usable in resume bullets (educational project, October 2026)

- Implemented a table-driven consent decision engine (13 ordered rules, 19 reason codes) with full decision traces, temporal validity and regime-specific handling (GDPR child thresholds, CCPA opt-out preference signals).
- Added rule-level mutation coverage and a replayable policy regression suite; 44 automated tests including a 200-case property test.
- 0 axe WCAG AA violations at three viewports; 0 `npm audit` findings.

## Upgrade round — October 2026 (lab-wide)

Measured 4 Oct 2026 in the build sandbox (Node v20.20.1, npm 10.8.2), one command at a time through a small local wrapper script (not part of this repository) that runs the project-local command in this directory and saves the verbatim output (command, timestamp, Node version, exit code, full output) to the named `.txt` file. Paths are relative to this directory. Counts quoted in the older sections above (13 rules, 19 reason codes, 20 events/expectations, 44 or 51 tests) describe the 1 Oct 2026 state and are left as written; as of this round the table has 14 rules and 20 reason codes, the fixture 9 subjects / 12 records / 21 events / 21 expectations, and the suite 61 tests.

| Command | Verbatim result lines | Evidence file |
|---|---|---|
| `npx vitest run --reporter=verbose` — RED, new tests against a stub `R09a-record-regime` that always passes | `Test Files  3 failed (3)` · `Tests  7 failed \| 54 passed (61)` | `qa/red-record-regime.txt` |
| `npx vitest run --reporter=verbose` — GREEN | `Test Files  3 passed (3)` · `Tests  61 passed (61)` | `qa/green-record-regime.txt` |
| `npm run build` (`tsc -b && vite build`; the `tsc -b` step is the typecheck) | exit 0; `✓ built in 3.79s`; `dist/assets/index-CXmFKBDA.js  328.64 kB │ gzip: 101.60 kB`; `dist/assets/index-BP7lFBXv.css  15.48 kB │ gzip: 5.73 kB`; `dist/` 12 files, 528,848 bytes (self-hosted woff2 and `THIRD_PARTY_LICENSES.txt` included) | — |
| `npm audit --audit-level=high` | `found 0 vulnerabilities` | — |
| `npm run build` after `assetsInlineLimit: 0` (see "Fonts under the production CSP" below) | exit 0; `✓ built in 1.95s`; `dist/assets/index-CMIAl7V2.css  12.81 kB │ gzip: 3.42 kB`; 9 woff2 files (was 8 — `jetbrains-mono-cyrillic-ext-wght-normal-*.woff2`, 2.03 kB, is now a file); `grep -c "data:font"` on the CSS → `0` | — |
| `npx vitest run --reporter=verbose` after the config change | `Test Files  3 passed (3)` · `Tests  61 passed (61)` | — |

### Fonts under the production CSP

The browser review of this round served the built `dist/` with the app's own `vercel.json` headers. Under `font-src 'self'`, one small JetBrains Mono subset (2,03 kB, below Vite's default 4 KiB inline threshold) had been inlined into the CSS as `url(data:font/woff2;base64,…)` and was blocked: 2 CSP violations and 1 console error per load, in both viewports. Reproduced locally before the fix: `grep -c "data:font" dist/assets/index-BP7lFBXv.css` → `1` (petitio and firstlight → `0`, their subsets are above the threshold). Fix: `build.assetsInlineLimit: 0` in `vite.config.ts` so every asset ships as a file; the CSP was not widened. After the rebuild the grep prints `0`, `tools/check-dist.mjs --app apps/privacy/consentry` passes (its `data: blocked/total` column reads `0`), the test suite is unchanged (`61 passed (61)`), and the bundle grew by one 2 kB request while the CSS shrank by the same amount.

### What changed

- `src/engine/types.ts`: `ReasonCode` gains `RECORD_REGIME_MISMATCH` (additive; the `consentry.workspace` v1 schema id is unchanged and expectations may now name the new code).
- `src/engine/evaluate.ts`: new rule `R09a-record-regime` between R08 and R09. When the effective basis is `consent`, the latest record at or before the event is a *grant* and `record.regime !== subject.regime`, the decision is `review` / `RECORD_REGIME_MISMATCH` with `recordId` set and a note naming both regimes. The rung passes (with a stated note) when the basis is not consent, when there is no record, when the latest record is a withdrawal/objection/opt-out (those keep their protective effect through R07/R09), or when the regimes agree.
- `src/engine/workspace.ts`: `R09a-record-regime` added to the protective-rule list, so disabling it in an imported policy raises the existing "educational override" warning.
- `src/fixtures/demo-workspace.json`: subject `sub-uk-imogen` (UK-GDPR, adult), record `rec-012` (granted, `regime: EU-GDPR`, mechanism `imported`), event `ev-21`, expectation `review` / `RECORD_REGIME_MISMATCH`. The 20 previous expectations are unchanged and still pass.
- UI: `src/ui/Ladder.tsx` renders the trace generically, so the new rung appears without code changes; a grep found no exhaustive `Record<ReasonCode, …>` maps in the UI or analysis, so nothing else needed extending. `App.test.tsx` adjusted `1 of 20` → `1 of 21` expectations and gained one test for the rendered rung. No new colour tokens (the rung uses the existing ladder and stamp styles), so there are no new contrast ratios to report.
- Hygiene: canonical `vercel.json` header set with `cleanUrls: true` (see AUDIT.md "Security headers"); `engines.node >=20.19` in `package.json`; `color-scheme` stays `light` (body background `--bone #f7f7f3`).

### Test-first record (red → green)

Ten tests were written first (six in `evaluate.test.ts`, three in `analysis.test.ts`, one in `App.test.tsx`), together with the fixture additions; the rule was inserted as a stub that always passes so the suite collected and failed on behaviour, not on a missing export. RED (`qa/red-record-regime.txt`), 7 failures: `routes a consent grant captured under another regime to review …` (`expected { …(9) } to match object { decision: 'review', …(3) }` — the stub let R09 answer `CONSENT_VALID`); `passes for the bundled fixture expectations` and `ev-21 … the suite passes` (`expected [ { eventId: 'ev-21', …(4) } ] to deeply equal []`); `the fixture exercises R09a-record-regime` (`expected false to be true`); `disabling R09a-record-regime at import is called out` (the warning text did not mention R09a); and in the App both `renders the record-regime rung` and the pre-existing `disabling a rule in the coverage tab …`, which saw `2 of 21 expectations fail` because ev-21 was already expected to review. The remaining new tests passed at RED by design — same-regime grant unaffected, non-consent bases unaffected, a cross-regime withdrawal still denies, no record → `NO_CONSENT`, and the rule-position test (satisfied as soon as the stub sat before R09). GREEN after implementing the rule and the protective-rule entry: `Tests  61 passed (61)` (`qa/green-record-regime.txt`); the 200-case determinism property (exactly one matched rung) passed unchanged with fourteen rules. No test was weakened.

Capture note: later the same day, two pre-existing `describe` labels in `src/engine/evaluate.test.ts` and `src/engine/analysis.test.ts` were renamed to the neutral "(sixth-review finding)" (text only — no assertion, count or id changed). The suite was re-run and `qa/green-record-regime.txt` re-saved with the new labels (`Tests  61 passed (61)` again). `qa/red-record-regime.txt` cannot be re-run without re-stubbing the rule, so the old labels inside it were renamed in place and the file carries a header note saying so; its results are unchanged.

### Browser QA

Not re-run in this round (the external harness is not part of this repository). `qa/screens/*.png` predate this round.

### Artefact inventory

Paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that are **not** in this repository, with the reason. The original claims above are retained as written.

- `qa/npm-ci.log`, `qa/tdd-*.log` — the original build's npm and vitest logs (the engine, review-fixes and sixth-review hardening red/green pairs named in the sections above); never committed (`*.log` is gitignored), so the outcomes are described in the text above but the raw logs are not retained in this repository. From this round on, red/green evidence is saved as committed qa/*.txt files (qa/red-record-regime.txt, qa/green-record-regime.txt).
- `../qa-harness/audit.mjs` — external review harness (Playwright + axe-core) that lived outside this app; not part of this repository. What survives of its output is qa/browser-audit-summary.json, qa/screens/browser-audit.json and the screenshots in qa/screens/.
- `v2/*.mjs` — the external review harness's adverse-input repro scripts (fourth adverse-input round, 1 Oct 2026), which lived outside this app; not part of this repository. The findings raised here are reproduced by committed tests in src/engine/evaluate.test.ts and src/engine/analysis.test.ts.

## Sixth-review hardening (red first; the red/green vitest logs of that round are among the original build's `qa/tdd-*.log` files, never committed — `*.log` is gitignored)

Findings (sixth review, fourth adverse-input round, external repro script `v2/cs-adverse.mjs`): (I) the California under-16 sale/share opt-in rewrite in `buildFacts` fired only when the configured basis was `notice-and-opt-out`, so a sale/share purpose configured with `legitimate-interest` + `liaDocumented` evaluated to `allow LEGITIMATE_INTEREST` for an under-13 Californian; (N) importing a policy that disabled R05/R06/R07 produced no warning. Three tests added: **RED `3 failed | 48 passed (51)`**. Fixes: the minor guard now depends on regime + category + age only; `parseWorkspace` emits an "educational override" warning per disabled protective rule (R05–R08) and the app status line shows the warning text. **GREEN `51 passed (51)`.** Probe re-run: `CA minor, sale/share with LI basis -> deny NO_CONSENT`; import warnings listed. Build and 9-step browser flow re-run clean.
