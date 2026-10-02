# Ruleshadow — firewall and VPN rule-review simulator

Educational prototype built October 2026. Ruleshadow analyses a **synthetic firewall/VPN rule table** entirely in the browser: IPv4 CIDR and port expressions become integer intervals, and interval arithmetic finds rules that are shadowed (same or opposite action, including shadowing by the *union* of several earlier rules), overbroad allows, expired and unused rules, VPN-zone reach to management ports, and a missing final deny. Each finding is paired with a plain-language reading of the rule and a proposed change; approving proposals builds a before/after diff and a re-analysis preview. No device is contacted and nothing is deployed.

## Key workflows
1. **Review the findings list** (sorted by severity) and select one.
2. **Read the detail** — measured facts (e.g. "expired 93 days ago", "16,777,216 addresses"), the rule in plain English, and the earlier rule(s) that cover it.
3. **Approve or reject the proposal** — disable (expired, same-action shadowed), add expiry derived from the review date (+30 days, stale), narrow to a jump host you supply (VPN management) — accepted only when it is a **strict subset** of the rule's current destination (contained and smaller); equal, broader or outside CIDRs fall back to manual review with the reason, add deny-all (no final deny). Findings the engine cannot safely resolve — overbroad allows, conflicts, and VPN narrowing without a supplied jump host — are marked **manual review required** with no automatic change, so the re-analysis preview never implies they are resolved.
4. **Change set tab** — field-level diff with before/after, plain-language after-state, and "N findings would remain after these changes".
5. **Rules tab** — all rules with footprint bars (source/destination block size on a log scale and port coverage 0–65535), owner, last hit and finding chips; toggle disabled rules.
6. **Adjust review date and stale window**; findings recompute.
7. **Import CSV** (≤ 500 rules, validated line by line with reasons) or load the fixture text to edit.
8. **Export** `ruleshadow.report/1` JSON or a formula-safe findings CSV.

## Quickstart
```bash
npm ci
npm test
npm run build
npm run dev   # http://127.0.0.1:6134
```

## Algorithm
- **Intervals** (`net.ts`): CIDR → `[lo, hi]` on 32-bit integers (host bits masked); ports → merged interval list; `subtractIntervals` returns the uncovered remainder.
- **Shadowing** (`analyze.ts`) — *containment-based port-union analysis*: for each enabled rule in sequence order, only earlier enabled rules whose source range, destination range, zones and protocol set **contain** the rule are considered. Walking those in first-match order, each earlier rule contributes only the part of the rule's port space it still owns after the rules before it (so an earlier rule that is itself fully shadowed never counts as operative coverage). If the consumed port space covers the rule completely it is shadowed: all operative covering rules share its action → `redundant`; all have the opposite action → `conflict`; mixed actions → `conflict` with a per-range trace ("ports 80–200 already denied by A; 201–443 already allowed by B"). Partial overlap, and coverage assembled from several earlier rules that each contain only *part* of the address range, are **not** analysed — this is deliberately narrower than general IP-space union coverage.
- **Overbroad**: allow with any→any, or all ports with any source or destination.
- **VPN management**: allow from a VPN zone to a destination ≥ /16 on TCP 22/3389/445/135/5985/5986.
- **Expired**: `expires < reviewDate` and enabled. **Stale**: allow with no hit within the stale window or never.
- **No final deny**: the last enabled rule is not a deny with any source, any destination, any protocol, all ports **and** zones any→any (a zone-scoped deny is not a global final deny).
- **Proposals** (`change.ts`): deterministic per finding kind and review date; proposals that would require inventing address scopes are `manualReview` with `after: null`; `applyProposals` only applies approved ones; `diffRuleSets` lists changed fields. Approving the two safe fixture proposals (VPN narrowing with a supplied jump host, HR-PAYROLL disable) takes the fixture from 17 to 15 findings; the remaining ones are genuinely unresolved.
- **Modelling nuances**: ICMP rules are modelled as covering all ports, so a protocol-`any` rule with *specific* ports never covers an ICMP rule (conservative: fewer shadow reports, not more). Coverage assembled per protocol (`tcp:443` + `udp:443` + `icmp` earlier rules covering a later `any:443`) and coverage assembled from partial address overlaps are not detected. A `redundant` label means "fully covered by same-action *containing* operative rules"; an earlier non-containing deny that contradicts part of the rule is not considered, so confirm before treating "redundant" as "safe to remove" — the disable proposal says so.
- **CSV export** (`report.ts`): every cell quoted; a cell whose first non-whitespace/non-control character is `= + - @`, or that starts with a control character, is prefixed with `'` to neutralise spreadsheet formula injection.
- **CSV import dates** must be calendar-valid (`Date.UTC` round-trip), so `2026-02-30` is rejected.

## Fixture
40 synthetic rules across zones corp / dmz / vpn / mgmt / guest / internet with planted defects: an any/any troubleshooting allow that shadows everything after it, a DMZ→database allow that conflicts with an earlier deny, two expired rules, unused allows, VPN RDP to a /8, duplicate partner SFTP rules, and a final deny that is disabled. On review date 2026-10-01 the engine reports 17 findings (1 critical, 4 high, 3 medium, 9 low).

## Architecture
`src/engine/*` (net, rules, analyze, change, explain, report, fixtures) is framework-free TypeScript; `src/App.tsx` and `src/ui/RuleRow.tsx` are presentation. In-memory state only.

## Tests
25 vitest tests: CIDR/port parsing and rejection, interval subtraction, redundant vs conflict vs partial overlap, port-union shadowing, first-match precedence (a shadowed earlier rule is not operative coverage), mixed-action full shadowing, disabled-rule exclusion, overbroad, expired/stale, VPN management exposure, missing final deny (including zone-scoped deny), CSV fixture parse and bounds, line-level CSV errors, calendar-invalid dates, golden finding kinds for the fixture, proposals/apply/diff with rejection and post-change re-analysis, manual-review proposals for overbroad/VPN-without-jump-host/invalid CIDR, strict-subset check on the supplied jump host (0.0.0.0/0, identical, outside and superset CIDRs refused), review-date-derived stale expiry, plain-language explanation, CSV formula neutralisation (including leading whitespace/control characters), report schema. RED/GREEN in `EVIDENCE.md`.

## Limitations
- IPv4 only; no address objects/groups, NAT, application-layer rules, or device-specific syntax.
- Shadow analysis is containment-based (address ranges must fully contain the later rule); it does not detect shadowing assembled from partial address overlaps and does not compute partial shadowing percentages.
- Zone semantics are string equality plus `any`; no topology model.
- "Last hit" comes from the CSV; there is no telemetry integration.
- Proposals are templates, not a validated remediation plan; the VPN narrowing target is whatever jump host the reviewer supplies, and overbroad/conflict findings are never auto-resolved.

## JD evidence (educational, not professional experience)
TCP/IP addressing and port reasoning, firewall/VPN policy hygiene (least privilege, shadowing, expiry, logging of denies), secure-configuration review with a reviewer approval step, plain-language translation for non-network stakeholders.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; tests ran failing before implementation. A reviewer-raised precedence gap (an already-shadowed rule counted as coverage) was fixed with new failing tests first. `INTERVIEW_GUIDE.md` explains the engine; the candidate should rehearse it before presenting this project.
