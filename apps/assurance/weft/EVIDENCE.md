# Evidence — Weft

Measured 2026-10-01, Node v20.20.1 / npm 10.8.2.

## RED → GREEN

1. 24 tests written first (`tests/engine.test.ts`); stubs throwing `not implemented`.
2. RED (`qa/red-engine.txt`): **23 failed | 1 passed (24)** — the sha256 oracle test passed because the hash module was reused from Packetsmith.
3. Engine + validator + fixture → **23 passed, 1 failed**: the test wrongly expected `rootMatches=false` when the *bundle* drifted. `rootMatches` means the manifest is self-consistent; `intact` is the bundle-vs-manifest result. The test was corrected to the intended semantics (documented in README).
4. GREEN: `Tests 24 passed (24)`.
5. Parent source review found two real integrity gaps: `verifyManifest` ignored assertions appended after the manifest was built (`intact` stayed true), and the binding hash covered only the *set of content hashes*, so re-dating (`capturedOn`) or renaming a linked artifact changed its support without invalidating the sign-off. Five regression tests were written first and seen failing (`qa/red-engine.txt`, 5 failed | 24 passed), then: binding hash v2 binds `{id, capturedOn, sha256}` per linked artifact; verification adds `missingAssertions` / `addedAssertions` and folds them into `intact`; the fixture generator was updated to the v2 binding (the fixture test caught the stale hashes first). GREEN: **`Tests 29 passed (29)`** (`qa/green-engine.txt`). Build re-run `✓ built`.

## Build / audit

`npm run build` → `✓ built`. `npm audit` → `found 0 vulnerabilities`.

## Browser QA (http://127.0.0.1:6123/)

- `tools/browser_audit.mjs` (parent harness, *not part of this repository* — see the Artefact inventory at the end of this file): first run **0 axe violations** but tablet/mobile page overflow (1107/1023 px) because grid children lacked `min-width: 0`; fixed. Final (re-run after the review fix with `CHROMIUM_EXECUTABLE_PATH` chromium-1217): **0 violations, 0 page errors, page scroll width = viewport at 1440 / 768 / 375** (the weave table scrolls inside a focusable region).
- `qa/workflow.mjs` (imports `playwright` from an external install that is not a dependency of this app, so it is not runnable from this repository alone): **25/25** (one check added: appending an assertion and re-verifying reports `assertion added (unbound): AS-07`) — stale sign-off shown invalid; ledger lists all 8 planted defect kinds; clearing the stale sign-off and unlinking the out-of-period artifact makes AS-02 supported; sign-off recorded as valid; editing AR-03 content changes its hash, shows declared mismatch and invalidates the AS-02 sign-off; signing a weak assertion refused; manifest generated (root + 10 entries); verify → intact; after editing AR-01, verify → `modified: AR-01`; diff against the original bundle lists changed artifacts; keyboard Enter on a knot links an orphan and clears the finding; malformed import rejected with ≥ 4 path-addressed issues; no console errors; mobile no overflow. Screenshots `qa/screens/01…06`.

## Sixth review fixes (test-first)

The sixth review round's adverse-input repro script (2026-10-01; not part of this repository — see the Artefact inventory) showed: after `buildManifest`, deleting the AS-01 sign-off, swapping its reviewer to `mallory`/back-dating to 2020, or renaming a linked artifact left `intact === true`. Seven regression tests first — RED **7 failed | 29 passed** (`qa/red-engine.txt`). Fix: manifest schema `weft.manifest/2`; root = SHA-256 over canonical `{v:2, bundleName, entries (incl. names), bindings, signoffs}`; `verifyManifest` adds `renamed`, `signoffsChanged` (added/removed/re-attributed/re-dated/re-bound, both directions) and `bundleNameChanged`, all folded into `intact`; validator accepts only v2 and explains why v1 is refused. UI lists the new fields. GREEN **36 passed (36)**. Build ✓; workflow **27/27** (two new checks: manifest v2 binds sign-offs; removed sign-off detected); axe 0. The sign-off itself still cannot prove *who* signed (no keys) — the manifest now proves the sign-off record has not changed since the manifest was generated.

## Resume-usable measured facts

(Counts below are as measured on 2026-10-01 before the sixth review fixes; the suite was 36 tests after them and is 53 tests after the October 2026 round — see the section at the end of this file.)

29 unit tests (test-first, incl. 5 review-driven regressions); 9 lineage finding kinds; order-independent binding hashes over evidence id + capture date + content; manifest root + verification detecting modified/missing/added artifacts, binding changes and added/removed assertions; 0 axe violations at 3 viewports.

