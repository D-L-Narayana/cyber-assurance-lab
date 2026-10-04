# AUDIT.md — Firstlight

Self-review, 1 Oct 2026.

## Threat model

**Assets:** in-memory incident bundle, exported packet/bundle JSON. **Boundary:** single tab; no backend, auth or persistence. **Untrusted input:** imported bundle JSON. **Sensitive by nature:** incident facts can contain personal data; the redaction path must not over-claim.

| Threat | Mitigation | Residual |
|---|---|---|
| Oversized / hostile nesting | byte check (1,000,000) before `JSON.parse`; iterative bounded depth check (≤ 5) with an explicit stack — no recursion, so 20k-deep input cannot throw `RangeError`; item caps (2,000 events, 200 items per list) | parse of ≤ 1 MB still happens in-tab |
| Invalid timestamps producing a wrong clock | timestamps must match ISO shape *and* be real instants (calendar-valid day, hour ≤ 23, minute ≤ 59, finite `Date.parse`) | offsets are accepted and normalised by `Date.parse` |
| Redaction over-claim | `personalTokens` are rejected when malformed, blank or over limit rather than silently dropped; events flagged `personal` have summaries withheld; e-mails regex-redacted | names not listed in tokens are not caught; the UI labels the output "redacted" only for the token/e-mail model documented in README |
| Ambiguous duplicates | duplicate ids rejected across events, data scope and containment at import; exact duplicate events removed with a `DUPLICATE_EVENT` issue in the timeline | near-duplicates (different wording) are kept |
| "Done" without proof | `completeTask` throws without an evidence reference; the UI button is disabled until a reference is typed | reference is a free-text pointer |
| Deadline off-by-rounding | phase compares unrounded milliseconds; displayed hours rounded afterwards (test: +1 minute past deadline is exceeded) | — |
| XSS via fixture or import text | React escaping; CSP `script-src 'self'`; no `dangerouslySetInnerHTML` | `style-src 'unsafe-inline'` for Radix |
| Exfiltration | no network after load (browser audit records only the preview host); no storage APIs; export is user-initiated Blob download | none known |
| Clickjacking / sniffing | security headers in `vercel.json` (CSP, X-Frame-Options DENY, nosniff, COOP, CORP, HSTS, Referrer-Policy no-referrer, Permissions-Policy) | apply when hosted with the config |
| Sensitivity list (October 2026) presenting a move the engine would not actually make | `severitySensitivity` has no input path of its own (it reads the validated bundle), applies each candidate to a copy and measures `severity`; a test loops over every listed flip and checks the band and SE delta it claims | the list is advisory text; it never changes the bundle until the analyst edits a factor |

## Security headers

`vercel.json` applies the lab-wide canonical header set to every path (`/(.*)`), with `cleanUrls: true`:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`form-action 'none'` is compatible because both `<form>`s (add an event, mark a containment task done) handle `onSubmit` with `preventDefault()` and never navigate; `style-src 'unsafe-inline'` remains for Radix inline style attributes. The October 2026 round replaced the earlier `default-src 'self'` / `base-uri 'self'` / `form-action 'self'` / `upgrade-insecure-requests` / `interest-cohort=()` variant. The headers apply only when the built `dist/` is served through Vercel with this file.

## Data flow

Fixture / import → `parseBundle` (validated, bounded) → `IncidentBundle` state → pure engines `buildTimeline` → `evidenceClock` → `summariseScope`/`severity` (+ `severitySensitivity`, which re-runs `severity` on single-field variants and never mutates the bundle) → `readiness` → `buildPacket(redacted)` → view / Blob export. No side channels.

## Dependencies

`npm audit` 1 Oct 2026: **0 vulnerabilities** (production and full tree; `qa/npm-audit*.log`). Lockfile committed. `@radix-ui/react-tabs` was installed during scaffolding and removed before handoff because it is unused.

## Accessibility and QA

Playwright + axe at 1440 / 768 / 375 (`qa/browser-audit-summary.json`, `qa/screens/`). Initial run: `color-contrast` on the red/amber status tags (`#f26d6d` on `#5a2626` 4.13:1; `#f2a33a` on `#7a4f12` 3.41:1) → tag text lightened to `#ffc7c7` / `#ffd48a` on darker fills (9.45:1 / 8.76:1); `scrollable-region-focusable` on the packet `<pre>` → `tabIndex=0`; mobile horizontal overflow (389 px) traced to `.sr-only` labels positioned absolutely from the initial containing block inside the containment table → `.inline-form { position: relative }`. Final run: 0 violations, 0 page overflow, 0 console/page errors on all three viewports; 8-step workflow replay with axe re-run after the flow (0 violations).

## Known limitations (security-relevant)

- The redaction model is explicit and limited (tokens + e-mail regex); it is not an anonymisation guarantee.
- The clock is a teaching model; it does not encode statutory exceptions or decide notifiability.
- No authentication or audit log: the tool is single-user, single-tab by design.
- The screenshots in `qa/screens/` predate the October 2026 round (the severity column gained the "What would change the band" list; no browser re-audit was run in this round).
