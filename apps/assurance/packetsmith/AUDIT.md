# AUDIT — Packetsmith

## Threat model

Assets: in-memory packet, exported packet JSON and memo. Adversaries: a hostile imported packet; an assessor trying to approve their own work; an operator editing evidence after capture; a reviewer relying on an unfinished packet.

| Threat | Control | Residual |
|---|---|---|
| Hostile import (size, nesting, counts) | 1 MiB UTF-8 byte cap before parse; ≤ 400 steps, 300 artifacts, 200 findings, 500 history; 20k chars per artifact; path-addressed issues; rebuilt object with known keys only | Bespoke validator |
| Evidence tampering after capture | SHA-256 recomputed on every render and in the gate; mismatch blocks submission and is visible in the locker | Hash is over text; it proves integrity since hashing, not authenticity of the source |
| Self-approval | `transition` refuses `approved` by the assessor; only the named approver may approve | Identities are typed strings, not authenticated |
| Incomplete packet promoted | Completeness gate must be empty for `ready-for-review`; refusal lists every blocker | — |
| Post-approval edits | `assertEditable` throws for approved/ready-for-review; all UI edits route through one `edit()` function | — |
| History rewritten in an exported packet (new import path, Oct 2026) | Every transition writes `prevHash`/`hash` (SHA-256 over canonical `{at, from, to, actor, note, prevHash}`, genesis 64 zeros); `verifyHistoryChain` runs in the validator (chained packets must verify — issue addressed to the broken `history[i]`; mixed hashed/unhashed refused; both-or-neither hash fields, 64 hex chars each), before every transition (broken chains cannot be extended) and in the gate badge/memo | No keys: a forger who recomputes every hash from the edited entry onwards produces a valid chain. Legacy exports without hashes are accepted with a warning and chained retroactively by their next transition, which vouches for them only from that moment |
| XSS via imported text | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` retained |
| Memo misuse as a compliance claim | Disclaimer in UI header, memo header, Markdown export and README; paraphrase labels on determinations | Cannot prevent out-of-context quoting |

## Data flow

Fixture → `validatePacketObject` → state → pure engine → DOM; import via `FileReader` (size-gated) → `validatePacket` (returns `{ ok, packet, warnings }` — warnings such as *history not chained (legacy)* are shown in the notice, never thrown); export via Blob URL. No network, no storage APIs, no third-party scripts.

## Security headers

`vercel.json` carries the lab-wide canonical header set (October 2026 upgrade round), applied to every path (`/(.*)`) with `cleanUrls: true`:

- `Content-Security-Policy`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` — `style-src 'unsafe-inline'` is retained for inline `style` attributes; `form-action 'none'` is compatible because every `<form>` in the app only calls `preventDefault()` (nothing navigates or posts).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (added this round).

## Dependency findings

`npm audit --audit-level=high`: 0 (vitest 4.1.11; Vite 7.3.6 / @vitejs/plugin-react 5.2.0 since the October 2026 round). Runtime deps: react, react-dom, @fontsource/ibm-plex-{sans,mono}.

## Unresolved limitations

Paraphrased determinations (not authoritative); no control enhancements or parameter tailoring; text-only artifacts; single-browser automated a11y only (predates this round); print output verified visually in the dialog, not on paper. Approval is session-only: exported JSON is editable offline and the digest intentionally excludes state/history. The hash-chained history makes edits to an exported record evident, but without key material a consistent forgery that recomputes every hash remains possible (see README → What approval does and does not mean). Actor names are self-asserted.
