# Interview guide — Graceline

_Purpose:_ preparation material written during the AI-assisted build. It describes how the code works and what happened while building it; it is not a record of the candidate's existing knowledge. Study it against the code before presenting the project.

## The engine in two minutes

An exception is a record with a state and an append-only history. `applyEvent(record, event, date)` is the only way to change it: it checks the event is allowed in the current state, then checks the policy guardrails that apply — who may act, how long the exception may run for that risk level, whether compensating controls exist, whether the quorum (count plus required roles) is met, whether the approver is independent of the requester and owner, whether the renewal cap is reached, whether closure evidence is substantive — and either returns a new record with a history entry or throws a `GuardrailError` listing *every* reason. `tick(record, date)` is the second entry point: it is idempotent and only moves active → expired → escalated based on dates. Everything else (expiring, overdue days, quorum progress, live guardrail violations, priority) is derived, never stored.

## One failure case

The fixture includes EX-111: approved as *high* with an 85-day term, then re-rated *critical*, whose maximum is 30 days. The engine does not retroactively reject it — history is history — but `derive` reports the live violation and the card carries "policy violation on record". Browser QA during the build also exposed a wrong test expectation: the check assumed the draft would fail two guardrails but its justification was 40 characters, so only one fired. The fixture was shortened so the demo makes the point honestly.

## Why these tests

State transitions at exact boundaries (expiry day is still active; +1 day is expired; grace day 14 vs 15) because off-by-one here changes who gets escalated. Quorum tests use two approvals *without* the required role to prove counting alone is insufficient. `tick` idempotence and "returns the same object when nothing changes" so re-rendering never fabricates history. Renewal tests replay two renewals through full approval to hit the cap honestly.

## Be ready to answer

- Why can the risk owner not approve? (They hold the risk; acceptance needs an independent decision.)
- Why do renewals reset approvals? (A renewal is a new risk-acceptance decision for a new term.)
- Why escalate after 14 days instead of immediately? (A grace window separates administrative lateness from genuine neglect; both are visible.)
- Why not block re-rating after approval? (Imported data must be representable; the engine surfaces violations instead of hiding records.)

## Production next steps

Authenticated identities and role directory; policy versioning per record; notification and reminder integration; evidence attachments with hashing (see Weft); delegation and approval expiry; reporting by policy and owner; SLA metrics over time.
