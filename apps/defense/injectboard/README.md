# Injectboard — incident-response tabletop commander

Educational prototype built October 2026; hardened in the October 2026 lab-wide upgrade round. Injectboard runs a **repeatable, measurable tabletop exercise**: a fictional ransomware-like scenario delivers injects on an exercise clock, five roles commit decisions against SLA timers, decisions create containment tasks and unlock follow-up injects, lessons are captured during play, and an after-action report (Markdown + JSON) is generated from the deterministic state. No malware, no real systems, no messaging.

## Key workflows
1. **Run the clock** — Advance 5/15 minutes or jump to the next scheduled inject. Injects whose minute has arrived appear in the feed.
2. **Decide** — each decision shows its SLA bar; pick an option and commit. The record stores the minute, due minute, whether the SLA was breached and by how much, the option's score and its consequence note.
3. **Branch** — options can unlock follow-up injects relative to the decision time (e.g. observing instead of isolating unlocks "Encryption spreading").
4. **Contain** — options create role-owned tasks with due minutes; mark them done; late completion is recorded as overdue.
5. **Role views** — filter the board to what one role sees (Incident commander, IT operations, Communications, Legal & privacy, Executive sponsor).
6. **Capture lessons** with category and owner while the context is fresh.
7. **After-action report** — summary, timeline, decisions with SLA outcomes, lessons; download Markdown or `injectboard.aar/1` JSON. "Verify replay determinism" rebuilds the state from the action log and confirms equality.
8. **Read the score honestly** — the progress strip and the report show two numbers: the **best total achievable on one path** (branch-aware search, see Algorithm) and the **upper bound** (best option of every decision, including branch-only ones). For the shipped scenario they are 48 and 52.
9. **Import a scenario** — bounded and validated by `parseScenario`: 512 KiB UTF-8 cap checked before parsing, iterative depth scan (≤ 8 levels, ≤ 100,000 values), every field checked, path-addressed errors such as `injects[3].decision.options[1].score` (at most 25). Or download the current scenario to edit.

## Quickstart
```bash
npm ci
npm test      # vitest, 22 tests
npm run build
npm run dev   # http://127.0.0.1:6133
```

## Algorithm
- **Scheduler** (`engine.ts`): an inject is due when `atMinute ≤ clock`, or when unlocked by an option at `decisionMinute + afterMinutes ≤ clock`. Delivery order is by due minute then scenario order. Clock steps are integers 0–600.
- **SLA**: `dueMinute = deliveredAt + slaMinutes`; `minutesLate = max(0, clock − dueMinute)`; breached when > 0.
- **Decisions** are single-commit per decision id; undelivered injects and unknown options are rejected with a reason.
- **Tasks**: `dueMinute = decisionMinute + dueInMinutes`; completing after due → `overdue`.
- **Completeness**: decisions made / total, breaches, tasks done, open overdue, lessons, `score`, `maxScore` (upper bound) and `achievableMax` (+ `achievableTruncated`).
- **Achievable score** (`score.ts`, `achievableMaxScore(scenario)` → `{ max, path, truncated, expansions, log }`): a depth-first search over engine states that uses the real `decide`/`advanceClock` functions. When decisions are pending, the first pending decision is expanded (the order among simultaneously pending decisions cannot change the total); when none is pending the clock jumps to the next inject; a leaf is a state where nothing is pending and nothing more can be delivered. Options of one decision that make the same set of not-yet-reachable decision-bearing injects reachable are future-equivalent for scoring (tasks, notes and SLA do not change the total), so only the best-scoring one is expanded. A greedy warm start always yields one complete playable path; the search then spends an **expansion budget of 20,000 decision nodes**. If the budget runs out, `truncated: true` and `max` is a lower bound — the UI and the report say so. `replay(scenario, log)` reproduces the returned score, and `path` lists the decisions in order. Fixture: isolating FS-01 scores 10, while observing scores 0 and unlocks "Encryption spreading" whose best option is worth 4 — so the branch-only decision can never be part of the best path and 52 (upper bound) is not achievable; 48 is.
- **Validation** (`scenario.ts`): `parseScenario(text)` → byte cap → `JSON.parse` (exactly once; a decoded string is a value, not a second document) → iterative structure scan → field rules: `id`/`title` 1–80/1–200 chars, `version` positive integer, `startAt` strict ISO-8601 with explicit zone and a real calendar date (`2026-02-30` rejected; parsed value must round-trip), `description` ≤ 2,000, roles `{ id 1–40, name 1–120 }` with unique ids (1–12 roles), ≤ 200 injects with unique ids, `atMinute` null or integer 0–1440, known `role`, `title` ≤ 200, `body` ≤ 2,000; decisions with unique ids, `prompt` ≤ 500, `slaMinutes` integer 1–1440, 2–12 options with ids unique per decision, `label` ≤ 200, `score` finite 0–100, `note` ≤ 1,000; tasks `{ id unique, role known, title ≤ 200, dueInMinutes integer 0–1440 }`; unlocks `{ injectId known, afterMinutes integer 0–1440 }` whose target must be an unlock-only inject (`atMinute: null`). Unknown keys are dropped; the validated copy is what the engine runs.
- **Replay**: `replay(scenario, log)` folds the action log through the same pure functions; invalid actions are skipped.

