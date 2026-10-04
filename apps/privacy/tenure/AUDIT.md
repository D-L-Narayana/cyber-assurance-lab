# AUDIT.md — Tenure

Self-review, 1 Oct 2026; updated 4 Oct 2026 (lab-wide upgrade round: canonical security headers, exception route for flow-subject findings).

## Threat model

**Assets:** in-memory catalog and derived findings; exported JSON/CSV. **Boundary:** single browser tab; no backend, auth or persistence. **Untrusted input:** imported catalog JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Oversized or deeply nested import | byte check before parse; depth ≤ 6; per-collection caps; string caps | ≤ 2 MB fully parsed |
| Vocabulary smuggling / inconsistent ids | synonym normalisation with notes; unknown vocabulary rejected; duplicate ids rejected after normalisation; unknown keys dropped | a deliberately misleading synonym table entry would be a code change, visible in review |
| CSV formula injection in exports | `csvCell` prefixes `= + - @ \t \r` with `'` and quotes fields | relies on consumers not stripping the quote |
| Misleading "clean" result | every check has a test; the fixture's seeded defects are asserted; accepted findings remain visible with their exception id | checks are heuristics (name/suffix matching for inflation) and say so |
| Exception that silently hides a flow finding (new import field `exceptions[].subject`, October 2026) | `subject.kind` must be `element` or `flow`; `subject.id` must name a known element, a known flow or `flow/element` with both known (checked after normalisation); unknown keys inside `subject` are dropped by rebuilding it; an exception needs `subject` or the legacy `elementId`; acceptance matches exactly on finding code, subject kind and subject id, and the same guards apply as for element exceptions (approved, unexpired, active approver, approval date ≤ as-of, term ≤ 365 days) | a flow exception covers one flow id (or one flow/element pair); a re-declared flow with a new id is a new, live finding |
| XSS via catalog strings | React escaping, no raw HTML; CSP `script-src 'self'` | `style-src 'unsafe-inline'` for Radix |
| Exfiltration | no network after load (QA: only local host); no storage APIs; downloads user-initiated | none known |
| Clickjacking / sniffing / transport | canonical lab header set in `vercel.json` (see **Security headers** below) | applies when hosted with the config |

## Security headers

`vercel.json` (updated 4 Oct 2026 to the lab-wide canonical set) sends, for every path: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` (`'unsafe-inline'` styles remain for Radix; `form-action 'none'` is compatible because the only `<form>` — the exception dialog — handles submit in JavaScript with `preventDefault` and never navigates), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`; `cleanUrls: true` was added. The previous set already had CORP and HSTS but used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` and `interest-cohort=()` in Permissions-Policy.

## Data flow

Fixture → `parseCatalog` (validate → normalise → subject/id cross-checks) → state → `buildGraph` / `runChecks` (incl. `exceptionSubject` matching) / `retentionReviews` (pure) → SVG + tables → downloads.

## Dependencies

`npm audit` 1 Oct 2026: 0 vulnerabilities. Lockfile committed.

## Accessibility and QA

Playwright + axe at 1440/768/375 (measured 1 Oct 2026, before the October 2026 changes; the exception dialog's new availability from flow findings reuses the existing dialog, form and tokens and has not been re-measured with axe). Initial run: `nested-interactive` (SVG `role="img"` containing node buttons → changed to `role="group"`), `color-contrast` on muted text (`#5f6e63` → `#4f5e54`, 5.57:1 on the field background). A visual check found the inspector elements table collapsing inside a constrained grid container (grid auto-min of overflow items is 0); fixed by switching the inspector to block layout with a min-height. Final run: 0 violations, 0 overflow, 0 console/page errors; 9-step workflow replay with screenshots. Map nodes are keyboard-focusable buttons with full accessible names; the inventory table is the non-visual equivalent.

## Unresolved limitations

- The SVG map is not usable with a screen reader beyond node names; the table tab is the intended path.
- Edge labels are tooltips (`<title>`) only.
- Light theme only.
