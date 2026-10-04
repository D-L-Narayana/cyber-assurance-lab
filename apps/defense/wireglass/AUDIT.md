# AUDIT — Wireglass

## Threat model
- **Assets**: the user's pasted text (may be sensitive if they ignore guidance), triage notes, exported report.
- **Trust boundary**: the browser tab. No server, no network calls, no storage APIs. Fonts and scripts are bundled and served same-origin as files: `vite.config.ts` sets `build.assetsInlineLimit: 0` so no font subset is inlined as a `data:` URL (the production CSP's `font-src 'self'` has no `data:` source and would block it — see "Security headers").
- **Adversarial inputs considered**: oversized paste (capped at 200,000 chars / 5,000 lines before parsing), pathological lines (anchored regexes with bounded quantifiers — user-agent capped at 300 chars, qname at 253, HTTP bytes at 13 digits after the sixth review), malformed timestamps/IPs (rejected per line), hostile HTML in log text (rendered as React text nodes only; no `dangerouslySetInnerHTML`).
- **Not in scope**: real detection efficacy, evasion resistance, multi-user access control.

## Data flow
scenario generator / paste → `parseLogs` (bounded) → `runRules` → `correlateAlerts` → React state → optional `buildReport` → Blob download. No persistence.
Tuning what-if (October 2026): rule edits go to a pending `RuleConfig`; `runRules` is re-run over the already-parsed events with the pending config and `diffAlerts` (pure, `src/engine/diff.ts`) compares alert ids. Apply commits the config and the report gains an optional `tuning` record; Discard drops the pending config. No new import path, no new untrusted input — the config fields are the same bounded number/list inputs as before (numbers 0–1e9, lists ≤ 50 entries).

## Dependency findings
`npm audit` result recorded in `EVIDENCE.md`. Runtime deps: react, react-dom, three Radix primitives, two Fontsource font packages. No network-capable runtime dependency.

## Security headers
`vercel.json` applies the lab-wide canonical header set (October 2026 upgrade round):
- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`style-src 'unsafe-inline'` stays because the Radix primitives and React inline `style` attributes set styles inline. `form-action 'none'` is compatible: the only `<form>` (scenario/seed controls) calls `preventDefault()` in its submit handler and never navigates. Before this round the file allowed `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`, used `Referrer-Policy: strict-origin-when-cross-origin`, and set no COOP, CORP or HSTS header.

Build/CSP interaction (found 2026-10-04 by serving the built `dist/` with these exact headers): Vite inlines assets under 4 KiB, and one small variable-font subset was being emitted into the CSS as `url(data:font/woff2;base64,…)`, which `font-src 'self'` blocks (two CSP violation reports and one console error per page load; the glyphs fell back to the next font). The fix is in the build, not the policy: `build.assetsInlineLimit: 0` in `vite.config.ts` makes every font ship as a same-origin file. The CSP was not widened; `tools/check-dist.mjs` checks the built CSS for `data:` font URLs.

## Unresolved limitations
- Rules are heuristics with documented false positives; thresholds are illustrative defaults, not tuned to any real estate. The what-if diff shows the effect of a change on the *current* events only — it is not a precision/recall measurement.
- The DNS entropy gate can be evaded with low-entropy encodings; this is documented, not solved.
- Downloads use `URL.createObjectURL`, which some restricted preview sandboxes block; the in-app status line tells the user if nothing happened.
- No automated axe run inside this repo; manual keyboard pass and parent-side browser audit are the accessibility evidence.
