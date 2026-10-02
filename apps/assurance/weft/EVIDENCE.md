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

- `tools/browser_audit.mjs`: first run **0 axe violations** but tablet/mobile page overflow (1107/1023 px) because grid children lacked `min-width: 0`; fixed. Final (re-run after the review fix with `CHROMIUM_EXECUTABLE_PATH` chromium-1217): **0 violations, 0 page errors, page scroll width = viewport at 1440 / 768 / 375** (the weave table scrolls inside a focusable region).
- `qa/workflow.mjs`: **25/25** (one check added: appending an assertion and re-verifying reports `assertion added (unbound): AS-07`) — stale sign-off shown invalid; ledger lists all 8 planted defect kinds; clearing the stale sign-off and unlinking the out-of-period artifact makes AS-02 supported; sign-off recorded as valid; editing AR-03 content changes its hash, shows declared mismatch and invalidates the AS-02 sign-off; signing a weak assertion refused; manifest generated (root + 10 entries); verify → intact; after editing AR-01, verify → `modified: AR-01`; diff against the original bundle lists changed artifacts; keyboard Enter on a knot links an orphan and clears the finding; malformed import rejected with ≥ 4 path-addressed issues; no console errors; mobile no overflow. Screenshots `qa/screens/01…06`.

## Sixth-Fable review fixes (test-first)

Repro `wf-adverse.mjs`: after `buildManifest`, deleting the AS-01 sign-off, swapping its reviewer to `mallory`/back-dating to 2020, or renaming a linked artifact left `intact === true`. Seven regression tests first — RED **7 failed | 29 passed** (`qa/red-engine.txt`). Fix: manifest schema `weft.manifest/2`; root = SHA-256 over canonical `{v:2, bundleName, entries (incl. names), bindings, signoffs}`; `verifyManifest` adds `renamed`, `signoffsChanged` (added/removed/re-attributed/re-dated/re-bound, both directions) and `bundleNameChanged`, all folded into `intact`; validator accepts only v2 and explains why v1 is refused. UI lists the new fields. GREEN **36 passed (36)**. Build ✓; workflow **27/27** (two new checks: manifest v2 binds sign-offs; removed sign-off detected); axe 0. The sign-off itself still cannot prove *who* signed (no keys) — the manifest now proves the sign-off record has not changed since the manifest was generated.

## Resume-usable measured facts

29 unit tests (test-first, incl. 5 review-driven regressions); 9 lineage finding kinds; order-independent binding hashes over evidence id + capture date + content; manifest root + verification detecting modified/missing/added artifacts, binding changes and added/removed assertions; 0 axe violations at 3 viewports.

## Not claimed

No digital signatures or key management; no binary artifacts; no real evidence.
