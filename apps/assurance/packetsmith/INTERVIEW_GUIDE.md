# Interview guide — Packetsmith

_Purpose:_ preparation material written during the AI-assisted build. It describes how the code works and what happened while building it; it is not a record of the candidate's existing knowledge. Study it against the code before presenting the project.

## The engine in two minutes

A packet is a plain JSON object: scope, steps, artifacts, results, findings, state, history. Three pure functions do the work. `controlStatus` rolls determinations up to a control (any *other than satisfied* dominates). `completeness` walks the packet and returns every reason it is not ready — not a boolean, a list, so the UI can link each reason to its control. `transition` is the state machine: it checks the allowed edge, the actor's role (assessor submits, approver approves, never the same person), and for submission it requires `completeness` to be empty; it returns a new packet with a history entry and never mutates the input. Artifacts are hashed with a self-written SHA-256 so integrity is visible without a secure context; the memo digest hashes the canonical (sorted-key) JSON so it is stable across serialisers.

## One failure case

The fixture has a privilege-matrix artifact whose content was edited after the hash was recorded. Nothing looks wrong in the step — it is "performed" with evidence attached — but the locker shows `hash mismatch` and the gate blocks submission. In the first browser run the gate also surfaced an unplanned defect: the demo's AU-2 step cited `ART-99`, a typo'd id. The gate's "unknown artifact" rule turned a silent broken reference into a listed blocker. That is the point of the list-of-reasons design.

## Why these tests

SHA-256 against FIPS vectors *and* `node:crypto` *and* WebCrypto, because a hash that is "almost right" is worse than none. Every completeness rule has a test that removes exactly one thing from a complete packet. Every state edge has a positive and a negative test, and one test proves the input packet is unchanged. The fixture test asserts that the planted defects are exactly the defects the gate reports.

## Be ready to answer

- Why examine/interview/test? (SP 800-53A Rev. 5's three assessment methods; a determination is stronger when more than one method supports it.)
- Why is "other than satisfied" the only negative result? (That is 800-53A's vocabulary; severity lives on the finding, not the result.)
- Why not let the approver fix a typo? (Immutability after approval is what makes the digest meaningful.)
- What does the hash *not* prove? (Who captured the evidence or whether it is genuine — only that it has not changed since hashing.)

## Production next steps

Authenticated identities and roles; file attachments hashed client-side before upload; control enhancements and ODP tailoring; OSCAL assessment-results export; multiple approvers and delegation; audit-log signing.
