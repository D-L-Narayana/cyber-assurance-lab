# EVIDENCE — ruleshadow

Recorded 2026-10-01 on Node v20.20.1, npm 10.8.2, Linux sandbox. All numbers below are copied from command output; nothing is estimated.

## Test-first record

**RED (before any engine code existed)** — `npx vitest run`:
```
Error: Cannot find module './net' imported from '/home/user/workspace/cyber-portfolio/candidates/defense/ruleshadow/src/engine/engine.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
The failure is a module-resolution error because the engine files did not exist yet; the test file was written first and committed to the design.

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
  Fixture metrics were unchanged by the fix (17 findings: 1 critical, 4 high, 3 medium, 9 low).
- **Sixth-Fable review round (2026-10-01)** — proposals did not resolve their own findings (overbroad narrowed ports but stayed any→any; stale expiry hard-coded). Three new tests failed first (`qa/red-run-3.txt`), then: overbroad allows and conflicts are `manualReview` proposals with no automatic change; VPN narrowing is generated only when the reviewer supplies a valid jump-host CIDR; stale expiry = review date + 30 days. Browser QA: approving the two safe fixture proposals takes re-analysis from 17 to 15 findings; the overbroad proposal's Approve button is disabled. README documents the ICMP/proto-any asymmetry, per-protocol and partial-address assembly limits, and the "redundant ≠ safe to remove" nuance.
- **Round 3 (parent probe, 2026-10-01)** — any valid CIDR was accepted as the jump host, so `0.0.0.0/0` for a `10.0.0.0/8` rule was labelled `narrow` and would have broadened it. One failing test first (`qa/red-run-4.txt`), then: the supplied destination must be a strict subset of the current destination (contained and smaller); equal, broader or outside → manual review with reason. Browser QA confirms `0.0.0.0/0` yields "manual review required … not a strict subset" and `10.0.5.10/32` yields `narrow`.


**GREEN** — `npx vitest run` after implementation:
```
 Test Files  1 passed (1)
      Tests  25 passed (25)
   Start at  14:39:08
   Duration  387ms (transform 160ms, setup 0ms, import 182ms, tests 38ms, environment 0ms)
```

## Clean-checkout verification (`qa-tools/verify-all.sh`)
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
Screenshots in `qa/`: desktop-after-workflow.png, desktop-start.png, mobile-start.png, tablet-start.png. Viewports 1440×1000, 768×1024, 375×860; `horizontal overflow px=0` and `errors=0` (no page errors, console errors or failed requests) at all three.

## Keyboard-only pass (`qa-tools/keyboard_qa.mjs`)
```
ruleshadow: reached .finding after 10 Tabs, visible focus outline=true, activation changed detail=true ("CRITICAL TEMP-ANY allows any source → any destinat")
```

## Accessibility scan (`qa-tools/axe_qa.mjs`, axe-core WCAG 2.0 A/AA + 2.1 AA, start view, 1440 and 375 widths)
```
desktop: 0 violations, 31 rule groups passed, 2 incomplete (needs manual review)
mobile: 0 violations, 32 rule groups passed, 2 incomplete (needs manual review)
```
First run surfaced colour-contrast and scrollable-region-focusable issues (recorded in HANDOFF.md); palette tokens were darkened/brightened and scroll regions made focusable, then the scan was repeated. Only the initial view is scanned; dialogs and post-interaction states are covered by the Playwright workflow (which uses accessible roles/labels to find controls) and the keyboard pass above, not by axe.

## Measured facts usable in a resume bullet (educational project, not professional experience)
- Fixture: 40 synthetic rules; on review date 2026-10-01 the engine reports 17 findings: 1 critical (any/any allow), 4 high (3 opposite-action shadows, 1 VPN→RDP on a /8), 3 medium (2 expired, no final deny), 9 low (5 same-action shadows, 4 stale).
- Browser workflow exercised: select critical finding → approve narrowing proposal → change set shows 1 diff row and re-analysis count → toggle disabled rules → export CSV (quoted, formula-safe header verified) → invalid CIDR import rejected with line number.

## Not measured / not claimed
- No real-world detection or review efficacy; all metrics are on synthetic fixtures.
- axe-core scanned only the initial view at two widths; one scripted keyboard path (Tab to first list control → activate) was verified, not every control. "Incomplete" items are axe's needs-review bucket, not failures.
- No cross-browser matrix beyond headless Chromium.
