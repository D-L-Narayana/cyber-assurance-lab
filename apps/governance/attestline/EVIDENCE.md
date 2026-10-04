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

5. Sixth review (2026-10-01) reproduced self-certification: delegation to the identity under review, delegation to a leaver, and demo items where reviewer = holder. Six failing tests were added first (`qa/red-self-review.txt`: `6 failed | 22 passed`), then routing, `applyDecision`, `routeItem` and `validateFixture` were hardened → `39 passed` (`qa/green-self-review.txt`). The demo now has 12 unrouted items (manager/owner-held access) carrying a `self_review` hint; the browser workflow confirms the delegate dropdown no longer offers the reviewed identity.

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

- 39 automated tests (28 engine, 10 input-safety, 1 fixture) run in under 1 s. *(Superseded in October 2026: 48 tests in 4 files — see below.)*
- Synthetic fixture: 50 identities, 11 resources, 147 entitlements, 3 SoD rules, 6 hint types.
- `npm audit`: 0 known vulnerabilities on 2026-10-01.
- Bundle: ~283 kB JS (82 kB gzip) including React, with all fonts self-hosted. *(October 2026 build: 288.63 kB JS, 83.95 kB gzip.)*

## Upgrade round — October 2026 (lab-wide)

Commands were run on 2026-10-04 in this directory with Node v20.20.1 / npm 10.8.2, through a thin wrapper that only
sets `CI=1`/`NO_COLOR=1` and writes the verbatim output to the named `qa/*.txt` file (each capture starts with the
exact command line, the UTC timestamp, the Node version and the exit code). Lines quoted below are copied from those
captures. Paths are repo-relative. The pre-existing `qa/screens/*.png`, `qa/screens/workflow-log.txt` and
`qa/audit/browser-audit.json` were **not** regenerated: no browser run was performed in this round, so they predate
the "Close campaign" button, the closed banner and the masthead digest.

### Hygiene (contracts C1–C3)

