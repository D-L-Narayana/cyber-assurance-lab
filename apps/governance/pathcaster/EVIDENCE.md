# EVIDENCE — Pathcaster

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/graph.test.ts` (13 tests) written against a stub whose exports throw `not implemented`. First run (`qa/red-graph.txt`): **13 failed (13)**.
2. Before implementing, reviewing the test fixture showed my own cycle construction (`All staff → Engineering`) would have nested every group inside engineering and made the engineering deny apply to everyone; the fixture was corrected to a harmless `Cycle A ↔ Cycle B` pair and the what-if expectation recomputed by hand (`before 1 → after 0`). After implementing `graph.ts`: **23 passed** on the first run.
3. Demo-fixture test initially failed because the seeded "payroll write + warehouse read" identity was in the wrong department; the generator was fixed (`u-001` added to engineering) → **24 passed**.

4. Sixth review (2026-10-01) showed `blockedByCondition` paths were unbounded: a schema-valid 60-node/359-edge graph exhausted a 3 GB heap. Six failing tests were added first (`qa/red-budget.txt`: `3 failed | 15 passed` — three of the new tests happened to pass on the old code), then budgets and `indeterminate` semantics were implemented → `30 passed` (`qa/green-budget.txt`). The reviewer's 8×7 graph now returns `indeterminate` in well under a second instead of crashing.

## Final test run (clean `npm ci`, see `qa/clean-ci.txt`)

```
$ npm test
 ✓ src/engine/safe.test.ts (10 tests)
 ✓ src/fixtures/validate-demo.test.ts (1 test)
 ✓ src/engine/graph.test.ts (19 tests)
 Test Files  3 passed (3)
      Tests  30 passed (30)
