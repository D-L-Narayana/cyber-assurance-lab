# EVIDENCE — Assay Notebook

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`. *(October 2026 annotation: the Playwright install and `../_qa/axe-results.json` belong to the parent review harness and are not in this repository — see the artefact inventory at the end of this file.)*

## Test-first record

**RED — src/engine/__tests__/notebook.test.ts written before any engine code.** First run (`qa/red-run.txt`). *Paths/labels in the quoted output and in the saved capture were neutralised on 2026-10-04 (the absolute path quoted by the original RED output named the original build environment, not a repository path — it now reads `<original-build>/…`; the file here is `src/engine/__tests__/notebook.test.ts`); results unchanged.*

```
FAIL  src/engine/__tests__/notebook.test.ts
Error: Cannot find module '../lab' imported from .../src/engine/__tests__/notebook.test.ts
Tests  no tests
```

**GREEN-phase correction.** First implementation run: `18 passed | 1 failed` — the test's stack-frame regex expected `(receipts.ts:42)` while the lab emitted `(receipts.ts:42:19)`. The lab output was aligned to the test (the oracle regex accepts both forms). Re-run: 19 passed.

**GREEN** (`qa/green-run.txt`): 19 passed (19).

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 113 packages in 3s
$ npm run build
✓ built in 1.38s
$ npm test
 Test Files  1 passed (1)
      Tests  19 passed (19)
$ npm audit
found 0 vulnerabilities
```

