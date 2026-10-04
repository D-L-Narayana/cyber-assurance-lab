# AUDIT — Permit Matrix

## Scope and threat model

**Asset:** a static single-page app that evaluates a user-supplied JSON contract with an in-memory mock server. There is no backend, no account, no persistent storage and no network call initiated by application code.

**Trust boundaries**

| Boundary | Input | Control |
|---|---|---|
| Pasted / uploaded contract → engine | Arbitrary text up to the browser's ability to hold it | `parseContract` rejects >64 KB (UTF-8 bytes), invalid JSON, nesting >6, lists >1000, >50 000 values, non-finite numbers; `validateContract` enforces schema, id patterns, duplicate ids, cross-references and per-list caps. Validation is iterative (no recursion, no argument spreading), verified by a 50 000-endpoint / 200 000-element regression test. |
| Contract `servers` | Any URL | Only `mock://host` or `http(s)://localhost|127.0.0.1|[::1]` accepted; everything else fails with `External target refused`. There is no request-issuing code path at all. |
| Engine output → DOM | Case ids, paths, field names, rationale strings | Rendered through React text nodes only; no `dangerouslySetInnerHTML`, no `eval`, no `new Function`. |
| Report export | JSON / Markdown file | Authorization header redacted; no CSV (so no formula-injection surface). Download via `Blob` + object URL, revoked after click. |

**Threats considered**

* *Malicious contract causing denial of service in the tab* — bounded by the structural scan and caps; the mock server is instantiated per case so cost is O(cases × records) with cases ≤ 40 endpoints × 24 principals × (3 + fields), where "fields" now includes create-path probes (one per non-writable field of the resource, ≤ 24 fields per record). Worst case is seconds of CPU, not a crash.
* *Misuse as a scanner against third parties* — impossible by construction; the "server" is a function.
* *Leaking a real token through an exported report* — tokens are symbolic (`mock-token-<principal>`) and still redacted on export, so the redaction path is tested even though no real secret exists.
* *XSS through contract content* — all strings are text nodes; CSP in `vercel.json` disallows inline scripts and remote origins.

## Data flow

`fixture JSON | user paste/file → parseContract/validateContract → generateCases → runSuite(createMockServer per case) → React state (current run + at most one previous run) → compareRuns (pure diff of two in-memory runs) → (optional) buildReport → Blob download`. Nothing is written to `localStorage`, `sessionStorage`, IndexedDB, cookies or any remote host. The October 2026 round added no import path: the comparison only ever reads two runs the engine itself produced in this tab, so no new trust boundary exists; its cost is linear in cases + findings.

## Dependency review (1 Oct 2026)

* Runtime: `react`, `react-dom` 19.3.0 (MIT); `@radix-ui/react-dialog` 1.1.23 and `@radix-ui/react-switch` 1.3.7 (MIT); `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` 5.3.0 (fonts under SIL OFL 1.1, package MIT).
* Dev: `vite` 7.3.6, `vitest` 4.1.11, `typescript` 5.9.3, `@vitejs/plugin-react` 5.2.0.
* `npm audit` initially reported 2 moderate advisories in `vitest@3.2.7` / `@vitest/mocker` (path traversal via redirect mock — a development-only test-runner issue that does not ship in `dist/`). Resolved by upgrading to `vitest@4.1.11`; `npm audit` now reports 0 vulnerabilities. No `--force` audit fixes were used.

## Security headers

`vercel.json` follows the lab-wide canonical profile adopted in the October 2026 upgrade round (`cleanUrls: true`, one rule for `/(.*)`): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. `default-src 'none'` makes every permitted source explicit; `style-src 'unsafe-inline'` remains because Radix primitives set a few inline style attributes (script execution is not affected); `form-action 'none'` is compatible because the app has no `<form>` element — every control is a button, select or input handled in React; fonts are self-hosted through `@fontsource`, so `font-src 'self'` suffices. Earlier rounds used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and sent no CORP or HSTS header.

## Unresolved limitations

* The mock server's semantics are the engine author's reading of the contract; a real backend may differ in ways the contract cannot express (query filters, pagination, ABAC conditions).
* No fuzzing of path parameters beyond the record ids in the fixture; path-traversal style ids are rejected by the id pattern rather than exercised.
* Severity is a transparent rubric, not CVSS, and findings are not de-duplicated across builds (the October 2026 run comparison matches them by `endpoint|kind` between two runs, but each run still reports its own findings).
* Accessibility was checked by keyboard walk-through and the parent's axe harness is available, but no screen-reader session was recorded. (October 2026: the harness and its results file are not part of this repository — see the artefact inventory in `EVIDENCE.md`; the new compare panel was checked by code review and computed contrast only, not by a browser run.)
