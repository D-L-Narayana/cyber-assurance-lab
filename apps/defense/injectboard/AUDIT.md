# AUDIT — Injectboard

## Threat model
- **Assets**: exercise state, lessons text, imported scenarios, exported report.
- **Boundary**: the tab; no network, no storage API.
- **Adversarial inputs**: imported scenario JSON (200,000-char cap; structural validation for ids, roles, minutes, option counts, SLA, unlock targets; ≤ 200 injects, ≤ 12 roles, body ≤ 2,000 chars); clock steps bounded 0–600; lesson text ≤ 500 chars; all text rendered as React text nodes.
- **Not in scope**: multi-user facilitation, authentication, real-time comms.

## Data flow
fixture / import → `validateScenario` → `initialState` → actions (`advanceClock`, `decide`, `completeTask`, `addLesson`) → `State` + action log → `afterActionReport` → downloads.

## Dependency findings
See `EVIDENCE.md`. Runtime: react, react-dom, three Radix primitives, two Fontsource font packages.

## Security headers
`vercel.json`: CSP `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`; nosniff; SAMEORIGIN; referrer and permissions policies.

## Unresolved limitations
- `maxScore` includes branch-only decisions (documented).
- Replay verification compares JSON serialisations; it demonstrates determinism of the pure functions but is not a cryptographic audit trail.
- No automated axe run within the repo.
