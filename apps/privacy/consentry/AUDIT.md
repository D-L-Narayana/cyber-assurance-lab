# AUDIT.md — Consentry

Self-review, 1 Oct 2026. Not an independent assessment.

## Threat model

**Assets:** in-memory workspace (purposes, subjects, records, events), exported decision trails. **Boundary:** one browser tab, no backend, no persistence, no auth. **Untrusted input:** imported workspace JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Oversized / deeply nested import | byte limit before `JSON.parse`; depth ≤ 8; per-array caps (5,000 events/records); string caps | full parse of ≤ 2 MB |
| Unknown keys or references smuggled into state | validator copies known keys only; records must reference known subjects/purposes; duplicate ids rejected | events may name unregistered purposes by design (routed to review) |
| Wrong decision presented as certainty | every decision carries its terminal rule, reason code, record id and full trace; unknown regime/purpose/basis → review, never allow | thresholds and expiry are fixtures that an operator could set wrongly |
| Policy regression unnoticed | regression suite + rule-coverage mutation analysis in-app and in unit tests | fixtures are small (21 events) |
| A grant captured under another regime's notice treated as valid consent | `R09a-record-regime` (October 2026) routes a consent-basis grant whose `regime` differs from the subject's to `review` (`RECORD_REGIME_MISMATCH`, record id named), never `allow`; withdrawals, objections and opt-outs keep denying whatever regime recorded them; disabling R09a at import raises the protective-rule warning | whether the two notices were materially equivalent is a human judgement the engine does not make |
| XSS via fixture strings | React escaping; no `dangerouslySetInnerHTML`; CSP in `vercel.json` (`script-src 'self'`) | `style-src 'unsafe-inline'` for Radix inline styles |
| Data exfiltration | no network after load (QA: only local host contacted); no storage APIs; downloads are user-initiated | none known |
| Clickjacking / sniffing | `frame-ancestors 'none'`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy no-referrer`, HSTS | applies when hosted with `vercel.json` |

## Security headers

`vercel.json` applies the lab-wide canonical header set to every path (`/(.*)`), with `cleanUrls: true`:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`form-action 'none'` is compatible because the only `<form>` (add a consent record) handles `onSubmit` with `preventDefault()` and never navigates; `style-src 'unsafe-inline'` remains for Radix inline style attributes. Fonts ship as files: `vite.config.ts` sets `build.assetsInlineLimit: 0`, because the October 2026 browser review (the built `dist/` served with these headers) found one small font subset inlined into the CSS as a `data:` URL, which `font-src 'self'` blocks (2 CSP violations and 1 console error per load); the CSP was not widened — the build was changed so the policy is honoured (measurements in EVIDENCE.md). The October 2026 round replaced the earlier `default-src 'self'` / `base-uri 'self'` / `form-action 'self'` / `upgrade-insecure-requests` / `interest-cohort=()` variant. The headers apply only when the built `dist/` is served through Vercel with this file.

## Data flow

Fixture → `parseWorkspace` → React state → `evaluate`/`evaluateAll`/`ruleCoverage`/`runExpectations` (pure) → views → user-initiated JSON downloads.

## Dependencies

`npm audit` 1 Oct 2026: 0 vulnerabilities. Lockfile committed. Unused `@radix-ui/react-tooltip` removed before handoff.

## Accessibility and QA

Playwright + axe (WCAG 2.0/2.1 A+AA) at 1440/768/375: initial run found `color-contrast` on the review pill and the stamp sub-label, plus a 3 px horizontal overflow at 375 from wide `<select>` elements. Fixed (review colour `#7a4f05`, 6.35:1; selects constrained to the column). Final run: 0 violations, 0 overflow, 0 console/page errors; 9-step workflow replay recorded (`qa/screens/flow-*.png`).

## Unresolved limitations

- No keyboard shortcut to jump between the two compared ladders; they are sequential in DOM order.
- Switch label relies on Radix `Switch.Root` with an `id`/`label for` pairing; verified by axe but not by a screen-reader session.
- Light theme only.
- The screenshots in `qa/screens/` predate the October 2026 round (the fixture gained a ninth subject and the ladder a fourteenth rung; no browser re-audit was run in this round).
