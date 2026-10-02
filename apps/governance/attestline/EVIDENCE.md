# EVIDENCE — Attestline

All commands were run on 2026-10-01 in this directory with Node v20.20.1 / npm 10.8.2. Outputs are abbreviated copies of the actual terminal output; raw captures live in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/campaign.test.ts` was written before `campaign.ts` existed. First run (`npx vitest run src/engine/campaign.test.ts`):
   ```
   FAIL src/engine/campaign.test.ts  Error: Cannot find module './campaign'
   Test Files 1 failed (1)   Tests no tests
   ```
   A stub exporting `throw new Error('not implemented')` was then added and the run failed inside `buildCampaign` (`qa/red-campaign-stub.txt`).
2. After implementing `campaign.ts`: `Tests 1 failed | 25 passed (26)` — the failure was a genuine bug in the shared helper (`parseBoundedJson` accepted a JSON array root because `typeof [] === 'object'`). Fixed; `26 passed`.
3. Parent review raised two hardening gaps. Failing tests were added first (`qa/red-safe-hardening.txt`):
   ```
   × neutralises formula prefixes hidden behind whitespace or control characters
   × rejects calendar-invalid dates that Date.parse would normalise
   Tests 2 failed | 8 passed (10)
   ```
   then `isIsoDate` (UTC round-trip) and `csvCell` (skip leading whitespace/control chars) were fixed → `10 passed`.
4. Parent review raised malformed-row throws and a promised-but-missing routing control. Tests added first (`qa/red-routing-malformed.txt`):
   ```
   × returns bounded errors instead of throwing when rows are null or wrong types   TypeError: Cannot read properties of null (reading 'id')
   × lets the campaign owner assign a reviewer to an unrouted item …                TypeError: routeItem is not a function
   × rejects routing to an identity that is not in the fixture …
   Tests 3 failed | 18 passed (21)
   ```
   then `validateFixture` was rewritten with row guards and `routeItem` was implemented → all pass.

5. Sixth-Fable review (2026-10-01) reproduced self-certification: delegation to the identity under review, delegation to a leaver, and demo items where reviewer = holder. Six failing tests were added first (`qa/red-self-review.txt`: `6 failed | 22 passed`), then routing, `applyDecision`, `routeItem` and `validateFixture` were hardened → `39 passed` (`qa/green-self-review.txt`). The demo now has 12 unrouted items (manager/owner-held access) carrying a `self_review` hint; the browser workflow confirms the delegate dropdown no longer offers the reviewed identity.

## Final test run

```
$ npm test
 ✓ src/engine/safe.test.ts (10 tests)
 ✓ src/fixtures/validate-demo.test.ts (1 test)
 ✓ src/engine/campaign.test.ts (28 tests)
 Test Files  3 passed (3)
      Tests  39 passed (39)
```

## Build

```
$ npm run build
> tsc --noEmit -p tsconfig.json && vite build
✓ built in ~1.4s   dist/assets/index-*.js 282.60 kB (gzip 82.21 kB), index-*.css 14.92 kB, self-hosted woff2 fonts
```

`npm ci` from a clean `node_modules` was re-run at the end of the track build (see `../HANDOFF.md` for the consolidated clean-install log).

## Browser workflow (Chromium via Playwright, `qa/workflow.mjs`, `vite preview` on :6140)

Recorded in `qa/screens/workflow-log.txt`:

- Approve a flagged leaver entitlement without a reason → `A reason is required because this entitlement carries risk hints.`
- Add reason, Revoke → `Revoked prod.admin for Ada Placeholder.` (stamp rendered, `02-after-revoke.png`)
- Acting as the Finance manager, approve `payroll.approve` for Dalia Example, then approve the counterpart `payroll.create` without override → `Approving this would leave both sides of "sod-payroll" approved. Record an SoD override rationale …`; with rationale → approved and logged as SoD override (`03-sod-override.png`).
- Keyboard: focus row, Space, ArrowDown, Space → `2 selected`; Revoke selected → `2 items revoked with one shared reason.`
- Route an unrouted legacy-share item as campaign owner → logged as delegation by `campaign-owner`.
- Export CSV → 147 lines (header + 146 items), header `item,entitlement,identity,status,resource,privilege,reviewer,state,risk,hints,decision_reason,sod_override`. Export JSON → `schema=attestline.certification/v1`, 6 decisions, 5 decided.
- Invalid import (`{"schemaVersion":1,"identities":[null]}`) → bounded error list shown inline (`04-import-error.png`), no crash.
- Viewports: `mobile scrollWidth=375 viewport=375`, `tablet scrollWidth=768 viewport=768`; `pageErrors=[]`.

Axe audit (`qa/audit/browser-audit.json`): 0 page errors, 0 failed requests at all three viewports; the single `color-contrast` finding (footer note) was fixed afterwards by darkening `--muted` to `#5b6472`.

## Measured facts usable in a resume bullet (no inflation)

- 39 automated tests (28 engine, 10 input-safety, 1 fixture) run in under 1 s.
- Synthetic fixture: 50 identities, 11 resources, 147 entitlements, 3 SoD rules, 6 hint types.
- `npm audit`: 0 known vulnerabilities on 2026-10-01.
- Bundle: ~283 kB JS (82 kB gzip) including React, with all fonts self-hosted.