```

## Build

`npm run build` → `tsc --noEmit` clean (after removing one unused parameter flagged by `noUnusedParameters`), `vite build ✓`. `npm audit`: 0 vulnerabilities.

## Browser workflow (`qa/workflow.mjs`, Chromium, vite preview :6143) — `qa/screens/workflow-log.txt`

- Initial query Production account/any: `3 identities can reach … · 1 have a path but are blocked by an explicit deny · 45 have no path` (92 nodes, 125 edges).
- Action = admin: `1 identity can reach … · 1 blocked by explicit deny · 47 none`.
- Denied contractor: `Deny override: No production admin for contractors (edge e-055, from Contractors). || Lena Sample is a member of Legacy admins (2019) is assigned the role Production admin which grants prod:admin on Production account.` (`02-deny-override.png`)
- Payroll DB/admin, MFA-blocked lead: `Blocked by condition: Ximena Placeholder is a member of Finance leads is assigned the role Payroll approver (only when mfa is true) … — failed: mfa is false.` (`03-condition-blocked.png`)
- Toxic combinations include payroll SoD hits and `Caius Fixture — Production admin + vault read`; hotspot #1 `Engineering team group 12 id · 2 hi`.
- What-if removing `Legacy admins assigned Production admin`: `Allowed before 1 → after 0. Loses access: Caius Fixture.`; applied → `0 identities can reach Production account (admin)`, 124 edges.
- Export JSON `pathcaster.review/v1` with 49 identities and 22 hotspots; CSV 50 lines.
- Invalid import (self loop) → `Graph rejected: edge e: self loop`.
- First audit found `color-contrast` on the grey `none` pill, `nested-interactive` (focusable identity nodes inside `svg[role=img]`) and mobile page overflow (542 px) from the wide identity table. Fixed by darkening `--none`, switching the SVG to `role="group"`, and wrapping the table in a scroll container. Re-run: `mobile scrollWidth=375`, `tablet 768`, `pageErrors=[]`, axe **0 violations** at 1440/768/375.

## Measured facts for resume use

- 30 automated tests; graph of 92 nodes / 125 edges; deny-override, ABAC, cycle and traversal-budget cases covered. *(Superseded in October 2026: 39 tests in 4 files — see below.)*
- Lane diagram renders only query-relevant nodes; identity table hides no-path identities by default.

## Upgrade round — October 2026 (lab-wide)

Commands were run on 2026-10-04 in this directory with Node v20.20.1 / npm 10.8.2, through a thin wrapper that only
sets `CI=1`/`NO_COLOR=1` and writes the verbatim output to the named `qa/*.txt` file (each capture starts with the
exact command line, the UTC timestamp, the Node version and the exit code). Lines quoted below are copied from those
captures. Paths are repo-relative. The pre-existing `qa/screens/*.png`, `qa/screens/workflow-log.txt` and
`qa/audit/browser-audit.json` were **not** regenerated: no browser run was performed in this round, so they predate
the hierarchy checkbox.

### Hygiene (contracts C1–C3)

- `vercel.json` now carries the canonical lab-wide header set (CSP `default-src 'none'` with explicit `'self'` sources,
  `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; nosniff, DENY, no-referrer,
  Permissions-Policy, COOP, CORP, HSTS); AUDIT.md "Security headers" describes it. `form-action 'none'` was checked
  against `src/ui/App.tsx`: there is no `<form>` element.
- `package.json` gained `"engines": { "node": ">=20.19" }`.
- `index.html` `color-scheme` changed from `light dark` to `light` — `src/styles.css` paints `html, body` with
  `--paper: #dce8f5` (pale blue blueprint ground) and has no `prefers-color-scheme` query.

### Test-first: optional permission hierarchy (admin ⊃ write ⊃ read)

1. `src/engine/hierarchy.test.ts` (9 tests) was written first against stubs that accepted the new `opts` parameter on
   `reach`/`hotspots`/`toxicCombinations`/`whatIfRemoveEdge` but ignored it and always reported `hierarchy: false`, so
   every failure is an assertion failure, not an import error. `npx vitest run --reporter=verbose` →
   `qa/red-hierarchy.txt`:
   ```
    × src/engine/hierarchy.test.ts > permission hierarchy option (admin ⊃ write ⊃ read), October 2026 round > with hierarchy, admin satisfies write and read and write satisfies read; nothing is implied upwards
      → expected false to be true // Object.is equality
    × src/engine/hierarchy.test.ts > permission hierarchy option (admin ⊃ write ⊃ read), October 2026 round > a deny on the admin permission still blocks the read that the admin permission would have satisfied, and the path names that permission
      → expected 'none' to be 'deny' // Object.is equality
    × src/engine/hierarchy.test.ts > permission hierarchy option (admin ⊃ write ⊃ read), October 2026 round > what-if counts respect the option and record it
      → expected { removedEdgeId: 'e-admin', …(7) } to match object { hierarchy: true, before: 3, …(3) }
    Test Files  1 failed | 3 passed (4)
         Tests  5 failed | 34 passed (39)
   ```
   Four of the nine new tests passed on the stub by design — they pin what must *not* change (default and explicit
   `false` identical on the unit graph and the shipped fixture, `any` queries unaffected, hotspots unchanged,
   determinism / never-narrowing).
2. Implemented `actionSatisfies` at the asset step of the search, threaded `opts` through the four functions, added
   `hierarchy` to `ReachResult`/`WhatIf`/`ReviewExport.query` and the summary wording. `npx vitest run
   --reporter=verbose` → `qa/green-hierarchy.txt`:
   ```
    Test Files  4 passed (4)
         Tests  39 passed (39)
   ```
   The file split is 19 (`graph.test.ts`) + 9 (`hierarchy.test.ts`) + 10 (`safe.test.ts`) + 1 (`validate-demo.test.ts`).
   After the RED run, one `describe` title in `graph.test.ts` was renamed to the neutral label
   `traversal budget (sixth review: blocked paths were unbounded)` (label text only — no assertion, id or count
   changed). The RED capture was patched afterwards by a label-rename script to the same wording and carries a header
   note stating that labels were renamed after capture; the GREEN capture was re-recorded after the rename, so it is a
   byte-exact capture.

### Build and audit

`npm run build` → `qa/build-2026-10.txt`:
```
> tsc --noEmit -p tsconfig.json && vite build
dist/assets/index-DGDQdL39.css                                     13.08 kB │ gzip:  4.92 kB
dist/assets/index-bTjJpbwc.js                                     265.04 kB │ gzip: 81.09 kB
✓ built in 5.04s
```
The build's first step is the project's own typecheck (`tsc --noEmit -p tsconfig.json`, covering `src/**` including the
tests and `vite.config.ts`); it reported no errors.

`npm audit --audit-level=high` → `qa/audit-2026-10.txt`:
```
found 0 vulnerabilities
```
(The CSS figure above is superseded by the font-asset follow-up below; the JS bundle is unchanged.)

### Production CSP and font assets (follow-up, 2026-10-04)

The lead's browser survey served the built `dist/` with this app's own `vercel.json` response headers and measured,
on every load in both viewports, two CSP violations and one console error: Vite had inlined one font subset smaller
than its 4 KiB default as a `url(data:font/woff2;base64,…)` inside the compiled stylesheet, and `font-src 'self'`
(no `data:`) blocks it. Before the change, `grep -c "data:font" dist/assets/*.css` printed `1` for this app. The CSP
was **not** widened; instead `vite.config.ts` now sets `build.assetsInlineLimit: 0` so every asset ships as a file.
Rebuilt with `npm run build` → `qa/build-fonts-2026-10.txt`:
```
> tsc --noEmit -p tsconfig.json && vite build
dist/assets/index-CFJe3VxR.css                                       10.41 kB │ gzip:  2.65 kB
dist/assets/index-BVbfQWh9.js                                       265.04 kB │ gzip: 81.09 kB
✓ built in 2.26s
```
The stylesheet shrank from 13.08 kB to 10.41 kB (the formerly inlined subset is now one more `.woff2` file in
`dist/assets/`) and `grep -c "data:font" dist/assets/*.css` now prints `0`. The repository-level dist checker
(`check-dist`) reports the rebuilt output as OK, and the suite was re-run afterwards →
`qa/green-final-2026-10.txt`:
```
 Test Files  4 passed (4)
      Tests  39 passed (39)
```
Whether the production CSP is now honoured in a real browser is measured by the lead's harness, not by this document.

### Accessibility of the new UI (not browser-measured)

No axe run was performed in this round; the statements below come from reading the code and computing WCAG ratios by
hand (sRGB relative luminance, (L1+0.05)/(L2+0.05)):

- The toggle is a native `<input type="checkbox">` inside a `<label>` ("Treat admin as implying write/read"), so it is
  named, keyboard operable and gets the existing `:focus-visible` ring.
- Its label uses `--ink #1f2a6b` on the query bar's effective background (≈ `#e5eef8`: the 70 % `#e9f1fa` overlay on
  `#dce8f5`) = **11.2:1**. The pre-existing `.field` labels in the same bar use `--ink-soft`, which sits at ≈ 4.5:1 on
  that ground; the new label deliberately does not reuse it.
- State is not conveyed by colour: the summary sentence gains "Permission hierarchy applied: admin ⊃ write ⊃ read …"
  while the option is on, and the export says so in `summary` and `query.hierarchy`.
- No animation was added, so `prefers-reduced-motion` behaviour is unchanged.

### Referenced files

Every relative path referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE resolves in this repository:
`qa/red-graph.txt`, `qa/red-budget.txt`, `qa/green-budget.txt`, `qa/clean-ci.txt`, `qa/screens/workflow-log.txt`,
`qa/audit/browser-audit.json`, `qa/workflow.mjs`, `scripts/generate-fixture.mjs`, and this round's
`qa/red-hierarchy.txt`, `qa/green-hierarchy.txt`, `qa/build-2026-10.txt`, `qa/audit-2026-10.txt`,
`qa/build-fonts-2026-10.txt`, `qa/green-final-2026-10.txt`.

### Artefact inventory

Nothing referenced by the four documents is absent from the repository. The only external dependency of the QA
material is the `playwright` package imported by the browser workflow script — deliberately not a dependency of this
app (the script expects it on `NODE_PATH`); it was not run in this round.
