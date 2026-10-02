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

`fixture | paste/file → parseManifest/parsePolicy → classifyChanges → evaluateRelease (async, SHA-256) → React state → buildBundle → Blob download`. No persistence.

## Dependency review (1 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-dialog 1.1.23 and @radix-ui/react-tabs 1.1.21 (MIT), @fontsource-variable/archivo and @fontsource-variable/source-sans-3 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions (vitest 4.1.11 chosen over 3.x to avoid the @vitest/mocker advisory). No forced fixes.

## Security headers

Same `vercel.json` profile as the other candidates: CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), nosniff, DENY framing, no-referrer, restrictive Permissions-Policy, COOP. `style-src 'unsafe-inline'` is retained for Radix inline style attributes.

## Unresolved limitations

* `unverified` evidence (no inline artifact) does not block. This is a policy choice made visible as an amber signal and a warning; a stricter policy option ("require verifiable artifacts") is a sensible next step.
* The as-of date input is day-granular; evidence timestamps are second-granular.
* No screen-reader session recorded; keyboard navigation was checked manually and the train signals carry `role="img"` labels.
