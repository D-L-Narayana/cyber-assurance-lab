# AUDIT — Holdfast Ledger

Date 2026-10-01; updated 2026-10-04 (lab-wide upgrade round: canonical security headers, guarded hold release/reinstatement with trail). Educational prototype; not a certification and not legal advice.

## Threat model

Assets: in-memory plans/receipts and exported audit bundles. Untrusted input: user-selected fixture JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Fabricated or edited receipts | SHA-256 chain over content + previous hash; `verifyChain` recomputes from genesis; reconciliation vs plan | Chain head is not anchored outside the tab; an attacker who controls the whole ledger can rewrite everything consistently |
| Double execution / replay of a plan | Plan id derived from inputs; execution refuses a known plan id | — |
| Hold bypass (hold placed between planning and execution) | Plan id re-derived from the current fixture at execution; mismatch → stale plan rejected atomically (review finding of 2026-10-01, regression-tested) | — |
| Unexplained or careless hold release (October 2026) | `releaseHold`/`reinstateHold` refuse unknown holds, already-released / not-released holds, dates before `placedOn` / `releasedOn`, non-calendar dates, a missing or > 120-char actor and a reason shorter than 10 chars; every accepted change is appended to `holdHistory` with contiguous `seq`; the UI only calls these functions | Actor is free text — no authentication, role model or second-person approval; the trail is not hash-chained |
| Malformed fixture (nulls, bad dates, dangling systems, duplicate categories, 2026-02-30) | `parseBoundedJson` + `validateFixture` with caps (5 000 records, 200 holds, 500 ids per hold) and bounded errors | — |
| Malformed hold trail in an imported fixture (new import field, October 2026) | `holdHistory` is optional (legacy fixtures import unchanged); when present each event is rebuilt field by field so unknown keys are dropped: `seq` contiguous from 1, known hold id, action `release`/`reinstate`, strict calendar date, actor 1–120 chars, reason 1–1 000 chars, at most 2 000 events; errors are path-addressed (`holdHistory[i]: …`) and never thrown | Trail content is asserted by the file, not proven |
| CSV formula injection | `csvCell` apostrophe prefix (incl. leading whitespace/control chars) | — |
| XSS / eval | React escaping only; no HTML injection; no eval | — |
| Deployment | Canonical lab header set in `vercel.json` (see **Security headers** below) | Applies only when served with that configuration |

## Security headers

`vercel.json` (updated 2026-10-04 to the lab-wide canonical set) sends, for every path: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` (`'unsafe-inline'` styles remain for the SVG/inline widths; `form-action 'none'` is compatible because the only `<form>` — the hold release/reinstate form — handles submit in JavaScript with `preventDefault` and never navigates), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. The previous set used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and lacked CORP and HSTS.

## Data flow

fixture → `validateFixture` → React state → `computeDue`/`planDisposal` (pure, async for hashing) → `releaseHold`/`reinstateHold` (pure, return a new fixture + trail) → `executePlan` (returns new records + receipts) → `verifyChain`/`reconcile` → `exportAudit` (now includes `holdHistory`) → Blob download. No network, no storage APIs.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime: React, React DOM, 3 Fontsource font packages. Hashing via platform Web Crypto, no crypto library.

## Accessibility

Axe: 0 violations at three viewports (measured 2026-10-01, before this round's UI change). The SVG calendar has a text `aria-label` summarising counts and a full `<table>` fallback; bars are focusable with `<title>` tooltips and update a text detail line; all buttons/inputs labelled; colour is never the only indicator (hatching for holds, text states in table). The October 2026 hold form uses labelled text/date inputs, a `role="alert"` refusal message, keyboard-operable submit/cancel buttons, no motion, and text tokens already in the palette (contrast ratios in `EVIDENCE.md`); it has not yet been re-measured with axe in a browser.

## Unresolved limitations

- No external anchoring of the chain head; no signatures.
- One schedule per category; UTC calendar days only.
- Hold changes carry an actor and a reason but no authentication or second-person approval; the trail is not hash-chained.
