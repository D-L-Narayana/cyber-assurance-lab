# AUDIT — Attestline

Date: 2026-10-01. Scope: this repository only. Educational prototype; not a security certification.

## Threat model

**Assets.** The in-memory campaign (decisions, override rationales) and the exported certification files. All inputs are synthetic.

**Trust boundaries.** The only untrusted input is a JSON fixture chosen by the user through the file picker. Everything else is bundled code. There is no server, no authentication and no outbound request after the static assets load.

**Threats considered**

| Threat | Mitigation | Residual |
|---|---|---|
| Oversized / deeply nested / malformed fixture causing a hang or crash | `parseBoundedJson` (512 KB, depth 8, 5 000 values), `validateFixture` with per-array row caps and per-row type guards; all errors are returned, never thrown; error list capped at 26 entries | A fixture with 3 000 entitlements × 1 000 identities still runs O(entitlements × rules) in the browser; acceptable at these caps |
| Prototype pollution via `__proto__` keys | Rejected at parse time; engine never spreads untrusted objects into prototypes | Nested `__proto__` keys below the root are not scanned; the engine reads only known fields |
| CSV formula injection in exported reports | `csvCell` prefixes any cell whose first non-whitespace/non-control char is `= + - @` (or starts with tab/CR) and quotes delimiters | Users who strip the apostrophe themselves re-expose the risk |
| XSS through fixture strings | React escapes all text; no `dangerouslySetInnerHTML`, no `eval`, no `new Function` | None known |
| Clickjacking / sniffing / referrer leakage on deployment | `vercel.json` canonical lab-wide set (see "Security headers" below): CSP `default-src 'none'` with explicit `'self'` sources, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy no-referrer`, restrictive Permissions-Policy, COOP/CORP `same-origin`, HSTS | CSP allows `style-src 'unsafe-inline'` because React inline styles set the progress-bar width and risk colour; no inline scripts are needed. Headers apply to the Vercel deployment only, not to `vite preview` |
| Wrong reviewer deciding, self-review (actor or delegate = holder), delegation to leavers, self-manager fixtures, silent SoD acceptance | Enforced in `buildCampaign` routing, `applyDecision`, `routeItem`, `validateFixture`; covered by tests (added after sixth review) | Reviewer identity is a dropdown — there is no authentication by design |
| Data persistence in restricted environments | No storage APIs; state resets on refresh | Users lose work if they do not export |
| Decisions changed after a campaign was declared complete (October 2026) | `closeCampaign` guard: note ≥ 10 chars, pending items refused unless acknowledged and counted; `applyDecision`/`routeItem`/`bulkDecision` refuse on a closed campaign; UI disables the controls and shows the closing record | In-memory only; "Reset decisions" starts a new open campaign by design |
| Edited export passed off as the original | `digest` = SHA-256 (Web Crypto) over canonical JSON of items, decisions, config and closing record, shown in the UI and written into the JSON | Tamper-*evident*, not tamper-proof: no key, so an editor can recompute; the CSV carries no digest |

## Security headers

`vercel.json` (updated in the October 2026 lab-wide round to the canonical set shared by all 25 apps) sends, for every path:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` — `style-src 'unsafe-inline'` stays for the inline progress-bar widths and risk colours; `form-action 'none'` is compatible because the only `<form>` (the decision drawer) calls `preventDefault()` and never navigates; fonts are self-hosted Fontsource packages, so `font-src 'self'` suffices.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

Previously the CSP used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and omitted CORP and HSTS.

## Data flow

```
demo.json (bundled) ──┐
user file (optional) ─┴─> parseBoundedJson -> validateFixture -> buildCampaign -> React state
                                                                     │
                                            applyDecision / routeItem / bulkDecision / closeCampaign (pure, returns new campaign)
                                                                     │
                                            exportCertificationWithDigest (SHA-256 via crypto.subtle) -> Blob -> browser download (JSON / CSV)
```

Nothing leaves the tab. `URL.createObjectURL` blobs are revoked after download. No new import path was added in the October 2026 round; the digest is computed, never read back.

## Dependency findings

- `npm audit` (full and `--omit=dev`) on 2026-10-01: **0 vulnerabilities** reported for the resolved lockfile.
- Runtime dependencies are limited to React 19, React DOM and three Fontsource font packages. No component library, router, state library or analytics.
- Fonts are self-hosted via Vite asset hashing; no Google Fonts or other CDN requests.

## Accessibility check

Axe-core (wcag2a/aa/21aa) was run via `../_qa/audit.mjs` at 1440/768/375 px. One `color-contrast` finding on the footer note was fixed by darkening `--muted`. Table rows use roving `tabIndex` with arrow/j/k/Home/End navigation; every control is labelled; `prefers-reduced-motion` disables the stamp animation. The data table is wide by nature and scrolls horizontally inside its container on narrow screens (the page itself does not overflow).

## Unresolved limitations

- Risk weights are heuristics; see README.
- `validateFixture` does not check that `managerId` chains are acyclic (not needed by the engine but would matter for org-chart views).
- Campaign lock exists since October 2026 (`closeCampaign`), but only in memory and without a signature; a real system would persist the closure and sign the export.
- Browser QA is scripted for Chromium only.
