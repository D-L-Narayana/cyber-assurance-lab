# AUDIT — Outflow Register

Date 2026-10-01. Educational prototype; not legal advice; not a certification.

## Threat model

Assets: in-memory register, history and exported packets. Untrusted input: user-selected register JSON; free-text reasons.

| Threat | Mitigation | Residual |
|---|---|---|
| Malformed/oversize register | `parseBoundedJson` + `validateRegister` (caps: 500 agreements, 2 000 flows, 50 obligations each; dangling vendor/owner/system/agreement references; strict dates; bounded errors) | — |
| Silent loss of accountability when an agreement ends | Termination requires acknowledging active flows; flows then surface as `flow_after_end` | No enforcement that flows actually stop |
| Unexplained prioritisation | Additive score with per-factor notes, exported alongside | Weights are opinionated defaults |
| CSV formula injection in issue export | `csvCell` apostrophe prefix | — |
| XSS via reasons/titles | React escaping; no HTML rendering of user text; Markdown packet is downloaded, never rendered | — |
| Deployment | CSP `default-src 'self'`, `style-src 'unsafe-inline'` (bar widths), `frame-ancestors 'none'`, nosniff, no-referrer | — |

## Data flow

fixture → `validateRegister` → React state → `findIssues`/`renewalQueue` (pure) → UI; `transition` returns a new register with an appended history entry; `evidencePacket`/`exportIssues` → Blob download. No network, no storage.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime: React, React DOM, 3 Fontsource packages.

## Accessibility

Axe: 0 violations after the contrast fix. Vendor nodes in the SVG are keyboard buttons with `aria-pressed`; the SVG is `role=group` with a text label and the agreements table is the full fallback; all inputs labelled; status and severity use text plus colour.

## Unresolved limitations

- Only hour-based breach windows are compared; no clause text analysis.
- No approvals; one user per session.
