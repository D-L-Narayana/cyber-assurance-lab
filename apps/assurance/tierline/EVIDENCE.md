# Evidence — Tierline

Measured 2026-10-01, Node v20.20.1 / npm 10.8.2.

## RED → GREEN

1. 29 tests written first against `model.ts`, `assess.ts`, `validate.ts`; stubs throwing `not implemented` so the file collects.
2. RED (`qa/red-engine.txt`): **29 failed (29)**.
3. Implementation + fixture generator → GREEN on the first full run: **29 passed (29)** (`qa/green-engine.txt`). One cosmetic engine tweak afterwards (distance-to-lower-boundary no longer adds 0.01) kept all tests green.

## Build / audit

`npm run build` → `✓ built` (one unused-import TS error fixed). `npm audit` → `found 0 vulnerabilities`.

## Browser QA (http://127.0.0.1:6122/)

- `tools/browser_audit.mjs`: first run → **2 serious axe violations** (`color-contrast` on tier-2 amber text, 7 nodes; `nested-interactive` because the SVG had `role="img"` while containing focusable dots) and **mobile overflow 406 > 375** from the requirements table. Fixed (darker amber `#9a5e05`, SVG `role="group"`, scrollable table region). Second run surfaced `scrollable-region-focusable` → table wrappers made focusable regions (also back-ported to Tessera and Packetsmith). Final: **0 violations, 0 page errors, no overflow at 1440 / 768 / 375**.
- `qa/workflow.mjs`: **20/20** — pre-selected boundary vendor (tier 2 at exactly 35) shows downward flips and ghost dots; changing one answer re-tiers live and shrinks requirements to one row; hard-trigger vendor shows the trigger reason with six valid requirements; adding evidence moves coverage 0% → 17%; adding an exception moves it to 25% (half credit); queue filter and CSV row count match; shifting the assessment date to 2027 increases queue size; malformed import rejected with ≥ 4 path-addressed issues; keyboard Enter on a quadrant dot selects; no console errors; mobile no overflow. Screenshots `qa/screens/01…06`.

## Sixth-Fable review fixes (test-first)

Repro `tl-adverse.mjs`: `issuedOn: 2027-06-01` at asOf 2026-10-01 → `valid`, 609 days left, coverage 1.0; `expiresOn: 2076-01-01` exception → half credit for 50 years. Four regression tests first — RED **4 failed | 29 passed** (`qa/red-engine.txt`). Fix: evidence dated after the assessment date → state `future-dated`, credit 0, queue kind `future-dated-evidence`, and it never shadows an older valid item; `MAX_EXCEPTION_DAYS = 180` — an exception ending later than that → `exception-out-of-policy`, credit 0, queued; the cap sits in `SCORING_NOTE` as a labelled heuristic. Fixture: V-09 gained a future-dated pen test (adversarial). GREEN **33 passed (33)**. Build ✓; workflow 20/20; axe 0.

## Resume-usable measured facts

29 unit tests (test-first); 8-question weighted model with 2 hard triggers and single-answer sensitivity analysis; 9 queue item kinds; 15-vendor synthetic register; 0 axe violations at 3 viewports.

## Not claimed

No real vendors; model weights are illustrative; no cross-browser matrix.
