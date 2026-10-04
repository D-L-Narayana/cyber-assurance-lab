# AUDIT — Tessera

## Threat model

**Assets:** the in-memory evidence pack and the exported report. **Actors:** the single local user; a hostile pack file (imported JSON); a hostile spreadsheet consumer of the CSV. **Out of scope:** multi-user authorisation, server-side anything (there is no server), confidentiality of real evidence (none is accepted — metadata only, synthetic by design).

| Threat | Control | Residual |
|---|---|---|
| Oversized / deeply nested import causes DoS | File read refused above 512 KiB; UTF-8 byte count checked before `JSON.parse`; ≤ 500 artifacts, ≤ 200 decisions, ≤ 25 subcategory refs / priorities; strings length-capped | `JSON.parse` of ≤ 512 KiB is bounded; no recursive schema |
| Malformed/unknown fields | Hand-written validator rebuilds a clean object with only known keys; path-addressed issues; nothing applied on any issue | Validator is bespoke (no zod) — tested, but less battle-hardened |
| Script injection via imported strings | React escapes all text; no `dangerouslySetInnerHTML`; CSP `script-src 'self'` in `vercel.json` | `style-src 'unsafe-inline'` kept for React inline styles |
| CSV formula injection | Cells starting with `= + - @` (after optional whitespace/control chars) prefixed with `'`; all cells quoted | Consumers that strip the quote prefix differently may still interpret |
| Reviewer greenwashing | `accepted`/`not-applicable` need ≥ 40-char rationale, never apply over contradicted/refuted; refusals surfaced as warnings and tile markers; all-N/A functions report `not-assessed` | Rationale length is a weak proxy for substance |
| Stale state / silent data loss | Memory-only state, explicit "reset on refresh" notice, export pack any time | User can still forget to export |
| Forecast cost / misleading projection | Horizons are a fixed UI constant (30/90/180); the engine bounds any caller-supplied list to ≤ 12 whole-day horizons ≤ 3650 days (`normaliseHorizons`), i.e. ≤ 300 extra evaluations of a ≤ 500-item pack; every row and the report block carry the "no new evidence, not a prediction" note; improvements and equal-exposure changes are never counted as degradation (tested) | A reader can still mistake a projection for a plan; the forecast is only as good as the recorded `validDays` |
| Supply chain | 2 runtime deps (react, react-dom) + OFL fonts; dev deps vite 7.3 / @vitejs/plugin-react 5.2 / vitest 4.1 / typescript 5.9; lockfile committed and reproduced with `npm ci`; `npm audit --audit-level=high` → 0 after the October 2026 toolchain bump | Advisory GHSA-82fw-gwwq-j7x9 was dev-only before the earlier vitest upgrade |

## Data flow

Bundled fixture JSON → `validatePackObject` → React state → `buildReport` and `forecastPack` (both pure) → DOM. Import: `<input type=file>` → `FileReader` (size-gated) → `validatePack` → state. Export: `JSON.stringify`/`toCsv` → `Blob` → transient object URL → download; the report JSON carries the additive optional `forecast` block (`tessera.report/1` unchanged) and the forecast CSV uses the same neutralising writer. The forecast adds no import path: it only re-evaluates the already-validated pack at later dates. No fetch/XHR/WebSocket; no localStorage/sessionStorage/IndexedDB; no third-party scripts, fonts or trackers.

## Security headers (vercel.json)

Lab-wide canonical set (October 2026 upgrade round), applied to `/(.*)` with `cleanUrls: true`:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`form-action 'none'` is compatible with this app: all three `<form>` elements (profile, add-evidence, reviewer decision) call `preventDefault()` and never navigate. `style-src 'unsafe-inline'` remains for React inline style attributes. Headers apply to the static Vercel deployment only, not to `vite preview`/dev.

## Dependency findings

See EVIDENCE.md. Final state: `found 0 vulnerabilities`.

## Unresolved limitations

- Not a NIST tool; heuristic scoring is custom and labelled as such in UI, report (`scoringNote`) and README.
- No evidence content or hashing (metadata only) — paired with Weft for integrity.
- Single-reviewer model; no identity, approval chain or audit log beyond the decision record.
- `vite preview`/Vercel static hosting only; headers are not applied by the Vite dev server.
- Accessibility verified with axe automation and keyboard checks only; no screen-reader session. An early '0 violations' result was measured on a broken (empty) page; the parent's independent scan found contrast failures, now fixed and guarded by `tests/contrast.test.ts`.
- The October 2026 forecast panel and tile marker were not browser-audited in this round (no Playwright/axe run was performed from this repository); their text uses only tokens already guarded by `tests/contrast.test.ts`, and the marker is a glyph plus double border with its meaning in the tile's accessible name. The `qa/` screenshots predate the forecast UI.
