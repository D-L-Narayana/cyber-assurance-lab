# AUDIT — Injectboard

## Threat model
- **Assets**: exercise state, lessons text, imported scenarios, exported report.
- **Boundary**: the tab; no network, no storage API.
- **Adversarial inputs**: imported scenario JSON — 512 KiB UTF-8 cap checked before `JSON.parse`, iterative (stack-based) depth scan ≤ 8 container levels and ≤ 100,000 values, then complete field validation (string length caps, positive-integer `version`, strict ISO `startAt` with real calendar date, integer minute fields 0–1440, finite scores 0–100, unique role/inject/decision/task ids and per-decision option ids, known roles, unlock targets that are unlock-only injects, ≤ 200 injects, ≤ 12 roles, 2–12 options per decision); unknown keys dropped; at most 25 path-addressed errors returned and the validator never throws. Clock steps bounded 0–600; lesson text ≤ 500 chars; all text rendered as React text nodes.
- **Search bounds**: the achievable-score search (`score.ts`) expands at most 20,000 decision nodes per scenario and reports `truncated` when it stops early; it runs once per loaded scenario (memoised in the UI).
- **Not in scope**: multi-user facilitation, authentication, real-time comms.

## Trust boundaries
| Input | Trust | Guard | Failure mode |
| --- | --- | --- | --- |
| Shipped fixture (`src/engine/fixtures.ts`) | Trusted (in repo, synthetic) | Validated by the test suite with the same `validateScenario` | Test failure |
| Imported scenario JSON (textarea) | Untrusted | `parseScenario`: byte cap → single `JSON.parse` (a decoded string literal is never re-parsed) → structural scan → field rules → sanitised copy | Error list in the dialog; nothing loaded |
| Action log replay | In-memory, produced by the engine | `replay` skips invalid actions | Status line reports equality yes/no |
| Downloads (AAR Markdown/JSON, scenario JSON) | Outbound only | Blob + transient object URL | — |

## Data flow
fixture / import → `parseScenario` → `validateScenario` → `initialState` → actions (`advanceClock`, `decide`, `completeTask`, `addLesson`) → `State` + action log → `completeness` (+ `achievableMaxScore`, memoised) → `afterActionReport` → downloads.

## Dependency findings
See `EVIDENCE.md`. Runtime: react, react-dom, three Radix primitives, two Fontsource font packages. No dependency was added in the October 2026 round.

## Security headers
`vercel.json` carries the lab-wide canonical set (October 2026 upgrade round), applied to every path (`/(.*)`):
- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`style-src 'unsafe-inline'` remains because Radix primitives and React inline `style` attributes (the SLA bar width) need it. `form-action 'none'` is compatible: the only `<form>` (lesson capture) calls `preventDefault()` and never navigates. Headers apply to the Vercel deployment only; `vite preview` serves without them.

## Unresolved limitations
- The upper-bound score still includes branch-only decisions; the achievable total is exact unless the search budget is reached, in which case it is a flagged lower bound (documented in the UI and the report).
- Replay verification compares JSON serialisations; it demonstrates determinism of the pure functions but is not a cryptographic audit trail.
- No automated axe run within the repo.
