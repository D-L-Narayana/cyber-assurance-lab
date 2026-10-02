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
| Hostile import | 1 MiB UTF-8 cap; ≤ 300 records; enumerations validated; strict dates; path-addressed issues | Bespoke validator |
| XSS | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` |

## Data flow

Fixture → validator → `tick` for the board date → state → pure engine → DOM. Import via size-gated `FileReader`; export via Blob URL. No network, storage APIs or third-party scripts.

## Headers

Track-standard hardened `vercel.json`.

## Dependency findings

`npm audit`: 0. Runtime deps: react, react-dom, two OFL font packages. `vite-node` is fetched by `npx` only when regenerating the fixture (QA script, not shipped).

## Unresolved limitations

No authentication or role directory; policy is a constant (not versioned per record, so re-rating risk changes the rules retroactively — surfaced but not blocked); automated a11y only.
