# EVIDENCE — ruleshadow

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated. *(The October 2026 lab-wide upgrade round is recorded in its own section at the end of this file; the sections before it describe the original build and are kept as written, with annotations in italics where this round changed the facts.)*

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './net' imported from '<original-build>/defense/ruleshadow/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design. Paths in the quoted output were neutralised on 2026-10-04 (`<original-build>/` stands for the original build environment's directory, which is not a repository path; the file here is `src/engine/engine.test.ts`); results unchanged. The same substitution, with a header note, was applied to the retained capture `qa/red-run.txt`.

**RED, review round (new assertion-level tests before the fix)** — `npx vitest run`:
```
× does not treat an already-shadowed earlier rule as operative coverage (first-match precedence) 10ms
     × classifies full shadowing by mixed-action earlier rules as a conflict with a per-range trace 1ms
     × reports a missing explicit final deny 1ms
     × rejects calendar-invalid dates such as 2026-02-30 and 2026-99-99 2ms
     × neutralises CSV formula injection and quotes fields 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
      Tests  5 failed | 17 passed (22)
AssertionError: expected 'redundant' to be 'conflict' // Object.is equality
AssertionError: expected undefined to be 'conflict' // Object.is equality
AssertionError: zone-scoped deny is not a global final deny: expected false to be true // Object.is equality
AssertionError: expected [ 'a', 'b', 'c' ] to deeply equal [ 'c' ]
AssertionError: expected '"  =1+1","\'\t+5","\u0001-3","\'\r\n@…' to be '"\'  =1+1","\'\t+5","\'\u0001-3","\'\…' // Object.is equality

× requires manual review for VPN narrowing when no jump host is supplied, and for overbroad allows (no automatic address scoping) 7ms
     × derives the stale-rule expiry from the review date instead of a hard-coded day 1ms
     × builds a stable report schema 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 'narrow' to be 'review' // Object.is equality
AssertionError: expected '2026-10-31' to be '2026-03-31' // Object.is equality
AssertionError: expected undefined to be +0 // Object.is equality
      Tests  3 failed | 21 passed (24)

× only narrows VPN exposure when the supplied jump host is a strict subset of the original destination 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 'narrow' to be 'review' // Object.is equality
      Tests  1 failed | 24 passed (25)
```

**Iterations**
- Assertion-level RED during implementation (recorded): `expected '[object Object]' to match /500/` — the CSV error list is structured `{line, reason}`; the test joined objects. Fixed in the test to read `reason`. A `tsc` failure on a `FindingKind` literal array in the golden test was fixed with `as const`.
- **Review round (parent source audit, 2026-10-01)** — four new assertion-level failing tests were written first (`qa/red-run-2.txt`), then fixed:
  1. first-match precedence: `A deny any; B allow any; C allow 443` — C was labelled redundant via the already-dead B; now the shadow walk lets each earlier containing rule contribute only the port space it still owns, so C is a conflict with A;
  2. mixed-action full shadowing (`deny 80-200` + `allow 201-443` over `allow 80-443`) is now an explicit conflict with a per-range trace;
  3. final-deny detection requires zones any→any;
  4. CSV import dates must round-trip through `Date.UTC` (rejects 2026-02-30 / 2026-99-99); CSV export neutralises formula prefixes after leading whitespace/control characters.
  Fixture metrics were unchanged by the fix (17 findings: 1 critical, 4 high, 3 medium, 9 low). *(October 2026: the fixture grew to 41 rules and the engine now also reports one info-severity `partially-shadowed` finding; the 17 findings of the original kinds are unchanged — see the upgrade-round section.)*
