# AUDIT — Ruleshadow

## Threat model
- **Assets**: imported rule tables (would be sensitive if real; guidance says synthetic only), review decisions, exports.
- **Boundary**: the tab; no network, no storage API.
- **Adversarial inputs**: CSV up to 500,000 chars / 500 rules; each field validated (CIDR, ports, action, proto, dates, ids ≤ 40, comment ≤ 200); quoted-field parser is linear-time; regexes are anchored with bounded repetition.
- **Export safety**: CSV cells are quoted and formula-prefixed characters are neutralised.
- **Out of scope**: device connectivity, live hit counters, configuration push.

## Data flow
fixture / CSV → `parseRuleCsv` → `analyzeCoverage` (boxes.ts, bounded by a 4 000-fragment budget per box) → `analyzeRules` → `proposeChange` → approvals → `applyProposals` → `diffRuleSets` → exports. No new import path was added in the October 2026 round; the CSV importer and its limits (500 rules / 500 000 chars, per-field validation) are the only untrusted input.

## Dependency findings
See `EVIDENCE.md`. Runtime: react, react-dom, three Radix primitives, three Fontsource font packages.

## Security headers
`vercel.json` applies the lab-wide canonical header set (October 2026 upgrade round):
- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`style-src 'unsafe-inline'` stays because the Radix primitives (tooltip positioning) set inline styles; the footprint and coverage bars are SVG attributes, not inline styles. `form-action 'none'` is compatible: the app has no `<form>` element — every control is a plain button or input. Before this round the file allowed `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`, used `Referrer-Policy: strict-origin-when-cross-origin`, and set no COOP, CORP or HSTS header.

## Unresolved limitations
- Shadow analysis treats `any` zone as covering all zones, which is correct for the fixture but may not match every vendor's semantics. The `redundant`/`conflict` classification is containment-based (port union under fully containing address ranges); the parent review's first-match precedence gap (a dead earlier rule counted as coverage) was fixed and is now tested. Since October 2026 a separate union-based coverage pass (`boxes.ts`) reports the share of each rule's address × port space already matched by earlier rules as an `info` finding; it is volume-weighted, ignores the covering rules' actions, and becomes a flagged lower bound when the 4 000-fragment budget is reached (R12). It never changes the containment findings.
- Proposals never invent address scopes: overbroad allows and VPN narrowing without a supplied jump host are `manualReview` with no change (review round 2, 2026-10-01). A supplied jump host must be a strict subset of the rule's current destination (round 3: `0.0.0.0/0` for a `10.0.0.0/8` rule was previously accepted as a "narrow" and would have broadened the rule). Stale expiry is derived from the review date (+30 days). The re-analysis preview therefore reflects only changes the engine actually made.
- No automated axe run within the repo.
