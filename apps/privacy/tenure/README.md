# Tenure — data inventory and retention graph

Educational, browser-local prototype for privacy engineers who need a *defensible* map of where personal data lives, where it flows, who owns it and how long it is kept. Tenure imports a synthetic data catalog, normalises its vocabulary, builds a layered lineage graph of systems and flows, runs fourteen consistency checks (orphaned elements, inactive owners, missing schedules, retention inflation, purpose drift, unmapped cross-region transfers, cycles, lapsed or out-of-policy exceptions, overdue reviews) and produces a retention review calendar. Every finding explains why it matters, can be time-box-accepted by an active owner, and is exportable as JSON or injection-safe CSV.

> Educational prototype. No live system is discovered, connected or scanned; the catalog is a JSON file you control. Retention periods and legal references in the fixture are placeholders, not legal advice. Vendor products (BigID, OneTrust and similar) are context only.

## Key workflows

1. **Read the map.** Systems are laid out left-to-right by lineage layer (sources first). The ring on each node encodes its longest retention on a log scale; dashed edges cross regions; a thick clay edge is a cross-region flow with no transfer mechanism; badges count open findings (critical/high vs other). Click or keyboard-select a node to inspect it. Zoom controls and a full inventory table provide the accessible fallback.
2. **Inspect a system.** Owner (with inactive/missing states), region, hosting, purposes, flow degree, every element with effective retention and review status, and the findings that touch it.
3. **Work the findings.** Filter by severity and code. Element-level findings can be accepted with an exception: rationale (20+ chars), an *active* approver, an expiry date. Accepted findings remain visible and lapse when the exception expires or the approver leaves.
4. **Review calendar.** Every element's review cadence comes from its schedule; overdue, never-reviewed, due-soon and current items are listed with a one-click "mark reviewed today" that is reflected in the findings.
5. **Normalise messy catalogs.** Import a file with "PII", "Europe" or "SCCs" and see each change recorded in the Normalisation notes tab. Unknown vocabulary is rejected with a precise message.
6. **Export** the catalog, findings JSON (with summary) or findings CSV (formula-injection guarded).

## Quickstart

```bash
npm ci
npm test        # 42 tests: engine 37 (31 test-first + 6 review-driven) + UI integration 5
npm run build
npm run preview # http://127.0.0.1:6102
```

## Algorithm

- **Normalisation** (`normalise.ts`): ids trimmed and lower-cased; categories, regions and transfer mechanisms mapped through synonym tables to a canonical vocabulary; duplicate list entries removed; every change is a note `{path, from, to, rule}`. Idempotent.
- **Graph** (`graph.ts`): nodes are systems, edges are flows. Layers are longest-path depths via Kahn's algorithm; nodes on cycles still receive a finite layer. Cycle *witnesses* are collected by a single DFS (one back-edge cycle per back edge found); this is not a complete enumeration of every elementary cycle, and the FLOW_CYCLE finding should be read as "circular flows exist here", not as a full list. `crossRegion` is derived from system regions.
- **Checks** (`checks.ts`), each with a severity and a plain-language "why":

