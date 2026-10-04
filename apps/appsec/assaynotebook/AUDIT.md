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

`composer | catalog → validateLabRequest → labRequest(build) → sha256(canonical exchange) → notebook state (memory) → buildReport → Blob`. No persistence, no network. The October 2026 header oracle adds no input path: it reads the simulated response's header map (case-insensitively) and sends nothing.

## Dependency review (1 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-toggle-group 1.1.19 (MIT), @fontsource-variable/literata and @fontsource-variable/jetbrains-mono 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions. No forced fixes.

## Security headers

`vercel.json` follows the lab-wide canonical profile adopted in the October 2026 upgrade round (`cleanUrls: true`, one rule for `/(.*)`): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. `default-src 'none'` makes every permitted source explicit; `style-src 'unsafe-inline'` is retained for Radix inline style attributes (script execution is not affected); `form-action 'none'` is compatible because the app has no `<form>` element — the composer is a set of inputs and buttons handled in React, and the lab's "login form" is a pure function call, not a browser form submission; fonts are self-hosted through `@fontsource-variable`, so `font-src 'self'` suffices — provided they ship as files: `vite.config.ts` sets `build.assetsInlineLimit: 0` because a browser check of the built bundle under these response headers found one small font subset that Vite had inlined as a `data:` URL blocked by `font-src 'self'` (which deliberately allows no `data:`); the CSP was kept as is and the build changed instead. Earlier rounds used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and sent no CORP or HSTS header. Note that the in-tab lab's *simulated* responses deliberately omit `Content-Security-Policy`/`X-Content-Type-Options` on builds v1 and v2 (the TC-05 teaching case); those are strings inside the page, never real HTTP headers.

## Unresolved limitations

* The weakness catalogue is small and fixed; there is no fuzzing or discovery.
* The stack-trace oracle is a regex over a synthetic trace format; real frameworks vary.
* The security-headers oracle checks the presence of two headers on rendered HTML, not the strength of the policy they carry.
* Severity rubric is intentionally coarse.
* No screen-reader session recorded; rubber-stamp states carry `aria-label`s and all controls are labelled. (October 2026: no new UI control was added — only text and one more catalog row rendered by existing components; the earlier axe results file is not in this repository, see `EVIDENCE.md`.)