## Architecture
`src/engine/*` is framework-free TypeScript: `scenario.ts` (types, limits, `parseScenario`/`validateScenario`), `engine.ts` (state machine, completeness, replay), `score.ts` (upper bound and branch-aware achievable score), `report.ts` (after-action report), `fixtures.ts` (synthetic scenario). `src/App.tsx` is presentation only: it memoises the achievable-score search per loaded scenario and passes the result to `completeness` and `afterActionReport`. In-memory state only.

Note on module shape: `score.ts` drives the real engine (`initialState`, `advanceClock`, `decide`, …) and `engine.ts`'s `completeness` defaults its third argument to `achievableMaxScore(scenario)`, so the two modules import each other. The cycle is safe by construction — neither module touches the other at module-evaluation time (only constants and function declarations are defined at top level; the cross calls happen inside function bodies) — and it is exercised by the test suite, `tsc` and the Vite build. Callers that already hold a result (the UI, the report) pass it in and never trigger the default.

## Tests
22 vitest tests across three files (`vitest run` prints `Tests  22 passed (22)`):
- `engine.test.ts` (11): scheduler ordering and unlock-only exclusion, step bounds, timely decision + tasks + relative unlock, SLA breach minutes, rejection of double/unknown/undelivered decisions, overdue tasks, completeness and lesson validation, deterministic replay, after-action report content, scenario validation (fixture accepted; duplicate ids, unknown roles, negative minutes, non-objects, > 200 injects rejected).
- `scenario.test.ts` (6): fixture and mini scenario accepted with unknown keys stripped; `parseScenario` byte cap (multi-byte text under the character count but over the byte cap), invalid JSON and single decoding (a JSON string literal that contains a scenario document is rejected, never parsed a second time); iterative depth/value caps on a 5,000-deep array and a 9-level object; every top-level rule with its error path; every inject/decision/option/task/unlock rule with its exact path (including the unlock-only target rule); the 25-entry error cap.
- `score.test.ts` (5): fixture upper bound 52 vs achievable 48 with a 6-decision path that avoids `d-late-isolate`; the path replays to the same score through `decide`/`advanceClock` and `replay`; a scenario where the 0-point branch option is the best path (30 vs 10); completeness and report expose both numbers; determinism plus the expansion budget on a hostile 64-decision scenario (3^16 complete paths) finishing with `truncated: true` and a replayable path.
RED/GREEN runs are recorded in `EVIDENCE.md` (`qa/red-scenario-hardening.txt`, `qa/green-scenario-hardening.txt`, `qa/red-achievable-score.txt`, `qa/green-achievable-score.txt`, `qa/red-single-decode.txt`, `qa/green-single-decode.txt`, `qa/green-full-suite.txt`).

## Data handling
The scenario is fictional ("Northwind Example"). Imported scenarios stay in the browser.

## Limitations
- The **upper bound** still sums the best option of every decision, including branch-only ones, and so can exceed anything playable; the **achievable** total is exact when the search completes (the shipped scenario needs well under 100 expansions) and a flagged lower bound when the 20,000-expansion budget is reached on dense imported scenarios.
- One shipped scenario; no scenario editor beyond JSON import.
- Exercise time is simulated by button presses; there is no wall-clock mode, facilitator sync or multi-participant state.
- Scores are illustrative weights set in the fixture, not a validated maturity model.
- The qa screenshots predate the October 2026 round (the score strip now shows two numbers and the import dialog text changed).

## JD evidence (educational, not professional experience)
Incident-response process vocabulary (containment, declaration, notification readiness, communications), SLA reasoning, role-based views for explaining the same event to different audiences, after-action reporting.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; tests were run failing before implementation (original build and October 2026 round alike). Human review of the engine has not been independently confirmed; `INTERVIEW_GUIDE.md` is provided and the candidate should rehearse it before presenting this project.
