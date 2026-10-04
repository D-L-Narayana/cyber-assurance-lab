# AUDIT — Seamline

## Threat model

**Asset:** a static SPA that replays scripted events through two in-memory server models. No backend, storage or outbound traffic.

| Boundary | Input | Control |
|---|---|---|
| Pasted/uploaded scenario | Arbitrary text | 96 KB UTF-8 limit; JSON parse; iterative structural scan (depth ≤ 8, lists ≤ 500, ≤ 50 000 values, finite numbers); then schema validation with id patterns, per-event payload allow-lists, reference checks, monotonic time, and caps on steps/users/catalog/items. Lists sliced to caps before iteration. |
| Scenario fields added October 2026 (same import path) | `catalog[].maxQty`, `tamper.value`, client `items[].qty` | `maxQty` optional integer 1–10 000; `tamper.value` optional finite number with magnitude ≤ 1 000 000 and only on `quantity-rewrite` steps of `place-order` events; client line quantities are deliberately accepted when zero, negative or fractional (they are untrusted claims the *server* must judge) but must be finite with magnitude ≤ 1 000 000 so arithmetic stays bounded. Both schema ids are unchanged (`seamline.scenario/1`, `seamline.report/1`); previous fixtures and exports still import. |
| Scenario → simulation | Validated objects | Pure functions; money arithmetic rounded to cents; nonces stored in a `Set` bounded by step count; quantities validated per line against `maxQty` (default 99) by the enforcing model before pricing. |
| Simulation → DOM | Labels, field names, values | React text nodes only. No `dangerouslySetInnerHTML`, `eval` or dynamic HTML. |
| Export | JSON / Markdown | Tokens replaced with `[token:<user>]`; Blob download, URL revoked. No CSV. |

**Threats considered:** oversized or hostile scenarios (bounded), misleading claims (UI and report state the simulation nature), leaking the placeholder tokens (redacted anyway so the redaction path is exercised). **Not applicable:** network abuse — there is no network code path.

## Data flow

`fixture | paste/file → parseScenario → runScenario(trusting) + runScenario(enforcing) → React state → buildReport → Blob`. No persistence.

## Dependency review (1 Oct 2026; unchanged 4 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-slider 1.4.7 and @radix-ui/react-switch 1.3.7 (MIT), @fontsource-variable/manrope and @fontsource-variable/fira-code 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions; no forced fixes. No dependency was added in the October 2026 round.

## Security headers

`vercel.json` (lab-wide canonical set, October 2026): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`; `cleanUrls: true`. `style-src 'unsafe-inline'` is retained for Radix inline styles. `form-action 'none'` is compatible because the app has no `<form>` element: the import controls are plain buttons and inputs that never submit or navigate. Build-side consequence of `font-src 'self'` (no `data:`): `vite.config.ts` sets `assetsInlineLimit: 0` so every font subset is emitted as a file under `assets/` — with Vite's default 4 KB inline limit one small Manrope subset (cyrillic-ext, 2.55 kB) was embedded in the CSS as a `data:font/woff2` URL and blocked by this very policy when the built bundle was served under it in the October 2026 browser acceptance run (two CSP violations and one console error per load). The policy was not widened; the build was changed. `EVIDENCE.md` records the before/after measurement.

## Unresolved limitations

* Dark theme contrast was chosen by eye against WCAG AA for body text (`#e6edf5` on `#0e1520`, `#93a1b5` muted on panels); the parent's axe harness should confirm; the teal/violet origin labels are supplemented by text, not colour alone.
* The scrubber slider is keyboard-operable through Radix; the per-step marker buttons also carry labels, but no screen-reader session was recorded.
* The oracle maps each invariant to one CWE; real findings often warrant several (an accepted negative quantity is CWE-20 here, though its business effect — a credit instead of a charge — could also be filed under CWE-840 or CWE-602).
* The October 2026 UI text changes (server description, footer, tamper note for `quantity-rewrite`) reuse existing colour tokens; the screenshots in `qa/screens/` predate them and no browser/axe pass was run in this round.
