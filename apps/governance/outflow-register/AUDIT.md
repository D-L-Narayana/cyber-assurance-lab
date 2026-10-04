# AUDIT — Outflow Register

Date 2026-10-01; updated 2026-10-04 (lab-wide upgrade round: canonical security headers, breach-window normalisation). Educational prototype; not legal advice; not a certification.

## Threat model

Assets: in-memory register, history and exported packets. Untrusted input: user-selected register JSON; free-text reasons.

| Threat | Mitigation | Residual |
|---|---|---|
| Malformed/oversize register | `parseBoundedJson` + `validateRegister` (caps: 500 agreements, 2 000 flows, 50 obligations each; dangling vendor/owner/system/agreement references; strict dates; bounded errors) | — |
| Silent loss of accountability when an agreement ends | Termination requires acknowledging active flows; flows then surface as `flow_after_end` | No enforcement that flows actually stop |
| Unexplained prioritisation | Additive score with per-factor notes, exported alongside | Weights are opinionated defaults |
| CSV formula injection in issue export | `csvCell` apostrophe prefix | — |
| XSS via reasons/titles | React escaping; no HTML rendering of user text; Markdown packet is downloaded, never rendered | — |
| Free-text requirement parsing (October 2026) | `parseWindowHours` is a single linear regex over a string already capped at 300 characters by `validateRegister`; digits are limited to six, only hours/days/weeks units are known, everything else is `null` and reported as *not compared* rather than guessed | A requirement that reads "3 days" but means business days is normalised to 72 h; the raw text stays visible in the issue so a reader can catch it |
| Deployment | Canonical lab header set in `vercel.json` (see **Security headers** below); the build no longer inlines any asset (`assetsInlineLimit: 0`), because an inlined font subset (`data:` URL) was blocked by `font-src 'self'` in the integration browser run of 2026-10-04 — fixed by shipping the font as a file, not by widening the policy | Applies only when served with that configuration |

## Security headers

`vercel.json` (updated 2026-10-04 to the lab-wide canonical set) sends, for every path: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` (`'unsafe-inline'` styles remain for the priority bar widths; `form-action 'none'` is compatible because the app has no `<form>` element — the status-change controls are plain buttons), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. The previous set used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and lacked CORP and HSTS. Honouring `font-src 'self'` required a build change as well as the header: see the Deployment row above and `EVIDENCE.md`.

## Data flow

fixture → `validateRegister` → React state → `findIssues`/`renewalQueue` (pure) → UI; `transition` returns a new register with an appended history entry; `evidencePacket`/`exportIssues` → Blob download. No network, no storage.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime: React, React DOM, 3 Fontsource packages.

## Accessibility

Axe: 0 violations after the contrast fix. Vendor nodes in the SVG are keyboard buttons with `aria-pressed`; the SVG is `role=group` with a text label and the agreements table is the full fallback; all inputs labelled; status and severity use text plus colour.

## Unresolved limitations

- Breach windows are compared only when a number plus an hours/days/weeks unit can be read; other phrasing is listed as not compared. No clause text analysis.
- No approvals; one user per session.
