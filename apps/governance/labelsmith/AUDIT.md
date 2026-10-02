# AUDIT — Labelsmith

Date 2026-10-01. Educational prototype; not a certification.

Publication hygiene, 2026-10-02 UTC: GitHub push protection flagged provider-shaped synthetic values. These were replaced with explicit `DEMO_ONLY_NOT_A_SECRET_` examples in the fixture generator, fixture and tests. The generic high-variety-token detector still classifies them; no detector rule was weakened and no push-protection exception was requested. The unpublished local history containing the old fixtures was retained privately, not pushed.

## Threat model

Assets: the in-memory catalog, exceptions and exports. Untrusted inputs: a user-selected JSON fixture, free-text field names/samples typed into the specimen, user keyword rules.

| Threat | Mitigation | Residual |
|---|---|---|
| ReDoS via user rules | User rules are substring tokens, never RegExp; regex metacharacters rejected | Built-in regexes are anchored and linear; reviewed by eye, not fuzzed |
| Oversized/deep/malformed fixture | `parseBoundedJson` + `validateFixture` caps (2 000 fields, 50 samples, 200 chars) and per-row guards; bounded error lists | — |
| Prototype pollution | `__proto__` root key rejected; only known fields read | Nested keys not scanned |
| CSV formula injection | `csvCell` apostrophe-prefix incl. leading whitespace/control chars | — |
| XSS | React escaping; no `dangerouslySetInnerHTML`/`eval` | — |
| Misuse as "legal classification" | UI footer, README, export `disclaimer` field | Users may still over-trust confidence numbers |
| Heuristic over-classification (substring hits such as `tokenizer_version`, `healthcheck_status`) | Documented in README "Known false positives" and pinned by a test; waterfall shows the firing token; exceptions record downgrades | Not redesigned; safe failure direction but costs review time |
| Declared class weaker/stricter than computed | Weaker never lowers the effective class; stricter is kept as effective pending review (fixed after sixth-Fable review) | — |
| Deployment headers | CSP `default-src 'self'`, `style-src 'unsafe-inline'` (inline widths for meters), `frame-ancestors 'none'`, nosniff, no-referrer | — |

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
