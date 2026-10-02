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

## Sixth-Fable hardening (red first, `qa/tdd-red-sixth-fable.log` → `qa/tdd-green-sixth-fable.log`)

Findings (Round 4, `v2/cs-adverse.mjs`): (I) the California under-16 sale/share opt-in rewrite in `buildFacts` fired only when the configured basis was `notice-and-opt-out`, so a sale/share purpose configured with `legitimate-interest` + `liaDocumented` evaluated to `allow LEGITIMATE_INTEREST` for an under-13 Californian; (N) importing a policy that disabled R05/R06/R07 produced no warning. Three tests added: **RED `3 failed | 48 passed (51)`**. Fixes: the minor guard now depends on regime + category + age only; `parseWorkspace` emits an "educational override" warning per disabled protective rule (R05–R08) and the app status line shows the warning text. **GREEN `51 passed (51)`.** Probe re-run: `CA minor, sale/share with LI basis -> deny NO_CONSENT`; import warnings listed. Build and 9-step browser flow re-run clean.