## Not claimed

No digital signatures or key management; no binary artifacts; no real evidence.

## Upgrade round — October 2026 (lab-wide)

Measured on 2026-10-04 in the build sandbox: Node v20.20.1, npm 10.8.2, Linux. All commands were run from this app's own directory; result lines are quoted verbatim. Nothing below was run in a browser.

### Toolchain (contract C2): Vite 6 → 7, @vitejs/plugin-react 4 → 5

`package.json`: `vite ^6.4.0 → ^7.3.6`, `@vitejs/plugin-react ^4.7.0 → ^5.2.0`. Unchanged: `vitest ^4.1.11`, `typescript ^5.9.0`, `react`/`react-dom ^19.2.0`, `@types/node ^20.19.43`, `engines.node >=20.19`.

1. `npm install --ignore-scripts --no-fund --no-audit` → `changed 6 packages in 10s` (exit 0). **`--legacy-peer-deps` was not needed.**
2. `npm ci --ignore-scripts --no-fund --no-audit` from the regenerated lockfile → `added 99 packages in 9s` (exit 0). The lockfile was regenerated by npm only, never hand-edited.
3. Lockfile now resolves `vite 7.3.6`, `@vitejs/plugin-react 5.2.0`, `esbuild 0.28.2` (was 0.25.12); `rollup 4.63.6`, `vitest 4.1.11`, `typescript 5.9.3`, `react`/`react-dom 19.3.0` unchanged. `public/THIRD_PARTY_LICENSES.txt` lists production dependencies only (unchanged by this bump); `THIRD_PARTY_NOTICES.md` versions updated.

### Hygiene (contracts C1, C3)

- `vercel.json` now carries the lab-wide canonical header set exactly: it adds `Strict-Transport-Security: max-age=63072000; includeSubDomains`; the CSP and the other six headers were already identical. `AUDIT.md` → "Security headers" lists the set and states why `form-action 'none'` is safe here (every form calls `preventDefault()`).
- `index.html` `<meta name="color-scheme">` changed from `light dark` to `dark`: `src/ui/styles.css` declares `color-scheme: dark`, has no `prefers-color-scheme` query, and the `html` background is `#101418`.

### Formula-safe CSV export (test-first)

**RED.** `tests/csv.test.ts` (11 tests) was written first against a stub `src/engine/csv.ts` exporting the final signatures with placeholder returns (`''`, `[]`), so the suite collected and failed on assertions, not on a missing module:
`npx vitest run --reporter=verbose tests/csv.test.ts` → `Test Files  1 failed (1)` / `Tests  11 failed (11)` — e.g. `expected '' to be '"a","b"\r\n"1","2"'`, `expected undefined to deeply equal [ 'kind', 'severity', 'refs', …(1) ]`, `expected [] to deeply equal [ 'AR-01', 'AR-02', 'AR-03', …(7) ]`. Saved verbatim as `qa/red-csv.txt`.

What the tests pin: RFC 4180 quoting with CRLF; `= + - @` prefixes neutralised, also behind leading spaces, tabs, carriage returns, newlines and NUL bytes; cells that merely start with a tab or CR prefixed; embedded quotes doubled and commas/newlines kept inside the cell; ledger CSV header `kind, severity, refs, message` with one row per finding in ledger order and refs joined with `; `; hostile artifact ids/names pushed through `analyze()` arrive neutralised in refs and messages; artifact CSV header `id, name, kind, capturedOn, sha256, bytes, declaredMatches, duplicateOf, linkedAssertions`, rows sorted by id, `yes` / `no` / `none declared` for the declared-hash check; the Harbourline fixture yields ten rows with the planted mismatch (AR-05), duplicate (AR-06 = AR-07) and orphan (AR-09) visible, deterministically.

### Validation audit (no behaviour change)