Total: **19 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions.

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-initial.png` | Bench and empty notebook |
| `desktop-02-manual-probe.png` | Manual probe sent to v1, exchange shown as text, oracle "fired" |
| `desktop-03-catalog-v1.png` | Catalog run: four findings with CWE mapping and severity *(predates the October 2026 round — the catalog now has five cases and v1 yields five findings; not re-shot)* |
| `desktop-04-retest-fixed.png` | F-02 retested on v3: FIXED stamp, retest evidence, history |
| `desktop-05-invalid-input.png` | Traversal-style id rejected before sending |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json` — not in this repository; see the artefact inventory below). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* Four catalog cases produce 4 findings on build v1, 2 on v2, 0 on v3 (asserted by test). *(1 October 2026 measurement; superseded on 4 October 2026 — five cases, 5 / 3 / 0, see "Upgrade round — October 2026" below.)*
* Finding state trail asserted exactly: `open → retest-requested → still-open → retest-requested → fixed`.
* Input bounds: relative lab paths only (absolute/protocol-relative refused with `External target refused`), ≤ 8 params, ≤ 512 printable-ASCII chars, no `..`; notebook caps 500 observations / 100 findings.
* Exported JSON contains no `sid=<value>`; cookies are redacted to `sid=[redacted]` (asserted).

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`): `× logs a history entry when impact, likelihood or rationale changes … expected [ { …(3) } ] to have a length of 2 but got 1` — `Tests 1 failed | 19 passed (20)`.

**GREEN** (`qa/green-run-sixth.txt`): `Tests 20 passed (20)` — `rerate` now appends one history entry per actual change and none for no-op saves.

Clean checkout re-run: 20/20, build ok, 0 vulnerabilities; browser flow re-shot; axe 0 violations.

## Upgrade round — October 2026 (lab-wide)

Node v20.20.1, npm 10.8.2, Linux sandbox, 4 October 2026. Commands were run from this directory (`apps/appsec/assaynotebook`) through the lab's run helper, which saves the verbatim output with the command, timestamp, Node version and exit code as the first lines of each saved `qa/` text file named below (the checkout path is written as `<repo>` in saved files). No browser, Playwright or axe run was performed in this round; the screenshots under `qa/screens/` predate it.

### Hygiene (lab contracts C1–C3)

* `vercel.json` carries the lab-wide canonical header set (`cleanUrls: true`; CSP with `default-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `img-src 'self' data: blob:`, `manifest-src 'self'`; plus `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security`). `AUDIT.md` → "Security headers" describes it. The app has no `<form>` element (the lab's "login form" is a function call), so `form-action 'none'` changes nothing.
* `package.json` `engines.node` is `>=20.19` (was `>=20`).
* `index.html` keeps `<meta name="color-scheme" content="light">`; `styles.css` sets `html, body { background-color: var(--paper) }` = `#f3f7fa` with a light grid, so the declared scheme matches the palette (verified by reading; unchanged).
* **Fonts under the production CSP (4 October 2026, ~20:45 UTC).** A browser check of the built bundle served with this app's own response headers found the built stylesheet inlining one small font subset as a `data:` URL (`url(data:font/woff2;base64,…)`), which `font-src 'self'` blocks — two CSP violations and one console error per page load, in both the desktop and the mobile viewport. RED, reproduced here before the change: counting `data:font` occurrences in the built stylesheet gave 1 (the two sibling apps' stylesheets gave 0; their font subsets exceed Vite's 4 KiB inline threshold). Fix: `vite.config.ts` sets `build.assetsInlineLimit: 0` with a one-line comment — fonts must ship as files; the CSP was not widened. After the rebuild the stylesheet shrank from 15.15 kB to 12.48 kB and references all 13 font files by URL (the 2.03 kB JetBrains Mono cyrillic-ext subset now appears as its own file), the `data:font` count is 0, and the lab's dist checker passes (one informational note about Vite's same-origin modulepreload polyfill). The browser re-check under the same headers belongs to the lab's integration step, not to this file. The suite was re-run afterwards: `Tests  24 passed (24)` (`qa/green-security-headers.txt` re-saved).

### Test-first record

**RED** — four tests were added to `src/engine/__tests__/notebook.test.ts` and two existing ones were tightened (catalog counts 5/3/0 with the clean-case ids; `CWE-693` expected in the report), while `oracles.ts` carried a metadata-only stub for `security-headers-missing` whose `evaluate` always returned `{ vulnerable: false }`, `suggestOracles` was unchanged and `TC-05` was already in the catalog. The stub made the `it.each` over `ORACLES` collect the new case, so every failure below is an assertion on behaviour. `npx vitest run --reporter=verbose`, saved as `qa/red-security-headers.txt`:

```
Test Files  1 failed (1)
     Tests  5 failed | 19 passed (24)
```

Failures: `security-headers-missing fires on v1 and is silent on v3` (`expected false to be true`), the oracle-semantics test (`expected false to be true` on a bare `text/html` response), `suggestOracles …` (`expected [] to include 'security-headers-missing'`), `runCatalog records 5 findings on v1 …` (`v1: expected 4 to be 5`), and the report test (`CWE-693` missing from the sorted CWE list). Honest note: the new lab test "v1 and v2 serve the HTML account page without Content-Security-Policy or X-Content-Type-Options; v3 sends both" passed already in RED — it pins behaviour the lab had since the first round (v3 sent the headers; v1/v2 did not), so no lab change was needed for this feature.

**GREEN** — same command, saved as `qa/green-security-headers.txt`:

```
Test Files  1 passed (1)
     Tests  24 passed (24)
```

**Capture note (4 October 2026, later the same day).** The historical test-group label in `notebook.test.ts` that carried a model name was renamed to the neutral `sixth-review regression — …` (label text only; no assertion, id or count changed). `qa/red-security-headers.txt` was patched accordingly and says so in its header; the GREEN capture was re-run and re-saved after the rename with the same result, `Tests  24 passed (24)`.

### Verification

Build re-run after the font change described under "Hygiene" (the earlier run of the same day, before that change, printed `✓ built in 1.58s` with a 15.15 kB stylesheet and the same 276.72 kB script; the capture file holds the latest run):

```
$ npx tsc -p tsconfig.json --noEmit        # exit 0 (typecheck; also the first step of `npm run build`)
$ npm run build                            # qa/build-2026-10.txt
✓ 52 modules transformed.
dist/assets/index-stiUrtlD.css   12.48 kB │ gzip:  3.12 kB
dist/assets/index-2Mss8l4k.js   276.72 kB │ gzip: 87.95 kB
✓ built in 4.01s
$ npm audit --audit-level=high             # qa/audit-2026-10.txt
found 0 vulnerabilities
```

Dependencies were not changed in this round (no `npm install`; the lockfile is untouched).

### Measured facts (asserted by `notebook.test.ts`)

* Catalog: five cases `TC-01` … `TC-05`; `TC-05` is `GET /account` as alice with oracle `security-headers-missing`.
* `runCatalog`: v1 → 5 findings (no clean case); v2 → 3 findings, clean `TC-01`, `TC-02`; v3 → 0 findings, all five clean. Observations per run = 5.
* Oracle semantics: fires on a `text/html` 200 lacking either header and names the missing ones (`HTML response lacks content-security-policy and x-content-type-options.`); quiet when both are present in any casing (`Content-Security-Policy`, `X-Content-Type-Options`, `TEXT/HTML`); quiet on `application/json` and on a `302` redirect. Metadata: CWE-693 "Protection Mechanism Failure", A05:2021, impact low, likelihood high.
* `suggestOracles` offers `security-headers-missing` for the account page on every build and never for the JSON receipt route. The exported report's CWE list is now `CWE-1004, CWE-209, CWE-639, CWE-693, CWE-79`; `assaynotebook.report/1` is unchanged in shape.

### Accessibility and contrast

No new UI control, colour token or style rule was introduced: the fifth oracle and `TC-05` render through the existing suggestion list, finding pages and catalog button, and the only visible text changes are the build label ("5 seeded flaws") and the footer. No new contrast ratio to cite; nothing was browser-measured in this round.

### Artefacts referenced and present

Every file path referenced in this app's four documents (README, AUDIT, EVIDENCE, INTERVIEW GUIDE) resolves in the repository — `qa/red-run.txt`, `qa/green-run.txt`, `qa/red-run-sixth.txt`, `qa/green-run-sixth.txt`, `qa/verify-run.txt`, the screenshots in `qa/screens/`, `qa/screens/qa-log.json`, and the October 2026 files `qa/red-security-headers.txt`, `qa/green-security-headers.txt`, `qa/build-2026-10.txt`, `qa/audit-2026-10.txt` — except the entries in the inventory below.

### Artefact inventory

References in this app's documents that are **not** in the repository:

| Reference | Status |
|---|---|
| `../_qa/axe-results.json` (Environment and Browser verification sections above) | Results file of the parent review harness; not in this repository. The axe numbers quoted above cannot be re-run from the repo alone. |
| "Playwright 1.63.0 (parent's internal QA install)" | External review harness, not part of this repository; this app declares no Playwright dependency. The screenshots it produced are committed (Browser verification table above). |
| `'../lab'` (module specifier inside quoted vitest output above) | Copied verbatim from a test-runner message, not a repository path; the engine module it names exists. |
