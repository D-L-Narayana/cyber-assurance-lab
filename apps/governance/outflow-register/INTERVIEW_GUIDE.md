# INTERVIEW GUIDE — Outflow Register

## Core engine in two minutes

A sharing register is three joined lists — agreements, flows and obligations — and the risk lives in the joins. `findIssues` walks those joins as of a date: a flow whose categories are not in its agreement, a flow whose agreement has ended, an agreement whose owner left, an obligation with no evidence, two live agreements with the same vendor promising different breach windows. Status is read through `effectiveStatus`, so "recorded active but past the end date" is itself a finding rather than an invisible default. Renewal priority is an additive score whose five factors are exported with the number, so a manager can argue with the arithmetic instead of trusting a colour. The state machine exists to make the uncomfortable step explicit: you cannot terminate an agreement that still has active flows without acknowledging them in writing.

## One failure case

Two obligations on the same agreement both lacked evidence and my first issue id scheme (`kind:agreement:flow`) produced duplicate ids, which would have made de-duplication in a UI or ticketing export silently drop one finding. The "stable unique ids" test caught it; the id now includes the obligation id. The broader lesson: identity for findings must come from the *thing that is wrong*, not from the container it sits in.

## Why the tests look like this

- Each detector has its own assertion on a fixture engineered to trigger exactly one instance, so a regression names the detector.
- Priority tests check ordering *and* that the score equals the sum of the breakdown, so the explanation can never drift from the number.
- Transition guards are tested individually (owner, categories, acknowledgement, later end date, undefined edge, empty reason) because each is a distinct business rule.
- The packet test counts flows including an inactive mismatched one — a correction I made to my own expectation after the engine was right.

## Production next steps

1. Attach evidence files with hashes and reviewer sign-off; expire evidence by age.
2. Add approval workflow and notifications for renewal windows and acknowledgements.
3. Compare more obligation kinds across agreements (sub-processor notice periods, audit rights, deletion windows).
4. Import flows from DLP/SaaS telemetry to reconcile declared vs observed sharing.
5. Map categories and mechanisms to the organisation's actual policy taxonomy and cite it.
