# EVIDENCE — Pathcaster

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Test-first (RED → GREEN)

1. `src/engine/graph.test.ts` (13 tests) written against a stub whose exports throw `not implemented`. First run (`qa/red-graph.txt`): **13 failed (13)**.
2. Before implementing, reviewing the test fixture showed my own cycle construction (`All staff → Engineering`) would have nested every group inside engineering and made the engineering deny apply to everyone; the fixture was corrected to a harmless `Cycle A ↔ Cycle B` pair and the what-if expectation recomputed by hand (`before 1 → after 0`). After implementing `graph.ts`: **23 passed** on the first run.
3. Demo-fixture test initially failed because the seeded "payroll write + warehouse read" identity was in the wrong department; the generator was fixed (`u-001` added to engineering) → **24 passed**.

4. Sixth-Fable review (2026-10-01) showed `blockedByCondition` paths were unbounded: a schema-valid 60-node/359-edge graph exhausted a 3 GB heap. Six failing tests were added first (`qa/red-budget.txt`: `3 failed | 15 passed` — three of the new tests happened to pass on the old code), then budgets and `indeterminate` semantics were implemented → `30 passed` (`qa/green-budget.txt`). The reviewer's 8×7 graph now returns `indeterminate` in well under a second instead of crashing.

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

- 30 automated tests; graph of 92 nodes / 125 edges; deny-override, ABAC, cycle and traversal-budget cases covered.
- Lane diagram renders only query-relevant nodes; identity table hides no-path identities by default.
