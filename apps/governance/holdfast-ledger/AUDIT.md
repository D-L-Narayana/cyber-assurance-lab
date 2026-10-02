# AUDIT — Holdfast Ledger

Date 2026-10-01. Educational prototype; not a certification and not legal advice.

## Threat model

Assets: in-memory plans/receipts and exported audit bundles. Untrusted input: user-selected fixture JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Fabricated or edited receipts | SHA-256 chain over content + previous hash; `verifyChain` recomputes from genesis; reconciliation vs plan | Chain head is not anchored outside the tab; an attacker who controls the whole ledger can rewrite everything consistently |
| Double execution / replay of a plan | Plan id derived from inputs; execution refuses a known plan id | — |
| Hold bypass (hold placed between planning and execution) | Plan id re-derived from the current fixture at execution; mismatch → stale plan rejected atomically (sixth-Fable finding, regression-tested) | Hold release is a UI click; no authority check (documented) |
| Malformed fixture (nulls, bad dates, dangling systems, duplicate categories, 2026-02-30) | `parseBoundedJson` + `validateFixture` with caps (5 000 records, 200 holds, 500 ids per hold) and bounded errors | — |
| CSV formula injection | `csvCell` apostrophe prefix (incl. leading whitespace/control chars) | — |
| XSS / eval | React escaping only; no HTML injection; no eval | — |
| Deployment | CSP `default-src 'self'`, `style-src 'unsafe-inline'` (SVG/inline widths), `frame-ancestors 'none'`, nosniff, no-referrer | — |

## Data flow

fixture → `validateFixture` → React state → `computeDue`/`planDisposal` (pure, async for hashing) → `executePlan` (returns new records + receipts) → `verifyChain`/`reconcile` → `exportAudit` → Blob download. No network, no storage APIs.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime: React, React DOM, 3 Fontsource font packages. Hashing via platform Web Crypto, no crypto library.

## Accessibility

Axe: 0 violations at three viewports. The SVG calendar has a text `aria-label` summarising counts and a full `<table>` fallback; bars are focusable with `<title>` tooltips and update a text detail line; all buttons/inputs labelled; colour is never the only indicator (hatching for holds, text states in table).

## Unresolved limitations

- No external anchoring of the chain head; no signatures.
- One schedule per category; UTC calendar days only.
- Hold release lacks authority/approval modelling.
