# Interview guide — Injectboard

> Rehearsal script, written in the first person for the candidate to practise. It describes how the engine works and why; it is not a record of work the candidate has already performed or reviewed. Rehearse it against the code before presenting.

## Core engine
State is a plain object; every user action is a pure function `(state, scenario, …) → state` that also appends to an action log. The scheduler delivers injects whose due minute has passed — scheduled injects use `atMinute`, branch injects use an unlock minute recorded when an option is chosen. SLA evaluation is arithmetic on recorded minutes, so a breach is reproducible and explainable ("due at +15, committed at +20, 5 minutes late"). Because everything is pure, `replay(scenario, log)` rebuilds the exact state, which is what makes the after-action report trustworthy.

## One failure case
An early design unlocked follow-up injects at an absolute minute. That broke when a facilitator committed late: the follow-up had already "happened" before the decision that caused it. The fix was to record unlocks relative to the decision time (`clock + afterMinutes`), tested by *unlocks a follow-up inject relative to decision time*, which advances to +8 (not delivered) and +9 (delivered) around a decision at +4 with a 5-minute offset.

## "Why does the report show two maximum scores?" (October 2026 round)
The old `maxScore` added up the best option of every decision, including decisions that only exist on a branch you reach by choosing badly. In the shipped scenario, "observe" scores 0 and unlocks "Encryption spreading", whose best option is worth 4; "isolate" scores 10 and skips it. So 52 was never playable — 48 is. I kept the upper bound because it is cheap and stable, and added `achievableMaxScore`: a depth-first search that drives the real engine (`decide`, `advanceClock`) from the initial state, expanding the first pending decision, jumping the clock when nothing is pending, and following unlocks. Two things keep it honest and bounded. First, options of one decision that make the same set of not-yet-reachable decision-bearing injects reachable are future-equivalent for scoring, so only the best of each class is expanded — exact pruning, not a heuristic. Second, a greedy warm start guarantees one complete playable path, and the search has a budget of 20,000 expansions; on a hostile 64-decision scenario with 3^16 paths it stops, sets `truncated: true`, and the UI says the number is a lower bound. The test I would point to replays the returned path through `replay()` and asserts the same score, so the "achievable" number is backed by a path the engine can actually play. The same round made import a real boundary: `parseScenario` checks the 512 KiB byte cap before `JSON.parse`, scans depth and value count iteratively, and reports path-addressed errors like `injects[3].decision.options[1].score` instead of a generic message.

## Why the tests look like this
Scheduler tests check ordering and that unlock-only injects never appear by time alone. Decision tests cover the happy path, SLA breach minutes, and three rejection reasons, because the UI relies on the engine for all guardrails. Replay equality and the report content tests protect the deliverable that a reviewer would actually read.

## Next steps in production
Facilitator/participant roles with a shared session, wall-clock mode with pause, scenario library and editor, calibrated scoring tied to a published IR framework, and export to common ticketing formats.
