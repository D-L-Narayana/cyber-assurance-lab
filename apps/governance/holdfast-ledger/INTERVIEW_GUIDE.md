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

## Production next steps

1. Anchor each chain head externally (RFC 3161 timestamp or WORM bucket) and sign receipts.
2. Collect system-side deletion evidence (job ids, row counts) into the receipt instead of simulating.
3. Model hold authority, approvals and release reasons; notify stewards when holds block overdue items.
4. Support multiple schedules per category by jurisdiction and event-based re-triggering.
5. Schedule plan generation and alert on reconciliation mismatches.
