# AUDIT — Assay Notebook

## Threat model

**Asset:** a static SPA with an embedded, deterministic "vulnerable" application used as a teaching target. Because the target is a pure function, the usual risk of an intentionally vulnerable lab — exposing a real exploitable service — does not exist: there is no server, port or process to attack.

| Boundary | Input | Control |
|---|---|---|
| Composer → lab | Route, parameters, session | `validateLabRequest`: relative lab paths only (`External target refused` for any scheme or `//`), ≤ 200-char path, no `..`, ≤ 8 params with `[a-z][a-z0-9_]{0,31}` names and ≤ 512 printable-ASCII values, session ∈ {alice, bob, none}. |
| Lab response → DOM | HTML strings containing the reflected probe | Rendered only as text inside `<pre>`; React escapes; no `dangerouslySetInnerHTML`, `eval`, `innerHTML` or iframes. The reflected-input weakness is therefore observable but not executable. |
| Notebook growth | Repeated observations | 500 observations / 100 findings per notebook; notes ≤ 500 chars, rationale ≤ 1000. |
| Export | JSON/Markdown | `sid=` values redacted in headers and bodies; Blob download, URL revoked. No CSV. |

**Threats considered:** using the app as a scanner (impossible — no network code path), XSS via the lab's own reflected output (text-only rendering), memory exhaustion (caps), misleading reports (every report and the UI state "simulated target", "not a penetration test").

## Data flow

`composer | catalog → validateLabRequest → labRequest(build) → sha256(canonical exchange) → notebook state (memory) → buildReport → Blob`. No persistence, no network.

## Dependency review (1 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-toggle-group 1.1.19 (MIT), @fontsource-variable/literata and @fontsource-variable/jetbrains-mono 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions. No forced fixes.

## Security headers

`vercel.json`: CSP without inline scripts, `frame-ancestors 'none'`, nosniff, DENY, no-referrer, restrictive Permissions-Policy, COOP. `style-src 'unsafe-inline'` retained for Radix inline styles.

## Unresolved limitations

* The weakness catalogue is small and fixed; there is no fuzzing or discovery.
* The stack-trace oracle is a regex over a synthetic trace format; real frameworks vary.
* Severity rubric is intentionally coarse.
* No screen-reader session recorded; rubber-stamp states carry `aria-label`s and all controls are labelled.
