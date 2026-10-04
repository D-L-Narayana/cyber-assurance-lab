# EVIDENCE — injectboard

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

> **Annotation (October 2026 round).** The sections below are the original build record and are kept verbatim. The `qa-tools/*` scripts they cite belong to an external QA harness that is **not** part of this repository (see `### Artefact inventory` at the end), so the browser, keyboard and axe measurements quoted there cannot be re-run from the repository alone. The absolute path quoted in the original RED output named the original build environment, not a repository path; the file it refers to is `src/engine/engine.test.ts`. Paths in the quoted output were neutralised to `<original-build>/…` on 2026-10-04; results unchanged. The test total quoted below (11) is the original count; the current measured total is in the October 2026 section.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './engine' imported from '<original-build>/defense/injectboard/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design.


**Iterations**
- All 11 tests passed on the first implementation run after the module-resolution RED.


**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  13:28:54
   Duration  357ms (transform 115ms, setup 0ms, collect 128ms, tests 11ms, environment 0ms, prepare 56ms)
```

## Clean-checkout verification (`qa-tools/verify-all.sh`)
```
## npm ci

added 130 packages in 14s
## npm run build
dist/index.html                                                  0.62 kB │ gzip:  0.37 kB
✓ built in 1.88s
## npm test
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  492ms (transform 288ms, setup 0ms, import 303ms, tests 13ms, environment 0ms)
## npm audit
found 0 vulnerabilities
## storage-api grep (expect no matches in src)
none
## fetch/XHR grep (expect none)
none
## dist size
468K
```
Dependency note: the first install pulled vitest 3.2.7, for which `npm audit` reported 2 moderate advisories in `@vitest/mocker` (dev-only, not shipped). Upgraded to vitest ^4.1.11; the suite passed unchanged and `npm audit` reports 0 vulnerabilities (above).

## Browser workflow (`qa-tools/browser_qa.mjs`, Playwright Chromium, reduced motion)
Preview served with `vite preview --port 6133`. Log:
```
clock: 09:00Z
after decision: Committed "Isolate FS-01 from the network now" at +5m — within SLA.
clock: 09:10Z
role view: INJECT FEED — COMMUNICATIONS
task completed
lessons: 1
aar: After-action report  Generated from the exercise state. Markdown preview below; JSON follows schema injectboard.aar/1.  
export schema=injectboard.aar/1 decisions=1 breaches=0
[desktop] horizontal overflow px=0 errors=0 
[tablet] horizontal overflow px=0 errors=0 
[mobile] horizontal overflow px=0 errors=0
```
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three.

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
```
injectboard: reached .radio after 9 Tabs, visible focus outline=true, activation changed detail=true ("option chosen")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
```
desktop: 0 violations, 24 rule groups passed, 1 incomplete (needs manual review)
mobile: 0 violations, 24 rule groups passed, 1 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- Shipped scenario: 9 injects, 7 decisions (2 of them branch-only), 5 roles, 12 possible tasks; maxScore 52 (upper bound across all branches). *(October 2026 annotation: the best total achievable on one path is 48 — computed by `achievableMaxScore`, see below.)*
- Browser workflow exercised: advance 5 min → commit "Isolate FS-01" (within SLA, +5m) → jump to next inject (09:10Z) → Communications role view → mark task done → add lesson → open after-action report → download JSON (`injectboard.aar/1`, 1 decision, 0 breaches).

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.

## Upgrade round — October 2026 (lab-wide)

Recorded 2026-10-04 on Node v20.20.1, npm 10.8.2, Linux sandbox. Commands were run from the app directory through the lab's lead helper, which records the command, timestamp, Node version and exit code as the first lines of every saved evidence file in `qa/`; the output below is copied verbatim from those files. No dependency was added or changed; `npm ci` was not re-run in this round (dependencies were installed once by the lead from the unchanged lockfile).

### Hygiene
- `vercel.json` replaced by the lab-wide canonical header set (CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, HSTS) — described in `AUDIT.md`.
- `package.json`: `"engines": { "node": ">=20.19" }` added.
- `index.html`: `color-scheme` changed from `light dark` to `light` (the stylesheet implements one light palette: `body` background `#f4f6f4`, no `prefers-color-scheme` query).
- After the hygiene edits, `npx vitest run --reporter=verbose` → `Tests  11 passed (11)` (09:20 UTC), i.e. the baseline still passed before any engine change.

### Test-first record — scenario import hardening
Tests written first in `src/engine/scenario.test.ts` (6 tests) against the existing `validateScenario`.

**RED** — `npx vitest run --reporter=verbose src/engine/scenario.test.ts`, saved as `qa/red-scenario-hardening.txt` (exit 1):
```
 × … accepts the shipped fixture and the mini scenario and returns a copy without unknown keys
   → expected { id: 'mini', title: 'Mini', …(5) } to deeply equal { id: 'mini', title: 'Mini', …(4) }
 × … parseScenario rejects invalid JSON and anything over the 512 KiB byte cap before parsing
   → expected undefined to be 524288 // Object.is equality
 × … bounds nesting depth (≤ 8 containers) and total value count with an iterative scan
   → parseScenario is not a function
 × … validates top-level fields with path-addressed errors
   → expected true to be false // Object.is equality
 × … validates injects, decisions, options, tasks and unlocks with exact paths
   → expected true to be false // Object.is equality
 × … caps the error list at 25 entries
   → expected 'Inject "x0" targets unknown role "gho…' to match /^injects\[0\]\.role/m
      Tests  6 failed (6)
```
Five of the six failures are behavioural (unknown keys kept, no byte cap, lenient field rules, legacy error wording, 20-entry cap); one test additionally hit the missing `parseScenario` export.