- **Sixth review round (2026-10-01)** — proposals did not resolve their own findings (overbroad narrowed ports but stayed any→any; stale expiry hard-coded). Three new tests failed first (`qa/red-run-3.txt`), then: overbroad allows and conflicts are `manualReview` proposals with no automatic change; VPN narrowing is generated only when the reviewer supplies a valid jump-host CIDR; stale expiry = review date + 30 days. Browser QA: approving the two safe fixture proposals takes re-analysis from 17 to 15 findings; the overbroad proposal's Approve button is disabled. README documents the ICMP/proto-any asymmetry, per-protocol and partial-address assembly limits, and the "redundant ≠ safe to remove" nuance. *(October 2026: the same two proposals now take 18 → 16 findings, i.e. 17 → 15 of the original kinds plus the info finding, which stays because it needs a human decision.)*
- **Round 3 (parent probe, 2026-10-01)** — any valid CIDR was accepted as the jump host, so `0.0.0.0/0` for a `10.0.0.0/8` rule was labelled `narrow` and would have broadened it. One failing test first (`qa/red-run-4.txt`), then: the supplied destination must be a strict subset of the current destination (contained and smaller); equal, broader or outside → manual review with reason. Browser QA confirms `0.0.0.0/0` yields "manual review required … not a strict subset" and `10.0.5.10/32` yields `narrow`.


**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  25 passed (25)
   Start at  14:39:08
   Duration  387ms (transform 160ms, setup 0ms, import 182ms, tests 38ms, environment 0ms)
```
*(October 2026: the suite is now 47 tests in two files; see below.)*

## Clean-checkout verification (`qa-tools/verify-all.sh`)
*(External harness used during the original build; not part of this repository — see the artefact inventory below.)*
```
## npm ci
added 128 packages in 4s
## npm run build
dist/index.html                                                     0.62 kB │ gzip:   0.38 kB
✓ built in 1.76s
## npm test
 Test Files  1 passed (1)
      Tests  25 passed (25)
   Duration  632ms (transform 260ms, setup 0ms, import 281ms, tests 41ms, environment 0ms)
