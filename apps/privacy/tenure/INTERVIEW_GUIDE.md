# INTERVIEW_GUIDE.md — Tenure

Rehearsal material. This project was built with substantial AI assistance and has not been independently reviewed by the candidate; study and be able to explain the following unaided before presenting it as personal work.

## The engine in two minutes

Three pure stages. `normaliseCatalog` makes ids and vocabulary canonical and writes a note for every change, so an importer can show its work. `buildGraph` turns systems and flows into a layered DAG (Kahn's algorithm for longest-path layers, a DFS that collects cycle witnesses, not every elementary cycle). `runChecks` walks systems, elements, flows, cycles and exceptions, emitting findings with stable ids, a severity and a plain-language "why", then applies live exceptions (approved, unexpired, active approver) to mark findings accepted rather than hide them.

The one heuristic to be upfront about: **retention inflation** matches a downstream copy by element *name* or id *suffix*, because the synthetic catalog has no lineage identifiers. In production you would carry a lineage key on the flow.

## One failure case

`marketing-platform.email` is kept 3,650 days while its source `crm.email` is kept 730. Exception `ex-002` accepted that, but expired on 2026-06-30. With the as-of date at 2026-10-01 the engine reports *both* `EXCEPTION_EXPIRED` and a live `RETENTION_INFLATION`. Move the as-of date back to June and the inflation becomes accepted again; this is the test `an expired exception no longer accepts the finding and is itself reported`.

## Why the tests look like this

- One test per finding code plus a "clean catalog produces no findings" test; without the clean test, over-eager checks go unnoticed (the first run of the clean test caught exactly that: the tiny fixture itself had purpose drift, and the fixture was corrected, not the engine).
- Property test for layering: for random acyclic graphs every edge goes to a strictly higher layer. Example tests cannot cover enough shapes.
- The demo fixture's seeded defects are asserted so documentation claims ("the demo shows X") are executable.
- CSV escaping is tested with a `=HYPERLINK` payload because exports are the most likely place for a spreadsheet-side injection.

## Q: Why could a purpose-drift finding not be accepted before, and what changed?

A: Exceptions originally had a single `elementId`, so the acceptance step only ever compared element-subject findings; `PURPOSE_DRIFT`, `UNMAPPED_TRANSFER` and `DANGLING_FLOW` are raised against flows and simply had no route — the README listed it as a limitation. In October 2026 `RetentionException` gained an optional `subject: { kind: 'element' | 'flow', id }`; the legacy `elementId` still works and means `{ kind: 'element', id }`, so every older catalog imports unchanged. The matching rule is deliberately exact: code, kind and id must all agree. That matters for purpose drift, which is reported per flow/element pair with the subject `flow-id/element-id` — an exception for the whole flow does not blanket-accept every element it carries; you accept one element on one flow, with a rationale, an active approver and a term of at most 365 days, exactly as for element findings. The importer checks that a subject names a known element, a known flow, or a known flow *and* a known element after the slash, after normalisation, and rejects anything else with the path of the offending exception. The fixture now ships one such exception (`ex-004`, customer id flowing from the CRM to billing) and a test asserts it accepts precisely that finding and nothing else. What remains unmodelled: system-subject findings (owners, cycles) still cannot be accepted.

## Production next steps

- Lineage keys on flows; column-level inventory with discovery connectors feeding the same catalog schema.
- Legal retention references as structured citations with jurisdiction; transfer assessments as first-class objects.
- Owner directory integration so inactive owners are detected automatically.
- Persisted exceptions with approval workflow and audit trail.
