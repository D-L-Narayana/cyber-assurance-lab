# EVIDENCE — Permit Matrix

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`. *(October 2026 annotation: the Playwright install and `../_qa/axe-results.json` belong to the parent review harness and are not in this repository — see the artefact inventory at the end of this file.)*

## Test-first record

**RED — src/engine/__tests__/engine.test.ts written before any engine code.** First run (`qa/red-run.txt`). *Paths/labels in the quoted output and in the saved capture were neutralised on 2026-10-04 (the absolute path quoted by the original RED output named the original build environment, not a repository path — it now reads `<original-build>/…`; the file here is `src/engine/__tests__/engine.test.ts`); results unchanged.*

```
FAIL  src/engine/__tests__/engine.test.ts
Error: Cannot find module '../contract' imported from .../src/engine/__tests__/engine.test.ts
Tests  no tests
```

**Second RED (after the parent's early source review), 1 Oct 2026 ~13:02 UTC** — five regression tests were added *before* the fixes and failed as expected (`qa/red-run-review1.txt`):

```
× measures the byte limit in UTF-8 bytes, not UTF-16 code units
× rejects duplicate record ids within a resource
× rejects non-finite numeric field values such as 1e999
× caps servers, builds and flaws per build
× does not throw on absurdly large lists passed as objects
    → expected [Function] to not throw an error but 'RangeError: Maximum call stack size e…' was thrown
Failed Tests 5 | 18 passed (23)
```

The `RangeError` was real: the original depth check spread a 200 000-element array into `Math.max`. It was replaced by an iterative scan.

**GREEN** (`qa/green-run.txt`): 18 passed (18) — first GREEN before the review regressions; 23 passed (23) after them. *The capture's `RUN` banner named the original build environment's absolute path; it was replaced by `<original-build>/…` on 2026-10-04 with a header note; results unchanged.*

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 124 packages in 4s
$ npm run build
✓ built in 1.49s
$ npm test
 Test Files  1 passed (1)
      Tests  23 passed (23)
$ npm audit
found 0 vulnerabilities
```

Total: **23 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions.

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-initial.png` | Start view with demo contract, not yet run |
| `desktop-02-vulnerable-run.png` | 83 cases run against 1.4.0; matrix pins; 4 findings *(predates the October 2026 round — the fixture now yields 89 cases and 5 findings; not re-shot)* |
| `desktop-03-cell-detail.png` | `GET /invoices/{id}` as Member: case ledger with redacted request/response |
| `desktop-04-fixed-run.png` | Same suite on 1.4.1: no findings |
| `desktop-05-import-refused.png` | Import of a contract naming `https://api.victim.example` refused |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json` — not in this repository; see the artefact inventory below). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* 83 authorization cases are generated from the 6-endpoint / 3-role / 4-principal synthetic contract (`generateCases`). *(1 October 2026 measurement; superseded on 4 October 2026 — 89 cases from 7 endpoints, see "Upgrade round — October 2026" below.)*
* Vulnerable build `release/1.4.0`: 52 pass, 15 bypass, 12 mass-assignment, 4 exposure → 4 findings (API1, API5, API3 ×2). Remediated build: 83 pass, 0 findings. *(Superseded on 4 October 2026: 56 / 15 / 14 / 4 → 5 findings; remediated build 89 pass, 0 findings.)*
* Contract limits: 64 KB UTF-8, 40 endpoints, 8 roles, 24 principals, 12 resources, 100 records/resource, depth 6, list length 1000, 4 servers, 8 builds, 40 flaws/build.
* `npm audit` moved from 2 moderate (vitest 3.2.7 / @vitest/mocker, dev-only) to 0 by pinning vitest 4.1.11; no `--force`.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`) — five regression tests added before fixes, all failing at assertion level:

```
× rejects two endpoints with the same method and path template          expected true to be false
× rejects parameter names other than {id} …                             expected true to be false
× routes a literal path to its own endpoint … after a {id} sibling      expected false to be true
× keeps the demo contract self-consistent: list and item scope agree    expected 'same-tenant' to be 'own'
× states in the export that response bodies carry fictional values      .toMatch() … got undefined
Tests  5 failed | 23 passed (28)
```

**GREEN** (`qa/green-run-sixth.txt`): `Tests 28 passed (28)` after: duplicate-route rejection, `{id}`-only paths, literal-first routing, `list-invoices` scope `own`, `dataNote` in the report. Case count remains 83.

Clean checkout re-run (`qa/verify-run.txt`): 28/28, build ok, 0 vulnerabilities. Browser flow re-shot, including `desktop-06-duplicate-route-refused.png`; axe 0 violations.

## Upgrade round — October 2026 (lab-wide)

Node v20.20.1, npm 10.8.2, Linux sandbox, 4 October 2026. Commands were run from this directory (`apps/appsec/permitmatrix`) through the lab's run helper, which saves the verbatim output with the command, timestamp, Node version and exit code as the first lines of each saved `qa/` text file named below (the checkout path is written as `<repo>` in saved files). No browser, Playwright or axe run was performed in this round; the screenshots under `qa/screens/` predate it.

### Hygiene (lab contracts C1–C3)

* `vercel.json` carries the lab-wide canonical header set (`cleanUrls: true`; CSP with `default-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `img-src 'self' data: blob:`, `manifest-src 'self'`; plus `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security`). `AUDIT.md` → "Security headers" describes it. The app has no `<form>` element, so `form-action 'none'` changes nothing.
* `package.json` `engines.node` is `>=20.19` (was `>=20`).
* `index.html` keeps `<meta name="color-scheme" content="light">`; `styles.css` sets `html, body { background: var(--paper) }` = `#f1f4f8`, so the declared scheme matches the palette (verified by reading; unchanged).

