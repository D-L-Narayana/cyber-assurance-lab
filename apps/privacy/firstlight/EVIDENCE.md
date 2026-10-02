# EVIDENCE.md — Firstlight

All commands run from this directory on 1 Oct 2026 (Node v20.20.1, npm 10.8.2). Logs referenced live in `qa/`.

| Command | Result |
|---|---|
| `npm ci` | clean install from the committed lockfile (`qa/npm-ci.log`) |
| `npx vitest run` | **36 passed (36)**, 2 files (`src/engine/engine.test.ts` 30, `src/App.test.tsx` 6) |
| `npx tsc -b` | no errors |
| `npm run build` | `dist/` 608 K; `index-*.js` 305 kB (96 kB gzip), `index-*.css` 16 kB; relative base `./` |
| `npm audit` / `npm audit --omit=dev` | found 0 vulnerabilities (`qa/npm-audit.log`, `qa/npm-audit-prod.log`) |
| `node ../qa-harness/audit.mjs http://127.0.0.1:6104/ qa/screens flows/firstlight.mjs` | 3 viewports: 0 axe violations, 0 page overflow, 0 console/page errors; 8 flow steps; only host contacted `127.0.0.1:6104` |

## Test-first record

1. Engine stubs + 27 tests written → `npx vitest run` → `qa/tdd-red-engine.log`: **Tests 27 failed (27)**.
2. Implementations (`timeline.ts`, `clock.ts`, `severity.ts`, `readiness.ts`, `packet.ts`, `bundleIO.ts`) → `qa/tdd-green-engine.log`: **Tests 27 passed (27)**.
3. Review-driven tests added (California 30-calendar-day clock, phase on unrounded timestamps, `subjectsLowerBound` label, strict calendar-valid timestamps, strict `personalTokens`) → `qa/tdd-red-review-fixes.log`: **5 failed | 25 passed (30)** → fixes → `qa/tdd-green-review-fixes.log`: **36 passed (36)** (includes the 6 app tests).
4. App tests (6) were written *after* the UI and passed on first run after two test-side corrections (jsdom cannot type into `datetime-local`, so the test dispatches a change event; the `SE` selector was narrowed). They are integration coverage, not TDD.

## Browser QA findings → fixes

| Finding (axe / layout) | Fix |
|---|---|
| `color-contrast` serious: `.flag`, `.task-status.open` (`#f26d6d` on `#5a2626`, 4.13:1), `.task-status.in-progress` (`#f2a33a` on `#7a4f12`, 3.41:1) | text `#ffc7c7` on `#4a1f1f` (9.45:1), `#ffd48a` on `#4a3008` (8.76:1), checked with `track-notes/contrast.py` |
| `scrollable-region-focusable` serious: packet `<pre>` | `tabIndex=0` + `aria-label` |
| mobile `scrollWidth` 389 > 375 | `.sr-only` labels inside the containment table were absolutely positioned against the initial containing block; `.inline-form { position: relative }` |
| tablet `.pin-time` labels past the band edge | `overflow-x: clip` on the band; times hidden under 720 px |

Final: desktop/tablet/mobile each `overflow: false`, `axeViolations: []`, `pageErrors: 0`, `consoleErrors: 0`.

## Workflow replay (observed text, `qa/browser-audit-summary.json`)

- Clock chips at demo "now" 2026-09-22T12:00Z: `EU-GDPR: 23.5 h left of 72 hours`, `UK-GDPR: 23.5 h left of 72 hours`.
- "Now" moved to 2026-09-25T12:00Z: `EU-GDPR: 72 hours exceeded by 48.5 h`.
- Confidentiality → unknown recipients, malicious intent on: `SE 3 high` (from `SE 2.25 medium`).
- Two missing facts filled: heading `12/12 required facts`.
- Redaction off: event stream contains `Priya Oduya`; preview label `Packet preview, full`.
- `ct-4` marked done with reference `archive-check-7731`: status `done`.
- Malformed import: `Import rejected. bundle.incidentType "alien" is not an allowed value · …` (8 errors listed).

## Facts usable in resume bullets (educational project, October 2026)

- 36 automated tests including a fast-check property; engine tests failed before implementation (27 RED → GREEN) with logs retained.
- Defensive JSON importer: byte, depth (iterative), item, enum, strict-timestamp and duplicate-id checks; rejects rather than silently alters redaction tokens.
- Evidence clock implementing GDPR Art. 33 (72 h) and California SB 446 (30 calendar days from discovery) as dated teaching rules, with exact-timestamp phase logic.
- axe-core: 0 violations at 375/768/1440 after three measured contrast/focus/overflow fixes.

Sources: ENISA severity methodology https://www.enisa.europa.eu/sites/default/files/publications/Data%20breach%20severity%20methodology_1.0.pdf ; GDPR Art. 33 https://gdpr-text.com/read/article-33/ ; SB 446 text https://legiscan.com/CA/text/SB446/2025 ; Pillsbury summary https://www.pillsburylaw.com/en/news-and-insights/california-data-breach-notification-requirements.html
