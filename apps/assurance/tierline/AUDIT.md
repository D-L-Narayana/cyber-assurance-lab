# AUDIT — Tierline

## Threat model

Assets: vendor register (synthetic), assessment and queue exports. Adversaries: hostile register import; a spreadsheet consumer of the CSV; an analyst gaming the tier by leaving questions blank or parking exceptions.

| Threat | Control | Residual |
|---|---|---|
| Hostile import | 1 MiB UTF-8 cap pre-parse; ≤ 200 vendors, 40 evidence and 20 exceptions per vendor; option/question ids validated against the model; strict date round-trip; path-addressed issues; rebuilt object | Bespoke validator |
| Tier gaming by omission | Unanswered questions score at maximum and raise an `incomplete-questionnaire` queue item | — |
| Exceptions as permanent waivers | Exceptions expire, count half, and generate `exception-expiring` / `exception-expired` queue items | No approval workflow (see Graceline) |
| Stale tiers | `tier-drift` item when recorded tier ≠ computed tier | — |
| CSV formula injection | Cells starting with `= + - @` (even after whitespace) are quoted with a leading `'` | — |
| Forecast CSV export (new export, Oct 2026) | Same `toCsv` writer and neutralisation as the queue CSV; rows derive only from the validated register; no new import path | The forecast is a projection under "nothing new is filed", not a prediction; horizon input is bounded to the 90/180/365 options in the UI and falls back to 180 in the engine for invalid values |
| XSS | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` |
| Misreading the heuristic as a standard | `SCORING_NOTE` in footer and assessment export; README table of rules | — |

## Data flow

Fixture → validator → state → pure engine → SVG/DOM. Import via size-gated `FileReader`; export via Blob URL. No network, no storage APIs, no third-party scripts.

## Security headers

`vercel.json` carries the lab-wide canonical header set (October 2026 upgrade round), applied to every path (`/(.*)`) with `cleanUrls: true`:

- `Content-Security-Policy`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` — `style-src 'unsafe-inline'` is retained for inline `style` attributes (SVG quadrant, ribbon widths); `form-action 'none'` is compatible because the two `<form>` elements in `VendorDetail` only call `preventDefault()` in `onSubmit` (nothing navigates or posts).
- `font-src 'self'` and the self-hosted fonts: Vite inlines assets under 4 KiB into the CSS as `data:` URLs by default, and six small Archivo / JetBrains Mono subsets fell under that limit, so under this CSP the browser blocked them (found by the October 2026 header-enforcing browser check). `vite.config.ts` now sets `build.assetsInlineLimit: 0`, so every font subset ships as a file under `assets/` and the CSP is honoured without widening it. The remaining `data:` allowance (`img-src`) is for images only.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (added this round).

## Dependency findings

`npm audit --audit-level=high`: 0 (vitest 4.1.11; Vite 7.3.6 / @vitejs/plugin-react 5.2.0 since the October 2026 round). Runtime deps: react, react-dom, two OFL font packages.

## Unresolved limitations

Heuristic weights are not calibrated against any dataset; intake questionnaire only (vendor-supplied questionnaire answers are not scored); no inherent-vs-residual history over time; a11y verified by automation and keyboard checks only (the automated browser run predates the October 2026 forecast panel; the new text tokens are guarded by `tests/contrast.test.ts` instead). The forecast assumes the register stays as it is — it cannot anticipate evidence that will be filed or answers that will change.
