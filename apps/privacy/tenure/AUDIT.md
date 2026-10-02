# AUDIT.md — Tenure

Self-review, 1 Oct 2026.

## Threat model

**Assets:** in-memory catalog and derived findings; exported JSON/CSV. **Boundary:** single browser tab; no backend, auth or persistence. **Untrusted input:** imported catalog JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Oversized or deeply nested import | byte check before parse; depth ≤ 6; per-collection caps; string caps | ≤ 2 MB fully parsed |
| Vocabulary smuggling / inconsistent ids | synonym normalisation with notes; unknown vocabulary rejected; duplicate ids rejected after normalisation; unknown keys dropped | a deliberately misleading synonym table entry would be a code change, visible in review |
| CSV formula injection in exports | `csvCell` prefixes `= + - @ \t \r` with `'` and quotes fields | relies on consumers not stripping the quote |
| Misleading "clean" result | every check has a test; the fixture's seeded defects are asserted; accepted findings remain visible with their exception id | checks are heuristics (name/suffix matching for inflation) and say so |
| XSS via catalog strings | React escaping, no raw HTML; CSP `script-src 'self'` | `style-src 'unsafe-inline'` for Radix |
| Exfiltration | no network after load (QA: only local host); no storage APIs; downloads user-initiated | none known |
| Clickjacking / sniffing | frame-ancestors none, X-Frame-Options DENY, nosniff, no-referrer, HSTS in `vercel.json` | applies when hosted with the config |

## Data flow

Fixture → `parseCatalog` (validate → normalise) → state → `buildGraph` / `runChecks` / `retentionReviews` (pure) → SVG + tables → downloads.

## Dependencies

`npm audit` 1 Oct 2026: 0 vulnerabilities. Lockfile committed.

## Accessibility and QA

Playwright + axe at 1440/768/375. Initial run: `nested-interactive` (SVG `role="img"` containing node buttons → changed to `role="group"`), `color-contrast` on muted text (`#5f6e63` → `#4f5e54`, 5.57:1 on the field background). A visual check found the inspector elements table collapsing inside a constrained grid container (grid auto-min of overflow items is 0); fixed by switching the inspector to block layout with a min-height. Final run: 0 violations, 0 overflow, 0 console/page errors; 9-step workflow replay with screenshots. Map nodes are keyboard-focusable buttons with full accessible names; the inventory table is the non-visual equivalent.

## Unresolved limitations

- The SVG map is not usable with a screen reader beyond node names; the table tab is the intended path.
- Edge labels are tooltips (`<title>`) only.
- Light theme only.
