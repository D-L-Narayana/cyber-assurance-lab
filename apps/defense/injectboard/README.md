# Injectboard — incident-response tabletop commander

Educational prototype built October 2026. Injectboard runs a **repeatable, measurable tabletop exercise**: a fictional ransomware-like scenario delivers injects on an exercise clock, five roles commit decisions against SLA timers, decisions create containment tasks and unlock follow-up injects, lessons are captured during play, and an after-action report (Markdown + JSON) is generated from the deterministic state. No malware, no real systems, no messaging.

## Key workflows
1. **Run the clock** — Advance 5/15 minutes or jump to the next scheduled inject. Injects whose minute has arrived appear in the feed.
2. **Decide** — each decision shows its SLA bar; pick an option and commit. The record stores the minute, due minute, whether the SLA was breached and by how much, the option's score and its consequence note.
3. **Branch** — options can unlock follow-up injects relative to the decision time (e.g. observing instead of isolating unlocks "Encryption spreading").
4. **Contain** — options create role-owned tasks with due minutes; mark them done; late completion is recorded as overdue.
5. **Role views** — filter the board to what one role sees (Incident commander, IT operations, Communications, Legal & privacy, Executive sponsor).
6. **Capture lessons** with category and owner while the context is fresh.
7. **After-action report** — summary, timeline, decisions with SLA outcomes, lessons; download Markdown or `injectboard.aar/1` JSON. "Verify replay determinism" rebuilds the state from the action log and confirms equality.
8. **Import a scenario** (bounded, validated) or download the current one to edit.

## Quickstart
```bash
npm ci
npm test
npm run build
npm run dev   # http://127.0.0.1:6133
```

## Algorithm
- **Scheduler** (`engine.ts`): an inject is due when `atMinute ≤ clock`, or when unlocked by an option at `decisionMinute + afterMinutes ≤ clock`. Delivery order is by due minute then scenario order. Clock steps are integers 0–600.
- **SLA**: `dueMinute = deliveredAt + slaMinutes`; `minutesLate = max(0, clock − dueMinute)`; breached when > 0.
- **Decisions** are single-commit per decision id; undelivered injects and unknown options are rejected with a reason.
- **Tasks**: `dueMinute = decisionMinute + dueInMinutes`; completing after due → `overdue`.
- **Completeness**: decisions made / total, breaches, tasks done, open overdue, score / maxScore, lessons.
- **Replay**: `replay(scenario, log)` folds the action log through the same pure functions; invalid actions are skipped.

## Architecture
`src/engine/*` is framework-free TypeScript (scenario validation, engine, report, fixture). `src/App.tsx` is presentation. In-memory state only.

## Tests
11 vitest tests: scheduler ordering and unlock-only exclusion, step bounds, timely decision + tasks + relative unlock, SLA breach minutes, rejection of double/unknown/undelivered decisions, overdue tasks, completeness and lesson validation, deterministic replay, after-action report content, scenario validation (fixture accepted; duplicate ids, unknown roles, negative minutes, non-objects, > 200 injects rejected). RED/GREEN in `EVIDENCE.md`.

## Data handling
The scenario is fictional ("Northwind Example"). Imported scenarios stay in the browser.

## Limitations
- `maxScore` is the sum of the best option across **all** decisions, including branch-only ones, so it is an upper bound rather than an achievable total on every path.
- One shipped scenario; no scenario editor beyond JSON import.
- Exercise time is simulated by button presses; there is no wall-clock mode, facilitator sync or multi-participant state.
- Scores are illustrative weights set in the fixture, not a validated maturity model.

## JD evidence (educational, not professional experience)
Incident-response process vocabulary (containment, declaration, notification readiness, communications), SLA reasoning, role-based views for explaining the same event to different audiences, after-action reporting.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; tests were run failing before implementation. Human review of the engine has not been independently confirmed; `INTERVIEW_GUIDE.md` is provided and the candidate should rehearse it before presenting this project.