### Test-first record

**RED 1** — `npx vitest run --reporter=verbose`, saved as `qa/red-create-mass-assignment-compare.txt`, run after the fixture gained `create-invoice` + its `accept-all-fields` flaw and after the new tests were written, but before any engine change:

```
Test Files  2 failed (2)
     Tests  8 failed | 25 passed (33)
```

Seven of the eight failures are assertion-level and therefore genuine behavioural RED: `expected undefined to be 'API3:2023'`, `expected 4 to be 5`, `expected [ … ] to have a length of 89 but got 87` (twice), `expected [ … ] to have a length of 6 but got 4`, `expected [] to deeply equal [ 'status', 'currency' ]`, `Cannot read properties of undefined (reading 'request')` (the probe case did not exist), `expected [ … ] to have a length of 5 but got 4`. The eighth entry is `compare.test.ts` failing at import (`Cannot find module '../compare'`), which is **not** behavioural RED for the comparison feature and is recorded here as such.

**RED 2** — for that reason `src/engine/compare.ts` was temporarily replaced by a stub with the real signature returning empty lists, and only the comparison file was run (`npx vitest run --reporter=verbose src/engine/__tests__/compare.test.ts`, saved as `qa/red-compare-stub.txt`):

```
Test Files  1 failed (1)
     Tests  4 failed | 1 passed (5)
```

Four assertion failures: `expected [] to deeply equal [ …(5) ]`, `expected [] to deeply equal [ 'patch-user|mass-assignment' ]`, `expected [] to have a length of 5 but got +0` (twice). The determinism test passed against the stub by construction — a function that always returns the same empty diff *is* deterministic — so on its own it is not evidence; its value is as a regression guard on the real implementation. The stub was then replaced by the implementation.

**GREEN** — full suite, `npx vitest run --reporter=verbose`, saved as `qa/green-create-mass-assignment-compare.txt`:

```
Test Files  2 passed (2)
     Tests  38 passed (38)
```

**Capture note (4 October 2026, later the same day).** The historical test-group label in `engine.test.ts` that carried a model name was renamed to the neutral `sixth-review regressions — …` (label text only; no assertion, id or count changed). `qa/red-create-mass-assignment-compare.txt` was patched accordingly and says so in its header; `qa/red-compare-stub.txt` contained no such label; the GREEN capture was re-run and re-saved after the rename with the same result, `Tests  38 passed (38)`.

### Verification

```
$ npx tsc -p tsconfig.json --noEmit        # exit 0 (typecheck, also the first step of `npm run build`)
$ npm run build                            # qa/build-2026-10.txt
✓ 93 modules transformed.
dist/assets/index-DpTovoQY.css   13.59 kB │ gzip:  3.41 kB
dist/assets/index-N2EDivOI.js   312.08 kB │ gzip: 97.96 kB
✓ built in 2.53s
$ npm audit --audit-level=high             # qa/audit-2026-10.txt
found 0 vulnerabilities
```

