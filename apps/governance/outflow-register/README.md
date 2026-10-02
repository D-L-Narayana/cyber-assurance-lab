# Outflow Register — data-sharing agreement and vendor-flow register

Outflow Register is an **educational prototype** for the privacy/GRC question "what do we share, with whom, under which agreement, for how long, and are the obligations actually evidenced?" It holds a synthetic register of vendors, agreements, owners, control obligations and system-to-vendor data flows, detects twelve kinds of gaps and contradictions, ranks renewals with an explained score, enforces a guarded agreement state machine with history, and exports evidence packets.

Vendors, contracts and people are synthetic; transfer mechanisms are labels, not legal determinations. Not legal advice.

## What it demonstrates

| Capability | UI | Engine |
|---|---|---|
| Effective status (recorded `active` past its end date is `expired`) | Status column | `effectiveStatus` |
| 12 issue detectors: missing/departed owner, expired-but-active, renewal window open, flow without agreement, flow under a draft (unsigned) agreement, flow category not covered, flow after end, deletion obligation unmet, obligation without evidence, contradictory breach windows per vendor, stale flow, vendor mismatch | Issue badges, red ribbons on the flow map, agreement detail | `findIssues` |
| Explained renewal priority (expiry ≤40, restricted categories ≤20, active flows ≤20, open obligations ≤15, missing owner 10) | Renewal cockpit with per-factor bars and arithmetic | `renewalPriority`, `renewalQueue` |
| State machine with guards: activation needs owner + categories; renewal needs a later end date; termination with active flows needs explicit acknowledgement; every change needs a reason and is appended to history | Change status panel, History | `transition` |
| Evidence packet per agreement (`outflow.packet/v1` JSON + Markdown) | Evidence packet buttons | `evidencePacket` |
| Register export (`outflow.register/v1`) and formula-safe issues CSV | Header buttons | `exportIssues` |
| Bounded, typed import | Load register | `validateRegister`, `parseBoundedJson` |

## Quickstart

```bash
npm ci
npm test        # vitest: 30 tests in 3 files
npm run build   # tsc --noEmit && vite build (base './')
npm run dev     # http://localhost:6144
```

Demo register (`scripts/generate-fixture.mjs`): 5 internal systems, 6 vendors, 5 owners (one left), 12 agreements, 15 flows (one active pilot flow under a still-draft agreement). Seeded gaps: an expired backup agreement still feeding a flow with four categories; a benefits agreement whose owner left and whose flow ships identity documents it does not cover; a billing flow with no agreement; conflicting 24h/72h breach windows at PayCo; a legacy survey tool terminated with its flow still active and deletion unevidenced.

## Algorithm notes

- Issues are deterministic, have stable ids (`kind:agreement:flow[:obligation]`) and are sorted by severity (high → low) then id. Severity per kind is a fixed table in `register.ts`.
- Renewal priority is additive and fully disclosed in `breakdown`; the queue excludes drafts and terminated agreements.
- Transitions are the only way to change status; `effectiveStatus` is a read-time view and never mutates the record. Terminating with active flows does not silently deactivate them — it records the acknowledgement and the flows surface as `flow_after_end` until they are stopped or re-papered.
- Obligation `kind` is validated against the enum so a typo cannot silently escape contradiction checks.
- Contradiction detection parses hour-based breach windows (`24h`, `72h`); non-hour phrasing is ignored (documented limitation).

## Architecture

```
src/engine/types.ts      Vendor, Owner, Agreement, Obligation, Flow, Issue, RenewalPriority, HistoryEntry
src/engine/register.ts   effectiveStatus, findIssues, renewalPriority/renewalQueue, transition, evidencePacket, validateRegister, exportIssues
src/engine/safe.ts       bounded JSON, strict ISO dates, formula-safe CSV
src/ui/App.tsx           single view: flow map (SVG) · agreements table · renewal cockpit · agreement detail with transitions
```

No storage APIs; in-memory state resets on refresh.

## Tests

- `register.test.ts` (19): active flow under a draft agreement, obligation-kind enum validation, renewal end date after as-of, each detector, stable ids/sorting, priority ordering and breakdown arithmetic, queue exclusions, all transition guards (owner, categories, acknowledgement, later end date, undefined transitions, empty reason, unknown id), packet contents, malformed/oversize validation, export schema and CSV escaping.
- `safe.test.ts` (10), `validate-demo.test.ts` (1).

## Limitations

- No contract text or clause parsing; obligations are structured records entered by hand.
- Only hour-based breach windows are compared for contradictions; other obligation kinds are not cross-checked between agreements.
- Flows are declared, not discovered; there is no connector to network or SaaS telemetry.
- No approval chain for status changes; one user, one session.
- Transfer mechanism and lawful-basis style fields are labels only; the tool makes no legal determination.

## JD evidence (truthful framing)

Supports "built a test-first data-sharing register with gap/contradiction detection, explained renewal prioritisation and a guarded agreement lifecycle with evidence packets" — relevant to privacy tech, third-party risk and executive communication signals. Not evidence of OneTrust/CENTRL product experience or of managing real vendor contracts.

## Design direction

A contracts registry desk: slate header, white sheets on a pale desk, saffron reserved for "needs your attention" (selection, priority bars, warnings). Newsreader italic gives agreement titles a document feel; Hanken Grotesk carries the UI; Azeret Mono carries ids, dates and categories. The signature is the pairing of the flow map (ribbons that turn red when a flow is out of contract) with the renewal cockpit whose five-segment bar is the score's arithmetic made visible.

## AI-assistance disclosure

Built October 2026 with AI assistance (Claude) under a test-first workflow; the author reviewed logic, tests and limitations. Dependencies and fonts: `THIRD_PARTY_NOTICES.md`. MIT.
