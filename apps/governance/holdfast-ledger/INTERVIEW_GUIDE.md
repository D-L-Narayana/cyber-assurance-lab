# INTERVIEW GUIDE — Holdfast Ledger

## Core engine in two minutes

Retention is a scheduling problem with a veto. Each record's clock starts at a trigger event (closure, termination, last contact) and ends `retainDays` later. Legal holds are the veto: if any active hold's scope matches a record, it is *held*, regardless of how overdue it is. A plan is just the list of records past their date, split into `dispose` and `skip` (naming the hold). Making the plan id a hash of its inputs gives two properties for free: the same situation always produces the same plan, and executing the same plan twice is detectable and refused. Execution appends receipts to a hash chain so later edits to the ledger are detectable by anyone who recomputes it.

## One failure case

Early in the build my own test asserted that 2 555 days after 2018-01-01 is 2025-01-01. It is 2024-12-30: 2020 and 2024 are leap years. The engine was right and the test was wrong — which is exactly why due dates are computed by day arithmetic (`addDays`) and asserted exactly, never by "years × 365". Retention policies written in years need a stated convention (calendar years vs days) before they become code.

A second case from browser QA: on a 375 px screen the page overflowed because the SVG calendar's `min-width` propagated through a CSS grid whose items default to `min-width: auto`. The fix was one line, but it is a reminder that "responsive" needs to be measured, not assumed.

## Why the tests look like this

- Hold precedence is tested against an *overdue* record so the veto is visibly stronger than the clock.
- Idempotence is tested positively (same id) and negatively (releasing a hold changes the id).
- Chain verification has three distinct negative tests — tamper, reorder, gap — because each is caught by a different check (hash, prevHash, seq).
- A SHA-256 known-answer test (`abc`) guards the hashing helper against a silent encoding mistake.

## Q: Releasing a hold used to be one click. Why is it a form now, and what does the trail actually prove?

A: A hold is the veto that stops disposal, so releasing it is the single most consequential action in the ledger — and the old click left no trace of who did it or why. `releaseHold`/`reinstateHold` (October 2026) require an actor, a reason of at least ten characters and an effective date, and refuse the cases that would make the record incoherent: an unknown hold, releasing a hold that is already released, reinstating one that is not, a release dated before the hold was placed, a reinstatement dated before the release, or a date that is not a real calendar day. Each accepted change appends a `HoldEvent` (`seq`, hold, action, date, actor, reason) to `fixture.holdHistory`, which the validator checks on import (contiguous `seq`, known holds, strict dates; legacy fixtures without the field still load) and which travels in the audit export. What it proves is narrow and worth stating precisely: the trail shows *what the ledger was told* about each release — it is not an authentication or approval system (the actor is free text) and it is not hash-chained like the receipts. The property that *is* guaranteed mechanically is unchanged from before: because the plan id hashes the active hold ids, any release or reinstatement after planning makes the pending plan stale, and `executePlan` refuses it.

## Production next steps

1. Anchor each chain head externally (RFC 3161 timestamp or WORM bucket) and sign receipts.
2. Collect system-side deletion evidence (job ids, row counts) into the receipt instead of simulating.
3. Bind the hold-trail actor to an authenticated identity, add second-person approval, and hash-chain the trail; notify stewards when holds block overdue items.
4. Support multiple schedules per category by jurisdiction and event-based re-triggering.
5. Schedule plan generation and alert on reconciliation mismatches.
