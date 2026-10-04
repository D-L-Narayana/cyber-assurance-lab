# INTERVIEW GUIDE — Attestline

## The core engine in two minutes

An access review answers "should this person still have this access?" for every entitlement, and it has to be answered by the right reviewer with a defensible record. Attestline turns an entitlement export into *review items*. For each item it (1) decides the reviewer — the manager if the identity is active and the manager exists, otherwise the resource owner, otherwise *unrouted*; (2) attaches risk hints that are each a plain sentence a manager can act on; (3) computes a score purely to order the queue. Decisions are pure functions: `applyDecision(campaign, input)` returns either a new campaign or an error string, so every rule is unit-testable without a browser and the UI cannot bypass a guard.

The most important guard is the SoD override. If both sides of a conflict end up approved, the second approval must carry the rule id and a written compensating-control rationale, and that text goes into the export. Risk acceptance becomes an artifact instead of a quiet click.

## One failure case to walk through

*Bulk approval with an empty reason.* A reviewer selects a leaver's entitlement and a clean one and presses "Approve selected" with no reason. `bulkDecision` applies items sequentially on a copy; the first flagged item returns "A reason is required", so the function returns the error and the original campaign is untouched — not a half-applied batch. The test `bulk decisions stop at the first invalid item and apply none` pins this. A related parent-review finding was that `validateFixture` threw on `identities: [null]`; it now returns `identities[0] is not an object.` and the regression test enumerates nine malformed shapes.

## Why the tests look the way they do

- Tests were written before the engine (module-not-found, then "not implemented" stub) so each assertion was seen failing for the right reason.
- Hints are asserted individually (`sod_conflict` on *both* sides and pointing at the counterpart; `never_used` separate from `dormant`) because those distinctions drive different conversations with the manager.
- Determinism is tested by building the campaign twice and comparing scores; ordering by score then id makes the queue stable for screenshots and exports.
- Input-safety tests include cases that only surfaced in review: `Date.parse('2026-02-30')` silently normalises, and spreadsheet formula prefixes can hide behind whitespace or control characters.

## Q: What does "closing" a campaign change, and what does the export digest actually prove?

Closing is a guarded transition like every other one: `closeCampaign` refuses without an actor and a 10-character note, refuses a date before the campaign's as-of date, refuses a second close, and — the interesting rule — refuses while items are pending unless the closer explicitly acknowledges them, in which case the undecided count goes into the closing record instead of disappearing. Nothing else changes: items and decisions are untouched, but from then on `applyDecision`, `routeItem` and `bulkDecision` all answer `Campaign is closed …`, and the UI disables the buttons for clarity rather than as the control. The digest is SHA-256 over a canonical (key-sorted) JSON of the items, decisions, config and closing record, computed with Web Crypto in the tab and written into the export. It proves exactly one thing: that a file you are looking at has not been altered since it was produced *if* you trust the digest you recorded at the time — recompute and compare. It is not a signature (there is no key), it does not cover the CSV, and it says nothing about the real systems the synthetic fixture pretends to describe. I tested it the boring way: stable across property order, changed by one decision or one character of the closing note, and the existing export tests kept passing because the new fields are additive and the schema id did not move.

## What I would do next for production

1. Replace the reviewer dropdown with real authentication and server-side enforcement of `reviewerId === actor`.
2. Persist campaigns and decisions with an append-only log; add campaign close/lock and a signed export.
3. Pull entitlements from an IGA/IdP connector and feed revocations back as tickets, never as direct permission changes from this tool.
4. Calibrate hint weights against historical decisions; add peer-group outlier detection (see Pathcaster for the graph side).
5. Add escalation when a reviewer's pending count is stale and reminders with an SLA clock.
