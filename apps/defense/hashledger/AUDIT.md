# AUDIT — Hashledger

## Threat model
- **Assets**: fixture content (synthetic), snapshot history, cases, export.
- **Boundary**: the tab. No filesystem API, no fetch, no storage API.
- **Adversarial inputs**: oversized or too many files (caps), traversal paths (`..`, `.`, empty segments, absolute, backslashes) rejected, path characters restricted to `[A-Za-z0-9._/-]` (no spaces, non-ASCII look-alikes or shell metacharacters), malformed modes rejected, `owner` must be a printable string of 1–64 characters (no control/format/surrogate/private-use code points), non-array manifests and non-object rows reported instead of thrown, errors path-addressed (`files[i].field`) and capped at 20; regex inputs bounded to 64 KiB with simple non-nested patterns to avoid catastrophic backtracking; hostile text rendered as text nodes only.

## Trust boundaries
| Input | Trust | Guard | Failure mode |
| --- | --- | --- | --- |
| Shipped fixture (`src/engine/fixtures.ts`) | Trusted (in repo, synthetic) | Validated by the test suite with the same `validateManifest` | Test failure |
| Add-file dialog (path, owner, content) | User text | `validateManifest([...files, candidate])` — whole-manifest check, per-field path-addressed errors shown in the dialog | Nothing added |
| Content editor / mode input | User text | Length cap on save; octal regex on mode | Status line / input ignored |
| Egress actor / recipient | User text | Length-capped (80); used only as labels in events | — |
| Export | Outbound only | Blob + transient object URL | — |
- **Integrity**: chain verification recomputes hashes from `(prev, takenAt, entries)` and re-derives ids rather than trusting stored values; replay protection is by event id. Review finding fixed 2026-10-01: previously `takenAt` and `id` were outside the digest, so forged metadata verified OK (repro: the sixth review's `hl-adverse.mjs`, an external harness script not in this repository).
- **Integrity ≠ authenticity**: no signatures, so the chain cannot prove who captured a snapshot or that the capture clock was honest.
- **Out of scope**: real endpoint telemetry, kernel-level FIM, DLP evasion resistance.

## Data flow
fixtures/edits → `validateManifest` → `takeSnapshot` (Web Crypto) → `diffSnapshots` → ledger events; file → `classifyFile` → `decideEgress` → `applyEvent` → cases → export Blob.

## Dependency findings
See `EVIDENCE.md` (`npm audit`). Runtime: react, react-dom, two Radix primitives, two Fontsource font packages. No dependency was added in the October 2026 round.

## Security headers
`vercel.json` carries the lab-wide canonical set (October 2026 upgrade round), applied to every path (`/(.*)`):
- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`style-src 'unsafe-inline'` remains because Radix primitives (tabs, dialog) and React inline `style` attributes need it. `form-action 'none'` is compatible: the only `<form>` (close case) calls `preventDefault()` and never navigates. `font-src 'self'` has no `data:` scheme, so the build must never inline fonts: `vite.config.ts` sets `build.assetsInlineLimit: 0` after a browser review under these headers found one small font subset inlined as a `data:` URL and blocked (2 CSP violations per load; see `EVIDENCE.md`). The fix emits the asset as a file; the CSP was not widened. Headers apply to the Vercel deployment only; `vite preview` serves without them.

## Fixture note
The repository intentionally contains PEM-style markers (`-----BEGIN RSA PRIVATE KEY-----` / `-----END …-----`) in `src/engine/fixtures.ts` and `src/engine/engine.test.ts` with a placeholder body and no base64 content. They are detection fixtures for the `private-key-header` signal, not credentials; keep them if the test is kept, and expect secret scanners to flag the marker.

## Unresolved limitations
- The tamper demo edits in-memory history; "reset demo" clears snapshots because stored hashes cannot be re-derived from history once mutated — this is explained in the UI status line.
- Event ids for egress are derived from a counter + path + channel + recipient, so "Replay last event" is the only true replay path; two clicks on "Simulate egress" are two distinct events by design.
- No automated accessibility scan within the repo; manual keyboard pass and parent-side audit are the evidence.