- `vercel.json` now carries the canonical lab-wide header set (CSP `default-src 'none'` with explicit `'self'` sources,
  `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; nosniff, DENY, no-referrer,
  Permissions-Policy, COOP, CORP, HSTS); AUDIT.md "Security headers" describes it. `form-action 'none'` was checked
  against `src/ui/App.tsx`: the only `<form>` calls `preventDefault()`.
- `package.json` gained `"engines": { "node": ">=20.19" }`.
- `index.html` `color-scheme` changed from `light dark` to `light` — `src/styles.css` paints `html, body` with
  `--paper: #f3f5f7` (bone grey) and has no `prefers-color-scheme` query.

### Test-first: campaign closure and certification digest

1. `src/engine/closure.test.ts` (9 tests) was written first. `campaign.ts` exported the minimal API with placeholder
   behaviour (`closeCampaign` → `{ ok: false, error: 'not implemented' }`, `canonicalJson` → plain `JSON.stringify`,
   `certificationDigest` → `''`, no closed guards), so every failure is an assertion failure, not an import error.
   `npx vitest run --reporter=verbose` → `qa/red-close-digest.txt`:
   ```
    × src/engine/closure.test.ts > closeCampaign > refuses to close while items are pending unless the closer acknowledges them, and then records the pending count
      → expected 'not implemented' to match /4 items are still pending/
    × src/engine/closure.test.ts > a closed campaign accepts no further changes > applyDecision, bulkDecision and routeItem refuse with a "Campaign is closed" error
      → expected true to be false // Object.is equality
    × src/engine/closure.test.ts > certification digest > canonicalJson sorts object keys at every depth and leaves arrays in order
      → expected '{"b":1,"a":{"d":[3,{"z":1,"y":2}],"c"…' to be '{"a":{"c":null,"d":[3,{"y":2,"z":1}]}…' // Object.is equality
    × src/engine/closure.test.ts > certification digest > is a 64-hex SHA-256 that is stable run-to-run and across key order
      → expected '' to match /^[0-9a-f]{64}$/
    Test Files  1 failed | 3 passed (4)
         Tests  8 failed | 40 passed (48)
   ```
   (The ninth new test — the same inputs succeed on an *open* campaign — passed on the stub by design: it exists to
   prove the later refusals are caused by the closure alone.)
2. Implemented `closeCampaign`, the `closed` guards in `applyDecision`/`routeItem`/`bulkDecision`, `canonicalJson`,
   `certificationDigest` (SHA-256 via `crypto.subtle`), `exportCertificationWithDigest`, and `closed` in the export.
   `npx vitest run --reporter=verbose` → `qa/green-close-digest.txt`:
   ```
    Test Files  4 passed (4)
         Tests  48 passed (48)
   ```
   The file split is 28 (`campaign.test.ts`) + 9 (`closure.test.ts`) + 10 (`safe.test.ts`) + 1 (`validate-demo.test.ts`).
   After the RED run, one `describe` title in `campaign.test.ts` was renamed to the neutral label
   `self-review guards (sixth review)` (label text only — no assertion, id or count changed). The RED capture was
   patched afterwards by a label-rename script to the same wording and carries a header note stating that labels were
   renamed after capture; the GREEN capture was re-recorded after the rename, so it is a byte-exact capture.

### Build and audit

`npm run build` → `qa/build-2026-10.txt`:
```
> tsc --noEmit -p tsconfig.json && vite build
dist/assets/index-Cq4LBcEC.css                                            15.92 kB │ gzip:  3.51 kB
dist/assets/index-CoD0wFW_.js                                            288.63 kB │ gzip: 83.95 kB
✓ built in 5.30s
```
The build's first step is the project's own typecheck (`tsc --noEmit -p tsconfig.json`, which covers `src/**` including
the tests and `vite.config.ts`); it reported no errors.

`npm audit --audit-level=high` → `qa/audit-2026-10.txt`:
```
found 0 vulnerabilities
```

### Accessibility of the new UI (not browser-measured)

No axe run was performed in this round; the statements below are from reading the code and computing WCAG ratios by
hand (sRGB relative luminance, (L1+0.05)/(L2+0.05)):

- "Close campaign" is a `<button aria-expanded aria-controls="close-panel">`; the panel is a labelled `<section>` with a
  labelled `<textarea>`, a labelled acknowledgement checkbox (only rendered when items are pending), and "Confirm
  close"/"Cancel" buttons. All are native controls, keyboard operable, with the existing `:focus-visible` ring.
- The closed banner is `role="status"` text, not colour alone ("Campaign closed by … on …"). It reuses the existing
  `.notice.warn` token: `#7a5200` on `#fff9e8` = **6.58:1**.
- The masthead digest uses `--graphite #4b5563` on the white panel = **7.56:1**; the "certification digest" label
  inherits the same colour.
- No animation was added, so `prefers-reduced-motion` behaviour is unchanged.
- Decision/bulk/route buttons are `disabled` once closed and the engine refuses regardless of the UI state.

### Referenced files

Present in this repository: `qa/red-campaign-stub.txt`, `qa/red-campaign.txt`, `qa/red-safe-hardening.txt`,
`qa/red-routing-malformed.txt`, `qa/red-self-review.txt`, `qa/green-self-review.txt`, `qa/clean-ci.txt`,
`qa/screens/workflow-log.txt`, `qa/audit/browser-audit.json`, `qa/workflow.mjs`, `scripts/generate-fixture.mjs`,
`src/fixtures/demo.json`, and this round's `qa/red-close-digest.txt`, `qa/green-close-digest.txt`,
`qa/build-2026-10.txt`, `qa/audit-2026-10.txt`.

The two pre-existing captures `qa/red-campaign-stub.txt` and `qa/red-campaign.txt` quoted, in their vitest `RUN`
banner, the working directory of the original build environment rather than a repository path. On 2026-10-04 that
prefix was replaced by the marker `<original-build>/` and a header note was inserted saying so; results, counts and
test ids are unchanged.

### Artefact inventory

Relative paths referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE that are **not** in this repository, with the reason:

- `../_qa/audit.mjs` (AUDIT.md, "Accessibility check") — an external browser-audit harness that lived outside this app
  in the original working tree; it is not part of this repository. Its results survive only as the committed
  browser-audit JSON named in the "Referenced files" paragraph and the prose above.
- `../HANDOFF.md` (EVIDENCE.md, "Build") — a track-level handoff note outside this app; not part of this repository.
  The clean-install log it pointed to is retained in this app as the clean-ci capture named above.
- `playwright` (imported by the browser workflow script) — an external package, deliberately not a dependency of this
  app; the script expects it on `NODE_PATH`. It was not run in this round.
