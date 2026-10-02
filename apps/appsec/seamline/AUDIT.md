# AUDIT — Seamline

## Threat model

**Asset:** a static SPA that replays scripted events through two in-memory server models. No backend, storage or outbound traffic.

| Boundary | Input | Control |
|---|---|---|
| Pasted/uploaded scenario | Arbitrary text | 96 KB UTF-8 limit; JSON parse; iterative structural scan (depth ≤ 8, lists ≤ 500, ≤ 50 000 values, finite numbers); then schema validation with id patterns, per-event payload allow-lists, reference checks, monotonic time, and caps on steps/users/catalog/items. Lists sliced to caps before iteration. |
| Scenario → simulation | Validated objects | Pure functions; money arithmetic rounded to cents; nonces stored in a `Set` bounded by step count. |
| Simulation → DOM | Labels, field names, values | React text nodes only. No `dangerouslySetInnerHTML`, `eval` or dynamic HTML. |
| Export | JSON / Markdown | Tokens replaced with `[token:<user>]`; Blob download, URL revoked. No CSV. |

**Threats considered:** oversized or hostile scenarios (bounded), misleading claims (UI and report state the simulation nature), leaking the placeholder tokens (redacted anyway so the redaction path is exercised). **Not applicable:** network abuse — there is no network code path.

## Data flow

`fixture | paste/file → parseScenario → runScenario(trusting) + runScenario(enforcing) → React state → buildReport → Blob`. No persistence.

## Dependency review (1 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-slider 1.4.7 and @radix-ui/react-switch 1.3.7 (MIT), @fontsource-variable/manrope and @fontsource-variable/fira-code 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions; no forced fixes.

## Security headers

`vercel.json`: CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), nosniff, DENY, no-referrer, restrictive Permissions-Policy, COOP. `style-src 'unsafe-inline'` retained for Radix inline styles.

## Unresolved limitations

* Dark theme contrast was chosen by eye against WCAG AA for body text (`#e6edf5` on `#0e1520`, `#93a1b5` muted on panels); the parent's axe harness should confirm; the teal/violet origin labels are supplemented by text, not colour alone.
* The scrubber slider is keyboard-operable through Radix; the per-step marker buttons also carry labels, but no screen-reader session was recorded.
* The oracle maps each tamper kind to one CWE; real findings often warrant several.