Dependencies were not changed in this round (no `npm install`; the lockfile is untouched).

### Measured facts (asserted by `engine.test.ts` → "measures the demo-contract numbers quoted in the documentation")

* Contract: 7 endpoints (was 6); 5 seeded flaws on `release/1.4.0` (was 4). `generateCases` → **89 cases** (was 83): the new `POST /invoices` contributes 4 collection cases plus 2 create-path probes (`write:status` for the admin and the manager — `status` is the only invoice field outside `writableFields`; members are expected-deny and get no probe).
* `release/1.4.0`: 56 pass, 15 bypass, 14 mass-assignment, 4 exposure, 0 over-deny, 0 error → **5 findings** (API1, API5, API3 ×3). The new finding is `create-invoice:mass-assignment`, severity high (`status` matches the privilege-bearing field pattern), evidence cases `create-invoice|p-admin-1|collection|write:status` and `create-invoice|p-mgr-1|collection|write:status`. With the new flaw switched off, the same 89 cases yield exactly the original 4 findings.
* `release/1.4.1`: 89 pass, 0 findings — the "zero findings on the remediated build" test still holds.
* `compareRuns(1.4.0 run, 1.4.1 run)`: 5 closed, 0 opened, 0 persisted, 33 case verdict changes (every non-pass case of 1.4.0 → `pass`), 89 cases compared, `identical: false`. Identical runs → 0 closed / 0 opened / 5 persisted, `identical: true`. `buildReport` adds the optional `comparison` field only when a previous run is supplied; `schema` stays `permitmatrix.report/1`, so earlier exports are unaffected.

### Accessibility and contrast (computed, not browser-measured)

Ratios computed with the WCAG 2.x relative-luminance formula (sRGB). New text tokens in the "Compare with previous run" panel: closed tag `#15704a` on `#d9f0e4` = 5.08:1; opened tag `#b42318` on `#fbe1dd` = 5.30:1; persisted tag `#946200` on `#fbeec4` = 4.53:1; neutral tag `#44506a` on `#e7ecf3` = 6.80:1; list headings and meta `#55617a` on `#ffffff` = 6.22:1; body text `#44506a` on `#ffffff` = 8.07:1 and on the page ground `#f1f4f8` = 7.32:1; muted hints `#55617a` on `#f1f4f8` = 5.64:1. Verdict chips reuse the existing `.verdict` tokens. Every tag carries its meaning in text ("5 closed"), the case-change list is a native `<details>` holding buttons with explicit `aria-label`s, and `prefers-reduced-motion` was already honoured globally. Not measured in this round: axe, screen reader, overflow at 375 px.

### Artefacts referenced and present

Every file path referenced in this app's four documents (README, AUDIT, EVIDENCE, INTERVIEW GUIDE) resolves in the repository — `qa/red-run.txt`, `qa/green-run.txt`, `qa/red-run-review1.txt`, `qa/green-run-review1.txt`, `qa/red-run-sixth.txt`, `qa/green-run-sixth.txt`, `qa/verify-run.txt`, the screenshots in `qa/screens/`, `qa/screens/qa-log.json`, and the October 2026 files `qa/red-create-mass-assignment-compare.txt`, `qa/red-compare-stub.txt`, `qa/green-create-mass-assignment-compare.txt`, `qa/build-2026-10.txt`, `qa/audit-2026-10.txt` — except the entries in the inventory below.

### Artefact inventory

References in this app's documents that are **not** in the repository:

| Reference | Status |
|---|---|
| `../_qa/axe-results.json` (Environment, Browser verification and the sixth-review sections above) | Results file of the parent review harness; not in this repository. The axe numbers quoted above cannot be re-run from the repo alone. |
| "Playwright 1.63.0 (parent's internal QA install)" | External review harness, not part of this repository; this app declares no Playwright dependency. The screenshots it produced are committed (Browser verification table above). |
| `'../contract'`, `'../compare'` (module specifiers inside quoted vitest output above) | Copied verbatim from test-runner messages, not repository paths; the engine modules they name exist. |