| Code | Trigger | Severity |
|---|---|---|
| ORPHAN_ELEMENT | element's system is not registered | high |
| MISSING_OWNER / INACTIVE_OWNER | system has no owner / owner inactive or left | medium / high |
| MISSING_SCHEDULE | no schedule and no override | high |
| SPECIAL_CATEGORY_UNSCHEDULED | as above for special-category data | critical |
| RETENTION_INFLATION | downstream copy (same name or id suffix) kept longer than its source | medium |
| PURPOSE_DRIFT | flow carries an element to a system sharing none of its purposes | high |
| UNMAPPED_TRANSFER | cross-region flow with mechanism `none` | critical |
| FLOW_CYCLE | circular flows (one finding per cycle witness found by DFS; not exhaustive) | low |
| DANGLING_FLOW | flow references an element the source does not hold | medium |
| EXCEPTION_EXPIRED / EXCEPTION_APPROVER_INACTIVE | lapsed or orphaned exceptions | medium |
| EXCEPTION_OUT_OF_POLICY | approved in the future, no approval date, expiry before approval, or term longer than the 365-day cap | medium |
| REVIEW_OVERDUE | review cadence elapsed since last review | low |

  An exception accepts a finding only when `status = approved`, `expiresOn ≥ asOf`, the approver is an active owner, `approvedOn` is present and not after `asOf`, and the term from approval to expiry is at most `MAX_EXCEPTION_TERM_DAYS` (365, an educational policy constant matching the fixture's one-year exceptions). Anything else is reported as `EXCEPTION_OUT_OF_POLICY` and the finding it names stays live; the UI's exception form caps the expiry date accordingly. Finding ids are `code:kind:subject`, stable across runs for diffing.
- **Review calendar** (`review.ts`): next review = last review + schedule cadence (365 days default when only an override exists); due-soon within 30 days.
- **Import bounds** (`catalogIO.ts`): 2 MB, depth 6, 200 systems, 2,000 elements, 2,000 flows, 500 owners/exceptions, 100 schedules; enum/date/sensitivity validation; duplicate ids rejected after normalisation. CSV cells beginning with `= + - @ \t \r` are prefixed with `'`.

Storage-limitation and purpose-limitation vocabulary follows the general principles in GDPR Art. 5(1)(b) and (e); the engine does not decide what period is lawful, it checks the inventory for internal consistency.

## Architecture

```
src/engine/  types, normalise, graph, retention, checks, review, catalogIO
src/fixtures/demo-catalog.json  12 systems, 6 owners (1 inactive), 6 schedules, 41 elements, 13 flows, 3 exceptions
src/ui/      LineageMap (SVG)
src/App.tsx  inspector, tabs, exception dialog, import dialog
```

React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, fast-check; Radix Tabs and Dialog; self-hosted Archivo and Atkinson Hyperlegible (Fontsource). SVG rendered directly, no chart library. Single view, `base: './'`.

## Tests

42 tests (1 Oct 2026). Engine tests were written first and run red against stubs (31 failures) before implementation (31 passes); two review-driven tests (hostile nesting, strict calendar dates) were added afterwards — see `EVIDENCE.md` for which of them ran red first. Highlights: synonym and idempotence tests for normalisation; a property test that layers form a DAG ordering for random acyclic graphs; one test per finding code including the exception-acceptance rules; review status classification; CSV formula escaping; import rejection cases. The demo fixture's seeded defects are asserted so the fixture cannot drift from the engine.

## Data handling

Browser-local; no network after load; no storage APIs; fixture owners are fictional, vendors are labelled synthetic; no element values are stored, only metadata.

## Limitations

- Retention-inflation matching uses element name or id suffix, not a formal lineage identifier.
- The 365-day exception cap is a teaching policy, not a legal requirement; acceptance of `critical` findings is not forbidden, only bounded.
- Only element-subject findings can be accepted; flow-subject findings (PURPOSE_DRIFT, UNMAPPED_TRANSFER, DANGLING_FLOW) have no exception route.
- Transfer rules are reduced to "cross-region with mechanism none"; adequacy decisions and real transfer law are not modelled.
- No field-level data discovery; the catalog is declared, not observed.
- Layout is a simple layered grid; very wide catalogs will need horizontal scrolling.

## JD evidence (educational mapping)

Privacy/data-protection operations (inventory, retention, transfers), GRC-style evidence (findings with rationale, time-boxed exceptions, exports), HTML/CSS/SVG/TypeScript, JSON contracts with validation. Not vendor product experience; not legal advice.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance (Claude) for design, tests, implementation and documentation. Human review and understanding of this code have **not** been independently established. Before this project is presented as personal work, the candidate should study the code and rehearse the material in `INTERVIEW_GUIDE.md`; this README makes no claim that such review has already happened.

## License

MIT; third-party notices in `THIRD_PARTY_NOTICES.md`.
