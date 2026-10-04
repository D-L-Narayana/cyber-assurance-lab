# EVIDENCE — Provenance Gate

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json`. *(October 2026 annotation: the Playwright install and `../_qa/axe-results.json` belong to the parent review harness and are not in this repository — see the artefact inventory at the end of this file.)*

## Test-first record

**RED — src/engine/__tests__/gate.test.ts written before any engine code.** First run (`qa/red-run.txt`). *Paths/labels in the quoted output and in the saved capture were neutralised on 2026-10-04 (the absolute path quoted by the original RED output named the original build environment, not a repository path — it now reads `<original-build>/…`; the file here is `src/engine/__tests__/gate.test.ts`); results unchanged.*

```
FAIL  src/engine/__tests__/gate.test.ts
Error: Cannot find module '../schema' imported from .../src/engine/__tests__/gate.test.ts
Tests  no tests
```

**GREEN-phase correction.** The first implementation run showed `16 passed | 1 failed`: *releases with accepted risk and no requirement problems* failed because the threat model was asked to cover `package-lock.json`. The scope rule was narrowed to "paths of the classes that require that evidence type" (`classifyChanges` now returns `scopePathsByType`). Re-run: 17 passed.

**GREEN** (`qa/green-run.txt`): 17 passed (17) after the scope-rule correction described above.

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 127 packages in 4s
$ npm run build
✓ built in 1.56s
$ npm test
 Test Files  1 passed (1)
      Tests  17 passed (17)
$ npm audit
found 0 vulnerabilities
```

Total: **17 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions.

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-blocked-140.png` | 1.4.0: red signals on four stages, gate BLOCKED with blockers list |
| `desktop-02-evidence-detail-hash-mismatch.png` | Unit-test ticket selected: hash mismatch and inline artifact |
| `desktop-03-accepted-risk-141.png` | 1.4.1: amber gate, RELEASE WITH ACCEPTED RISK |
| `desktop-04-asof-stale.png` | 1.4.1 evaluated as of 2026-12-01: blocked by staleness/expiry |
| `desktop-05-policy-errors.png` | Invalid policy JSON rejected with field-level errors |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json` — not in this repository; see the artefact inventory below). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session.

## Measured facts that may support resume bullets

* Release 1.4.0 is blocked with 8 blockers *(sixth-review correction below: 7 blockers carrying 8 problem codes)*: threat-model `stale` (88 days) + `scope-gap`; code-review `self-review`, `reviewer-role`, `insufficient-reviewers` (0 eligible of 2); unit-tests `hash-mismatch`; sast `wrong-commit`; security-retest `missing`; SAST-17 open high with no acceptance; DEP-4 acceptance `expired`.
* Release 1.4.1 evaluates to `release-with-accepted-risk` (all requirements satisfied; DEP-4 carried by a 56-day acceptance ≤ 90-day policy). Evaluating the same manifest as of 2026-12-01 blocks it (stale evidence, expired acceptance).
* SHA-256 is computed with Web Crypto; the test vector `sha256("abc") = ba7816bf…f20015ad` passes.
* Limits: 128 KB UTF-8; 60 evidence, 50 identities, 500 changes, 60 acceptances, 20 change classes; artifacts ≤ 4000 chars; depth 6.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Sixth review cycle (1 Oct 2026, ~14:30 UTC)

**RED** (`qa/red-run-sixth.txt`):

```
× chooses a valid acceptance regardless of list order …   expected 'blocked' to be 'release-with-accepted-risk'
× reports the least-broken acceptance when none is valid   expected 'ra-bad' to be 'ra-exp'
× fails closed when class-required evidence omits scope    expected 'release-with-accepted-risk' to be 'blocked'
Tests  3 failed | 19 passed (22)
```

(The test "1.4.0 has exactly 7 blockers carrying 8 problem codes" passed immediately, confirming the engine count; the README said "eight named blockers" and was corrected.)

**GREEN** (`qa/green-run-sixth.txt`): first run after the fix showed `dependency-review: scope-missing` on both fixtures — the rule is applied to every class-required type — so `scope` was added to the fixture's SAST, security-retest and dependency-review items. Then `Tests 22 passed (22)`. 1.4.0 still has exactly 7 blockers.

