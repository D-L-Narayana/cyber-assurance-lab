# AUDIT — Peerline

## Threat model
- **Assets**: imported activity records (potentially sensitive if a user ignores the synthetic-only guidance), suppression rationales, dispositions, exported report.
- **Boundary**: browser tab; no server, storage API, or network call after load.
- **Adversarial inputs**: oversized JSON (2,000,000-byte UTF-8 cap checked before `JSON.parse`; 5,000-record cap), deeply nested or value-heavy JSON (iterative scan, ≤ 3 container levels, ≤ 100,000 values), wrong types, non-finite or out-of-range numbers, impossible calendar dates (`2026-02-30`), non-printable identifiers (control/format characters), duplicate `(user, day)` rows — each rejected with a path-addressed message (`records[i].field: …`, first 20 shown); unknown keys dropped; hostile strings rendered as text only. The validator never throws.
- **Ethical boundary**: the tool is explicitly for synthetic/aggregated data. It contains no connectors and is not suitable or intended for employee monitoring.

## Trust boundaries
| Input | Trust | Guard | Failure mode |
| --- | --- | --- | --- |
| Synthetic population (`generateActivity(seed)`) | Trusted (generated in the tab) | Deterministic by seed; tested | Test failure |
| Imported records JSON (textarea) | Untrusted | `parseRecords`: byte cap → single `JSON.parse` (a decoded string literal is never re-parsed) → structural scan → row rules → sanitised copy | Error list in the dialog; nothing loaded |
| Suppression rationale / disposition note | User text | Trimmed, length-capped (300) | — |
| Export | Outbound only | Blob + transient object URL | — |

## Data flow
seed → `generateActivity` (or import → `parseRecords` → `validateRecords`) → `buildBaselines` → `scoreRecords` → React state → `buildReport` → Blob download.

## Dependency findings
See `EVIDENCE.md` for the recorded `npm audit`. Runtime: react, react-dom, three Radix primitives, Fontsource fonts. No dependency was added in the October 2026 round.

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

`style-src 'unsafe-inline'` remains because Radix primitives (slider, switch, tooltip) and React inline `style` attributes need it. `form-action 'none'` is compatible: both `<form>` elements (suppression rationale, disposition) call `preventDefault()` and never navigate. Headers apply to the Vercel deployment only; `vite preview` serves without them.

## Unresolved limitations
- Precision on the default seed is 50 % by design (persistent peer deviation); the UI shows the number rather than hiding it.
- Threshold sliders are global; per-department thresholds are not implemented.
- Accessibility: band charts have `aria-label` summaries and the population table is the accessible equivalent; no automated axe run inside the repo.
