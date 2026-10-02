# AUDIT — Rootstock Review

## Threat model

**Asset:** a static SPA that evaluates a user-supplied dependency snapshot. No backend, storage or outbound traffic.

| Boundary | Input | Control |
|---|---|---|
| Pasted/uploaded snapshot | Arbitrary text | 256 KB UTF-8 limit; JSON parse; iterative structural scan (depth ≤ 6, lists ≤ 1000, ≤ 200 000 values, finite numbers); then validation of names (`NAME` pattern), versions (`parseVersion`), ranges (`isValidRange`), severities, licence strings, per-package dependency counts and list caps; duplicates of `name@version` rejected. |
| Licence expressions → parser | User-controlled SPDX-like strings | Tokeniser whitelists characters; recursive-descent parser bounded to 64 tokens, 8 nesting levels, 400 chars; malformed/unsupported → `unknown`, never `allow`. |
| Ranges → matcher | User-controlled range strings | The semver parser is hand-written with anchored regexes and token splitting; no nested quantifiers (no catastrophic backtracking); unparsable → never matches. |
| Graph traversal | Possibly cyclic graph | DFS cuts cycles by on-path check, depth ≤ 12, ≤ 20 paths per node; resolution is O(packages × deps × versions). |
| Engine → DOM | Package names, licence strings, advisory titles | React text nodes only; no `dangerouslySetInnerHTML`, `eval` or dynamic HTML. |
| Export | JSON / Markdown | Blob download, URL revoked. No CSV. |

**Threats considered:** hostile snapshots (bounded and validated), regex denial of service through crafted ranges (parser design), misleading output (unknown states are first-class; reachability text repeatedly says it is not exploitability; the UI states the data is synthetic).

## Data flow

`fixture | paste/file → parseLockgraph → buildGraph → reviewDependencies → React state → buildReport → Blob`. No persistence.

## Dependency review (1 Oct 2026)

Runtime: react/react-dom 19.3.0 (MIT), @radix-ui/react-toggle-group 1.1.19 (MIT), @fontsource-variable/fraunces 5.3.0 and @fontsource/atkinson-hyperlegible 5.3.0 (fonts SIL OFL 1.1). Dev: vite 7.3.6, vitest 4.1.11, typescript 5.9.3, @vitejs/plugin-react 5.2.0. `npm audit`: 0 vulnerabilities at pinned versions; no forced fixes. (It would be ironic otherwise.)

## Security headers

`vercel.json`: CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), nosniff, DENY, no-referrer, restrictive Permissions-Policy, COOP. `style-src 'unsafe-inline'` retained for Radix inline styles.

## Unresolved limitations

* Tree rows duplicate packages that appear under several parents (as lockfile trees do); selection is by `name@version`, so selecting one highlights all occurrences — intended, but worth knowing.
* Advisory severity is taken as given; there is no CVSS vector parsing.
* No screen-reader session recorded; the tree uses `role="tree"`/`treeitem` with expand state, and glyphs are always paired with text.