Clean checkout re-run: 22/22, build ok, 0 vulnerabilities; browser flow re-shot; axe 0 violations.

## Upgrade round — October 2026 (lab-wide)

Node v20.20.1, npm 10.8.2, Linux sandbox, 4 October 2026. Commands were run from this directory (`apps/appsec/provgate`) through the lab's run helper, which saves the verbatim output with the command, timestamp, Node version and exit code as the first lines of each saved `qa/` text file named below (the checkout path is written as `<repo>` in saved files). No browser, Playwright or axe run was performed in this round; the screenshots under `qa/screens/` predate it and do not show the remediation checklist.

### Hygiene (lab contracts C1–C3)

* `vercel.json` carries the lab-wide canonical header set (`cleanUrls: true`; CSP with `default-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `img-src 'self' data: blob:`, `manifest-src 'self'`; plus `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security`). `AUDIT.md` → "Security headers" describes it. The app has no `<form>` element, so `form-action 'none'` changes nothing.
* `package.json` `engines.node` is `>=20.19` (was `>=20`).
* `index.html` keeps `<meta name="color-scheme" content="light">`; `styles.css` sets `html, body { background: var(--stone) }` = `#eceeea`, so the declared scheme matches the palette (verified by reading; unchanged).

### Test-first record

**RED** — `src/engine/__tests__/remediation.test.ts` (5 tests) was written first; `src/engine/remediation.ts` existed only as a stub exporting the real signatures with placeholder values (`remediationFor` returning `[]`, `ACTION_SUMMARY` with empty strings for every code), so the tests collected and failed on behaviour, not on imports. `npx vitest run --reporter=verbose`, saved as `qa/red-remediation.txt`:

```
Test Files  1 failed | 1 passed (2)
     Tests  5 failed | 22 passed (27)
```

Failures: `approver-is-author: expected 0 to be greater than 30` (empty generic action), `self-review: expected false to be true` (no item for a 1.4.0 problem), `expected [] to have a length of 1 but got +0` (ghost acceptance not surfaced), `Cannot read properties of undefined (reading 'action')` (no `stale` item to inspect), and the memo not matching `/\n## Remediation checklist\n/`. The 22 pre-existing gate tests passed throughout.

**GREEN** — same command, saved as `qa/green-remediation.txt`:

```
Test Files  2 passed (2)
     Tests  27 passed (27)
```

**Capture note (4 October 2026, later the same day).** The historical test-group label in `gate.test.ts` that carried a model name was renamed to the neutral `sixth-review regressions — …` (label text only; no assertion, id or count changed). `qa/red-remediation.txt` was patched accordingly and says so in its header; the GREEN capture was re-run and re-saved after the rename with the same result, `Tests  27 passed (27)`.

**RED 2 — defect found while scripting the browser flow (4 October 2026, ~20:30 UTC).** Writing the new-feature browser flow against the real checklist text exposed a defect in the `no-acceptance` action: it derived the evidence *type* from the id stem of the finding's source evidence (`ev-sast-61` → "new ev-sast-type evidence"). Two assertions were added to `remediation.test.ts` before the fix (the action must read "new sast evidence", and "new evidence of the same type" without manifest context). `npx vitest run --reporter=verbose`, saved as `qa/red-remediation-source-type.txt`:

```
× turns every problem in the 1.4.0 evaluation into a concrete, policy-aware action
  → expected 'Fix SAST-17 and record it as fixed in…' to match /record it as fixed in new sast eviden…/
× is deterministic and still produces an action per problem without policy or manifest context
  → expected 'Fix SAST-17 and record it as fixed in…' to match /new evidence of the same type/
Test Files  1 failed | 1 passed (2)
     Tests  2 failed | 25 passed (27)
```

Fix: `remediationFor` now resolves the source evidence's `type` from the manifest ("…record it as fixed in new sast evidence for the release commit…") and falls back to "new evidence of the same type" when no manifest is supplied. Test count unchanged (assertions were added to existing tests). **GREEN 2** (`qa/green-remediation-source-type.txt`, same command):

```
Test Files  2 passed (2)
     Tests  27 passed (27)
```

### Verification

Build and audit were re-run after the RED 2 / GREEN 2 fix above (the earlier run of the same day, before that fix, printed `✓ built in 1.88s` with `index-CeaUPB2i.js 322.70 kB`; the capture files hold the latest run):

```
$ npx tsc -p tsconfig.json --noEmit        # exit 0 (typecheck; also the first step of `npm run build`)
$ npm run build                            # qa/build-2026-10.txt
✓ 98 modules transformed.
dist/assets/index-XmtZ9iMU.css   13.03 kB │ gzip:   3.34 kB
dist/assets/index-Dy6G-xap.js   322.77 kB │ gzip: 101.56 kB
✓ built in 5.21s
$ npm audit --audit-level=high             # qa/audit-2026-10.txt
found 0 vulnerabilities
```

Dependencies were not changed in this round (no `npm install`; the lockfile is untouched). The type-level exhaustiveness guard is exercised by this `tsc` step: `ACTION_SUMMARY` and the test's `EXPECTED_WORD` are both `Record<ProblemCode | AcceptanceProblemCode, string>`, so a new code without an action fails the build.

### Measured facts (asserted by `remediation.test.ts`)

* Release 1.4.0 with the default policy → **10 checklist items**, one per problem: `stale` and `scope-gap` on `threat-model (ev-tm-3)`; `self-review`, `reviewer-role` and `insufficient-reviewers` on `code-review (ev-cr-88)`; `hash-mismatch` on `unit-tests (ev-ut-140)`; `wrong-commit` on `sast (ev-sast-61)`; `missing` on `security-retest`; `expired` on `DEP-4 (acceptance ra-1)`; `no-acceptance` on `SAST-17`. The count equals requirement problems (8) + acceptance problems (1) + blocking findings without acceptance (1).
* The `stale` action reads "Re-run threat-model against commit a1b2c3d and record a new artifact; policy allows 30 days of evidence age relative to the as-of time (2026-09-28T09:00:00Z)." — the numbers come from the policy and manifest, not from prose.
* Release 1.4.1 → 0 items. Adding an acceptance that references a non-existent finding → exactly one `unknown-finding` item naming the acceptance and the missing finding id.
* Output is deterministic (`toEqual` and byte-identical JSON across two calls); without policy/manifest context the same items are produced with generic actions.
* Schema: `provgate.bundle/1` gains an optional `remediation` array (additive); the bundle digest covers it like every other field. The Markdown memo gains "## Remediation checklist" after "## Blockers" (`- none` when empty).

### Accessibility and contrast (computed, not browser-measured)

The checklist is a native `<details>` (open by default when the verdict is `blocked`) containing an `<ol aria-label="Remediation checklist">`, so it is keyboard operable by construction and conveys nothing by colour alone. WCAG 2.x relative-luminance ratios for the new text tokens: code badge `#c8102e` on `#fbe4e7` = 4.86:1; action text `#4a5159` on `#ffffff` = 8.04:1; target code `#1b1f23` on `#ffffff` = 16.58:1; summary label uses the existing card text colour. Not measured in this round: axe, screen reader, overflow at 375 px.

### Artefacts referenced and present

Every file path referenced in this app's four documents (README, AUDIT, EVIDENCE, INTERVIEW GUIDE) resolves in the repository — `qa/red-run.txt`, `qa/green-run.txt`, `qa/red-run-sixth.txt`, `qa/green-run-sixth.txt`, `qa/verify-run.txt`, the screenshots in `qa/screens/`, `qa/screens/qa-log.json`, and the October 2026 files `qa/red-remediation.txt`, `qa/green-remediation.txt`, `qa/red-remediation-source-type.txt`, `qa/green-remediation-source-type.txt`, `qa/build-2026-10.txt`, `qa/audit-2026-10.txt` — except the entries in the inventory below.

### Artefact inventory

References in this app's documents that are **not** in the repository:

| Reference | Status |
|---|---|
| `../_qa/axe-results.json` (Environment and Browser verification sections above) | Results file of the parent review harness; not in this repository. The axe numbers quoted above cannot be re-run from the repo alone. |
| "Playwright 1.63.0 (parent's internal QA install)" | External review harness, not part of this repository; this app declares no Playwright dependency. The screenshots it produced are committed (Browser verification table above). |
| `'../schema'` (module specifier inside quoted vitest output above) | Copied verbatim from a test-runner message, not a repository path; the engine module it names exists. |
