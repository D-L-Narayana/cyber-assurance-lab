# AUDIT — Provenance Gate

## Threat model

**Asset:** a static SPA that evaluates user-supplied release metadata. No backend, auth, storage or outbound traffic.

| Boundary | Input | Control |
|---|---|---|
| Pasted/uploaded manifest or policy → engine | Arbitrary text | Byte limit (128 KB UTF-8), JSON parse, iterative structural scan (depth ≤ 6, lists ≤ 1000, ≤ 100 000 values, finite numbers), then per-field validation with id/path/glob patterns, `..` rejection, enum checks and cross-reference checks (authors, reviewers, approvers must be listed identities). Lists are sliced to their caps before iteration. |
| Globs from policy → regex | User-controlled patterns | `globToRegExp` escapes every regex metacharacter and only emits `[^/]*`, `(?:[^/]+/)*` and `.*`; no nested quantifiers, so no catastrophic backtracking. Glob syntax itself is whitelisted by `GLOB`. |
| Artifacts → SHA-256 | ≤ 4000 chars text | `crypto.subtle.digest`; failure of Web Crypto would surface as a rejected promise, not a false "verified". |
| Engine output → DOM | Strings from the manifest | React text nodes only; no `dangerouslySetInnerHTML`, `eval` or `Function`. |
| Export | JSON / Markdown download | Blob + object URL revoked after click. No CSV. |

**Threats considered:** gate bypass through self-approval, duplicate reviewer identities, reused evidence from an older commit, altered artifacts, expired or over-long acceptances, future-dated evidence, acceptance by someone without the role, acceptances pointing at non-existent findings. Each has a test. **Not addressed:** forged manifests (the tool trusts its input; it is an evaluator, not a provenance source), and binary or external artifacts.

## Data flow

`fixture | paste/file → parseManifest/parsePolicy → classifyChanges → evaluateRelease (async, SHA-256) → React state → remediationFor (pure derivation from evaluation + policy + manifest) → buildBundle → Blob download`. No persistence. The October 2026 remediation checklist adds no import path and no trust boundary: it reads only values the validator already accepted (ids, commits, policy numbers) and renders them as text nodes / plain Markdown.

## Dependency review (1 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-dialog 1.1.23 and @radix-ui/react-tabs 1.1.21 (MIT), @fontsource-variable/archivo and @fontsource-variable/source-sans-3 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions (vitest 4.1.11 chosen over 3.x to avoid the @vitest/mocker advisory). No forced fixes.

## Security headers

`vercel.json` follows the lab-wide canonical profile adopted in the October 2026 upgrade round (`cleanUrls: true`, one rule for `/(.*)`): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. `default-src 'none'` makes every permitted source explicit; `style-src 'unsafe-inline'` is retained for Radix inline style attributes (script execution is not affected); `form-action 'none'` is compatible because the app has no `<form>` element — the policy editor and import dialog are textareas and buttons handled in React; fonts are self-hosted through `@fontsource-variable`, so `font-src 'self'` suffices. Earlier rounds used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and sent no CORP or HSTS header.

## Unresolved limitations

* `unverified` evidence (no inline artifact) does not block. This is a policy choice made visible as an amber signal and a warning; a stricter policy option ("require verifiable artifacts") is a sensible next step.
* The as-of date input is day-granular; evidence timestamps are second-granular.
* No screen-reader session recorded; keyboard navigation was checked manually and the train signals carry `role="img"` labels. (October 2026: the new checklist is a native `<details>`/`<ol>` — keyboard operable by construction — but it was checked by code review and computed contrast only, not by a browser run; the earlier axe results file is not in this repository, see `EVIDENCE.md`.)
