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
| XSS via imported text | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` retained |
| Memo misuse as a compliance claim | Disclaimer in UI header, memo header, Markdown export and README; paraphrase labels on determinations | Cannot prevent out-of-context quoting |

## Data flow

Fixture → `validatePacketObject` → state → pure engine → DOM; import via `FileReader` (size-gated) → `validatePacket`; export via Blob URL. No network, no storage APIs, no third-party scripts.

## Headers

Same hardened `vercel.json` as the track (CSP default-src 'none', nosniff, DENY framing, no-referrer, Permissions-Policy, COOP/CORP).

## Dependency findings

`npm audit`: 0 after vitest 4.1.11. Runtime deps: react, react-dom, @fontsource/ibm-plex-{sans,mono}.

## Unresolved limitations

Paraphrased determinations (not authoritative); no control enhancements or parameter tailoring; text-only artifacts; single-browser automated a11y only; print output verified visually in the dialog, not on paper. Approval is session-only: exported JSON is editable offline and the digest intentionally excludes state/history; the validator rejects inconsistent history/state but not a consistent forgery (see README → What approval does and does not mean). Actor names are self-asserted.
