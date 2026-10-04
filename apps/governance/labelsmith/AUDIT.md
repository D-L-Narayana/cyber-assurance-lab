# AUDIT — Labelsmith

Date 2026-10-01. Educational prototype; not a certification.

Publication hygiene, 2026-10-02 UTC: GitHub push protection flagged provider-shaped synthetic values. These were replaced with explicit `DEMO_ONLY_NOT_A_SECRET_` examples in the fixture generator, fixture and tests. The generic high-variety-token detector still classifies them; no detector rule was weakened and no push-protection exception was requested. The unpublished local history containing the old fixtures was retained privately, not pushed.

## Threat model

Assets: the in-memory catalog, exceptions and exports. Untrusted inputs: a user-selected JSON fixture, free-text field names/samples typed into the specimen, user keyword rules.

| Threat | Mitigation | Residual |
|---|---|---|
| ReDoS via user rules | User rules are plain keywords compared token-by-token or by containment, never RegExp; regex metacharacters rejected. The October 2026 tokeniser uses three fixed two-class split patterns on names capped at 200 characters | Built-in regexes are anchored and linear; reviewed by eye, not fuzzed |
| Oversized/deep/malformed fixture | `parseBoundedJson` + `validateFixture` caps (2 000 fields, 50 samples, 200 chars) and per-row guards; bounded error lists | — |
| Prototype pollution | `__proto__` root key rejected; only known fields read | Nested keys not scanned |
| CSV formula injection | `csvCell` apostrophe-prefix incl. leading whitespace/control chars | — |
| XSS | React escaping; no `dangerouslySetInnerHTML`/`eval` | — |
| Misuse as "legal classification" | UI footer, README, export `disclaimer` field | Users may still over-trust confidence numbers |
| Heuristic over-classification (substring hits such as `tokenizer_version`, `healthcheck_status`) | October 2026: whole-token / token-sequence matching, `ALLOW_TOKENS` discounting, per-rule `exceptTokens`, and a separate Confidential hex-digest rule; the former false positives are regression-tested and seeded in the demo fixture; the waterfall shows `Suppressed:` with the token that fired or vetoed | Ambiguous whole words (`budget`, `expiry`, plural `tokens`) and value shapes (8–15-digit ids, hex ids, old dates) still over-classify — listed in README "Known false positives"; the allow-list can also cause false negatives on names like `verified_email` without samples |
| Allow-list / veto lists as a bypass ("name a credential column `token_count`") | Discounting applies to *name* evidence only; value rules (`val-apikey`, `val-jwt`, `val-password-hash`, `val-hex-credential`) still fire on the samples; `val-hex-credential` requires both a credential name and hex values | A credential column with an innocuous name *and* no samples is Unknown → "treat as confidential until reviewed", not Secret |
| Declared class weaker/stricter than computed | Weaker never lowers the effective class; stricter is kept as effective pending review (fixed after sixth review) | — |
| Deployment headers | Canonical lab-wide set (see "Security headers" below): CSP `default-src 'none'` with explicit `script-src`/`style-src`/`img-src`/`font-src`/`connect-src`/`manifest-src 'self'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; nosniff, DENY, no-referrer, Permissions-Policy, COOP, CORP, HSTS | Headers exist only on the Vercel deployment; `vite preview` serves without them |

## Security headers

`vercel.json` (updated in the October 2026 lab-wide round to the canonical set shared by all 25 apps) sends, for every path:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` — `style-src 'unsafe-inline'` stays because the ladder bar, confidence meter and waterfall weights use inline `width` styles; `form-action 'none'` is compatible because the UI has no `<form>` element (buttons call handlers directly). Fonts are self-hosted Fontsource packages, and since the October 2026 round `vite.config.ts` sets `build.assetsInlineLimit: 0` so that every font subset ships as a file: the previous build inlined one sub-4 KiB subset as a `data:font/woff2` URL in the CSS, which `font-src 'self'` blocks (two CSP violations and one console error per load were measured by the lead's browser survey under the production headers). The CSP was not widened; the asset was moved out of the stylesheet (see EVIDENCE.md).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

Previously the CSP used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and omitted CORP and HSTS.

## Data flow

`demo.json`/user file → `parseBoundedJson` → `validateFixture` → React state → `effectiveLabels` (pure) → UI; `exportCatalog` → Blob download. No network, no storage APIs.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime deps: React, React DOM, three Fontsource packages (OFL fonts). No component library.

## Accessibility

Axe wcag2a/aa/21aa: 0 violations at three viewports. Catalog buttons use `aria-current`; the ladder bar has a text `aria-label`; the label tag is `aria-live="polite"` so live reclassification is announced; all inputs are labelled; focus ring is the violet accent.

## Unresolved limitations

- No semantic analysis of free text; heuristics only.
- Weights/thresholds untuned; no precision/recall measurement.
- Exceptions have no approval chain; single-user session.
