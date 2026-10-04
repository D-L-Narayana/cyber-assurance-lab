# AUDIT — Graceline

## Threat model

Assets: exception records and their decision history. Adversaries: a requester approving their own exception; an owner extending an exception indefinitely; a reviewer closing without evidence; an imported board carrying records that violate policy; a hostile import.

| Threat | Control | Residual |
|---|---|---|
| Self-approval | `approve` refuses the requester and the risk owner; duplicate approvers refused; required roles per risk level | Identities are typed strings — no authentication |
| Indefinite extension | Max duration per risk level; renewal cap (2 approved); renewal bounded to one more max duration; renewal is a request by the requester/owner that resets approvals while the current term keeps expiring and escalating | Imported records can exceed limits — surfaced as live guardrail violations, not silently accepted. Approver roles are self-asserted (no directory) |
| Expiry ignored | `tick` moves active → expired → escalated deterministically from the board date; history records system ticks | In-app only; no external notification |
| Closure without proof | ≥ 20-character closure evidence; remediation forced to done; recorded with actor and date | Text, not attachments |
| History tampering | History is append-only in the engine; drafts are the only editable state | Import can carry arbitrary history — validated for shape only |
| Hostile import | 1 MiB UTF-8 cap before `JSON.parse`; ≤ 300 records, ≤ 20 compensating controls, ≤ 10 approvals and ≤ 200 history entries per record; enumerations validated; strict calendar dates on every date field (`2026-02-30` is rejected at all 12 dated paths — `tests/validation.test.ts`, Oct 2026); non-finite/non-integer `renewals` rejected (`1e400` parses to `Infinity`); unknown keys dropped (records are rebuilt); path-addressed issues capped at 60; 20 000-deep nesting at the root, in the list or inside a record is survived without throwing (V8's iterative `JSON.parse`; the validator never recurses into unknown structure) | Bespoke validator; no explicit depth scan of its own — it relies on the runtime parser being iterative, which is tested |
| XSS | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` |

## Data flow

Fixture → validator → `tick` for the board date → state → pure engine → DOM. Import via size-gated `FileReader`; export via Blob URL. No network, storage APIs or third-party scripts.

## Security headers

`vercel.json` carries the lab-wide canonical header set (October 2026 upgrade round), applied to every path (`/(.*)`) with `cleanUrls: true`:

- `Content-Security-Policy`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` — `style-src 'unsafe-inline'` is retained for inline `style` attributes (card ribbons); `form-action 'none'` is compatible because the app has no `<form>` element at all — every action is a `<button type="button">` dispatching an engine event.
- `font-src 'self'` and the self-hosted fonts: Vite inlines assets under 4 KiB into the CSS as `data:` URLs by default, and six small Manrope subsets fell under that limit, so under this CSP the browser blocked them (found by the October 2026 header-enforcing browser check). `vite.config.ts` now sets `build.assetsInlineLimit: 0`, so every font subset ships as a file under `assets/` and the CSP is honoured without widening it. The remaining `data:` allowance (`img-src`) is for images only.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (added this round).

## Dependency findings

`npm audit --audit-level=high`: 0 (Vite 7.3.6 / @vitejs/plugin-react 5.2.0 since the October 2026 round). Runtime deps: react, react-dom, two OFL font packages. `vite-node` is not a dependency: `npx vite-node qa/make-fixture.ts` fetches it from the registry when the fixture is regenerated (QA script, not shipped, not runnable offline).

## Unresolved limitations

No authentication or role directory; policy is a constant (not versioned per record, so re-rating risk changes the rules retroactively — surfaced but not blocked); automated a11y only (the browser run predates the October 2026 round; text contrast is now also guarded by `tests/contrast.test.ts`). `tick` is covered by seeded property tests (idempotence, monotonicity, order independence over 200 random date pairs) but not by exhaustive enumeration.
