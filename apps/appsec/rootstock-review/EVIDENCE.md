# EVIDENCE — Rootstock Review

Measured facts only. Nothing below is estimated. Counts come from the commands shown.

## Environment

Node v20.20.1, npm 10.8.2, Linux sandbox, 1 October 2026. Browser checks used Playwright 1.63.0 (parent's internal QA install) driving Chromium headless shell 1217 at 1440×1000, 768×1024 and 375×900 with `prefers-reduced-motion: reduce`. All commands below were actually executed; outputs are copied, not paraphrased. Raw logs: `qa/red-run.txt`, `qa/green-run.txt`, `qa/verify-run.txt`, `qa/screens/qa-log.json`; axe results for all five apps in `../_qa/axe-results.json` (not part of this repository — see the artefact inventory at the end).

## Test-first record

**RED — src/engine/__tests__/rootstock.test.ts written before any engine code.** First run (`qa/red-run.txt`):

```
FAIL  src/engine/__tests__/rootstock.test.ts
Error: Cannot find module '../semver' imported from .../src/engine/__tests__/rootstock.test.ts
Tests  no tests
```

**GREEN** (`qa/green-run.txt`): 14 passed (14) on the first implementation run.

## Clean-checkout verification (node_modules and dist deleted first)

```
$ npm ci
added 113 packages in 10s
$ npm run build
✓ built in 1.67s
$ npm test
 Test Files  1 passed (1)
      Tests  14 passed (14)
$ npm audit
found 0 vulnerabilities
```

Total: **14 tests, 1 file**, build succeeds with `tsc --noEmit` + `vite build` (`base: './'`), 0 npm audit findings at pinned versions. (Superseded: 21 tests after the council cycle below, 48 after the October 2026 upgrade round.)

## Browser verification

Main flow replayed with Playwright against `vite preview` (`qa/screens/`, `qa/screens/qa-log.json`): 0 page errors, 0 console errors, 0 failed requests and no horizontal overflow at 1440, 768 and 375 px.

| Screenshot | What it shows |
|---|---|
| `desktop-01-initial-deepset.png` | Tree with derived tallies; `deepset` plan bump-in-range |
| `desktop-02-parent-conflict.png` | `colourkit@0.9.2`: parent conflict naming `uikit ~0.9.0` |
| `desktop-03-filter-advisories.png` | Tree filtered to advisories |
| `desktop-04-unknown-licence.png` | Unknowns filter; `tzdata-mini` empty licence → unknown |
| `desktop-05-import-errors.png` | Malformed snapshot rejected (bad version, severity, range) |
| `tablet-01-initial.png`, `mobile-01-initial.png` | Full-page captures at 768 and 375 px |

axe-core (WCAG 2.0 A/AA + 2.1 AA tags) at 1440 and 375 px after the main action: **0 violations** (`../_qa/axe-results.json`, parent review harness output, not in this repository). Earlier passes found muted-text contrast, a scrollable region without keyboard focus and (in other apps) ARIA attribute issues; all were fixed and re-measured. This is an automated check, not a screen-reader session. These screenshots and the axe pass predate the October 2026 round: the import panel now has a format toggle, import-evidence and include-dev controls and a conversion-notes list that are not in the captures.

## Measured facts that may support resume bullets

* Synthetic snapshot: 11 packages, 5 direct, two `colourkit` versions, one cycle (`pdfkit-lite ↔ fontparse`), one unresolved edge (`glyphcache ^1.0.0`), one empty licence, one denied licence (SSPL-1.0), one review licence (LGPL-3.0-only).
* Advisories matched: 3 packages (2 blocking at ≥ high). Plans: `deepset` bump-in-range → 1.2.3; `colourkit@0.9.2` parent-conflict (blocked by `uikit@3.2.4 ~0.9.0`); `fontparse` no-fix-available.
* Semver subset verified with 16 range assertions including 0.x caret rules and unions.
* Limits (1 Oct 2026): 256 KB UTF-8, 400 packages, 60 deps/package, 200 advisories, depth 6. Raised in the October 2026 round to 2 MiB, 2 500 packages, 250 deps/package (see below); advisories 200 and depth 6 unchanged.

## What was not measured

No performance benchmarks, no user studies, no cross-browser matrix beyond Chromium, no production deployment. Do not quote numbers that are not in this file.

## Council and sixth review cycle (1 Oct 2026, ~14:25 UTC)

**RED** (`qa/red-run-license.txt`) — seven regression tests added before the fix; four failed at assertion level:

```
× respects parentheses: (MIT OR Apache-2.0) AND GPL-3.0-only is deny, not allow   expected 'allow' to be 'deny'
× fails closed to unknown on malformed or unbalanced expressions                   (MIT: expected 'allow' to be 'unknown'
× bounds tokens and nesting                                                        expected 'allow' to be 'unknown'
× explains the decision in the detail text                                         expected 'At least one option is on the allow l…' to match /GPL-3.0-only/
Tests  4 failed | 17 passed (21)
```

**GREEN** (`qa/green-run-license.txt`): `Tests 21 passed (21)` with the new bounded precedence parser (`src/engine/license.ts`).

Clean checkout re-run (`qa/verify-run.txt`): 21/21, build ok, 0 vulnerabilities. Browser licence workflow re-run: importing the demo snapshot with `iconset` relicensed to `(MIT OR Apache-2.0) AND GPL-3.0-only` through the import panel shows **deny** with the parsed form in the detail panel (`qa/screens/desktop-06-licence-grouped-expression-deny.png`); axe 0 violations.

## Upgrade round — October 2026 (lab-wide)

Node v20.20.1, npm 10.8.2, Linux sandbox, 4 October 2026. Commands were run through the lab's helper, which executes the project-local commands shown below in this app directory and saves the verbatim output with a header (command, repo-relative cwd, UTC timestamp, Node version, exit code); the saved files are the evidence.

**Scope of this round:** canonical `vercel.json` headers (C1), `engines.node >=20.19` (C2), `color-scheme` verified `light` against the stylesheet (`html, body { background: var(--paper) }`, `#eef1ea`); the offline `package-lock.json` importer (`src/engine/lockfile.ts`), raised bounds in `src/engine/schema.ts` (2 MiB, 2 500 packages, 250 dependencies per package, 300 registry versions, 3 000 list entries), breadth-first depth/reachability plus a budgeted path enumeration in `src/engine/graph.ts` with a `truncated` flag carried through `Review`, `Report` and the UI; additive optional schema fields `unparsable` and `source` on `rootstock.lockgraph/1` (existing fixture and exports still import; schema id unchanged); `splitId` replacing `id.split('@')[0]` so scoped ids (`@scope/name@1.2.3`) are handled in plans and reachability; the import panel's package-lock mode. No dependency was added or changed.

**RED** (`qa/red-lockfile.txt`, `npx vitest run --reporter=verbose`, 2026-10-04T18:45:21Z, exit 1). `src/engine/__tests__/lockfile.test.ts` (24 tests) was written first; `lockfile.ts` exported `convertPackageLock` with the real signature returning `{ ok: false, errors: ['not implemented'] }`, `graph.ts` exported `BUDGET = { maxExpansionsPerDirect: 0, maxTotalPaths: 0 }` and `buildGraph(lock, options)` returning `truncated: false, expansions: 0`, and `review`/`report` carried placeholder `truncated: false` / `notes.traversal: ''`, so the suite collected and failed on assertions:

```
× convertPackageLock — shape and bounds > rejects lockfileVersion 1 and unknown versions with a clear error
   → expected 'not implemented' to match /lockfileVersion 1 is not supported/
× convertPackageLock — shape and bounds > checks the UTF-8 byte cap before parsing and bounds entry and dependency counts
   → expected 262144 to be 2097152 // Object.is equality
× graph traversal budget > exposes an explicit budget and completes the demo graph without truncation
   → expected 0 to be greater than or equal to 1000
× graph traversal budget > completes a layered 300-package graph within the per-direct budget and flags that path lists were cut
   → expected false to be true // Object.is equality
× graph traversal budget > surfaces truncation through the review and the report
   → expected '' to match /within budget/i
 Test Files  1 failed | 1 passed (2)
      Tests  23 failed | 22 passed (45)
```

Honesty note on that RED: most of the 23 failures read `conversion failed: not implemented` because the stub returns `{ ok: false, errors: ['not implemented'] }` and the tests unwrap the result before asserting on it; the RED failures are therefore the tests' ok-check against the placeholder result plus the limit/message/budget assertions quoted above — the mapping assertions themselves were first exercised at GREEN. (The one passing new test at RED, "never throws on hostile input", passes trivially against a stub that always returns an error object.)

**GREEN-phase correction (first implementation run, not saved; 2 failures of 45).** (1) The converter fell back to the document-level `version` when `packages[""]` had none, so the "defaults a missing root version to 0.0.0" test received `1.0.0`; fixed to read `packages[""].version` only. (2) The pre-existing graph test pinned the unresolved edge object exactly and needed the new `reason` field (`no package in the snapshot satisfies this range`); the assertion was extended, not weakened.

**GREEN** (`qa/green-lockfile.txt`, exit 0). First green run at 2026-10-04T18:54:15Z; the capture was re-saved at 19:28:49Z after the sample fixture's synthetic scope was renamed (`@orchard/grafting`), with the same result:

```
 Test Files  2 passed (2)
      Tests  45 passed (45)
```

The layered 300-package budget test (25 direct roots, 3^11 ≈ 177 000 simple paths each) finished with `truncated: true`, exact depth 12 at the last layer and one shortest path per node; vitest reported 90 ms for it in the first green run and 185 ms in the re-saved capture (shared host, no benchmark claimed).

**Snapshot export (added the same day while preparing the browser-acceptance flow, test-first).** The README's offline-advisory workflow ("add them to the exported snapshot and re-import") had no export of the snapshot itself — only the report could be downloaded. Three tests were appended to `src/engine/__tests__/lockfile.test.ts`: the canonical serialisation of a converted snapshot round-trips through `parseLockgraph` with `source` and `unparsable` intact and identical review output; an advisory appended to the exported document re-imports and drives a `no-fix-available` plan; the demo snapshot serialises without invented fields. **RED** (`qa/red-snapshot-export.txt`, 2026-10-04T20:35:55Z, exit 1) against a `serialiseLockgraph` stub that returned `{}`:

```
× snapshot export … > serialises a converted snapshot as rootstock.lockgraph/1 JSON that re-imports identically …
   → expected [] to deeply equal [ 'schema', 'name', 'root', …(8) ]
× snapshot export … > lets an offline advisory list be added to the exported snapshot and re-imported …
   → expected false to be true // Object.is equality
× snapshot export … > serialises the demo snapshot without inventing fields and round-trips it unchanged
   → expected false to deeply equal { …(9) }
 Tests  3 failed | 45 passed (48)
```

**GREEN** (`qa/green-snapshot-export.txt`, 2026-10-04T20:41:10Z, exit 0): `Tests  48 passed (48)`. UI: a third header button, **Export snapshot (.json)** (`rootstock-lockgraph.json`, canonical key order, optional fields only when present), and the import-evidence help text now names the route (export → add advisories → re-import in lock-snapshot mode).

**Gates (all after the UI and documentation changes; the test totals below predate the snapshot-export addition — see the re-run recorded after it):**

```
$ npx tsc -p tsconfig.json --noEmit            # exit 0
$ npm run build                                 # final build, after the fixture rename (the first build of the round printed ✓ built in 4.41s with JS 299.35 kB)
✓ 57 modules transformed.
dist/assets/index-DKBQFCY6.css   11.18 kB │ gzip:  3.00 kB
dist/assets/index-CfZH2kUm.js   299.36 kB │ gzip: 94.52 kB
✓ built in 3.05s
$ npm audit --audit-level=high
found 0 vulnerabilities
$ npx vitest run --reporter=verbose             # 2026-10-04T19:25Z, after the sample fixture's synthetic scope was renamed to @orchard/grafting; this capture was later overwritten by the final 48-test run saved as qa/verify-round-2026-10.txt (below)
 Test Files  2 passed (2)
      Tests  45 passed (45)
```

`dist/` after the build: `index.html` 0.67 kB, CSS 11.18 kB, JS 299.36 kB, eleven font files totalling ≈ 178 kB (sizes as printed by Vite above); the lab's dist checker reports 515 KB in 15 files, no network/storage tokens apart from Vite's same-origin modulepreload polyfill (informational note).

**Final gates (after the snapshot export, a status notice for the hidden file input, and `assetsInlineLimit: 0`).** Preparing the browser-acceptance flow showed that choosing a file through the visually hidden input announced nothing (the text was read into the editor silently), so `onFile` now sets the existing `role="status"` notice — "Read <file> (<n> bytes) into the editor — press Convert/Validate and load to apply it". This is UI wiring only: the app has no DOM test environment and adding one would be a new dev dependency, so it is covered by `tsc` and the build here and exercised by the lab's browser flow, not by a unit test. `vite.config.ts` gained `assetsInlineLimit: 0` so that no font subset can ever be inlined as a `data:` URL under `font-src 'self'`; this app's stylesheet had none before the setting (`grep -c "data:font"` on the built CSS → `0`), so for this app it is preventive — Seamline's EVIDENCE records the case where it was not.

```
$ npm run build                                 # final build
✓ 57 modules transformed.
dist/assets/index-DKBQFCY6.css   11.18 kB │ gzip:  3.00 kB
dist/assets/index-Dht6E-sn.js   300.86 kB │ gzip: 94.89 kB
✓ built in 4.17s
$ npx vitest run --reporter=verbose             # qa/verify-round-2026-10.txt, final capture, 2026-10-04T20:55:45Z
 Test Files  2 passed (2)
      Tests  48 passed (48)
```

Dist checker after the final build: 516 KB in 15 files, `data: blocked/total 0`, 0 errors, 1 informational note (Vite's same-origin modulepreload polyfill). No dependency changed at any point in this round; the audit result (`found 0 vulnerabilities`) was re-confirmed after the final edits.

**Contrast of text tokens introduced or re-paired in this round** (WCAG 2.x relative-luminance formula, computed from the hex values in `src/styles.css`; no browser measurement this round):

| Use | Foreground / background | Ratio |
|---|---|---|
| Conversion-notes list (`.notes`) | `--ink-2` #5a524b on `--paper` #eef1ea | 6.71 : 1 |
| Tree/traversal notices (`.treecut`), notes heading context | `--ink-2` #5a524b on `--card` #fbfcf9 | 7.43 : 1 |
| Import-evidence help text (`.help`) | `--ink-3` #655d55 on `--card` #fbfcf9 | 6.28 : 1 |
| "traversal budget exhausted" badge (`.tag.l-review`, existing pairing) | `--ochre` #7f5800 on `--ochre-bg` #f3e6c2 | 5.13 : 1 |

All ≥ 4.5 : 1. New controls are native labelled inputs (`label for`, `aria-describedby` help, checkbox) and a Radix toggle group with `aria-labelledby`; focus styling is the existing global `:focus-visible` outline; `prefers-reduced-motion` handling is unchanged; truncation and "not expanded" states are conveyed in text, not colour alone.

**Not measured this round:** no Playwright/axe run (browser QA is the lead's integration step; the screenshots in `qa/screens/` predate the new import controls), no performance benchmark beyond the vitest durations quoted above, no `npm ci` from a clean checkout here (dependencies were pre-installed by the lead; the lockfile is unchanged).

**Portability edit to the historical capture (disclosed):** the 1 October RED log `qa/red-run.txt` quoted an absolute path in its "Cannot find module" line; that path named the original build environment, not a repository path (the file it refers to is `src/engine/__tests__/rootstock.test.ts` here). On 2026-10-04 the lab's capture-neutralising helper replaced that directory prefix with the marker `<original-build>/` and inserted a header note saying so; the result line, count and everything else are unchanged. The helper-saved logs of this round print the checkout root as the portable marker `<repo>` for the same reason.

All other file paths referenced in the four documents of this app resolve inside the app directory (verified with the lab's documentation checker before hand-off).

### Artefact inventory

Artefacts referenced in this app's four documentation files that are **not** in this repository:

* `../_qa/axe-results.json` (and anything else under `../_qa/*`) — output of the parent review harness (axe-core results for the appsec apps), kept outside this repository; the 0-violation claim above is quoted from it and was not re-measured in October 2026.
* "Playwright 1.63.0 (parent's internal QA install)" — the browser-QA tooling lived in the parent workspace, not in this repository; no `playwright` package is a dependency here.
