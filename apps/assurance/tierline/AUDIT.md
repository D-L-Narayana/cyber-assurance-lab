# AUDIT — Tierline

## Threat model

Assets: vendor register (synthetic), assessment and queue exports. Adversaries: hostile register import; a spreadsheet consumer of the CSV; an analyst gaming the tier by leaving questions blank or parking exceptions.

| Threat | Control | Residual |
|---|---|---|
| Hostile import | 1 MiB UTF-8 cap pre-parse; ≤ 200 vendors, 40 evidence and 20 exceptions per vendor; option/question ids validated against the model; strict date round-trip; path-addressed issues; rebuilt object | Bespoke validator |
| Tier gaming by omission | Unanswered questions score at maximum and raise an `incomplete-questionnaire` queue item | — |
| Exceptions as permanent waivers | Exceptions expire, count half, and generate `exception-expiring` / `exception-expired` queue items | No approval workflow (see Graceline) |
| Stale tiers | `tier-drift` item when recorded tier ≠ computed tier | — |
| CSV formula injection | Cells starting with `= + - @` (even after whitespace) are quoted with a leading `'` | — |
| XSS | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` |
| Misreading the heuristic as a standard | `SCORING_NOTE` in footer and assessment export; README table of rules | — |

## Data flow

Fixture → validator → state → pure engine → SVG/DOM. Import via size-gated `FileReader`; export via Blob URL. No network, no storage APIs, no third-party scripts.

## Headers

Track-standard hardened `vercel.json` (CSP default-src 'none', nosniff, DENY, no-referrer, Permissions-Policy, COOP/CORP).

## Dependency findings

`npm audit`: 0 (vitest 4.1.11). Runtime deps: react, react-dom, two OFL font packages.

## Unresolved limitations

Heuristic weights are not calibrated against any dataset; intake questionnaire only (vendor-supplied questionnaire answers are not scored); no inherent-vs-residual history over time; a11y verified by automation and keyboard checks only.
