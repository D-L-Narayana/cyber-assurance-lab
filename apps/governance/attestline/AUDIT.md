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
| Clickjacking / sniffing / referrer leakage on deployment | `vercel.json`: CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy no-referrer`, restrictive Permissions-Policy | CSP allows `style-src 'unsafe-inline'` because React inline styles set the progress-bar width and risk colour; no inline scripts are needed |
| Wrong reviewer deciding, self-review (actor or delegate = holder), delegation to leavers, self-manager fixtures, silent SoD acceptance | Enforced in `buildCampaign` routing, `applyDecision`, `routeItem`, `validateFixture`; covered by tests (added after sixth-Fable review) | Reviewer identity is a dropdown — there is no authentication by design |
| Data persistence in restricted environments | No storage APIs; state resets on refresh | Users lose work if they do not export |

## Data flow

```
demo.json (bundled) ──┐
user file (optional) ─┴─> parseBoundedJson -> validateFixture -> buildCampaign -> React state
                                                                     │
                                            applyDecision / routeItem / bulkDecision (pure, returns new campaign)
                                                                     │
                                            exportCertification -> Blob -> browser download (JSON / CSV)
```

Nothing leaves the tab. `URL.createObjectURL` blobs are revoked after download.

## Dependency findings

- `npm audit` (full and `--omit=dev`) on 2026-10-01: **0 vulnerabilities** reported for the resolved lockfile.
- Runtime dependencies are limited to React 19, React DOM and three Fontsource font packages. No component library, router, state library or analytics.
- Fonts are self-hosted via Vite asset hashing; no Google Fonts or other CDN requests.

## Accessibility check

Axe-core (wcag2a/aa/21aa) was run via `../_qa/audit.mjs` at 1440/768/375 px. One `color-contrast` finding on the footer note was fixed by darkening `--muted`. Table rows use roving `tabIndex` with arrow/j/k/Home/End navigation; every control is labelled; `prefers-reduced-motion` disables the stamp animation. The data table is wide by nature and scrolls horizontally inside its container on narrow screens (the page itself does not overflow).

## Unresolved limitations

- Risk weights are heuristics; see README.
- `validateFixture` does not check that `managerId` chains are acyclic (not needed by the engine but would matter for org-chart views).
- No campaign lock: decisions can be changed until the user exports; a real system would freeze a closed campaign.
- Browser QA is scripted for Chromium only.
