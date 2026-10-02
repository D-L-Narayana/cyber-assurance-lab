# INTERVIEW_GUIDE.md — Forethought

Rehearsal material. This project was built with substantial AI assistance and has not been independently reviewed by the candidate; study and be able to explain the following unaided before presenting it as personal work.

## The engine in two minutes

`score(assessment)` walks the visible questions (progressive disclosure via `showIf`), sums each chosen option's effects per theme from a base of L=1, I=1, clamps to 1..5 and multiplies. Mitigations then subtract from L or I for their themes: counted ones produce the *residual*, planned ones only the *projected* score. `signOffBlockers` derives the approval invariants from that same scorecard, so the UI's blocker list and `signOff()`'s refusal can never disagree. `contentHash` canonicalises the assessable content (sorted answers, mitigations, flows, acceptances; excluding signatures/versions) and hashes it with SHA-256, which is what makes a signature go stale.

## One failure case

Mark "Signed data-processing agreements" as **verified** without an evidence reference. The mitigation stops counting (third-party residual returns to its inherent value) and `EVIDENCE_MISSING` appears as a blocker. The lesson: status fields are cheap; the model only trusts a status that carries evidence when the catalogue says evidence is required.

A second one worth knowing: the first calibration run put the demo at *very high* because the `personalisation` purpose already adds L+1 to automated decisions and the individual-recommendations option added L+3 on top. The rubric weight was reduced to L+2 and the reasoning recorded; calibration fixtures exist precisely to catch this.

## Why the tests look like this

- Engine tests first (24 red against stubs; the 2 rubric-shape tests passed immediately because the rubric is data, which is stated rather than hidden).
- Three calibration fixtures are asserted (low / high / very-high) so weight changes cannot silently re-band the examples.
- A property test over random mitigation sets asserts residual ≤ inherent and projected ≤ residual, the two invariants the UI relies on.
- Hash tests assert both what changes the hash and what must not (signatures, versions).

## Production next steps

- Rubric as versioned configuration with review/approval, and jurisdiction-specific DPIA triggers.
- Identity-backed signatures (SSO) and server-side storage of versions with full diffs.
- Mitigation evidence as attachments with integrity hashes; links to the control library and the rights desk.
- Legal/privacy-office review of weights, bands and language.
