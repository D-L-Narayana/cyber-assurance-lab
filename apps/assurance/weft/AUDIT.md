# AUDIT — Weft

## Threat model

Assets: the bundle (assertions, artifacts, links, sign-offs), the manifest. Adversaries: someone editing evidence after sign-off; someone padding a bundle with unexplained files; a forged or edited manifest; a hostile import.

| Threat | Control | Residual |
|---|---|---|
| Evidence edited, re-dated or renamed after sign-off | Binding hash v2 over statement + period + sorted `{id, capturedOn, sha256}` of linked evidence; recomputed on every render; `invalid-signoff` finding and header marker | Hash ≠ signature: no key binds the reviewer identity |
| Assertion appended or removed after the manifest | `verifyManifest` reports `addedAssertions` / `missingAssertions`; `intact` requires both empty (parent-review fix) | — |
| Evidence swapped for a same-named file | Content hashes, not names; `declaredSha256` comparison | Only when a declared hash was recorded at collection |
| Padding the bundle | `orphan-artifact` for unlinked artifacts; `duplicate-content` for renamed copies | — |
| Backdating / out-of-window evidence | Inclusive period check per link; weak vs supported status | Dates only, no timestamps |
| Forged manifest | `root` recomputed from entries + bindings; `rootMatches=false` when the manifest itself was altered | A forger who recomputes the root is not detectable without signatures |
| Hostile import | 2 MiB UTF-8 cap; ≤ 300 artifacts / 200 assertions / 2000 links / 50k chars; hex validation; strict dates; path-addressed issues | Bespoke validator |
| XSS | React escaping; no `innerHTML`; CSP `script-src 'self'` | `style-src 'unsafe-inline'` |

## Data flow

Fixture → validator → state → `analyze` (pure) → DOM. Manifest/bundle imports via size-gated `FileReader` → validators → `verifyManifest` / `diffBundles`. Exports via Blob URL. No network or storage APIs.

## Headers

Track-standard hardened `vercel.json`.

## Dependency findings

`npm audit`: 0. Runtime deps: react, react-dom, two OFL font packages.

## Unresolved limitations

No cryptographic signatures (an obvious production step: sign the manifest root); text artifacts only; single-user; periods are calendar dates; automated a11y only.