## npm audit
found 0 vulnerabilities
## storage-api grep (expect no matches in src)
none
## fetch/XHR grep (expect none)
none
## dist size
484K
```
Dependency note: the first install pulled vitest 3.2.7, for which `npm audit` reported 2 moderate advisories in `@vitest/mocker` (dev-only, not shipped). Upgraded to vitest ^4.1.11; the suite passed unchanged and `npm audit` reports 0 vulnerabilities (above).

## Browser workflow (`qa-tools/browser_qa.mjs`, Playwright Chromium, reduced motion)
*(External harness, original build, 2026-10-01; not re-run in the October 2026 round, so the log and screenshots below predate the coverage column and the info finding.)*
Preview served with `vite preview --port 6134`. Log:
```
findings: 17
detail: CRITICAL TEMP-ANY allows any source → any destination on all ports
overbroad proposal: PROPOSED CHANGE · MANUAL REVIEW REQUIRED | approve disabled=true
vpn proposal without jump host: PROPOSED CHANGE · MANUAL REVIEW REQUIRED
vpn proposal with broader 0.0.0.0/0: PROPOSED CHANGE · MANUAL REVIEW REQUIRED | Manual review required: the supplied destination 0.0.0.0/0 is not a strict subset of VPN-R
vpn proposal with jump host: PROPOSED CHANGE · NARROW
approved: Proposal approved; change set updated.
diff rows: 2 | Re-analysing the rule set after these changes: 15 findings would remain (now 17). Remaining: 1 critical, 3 high, 2 medium, 9 low.
csv header: "severity","kind","ruleId","relatedRuleIds","title","detail","proposal","approved"
import error: line 2: src "999.1.1.1" is not a valid IPv4 CIDR or "any"
[desktop] horizontal overflow px=0 errors=0 
[tablet] horizontal overflow px=0 errors=0 
[mobile] horizontal overflow px=0 errors=0
```
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three. *(These screenshots show the 40-rule fixture and the pre-round Rules table without the Coverage column.)*

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
*(External harness, original build; not re-run this round.)*
```
ruleshadow: reached .finding after 10 Tabs, visible focus outline=true, activation changed detail=true ("CRITICAL TEMP-ANY allows any source → any destinat")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
*(External harness, original build; not re-run this round.)*
```
desktop: 0 violations, 31 rule groups passed, 2 incomplete (needs manual review)
mobile: 0 violations, 32 rule groups passed, 2 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- Fixture: 40 synthetic rules; on review date 2026-10-01 the engine reports 17 findings: 1 critical (any/any allow), 4 high (3 opposite-action shadows, 1 VPN→RDP on a /8), 3 medium (2 expired, no final deny), 9 low (5 same-action shadows, 4 stale). *(October 2026: 41 rules; the same 17 findings plus 1 info `partially-shadowed` — 18 in total.)*
- Browser workflow exercised: select critical finding → approve narrowing proposal → change set shows 1 diff row and re-analysis count → toggle disabled rules → export CSV (quoted, formula-safe header verified) → invalid CIDR import rejected with line number.

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.

## Upgrade round — October 2026 (lab-wide)

Recorded 2026-10-04 on Node v20.20.1, npm 10.8.2, Linux sandbox, via the lead's per-app helper (`npx vitest run --reporter=verbose`, `npx tsc -p tsconfig.json --noEmit`, `npm run build`, `npm audit --audit-level=high`). Every line quoted below is copied from the saved command output; the `qa/*.txt` files are the helper's verbatim captures (command, UTC timestamp, Node version, exit code, full output). Paths are repository-relative.

### Hygiene (contracts C1–C3)
- `vercel.json` replaced with the lab-wide canonical header set: CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`. Previously: `frame-ancestors 'self'`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, no COOP/CORP/HSTS. `form-action 'none'` is safe: the app has no `<form>` element. AUDIT.md updated to match.
- `package.json`: `"engines": { "node": ">=20.19" }` added.
- `index.html`: `<meta name="color-scheme">` changed from `light dark` to `light` — `src/styles.css` sets `html, body { background: var(--bg) }` with `--bg: #f2f4f7` and has no `prefers-color-scheme` query.
- Baseline re-measured before any engine change (helper `test`, 09:18 UTC): `Tests  25 passed (25)`.

### Feature: partial-shadow coverage (test-first)
New `src/engine/boxes.ts` (axis-aligned box subtraction, BigInt volumes, fragment budget), `analyzeCoverage` and the `partially-shadowed` finding kind in `src/engine/analyze.ts`, a manual-review proposal in `src/engine/change.ts`, additive `coverage` in the report and findings CSV (`src/engine/report.ts`), the 41st fixture rule `FIN-ERP-WIDE`, and UI wiring (`src/ui/RuleRow.tsx` `CoverageBar`, Rules-tab Coverage column, detail coverage line).

**RED, first attempt — `qa/red-partial-shadow.txt` (09:54 UTC) — partly invalid, kept for the record.** The new tests were written (`src/engine/boxes.test.ts`, additions to `src/engine/engine.test.ts`) and the full suite was run before any implementation or stub existed:
```
      Tests  10 failed | 22 passed (32)
     Errors  1 error
```
Seven of the ten failures are behavioural assertions (`expected 40 to be 41`, `expected [] to deeply equal [ 'FIN-ERP-WIDE' ]`, `expected undefined to match object { id: 'partially-shadowed:R', …`), but three are `TypeError: analyzeCoverage is not a function`, and `boxes.test.ts` was never collected — the vitest fork worker timed out on the overloaded host (`[vitest-pool]: Failed to start forks worker … Timeout waiting for worker to respond`). Under the lab's evidence rule an import/`is not a function` failure is not behavioural RED, so the run was repeated with stubs.

**RED, clean (stubs exporting the real signatures with placeholder values: `volume → 0n`, `ruleBoxes → { tcp: [] }`, `subtractBoxes → { remainder: [target], approximate: false }`, `coverage → zeros`, `analyzeCoverage → {}`, `findingRows` without the coverage column).**
`qa/red-boxes.txt` (18:40 UTC, `npx vitest run --reporter=verbose src/engine/boxes.test.ts`):
```
      Tests  14 failed | 1 passed (15)
AssertionError: expected 0n to be 1208925819614629174706176n // Object.is equality
AssertionError: expected [ 'tcp' ] to deeply equal [ 'icmp', 'tcp', 'udp' ]
AssertionError: expected [ { …(3) } ] to have a length of 6 but got 1
AssertionError: expected false to be true // Object.is equality          (approximate flag on the 300-slab set)
AssertionError: expected { fraction: +0, …(2) } to deeply equal { fraction: 1, …(2) }
AssertionError: expected '100%' to be '>99%' // Object.is equality
```
The single pass is the determinism test, which a constant stub satisfies trivially.
`qa/red-partial-shadow-2.txt` (18:40 UTC, `npx vitest run --reporter=verbose src/engine/engine.test.ts`):
```
      Tests  8 failed | 24 passed (32)
AssertionError: expected [] to deeply equal [ 'FIN-ERP-WIDE' ]
AssertionError: expected undefined to match object { id: 'partially-shadowed:R', …(3) }
AssertionError: expected undefined to deeply equal { fraction: 0.25, …(2) }
AssertionError: expected [] to have a length of 301 but got +0
```
All eight failures are missing behaviour (the 41-rule fixture already parsed, so the two fixture-count assertions from the first attempt had turned green).

**GREEN — `qa/green-partial-shadow.txt` (18:55 UTC, full suite):**
```
 Test Files  2 passed (2)
      Tests  47 passed (47)
   Duration  3.02s (transform 289ms, setup 0ms, import 342ms, tests 2.18s, environment 0ms)
```
The slowest test is the hostile 301-rule slab set in `engine.test.ts` (1 894 ms for 301 coverage computations under the 4 000-fragment budget); it asserts `approximate: true`, a fraction strictly between 0.3 and 1, and completion within 10 s.

### Measured fixture facts (41 rules, review date 2026-10-01)
- 18 findings: the 17 of the original kinds (1 critical, 4 high, 3 medium, 9 low — the same rule ids as before: redundant CORP-TELNET-LEGACY, FIN-ERP-DUP, ICMP-MON, PARTNER-SFTP, PARTNER-SFTP-OLD; conflict DENY-DMZ-TO-CORP, DENY-TELNET, DMZ-DB-LEGACY) plus 1 info `partially-shadowed:FIN-ERP-WIDE` ("50% already handled by FIN-ERP"). Asserted by the golden test.
- Report `coverage` rows: FIN-ERP-WIDE 0.5 by FIN-ERP; PARTNER-SFTP-OLD 1.0 by TEMP-ANY; CORP-DNS 0; DISABLED-OLD `fraction: null` (disabled rules are not analysed); no fixture rule is `approximate`.
- Approving the two safe proposals (HR-PAYROLL disable, VPN-RDP-ALL narrowed to `10.0.5.10/32`) takes re-analysis from 18 to 16 findings (17 → 15 of the original kinds).

### Typecheck, build, audit (2026-10-04)
- `npx tsc -p tsconfig.json --noEmit` → exit 0.
- `npm run build` (`tsc -p tsconfig.json && vite build`):
```
dist/assets/index-DgKuhSlU.css                                     10.68 kB │ gzip:   2.97 kB
dist/assets/index-C06zUzSY.js                                     335.68 kB │ gzip: 108.02 kB
✓ built in 5.69s
```
- `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### Accessibility and contrast for the new UI (computed, WCAG 2.x relative luminance; not an axe run)
- Coverage is shown as text first (`50%`, `>99%`, `<1%`, `100%`, suffix `approx.` when budget-limited) with the bar as a visual aid and a visually-hidden sentence naming the covering rules; disabled rules read "— not analysed (disabled)". Nothing is conveyed by colour alone.
- Coverage label `--ink #1b2430` on the white panel: **15.65:1**; on the current-row tint `--steel-soft #e6eef7`: **13.37:1**.
- Muted text `--ink-2 #5a6678` on white: **5.82:1**; on `--steel-soft`: **4.97:1**.
- Info severity chip (new kind): white on `--info #2f855a`: **4.54:1** (existing token, now used for the first time by a finding).
- Bar fill `--steel #2f5d8a` against track `--line #dde2ea`: **5.29:1** (non-text, ≥ 3:1).
- No new focusable controls were added; the coverage column is static content inside the already keyboard-reachable scrollable table (`tabIndex=0`). No motion added.

### Lead browser check and mobile layout fix (2026-10-04, 19:05 UTC)
The lead's integration browser check of the rebuilt bundle (Playwright Chromium, the lead's harness — not run by this worker) reported: desktop fine, axe 0 violations, workflow ok, but at a 375 × 800 viewport the document `scrollWidth` was **551 px** (baseline build: 375 px on the same harness) after rendering the Rules tab. Diagnosis from the stylesheet: the rules table already sits in `.table-wrap { overflow-x: auto }`, so the table itself cannot widen the page; the new `CoverageBar` carried a `.visually-hidden` sentence (`position: absolute; width: 1px`) whose static position lies inside the horizontally scrolled table, and with no positioned ancestor it was placed against the initial containing block at ≈ 540 px, widening the document. Fix (CSS only, plus label-before-bar order in `src/ui/RuleRow.tsx`): `.table-wrap` and `.coverage` are now `position: relative`, so the hidden sentence is contained inside the scroll container; the percentage text comes first in the cell so it is the first thing seen when the table is scrolled. Rebuilt afterwards:
```
dist/assets/index-lr7sohn_.css                                     10.71 kB │ gzip:   2.97 kB
dist/assets/index-DUqu9h-s.js                                     335.68 kB │ gzip: 108.02 kB
✓ built in 3.36s
```
The lead re-measured the rebuilt bundle (19:13 UTC): `scrollWidth` 375 at a 375 px viewport, axe 0 violations, workflow ok. This worker has no browser in the repository and did not measure it; the lead's screenshots are private integration state, not part of this repository. The lead's later new-feature browser flow (Rules tab → Coverage column showing `50%` for FIN-ERP-WIDE → the info finding's detail, coverage line and manual-review proposal → CSV export with the trailing `coverage` column → JSON export with the `coverage` array) passed 21/21 steps under the production CSP. The built CSS contains no `data:` URLs (`grep -c "data:" dist/assets/index-lr7sohn_.css` → `0`; the smallest bundled font subset is 9.86 kB, above Vite's 4 KiB inline limit), so `font-src 'self'` is honoured without a build-config change — unlike wireglass, whose EVIDENCE.md records the fix.

### Not measured in this round
- No browser, keyboard or axe run was performed by this worker in this round (no Playwright package in the repository; browser QA is the lead's integration step — see the lead check above). The screenshots in `qa/` are from 2026-10-01 and predate the Coverage column and the info finding.
- The 4 000-fragment budget is a correctness/latency guard, not a benchmark; only the single hostile slab case was timed (1.9 s for 301 rules inside vitest).

Every repository-relative file path named in README.md, AUDIT.md, INTERVIEW_GUIDE.md and this file exists in the repository, except the artefacts listed in the inventory below. The absolute path quoted in the original RED output at the top of this file (the module-resolution error) names the original build environment, not a repository path; the corresponding file here is `src/engine/engine.test.ts`.

### Artefact inventory
Referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE but **not** in this repository, with the reason:
- `qa-tools/verify-all.sh` — external clean-checkout harness used during the original build (2026-10-01); not part of this repository. Its measurements above cannot be re-run from the repository alone; the October 2026 section re-measures tests, build and audit with the lab's helper instead.
- `qa-tools/browser_qa.mjs` — external Playwright browser-QA harness (original build); not in this repository; not re-run by this worker this round.
- `qa-tools/keyboard_qa.mjs` — external keyboard-pass harness (original build); not in this repository; not re-run this round.
- `qa-tools/axe_qa.mjs` — external axe-core harness (original build); not in this repository; not re-run this round. The retained result summary is the committed axe JSON file in the qa folder.
- `HANDOFF.md` — the original build's hand-off note where the first axe findings were recorded; it was not committed to this repository.
