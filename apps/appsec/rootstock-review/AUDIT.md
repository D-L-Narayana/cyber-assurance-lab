# AUDIT — Rootstock Review

## Threat model

**Asset:** a static SPA that evaluates a user-supplied dependency snapshot or an offline `package-lock.json`. No backend, storage or outbound traffic.

| Boundary | Input | Control |
|---|---|---|
| Pasted/uploaded snapshot (`rootstock.lockgraph/1`) | Arbitrary text | 2 MiB UTF-8 limit checked before `JSON.parse`; iterative structural scan (depth ≤ 6, lists/keys ≤ 3 000, ≤ 200 000 values, finite numbers); then validation of names (`NAME` pattern), versions (`parseVersion`), ranges (`isValidRange`), severities, licence strings, per-package dependency counts (≤ 250), `direct` size, list caps (≤ 2 500 packages, ≤ 300 registry versions, ≤ 200 advisories/imports); duplicates of `name@version` rejected; the optional additive `unparsable` and `source` fields are validated too; unknown keys dropped. |
| Pasted/uploaded `package-lock.json` (October 2026) | Arbitrary text claiming to be an npm lockfile | Same 2 MiB cap before parsing; `lockfileVersion` must be 2 or 3 (1 rejected); only the `packages` map is read — the v2 legacy `dependencies` tree is never traversed; ≤ 2 500 entries checked before an iterative scan of the map (depth ≤ 10, lists/keys ≤ 3 000, ≤ 400 000 values, finite numbers); per-entry name pattern, semver version required, ≤ 250 ranges per entry, licence/notes length caps, unparsable ranges quarantined as unresolved edges (never matched); caller options (`imports`, `advisories`, `policy`) validated with path-addressed errors; the converted document is then run through the snapshot validator above, so nothing bypasses it. Every decision is reported in notes; conversion never throws to the UI (tested with eleven hostile inputs). |
| Licence expressions → parser | User-controlled SPDX-like strings | Tokeniser whitelists characters; recursive-descent parser bounded to 64 tokens, 8 nesting levels, 400 chars; malformed/unsupported → `unknown`, never `allow`. |
| Ranges → matcher | User-controlled range strings | The semver parser is hand-written with anchored regexes and token splitting; no nested quantifiers (no catastrophic backtracking); unparsable → never matches. |
| Graph traversal | Possibly cyclic, possibly dense graph (a real lockfile) | Breadth-first depth/reachability (linear per direct dependency); path enumeration is depth-first with cycle cut by on-path check, depth ≤ 12, ≤ 20 paths per node **and an explicit budget** (20 000 expansions per direct dependency, 50 000 stored paths) that sets `truncated` on the graph, review and report; tested with a layered 300-package graph. The tree view stops drawing after 4 000 rows. |
| Engine → DOM | Package names, licence strings, advisory titles, conversion notes | React text nodes only; no `dangerouslySetInnerHTML`, `eval` or dynamic HTML. |
| Export | JSON (evidence report or the loaded snapshot) / Markdown | Blob download, URL revoked. The snapshot export is the validated in-memory document re-serialised with a fixed key order (`serialiseLockgraph`), so it re-imports through the same validator and bounds; nothing is added that was not validated. No CSV. |

**Threats considered:** hostile snapshots and lockfiles (bounded and validated), regex denial of service through crafted ranges (parser design), traversal blow-up on dense graphs (budget + flag), misleading output (unknown states are first-class; reachability text repeatedly says it is not exploitability; the UI and the report state whether the data is synthetic or an offline conversion with no fetched advisories).

## Data flow

`fixture | paste/file → parseLockgraph | convertPackageLock → validateLockgraph → buildGraph → reviewDependencies → React state → buildReport | serialiseLockgraph → Blob`. No persistence. The converter is offline: it never resolves names, versions or advisories against anything outside the pasted text; the only way advisories enter a converted review is the user adding them to an exported snapshot and re-importing it.

## Dependency review (1 Oct 2026; unchanged 4 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-toggle-group 1.1.19 (MIT), @fontsource-variable/fraunces 5.3.0 and @fontsource/atkinson-hyperlegible 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions; no forced fixes. (It would be ironic otherwise.) No dependency was added in the October 2026 round.

## Security headers

`vercel.json` (lab-wide canonical set, October 2026): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`; `cleanUrls: true`. `style-src 'unsafe-inline'` is retained for Radix inline styles. `form-action 'none'` is compatible because the app has no `<form>` element: the import controls are plain buttons and inputs that never submit or navigate. Because `font-src 'self'` allows no `data:` URLs, `vite.config.ts` sets `assetsInlineLimit: 0` so every font subset ships as a file under `assets/` (this app's CSS contained no inlined font before the setting; it is there to keep a future small subset from being embedded and blocked by the policy).

## Unresolved limitations

* Tree rows duplicate packages that appear under several parents (as lockfile trees do); selection is by `name@version`, so selecting one highlights all occurrences — intended, but worth knowing. For dense lockfiles the tree stops after 4 000 rows and says so.
* Advisory severity is taken as given; there is no CVSS vector parsing.
* A converted lockfile carries no advisories unless the user supplies them; "0 with advisories" then means "no data", which the tally, the detail panel and `notes.data` spell out.
* No screen-reader session recorded; the tree uses `role="tree"`/`treeitem` with expand state, and glyphs are always paired with text. The new import controls are native labelled inputs and a Radix toggle group; the browser/axe pass of this round is the lead's integration step, not something measured here.