**GREEN** — same command after implementing `parseScenario` / the complete `validateScenario`, saved as `qa/green-scenario-hardening.txt`:
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Test-first record — achievable score
Tests written first in `src/engine/score.test.ts` (5 tests). A first RED attempt failed only with `Cannot find module './score'` (zero tests collected) — that is **not** behavioural RED, so it was discarded: `src/engine/score.ts` was given its real signatures returning placeholder values (`upperBoundScore → 0`, `achievableMaxScore → { max: 0, path: [], truncated: false, … }`) and RED was re-run.

**RED** — `npx vitest run --reporter=verbose src/engine/score.test.ts`, saved as `qa/red-achievable-score.txt` (exit 1):
```
 × … fixture: upper bound 52, but only 48 is achievable on one path …   → expected +0 to be 52 // Object.is equality
 × … the returned path replays to exactly that score through the engine   → expected 0 to be greater than 0
 × … explores the branch when the branch-only decision is worth more …   → expected +0 to be 40 // Object.is equality
 × … completeness and the after-action report show both numbers          → expected undefined to be 48 // Object.is equality
 × … is deterministic and stops at the expansion budget on a dense branching scenario, flagging truncation
   → expected false to be true // Object.is equality
      Tests  5 failed (5)
```

**GREEN** — same command after implementing `score.ts` and wiring `completeness`/`afterActionReport`, saved as `qa/green-achievable-score.txt`:
```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
Measured facts from the GREEN run: upper bound 52, achievable 48 on a 6-decision path that avoids `d-late-isolate`; the hostile 64-decision scenario (3^16 complete paths) stops at the 20,000-expansion budget with `truncated: true` in about 0.8–1.0 s and still returns a path that replays to its reported score.

### Test-first record — single decoding (defect found in review of the GREEN code)
`parseScenario` decoded the text and handed the value to `validateScenario`, which re-delegated *string* input back to `parseScenario` — so a JSON string literal containing a scenario document was decoded twice. One assertion was added to the existing parse test (a double-encoded scenario must be rejected as "not an object").

**RED** — `npx vitest run --reporter=verbose src/engine/scenario.test.ts`, saved as `qa/red-single-decode.txt` (exit 1):
```
 × … parseScenario rejects invalid JSON and anything over the 512 KiB byte cap before parsing
   → expected true to be false // Object.is equality
      Tests  1 failed | 5 passed (6)
```
**GREEN** — same command after routing both entry points through an internal `validateParsed()` (strings are plain values after decoding), saved as `qa/green-single-decode.txt`:
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Final gates (2026-10-04, 19:11–19:12 UTC, after the single-decode fix)
- `npx vitest run --reporter=verbose` (full suite), saved as `qa/green-full-suite.txt`:
```
 Test Files  3 passed (3)
      Tests  22 passed (22)
```
- `npx tsc -p tsconfig.json --noEmit` → exit 0 (no output).
- `npm run build` (`tsc -p tsconfig.json && vite build`):
```
dist/index.html                                                  0.62 kB │ gzip:   0.37 kB
dist/assets/index-CC0bj2TI.css                                  10.99 kB │ gzip:   3.02 kB
dist/assets/index-Z09kl82e.js                                  317.16 kB │ gzip: 100.50 kB
✓ built in 4.50s
```
- `npm audit --audit-level=high`:
```
found 0 vulnerabilities
```

### Schema and compatibility
- `injectboard.aar/1` keeps its id; `completeness` gains `achievableMax` and `achievableTruncated`, and the JSON gains an additive `scoreBounds { upperBound, achievable, truncated, bestPath }`. Existing AAR files remain valid.
- Scenario JSON shape unchanged; the shipped fixture passes the complete validator unmodified (no fixture defect was found). One rule is stricter than before by design: an unlock target must be an unlock-only inject (`atMinute: null`) — the fixture already satisfies it.

### Accessibility notes
- No new colour tokens or components were introduced. The new text (score strip caption, import-dialog description, error list) reuses the existing `.muted` (`#51605a`), body ink (`#14201b`) and `.errors` red (`#b3261e`) tokens on white panels. Contrast ratios computed with the WCAG 2.x relative-luminance formula (private helper script, not in the repo): `#51605a` on `#ffffff` = **6.62:1**; `#b3261e` on `#ffffff` = **6.54:1**; `#14201b` on `#ffffff` = **16.77:1**; `#14201b` on the page ground `#f4f6f4` = **15.44:1** — all ≥ 4.5:1. Meaning is never colour-only: the truncation flag is spelled out in text.
- The screenshots in `qa/` (desktop-start.png, desktop-after-workflow.png, tablet-start.png, mobile-start.png) predate this round: the score strip now shows two numbers and the import-dialog text changed. No browser, keyboard or axe run was performed in this round (no harness is available in the repository); nothing of that kind is claimed.

### Artefact inventory
Paths referenced in this app's README, AUDIT, EVIDENCE and INTERVIEW_GUIDE documents that are **not** in this repository, with the reason:
- `qa-tools/verify-all.sh` — part of an external QA harness used during the original build; not in this repository; the clean-checkout measurements quoted above cannot be re-run from the repo alone.
- `qa-tools/browser_qa.mjs` — external QA harness (Playwright workflow); not in this repository; the browser-workflow log above cannot be re-run from the repo alone.
- `qa-tools/keyboard_qa.mjs` — external QA harness (keyboard pass); not in this repository.
- `qa-tools/axe_qa.mjs` — external QA harness (axe-core scan); not in this repository; the axe results above cannot be re-run from the repo alone.
- `HANDOFF.md` — a working note of the original build's review harness; never committed to this repository.
Every other path referenced in those four documents resolves inside this app directory; the original evidence files, the October 2026 RED/GREEN/full-suite evidence files and the four screenshots are all committed.
