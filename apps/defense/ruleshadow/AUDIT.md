# AUDIT — Ruleshadow

## Threat model
- **Assets**: imported rule tables (would be sensitive if real; guidance says synthetic only), review decisions, exports.
- **Boundary**: the tab; no network, no storage API.
- **Adversarial inputs**: CSV up to 500,000 chars / 500 rules; each field validated (CIDR, ports, action, proto, dates, ids ≤ 40, comment ≤ 200); quoted-field parser is linear-time; regexes are anchored with bounded repetition.
- **Export safety**: CSV cells are quoted and formula-prefixed characters are neutralised.
- **Out of scope**: device connectivity, live hit counters, configuration push.

## Data flow
fixture / CSV → `parseRuleCsv` → `analyzeRules` → `proposeChange` → approvals → `applyProposals` → `diffRuleSets` → exports.

## Dependency findings
See `EVIDENCE.md`. Runtime: react, react-dom, three Radix primitives, three Fontsource font packages.

## Security headers
`vercel.json`: CSP `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`; nosniff; SAMEORIGIN; referrer and permissions policies.

## Unresolved limitations
- Shadow analysis treats `any` zone as covering all zones, which is correct for the fixture but may not match every vendor's semantics. Coverage is containment-based (port union under fully containing address ranges), not general IP-space union; the parent review's first-match precedence gap (a dead earlier rule counted as coverage) was fixed and is now tested.
- Proposals never invent address scopes: overbroad allows and VPN narrowing without a supplied jump host are `manualReview` with no change (review round 2, 2026-10-01). A supplied jump host must be a strict subset of the rule's current destination (round 3: `0.0.0.0/0` for a `10.0.0.0/8` rule was previously accepted as a "narrow" and would have broadened the rule). Stale expiry is derived from the review date (+30 days). The re-analysis preview therefore reflects only changes the engine actually made.
- No automated axe run within the repo.
