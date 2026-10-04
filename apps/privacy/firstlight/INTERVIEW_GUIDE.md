# INTERVIEW_GUIDE.md — Firstlight

Rehearsal material. This project was built with substantial AI assistance and has not been independently reviewed by the candidate; study and be able to explain the following unaided before presenting it as personal work.

## The engine in two minutes

Six pure functions. `buildTimeline` sorts, deduplicates and sequence-checks the event stream and picks the anchors (first detected, first aware, last contained). `evidenceClock` turns the awareness anchor plus a jurisdiction rule into a deadline and a phase, comparing exact timestamps and rounding only for display. `summariseScope` and `severity` compute an ENISA-style `SE = DPC × EI + CB` with every term in a rationale array. `readiness` maps facts to the Art. 33(3) items and derived checks and returns a measured completeness ratio. `buildPacket` assembles the export with optional redaction. `parseBundle` is the trust boundary: bounded, strict, and rejecting rather than silently fixing.

## One failure case

The first import validator recursed to measure nesting depth and checked the limit *after* recursing, so a 2 MB-compliant file of 20,000 nested arrays would throw `RangeError` instead of returning a validation error. The fix is an iterative traversal with an explicit stack and a limit check before pushing children. Related: timestamps were regex-only, so `2026-02-30T10:00:00Z` parsed to a real-looking date and silently shifted the clock; the validator now requires a calendar-valid instant.

## Why the tests look like this

Engine tests were written before the implementation and failed first (27 RED → 27 GREEN, logs in `qa/`). Review-driven tests (SB 446 clock, unrounded phase, strict timestamps, strict `personalTokens`, lower-bound label) were also RED before the fix (5 failed). The timeline has a fast-check property: result independent of input order and idempotent. App tests (6) were added after the UI as integration coverage — they prove the wiring, not the design.

## "What would change the band" (October 2026 round)

**Q. Why is the sensitivity list computed by re-running `severity` on each variant instead of reasoning about the formula?**

A. Because the formula is not linear once the clamp is in: DPC is clamped to 1..4 after the context adjustment, so a +1 step can change nothing (financial +3 and +2 both land on 4) or a whole band, and the bands themselves are thresholds on `SE = DPC × EI + CB`. Deriving flips algebraically would mean re-implementing those edge cases a second time and risking a list that disagrees with the card. Instead `severitySensitivity` builds candidate single-field changes (every other enum value, the malicious toggle, ±1 on the adjustment within −3..+3, the highest data class one step up or down), applies each to a copy with `applyFlip`, measures `severity`, and keeps the ones whose band moved. The property-style test loops over every flip and checks that applying it really yields `bandTo` and the stated SE delta, and a deliberately saturated medium-band bundle (financial −3 with every circumstance at its worst) shows that the list can legitimately be empty. The list is sorted by |SE delta|, then field, then value, so it is deterministic and readable: the biggest lever comes first — in the demo, ease of identification dropping to negligible (−1.5).

## What I would say about California

Until 31 December 2025 the statute said "most expedient time possible and without unreasonable delay"; SB 446 (effective 1 January 2026) added a 30-calendar-day limit from discovery, with exceptions for law-enforcement needs and scope determination, plus a 15-day Attorney General sample copy when more than 500 residents are notified. Firstlight models the 30-day clock only and documents the rest.

## Production next steps

Authority-specific packet templates; persistence with an append-only audit trail; multi-incident workspace; a real anonymisation review step instead of token redaction; jurisdiction rules as versioned data with effective dates; integration with ticketing for containment evidence.