`tests/validation.test.ts` (5 tests) checks what the lab contract requires of every import path: strict calendar dates — `2026-02-30` rejected with the exact path in `asOf`, `assertions[].periodStart`, `assertions[].periodEnd`, `artifacts[].capturedOn`, `signoffs[].signedOn` and in manifest `generatedOn` / `signoffs[].signedOn`; `2026-04-31`, `2027-02-29`, `2026-13-01`, non-padded and timestamp forms rejected; real leap days accepted — and a 20 000-deep hostile nesting (root array, and deep objects/arrays inside `assertions[0].id`, `artifacts`, `links`, manifest `entries`) refused with path-addressed issues and no stack overflow. Run against the **unchanged** `src/engine/validate.ts`:
`npx vitest run --reporter=verbose tests/validation.test.ts` → `Test Files  1 passed (1)` / `Tests  5 passed (5)` (saved as `qa/audit-validation.txt`). Both properties already held (`isIsoDate` round-trips through `Date.UTC`/`toISOString`; the validator reads named keys with `typeof` checks and never recurses into unknown structure, and V8's `JSON.parse` is iterative), so no fix and therefore no RED run exists for this audit — the tests are regression guards. A sixth test was added afterwards: the committed synthetic sample `qa/samples/invalid-bundle-calendar-date.json` (periodStart `2026-02-30`, capturedOn `2026-04-31`, signedOn `2027-02-29`) must be rejected with exactly `assertions[0].periodStart`, `artifacts[0].capturedOn` and `signoffs[0].signedOn`; the sample exists so the UI import-rejection path can be exercised with a file that is in the repository. It is covered by the full GREEN run below (the 5-test capture above predates it).

### GREEN (full suite)

After implementing `src/engine/csv.ts` (`toCsv`, `findingsToCsvRows`, `artifactsToCsvRows`) and wiring the two buttons: `npx vitest run --reporter=verbose` → `Test Files  3 passed (3)` / `Tests  52 passed (52)` = 36 engine + 11 csv + 5 validation. The fixture tests were then strengthened (ledger = 11 findings, 4 high, the four high rows in order; no count change) and the sixth validation test added, and the full suite re-run: `Test Files  3 passed (3)` / `Tests  53 passed (53)` = 36 + 11 + 6, saved verbatim as `qa/green-csv.txt`. No existing test was weakened. Documentation correction: the README quickstart still said "29 tests" although the suite had been 36 since the sixth review fixes above; it now states the measured 53.

Test label wording (no behaviour change): the `describe` label of the earlier review-regression group in `tests/engine.test.ts` and three of its `it` labels ("external repro A/B/C") were reworded to neutral text ("sixth-review regressions …") in this round; the seven assertions and the counts are unchanged. `qa/red-engine.txt` is the historical RED run from 2026-10-01; on 2026-10-04 the seven group labels in its failure lines were neutralised in place and a one-line header note was inserted (text only — test ids, results and counts unchanged). `qa/green-engine.txt` never contained the label. One comment in `qa/workflow.mjs` was reworded the same way (no selector changed).

### Final gates (after the CSV UI)

- `npm run build` (`tsc -p tsconfig.json && vite build`; the tsc step typechecks `src` and `tests`) → `vite v7.3.6 building client environment for production...` … `dist/assets/index-6kW1G6Hk.js  265.75 kB │ gzip: 83.22 kB` … `✓ built in 4.96s`. Re-run after the committed-sample test was added (no `src/` change): same bundle hash, `✓ built in 4.38s`.
- `npm audit --audit-level=high` → `found 0 vulnerabilities` (lockfile unchanged since).

### Accessibility of the new UI (computed, not browser-measured)

No new colour token. "Export findings CSV" is a ghost button in the ledger header (text `--text #e6e9ec` on the panel `#171c22` → 14.06:1; border `--line-2`); "Export artifacts CSV" is a default button in the bundle-actions group (text `--text #e6e9ec` on `--panel-2 #1e252d` → 12.69:1). Both are native `<button>`s (keyboard operable, visible `--accent` focus outline inherited; the `prefers-reduced-motion` rule is global). Ratios computed with the WCAG 2.1 relative-luminance formula. **Not measured:** no axe/Playwright run was performed from this repository in this round; the `qa/` screenshots and `qa/workflow.mjs` predate the two buttons.

### Artefact inventory

Relative paths mentioned in `README.md`, `AUDIT.md`, this file or `INTERVIEW_GUIDE.md` that are **not** in the repository, with the reason:

- `tools/browser_audit.mjs` — the parent's external review harness (Playwright + axe); not part of this repository. Its kept outputs are in `qa/audit/` (JSON + screenshots).
- The sixth review's adverse-input repro script (cited under "Sixth review fixes") — external review material, not part of this repository and not retained here. The behaviour it reproduced is pinned by the sixth-review regression tests in `tests/engine.test.ts`.
- `qa/workflow.mjs` — present, but it imports `playwright` from an external `NODE_PATH` install (not a dependency of this app); it is not runnable from this repository alone and was not re-run in this round.
- `qa/screens/01…06` — shorthand for the six committed screenshots `qa/screens/01-desktop-initial.png` … `qa/screens/06-mobile.png`; they predate the October 2026 UI changes.
- `CHROMIUM_EXECUTABLE_PATH` — an environment variable of the external harness, not a file.
