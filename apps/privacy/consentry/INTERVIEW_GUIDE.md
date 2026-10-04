# INTERVIEW_GUIDE.md — Consentry

Rehearsal material. This project was built with substantial AI assistance and has not been independently reviewed by the candidate; study and be able to explain the following unaided before presenting it as personal work.

## The engine in two minutes

`evaluate(event, ctx)` builds a small set of facts once (purpose, regime, configured basis, effective basis, child flag, latest record *at or before the event*) and walks an ordered array of rules. Each rule returns `pass` or `match`; the first `match` is terminal and the trace records every rung. R99 guarantees termination, so the trace always ends in exactly one matched rung, a property the tests assert over 200 random inputs.

Two design choices worth defending:

1. **Effective basis.** California relies on notice-and-opt-out, but selling or sharing a minor's data needs opt-in. Rather than special-casing R09, `buildFacts` rewrites the effective basis to `consent` for that combination, so the ordinary consent rule applies. One place to change, one place to test.
2. **Refuse to guess.** Unknown regime, unknown purpose and missing basis route to review. An unknown age routes to review for age-sensitive purposes (EU/UK consent, California sale/share) and is ignored for purposes that do not depend on age. The one deliberate bypass is `R02 essential`, which runs before the regime/basis checks; be ready to defend why, and what a mis-registered purpose would do.

## One failure case

Disable `R06-gpc-signal` in the coverage tab. The regression suite immediately reports `ev-11: expected deny (GPC_OPT_OUT), observed allow (NOTICE_AND_OPT_OUT)`. The point: a consent engine with no stored expectations would silently start allowing sale/share despite a GPC signal. Coverage shows which other rules would have the same blind spot if their fixtures were missing (R99 is the deliberate example: never reached).

## The record-regime rung (October 2026 round)

**Q. Why is `R09a-record-regime` a separate rule placed before R09, and why does it route to review rather than deny?**

A. R09 answers "is there a current grant?"; R09a answers a different question — "was that grant captured under the notice this subject is actually governed by?" A consent captured under the EU notice is not automatically valid for a UK subject (thresholds, wording and the notice itself differ), but it is not evidence of refusal either, so the honest decision is *review*, with the record id named so a human can compare the two notices. Placing it before R09 leaves R09 untouched and makes the rung visible in every consent trace. It applies only to grants: a withdrawal, objection or opt-out recorded under another regime keeps its protective effect (R07/R09 still deny), because a protective signal must never be weakened by a bookkeeping mismatch. The fixture gained Imogen (UK) with `rec-012` captured under `EU-GDPR` and `ev-21` expecting `review / RECORD_REGIME_MISMATCH`, so `ruleCoverage` reports R09a as exercised and the suite fails if the rule is disabled; because it routes to review, it is listed with R05–R08 as a protective rule whose disabling triggers the import warning. The determinism property (exactly one matched rung over 200 random cases) still holds with fourteen rules.

## Why the tests look like this

- Engine tests first (38 red against stubs → 38 green). The fixture's 20 expectations are themselves a test (`passes for the bundled fixture expectations`), so the fixture cannot drift from the engine.
- Temporal validity is tested explicitly (grant after the event is ignored) because it is the most common real-world bug in consent lookups: using the newest record instead of the newest record *as of the event*.
- The property test checks determinism and trace shape, not specific outcomes; outcomes are pinned by example tests with reason codes.

## Production next steps

- Versioned policy tables with approval and effective dates; decision logs keyed to the policy version actually used.
- Real consent-receipt storage and proof verification; signal ingestion (GPC header/JS API) from the client with server-side enforcement.
- Jurisdiction resolution from reliable context rather than a fixture field.
- Legal review of every rule and threshold; ePrivacy cookie-specific handling.
