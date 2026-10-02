# AUDIT — Peerline

## Threat model
- **Assets**: imported activity records (potentially sensitive if a user ignores the synthetic-only guidance), suppression rationales, dispositions, exported report.
- **Boundary**: browser tab; no server, storage API, or network call after load.
- **Adversarial inputs**: oversized JSON (2,000,000-char and 5,000-record caps), wrong types/negative numbers/bad dates (field-level rejection, first 20 errors shown), hostile strings (rendered as text only).
- **Ethical boundary**: the tool is explicitly for synthetic/aggregated data. It contains no connectors and is not suitable or intended for employee monitoring.

## Data flow
seed → `generateActivity` (or import → `validateRecords`) → `buildBaselines` → `scoreRecords` → React state → `buildReport` → Blob download.

## Dependency findings
See `EVIDENCE.md` for the recorded `npm audit`. Runtime: react, react-dom, three Radix primitives, Fontsource fonts.

## Security headers
`vercel.json`: CSP `default-src 'self'` with `style-src 'unsafe-inline'` (React inline styles / Radix), `font-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`; nosniff; SAMEORIGIN; referrer and permissions policies.

## Unresolved limitations
- Precision on the default seed is 50 % by design (persistent peer deviation); the UI shows the number rather than hiding it.
- Threshold sliders are global; per-department thresholds are not implemented.
- Accessibility: band charts have `aria-label` summaries and the population table is the accessible equivalent; no automated axe run inside the repo.
