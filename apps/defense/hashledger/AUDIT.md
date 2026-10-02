# AUDIT — Hashledger

## Threat model
- **Assets**: fixture content (synthetic), snapshot history, cases, export.
- **Boundary**: the tab. No filesystem API, no fetch, no storage API.
- **Adversarial inputs**: oversized or too many files (caps), traversal paths (`..`, absolute) rejected, malformed modes rejected, regex inputs bounded to 64 KiB with simple non-nested patterns to avoid catastrophic backtracking, hostile text rendered as text nodes only.
- **Integrity**: chain verification recomputes hashes from `(prev, takenAt, entries)` and re-derives ids rather than trusting stored values; replay protection is by event id. Review finding fixed 2026-10-01: previously `takenAt` and `id` were outside the digest, so forged metadata verified OK (repro: sixth-Fable `hl-adverse.mjs`).
- **Integrity ≠ authenticity**: no signatures, so the chain cannot prove who captured a snapshot or that the capture clock was honest.
- **Out of scope**: real endpoint telemetry, kernel-level FIM, DLP evasion resistance.

## Data flow
fixtures/edits → `validateManifest` → `takeSnapshot` (Web Crypto) → `diffSnapshots` → ledger events; file → `classifyFile` → `decideEgress` → `applyEvent` → cases → export Blob.

## Dependency findings
See `EVIDENCE.md` (`npm audit`). Runtime: react, react-dom, two Radix primitives, two Fontsource font packages.

## Security headers
`vercel.json`: CSP `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`; nosniff; SAMEORIGIN; referrer and permissions policies.

## Fixture note
The repository intentionally contains PEM-style markers (`-----BEGIN RSA PRIVATE KEY-----` / `-----END …-----`) in `src/engine/fixtures.ts` and `src/engine/engine.test.ts` with a placeholder body and no base64 content. They are detection fixtures for the `private-key-header` signal, not credentials; keep them if the test is kept, and expect secret scanners to flag the marker.

## Unresolved limitations
- The tamper demo edits in-memory history; "reset demo" clears snapshots because stored hashes cannot be re-derived from history once mutated — this is explained in the UI status line.
- Event ids for egress are derived from a counter + path + channel + recipient, so "Replay last event" is the only true replay path; two clicks on "Simulate egress" are two distinct events by design.
- No automated accessibility scan within the repo; manual keyboard pass and parent-side audit are the evidence.
