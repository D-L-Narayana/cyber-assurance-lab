# Interview guide — Injectboard

> Rehearsal script, written in the first person for the candidate to practise. It describes how the engine works and why; it is not a record of work the candidate has already performed or reviewed. Rehearse it against the code before presenting.

## Core engine
State is a plain object; every user action is a pure function `(state, scenario, …) → state` that also appends to an action log. The scheduler delivers injects whose due minute has passed — scheduled injects use `atMinute`, branch injects use an unlock minute recorded when an option is chosen. SLA evaluation is arithmetic on recorded minutes, so a breach is reproducible and explainable ("due at +15, committed at +20, 5 minutes late"). Because everything is pure, `replay(scenario, log)` rebuilds the exact state, which is what makes the after-action report trustworthy.

## One failure case
An early design unlocked follow-up injects at an absolute minute. That broke when a facilitator committed late: the follow-up had already "happened" before the decision that caused it. The fix was to record unlocks relative to the decision time (`clock + afterMinutes`), tested by *unlocks a follow-up inject relative to decision time*, which advances to +8 (not delivered) and +9 (delivered) around a decision at +4 with a 5-minute offset.

## Why the tests look like this
Scheduler tests check ordering and that unlock-only injects never appear by time alone. Decision tests cover the happy path, SLA breach minutes, and three rejection reasons, because the UI relies on the engine for all guardrails. Replay equality and the report content tests protect the deliverable that a reviewer would actually read.

## Next steps in production
Facilitator/participant roles with a shared session, wall-clock mode with pause, scenario library and editor, calibrated scoring tied to a published IR framework, and export to common ticketing formats.
