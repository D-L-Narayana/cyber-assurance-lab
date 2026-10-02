# AUDIT — Wireglass

## Threat model
- **Assets**: the user's pasted text (may be sensitive if they ignore guidance), triage notes, exported report.
- **Trust boundary**: the browser tab. No server, no network calls, no storage APIs. Fonts and scripts are bundled and served same-origin.
- **Adversarial inputs considered**: oversized paste (capped at 200,000 chars / 5,000 lines before parsing), pathological lines (anchored regexes with bounded quantifiers — user-agent capped at 300 chars, qname at 253, HTTP bytes at 13 digits after the sixth-Fable review), malformed timestamps/IPs (rejected per line), hostile HTML in log text (rendered as React text nodes only; no `dangerouslySetInnerHTML`).
- **Not in scope**: real detection efficacy, evasion resistance, multi-user access control.

## Data flow
scenario generator / paste → `parseLogs` (bounded) → `runRules` → `correlateAlerts` → React state → optional `buildReport` → Blob download. No persistence.

## Dependency findings
`npm audit` result recorded in `EVIDENCE.md`. Runtime deps: react, react-dom, three Radix primitives, two Fontsource font packages. No network-capable runtime dependency.

## Security headers
`vercel.json` sets CSP (`default-src 'self'`, `style-src 'self' 'unsafe-inline'` for React inline style attributes, `font-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`.

## Unresolved limitations
- Rules are heuristics with documented false positives; thresholds are illustrative defaults, not tuned to any real estate.
- The DNS entropy gate can be evaded with low-entropy encodings; this is documented, not solved.
- Downloads use `URL.createObjectURL`, which some restricted preview sandboxes block; the in-app status line tells the user if nothing happened.
- No automated axe run inside this repo; manual keyboard pass and parent-side browser audit are the accessibility evidence.
