# Rootstock Review — dependency and supply-chain risk explainer

**Educational prototype (October 2026).** Rootstock Review turns a lock snapshot into a review a maintainer can act on: the resolved dependency graph (multiple versions, cycles and unresolved edges included), advisories matched with real semver semantics, a licence policy decision per package, a reachability *hint* labelled known / inferred / unknown, provenance flags, and an upgrade plan that names exactly which parent range blocks a fix. The demo snapshot is synthetic; since the October 2026 upgrade round a real `package-lock.json` (lockfileVersion 2 or 3) can also be converted **offline, inside the browser** — even then the app never contacts a registry or advisory database, so advisories and import evidence are only what you supply. It is not a vulnerability scanner, an SBOM attestation or a legal licence opinion.

## The problem

Dependency reports usually stop at "3 high". The questions that decide what to do next — is this code even reachable from our app, can we bump it without touching anything else, which parent pins the vulnerable range, is the licence actually a problem, what do we *not* know — are left to the reader. Rootstock Review answers each of those explicitly and marks the unknowns as unknowns.

## Key workflows

1. **Read the graft tree.** Direct dependencies with their declared ranges, transitive children indented, cycles marked, each row showing reachability glyph (● known, ◐ inferred, ○ unknown), licence verdict, advisories and plan/flags.
2. **Select a package** for its paths to the root, advisory ranges (vulnerable / patched), the licence decision with its reason, the plan rationale and provenance flags.
3. **Filter** to advisories, licence issues, unknowns or provenance flags.
4. **Follow the plan.** `deepset@1.0.4` → bump in range to 1.2.3 (every parent accepts it); `colourkit@0.9.2` → parent conflict: `uikit@3.2.4` declares `~0.9.0`, which excludes 1.0.0, and the snapshot lists newer uikit versions to check; `fontparse@3.4.0` → no fix available (advisory lists no patched version), with the honest options.
5. **Import a real `package-lock.json` (offline).** Open the import panel, switch the format to *package-lock.json (v2 / v3)*, paste or choose the file (≤ 2 MiB, ≤ 2 500 package entries), optionally list the direct dependencies your code imports (comma-separated) and tick *include devDependencies*, then **Convert and load**. The converter reads only the lockfile's `packages` map and reports what it did in numbered *conversion notes*: entries read and kept, dev-only entries excluded, duplicates merged, peer ranges excluded, ranges it could not parse (`npm:` aliases, `file:`/`link:`/`workspace:` paths, git URLs, tarballs, dist-tags) turned into unresolved edges, alias installs, and — always — that **no advisory data was fetched** and, without import evidence, that **reachability is unknown for every package**. The exported evidence (`notes.data`) repeats the conversion provenance. A synthetic sample lockfile (`src/fixtures/sample-package-lock.json`, fictional packages, `https://registry.example/…` URLs) can be loaded with one click. **Export snapshot (.json)** then writes the converted `rootstock.lockgraph/1` document itself (with its `source` notes and `unparsable` edges); add an offline advisory list to its `advisories` array and re-import it in lock-snapshot mode — the way to review a real lockfile against advisories without any network call.
6. **Import** a synthetic snapshot (bounded JSON) and **export** the evidence (`rootstock.report/1`), a Markdown plan or the snapshot itself.

## Quickstart

```bash
npm ci
npm test        # vitest, 48 engine tests in 2 files
npm run build   # tsc --noEmit + vite build → dist/
npm run dev     # http://localhost:6114
```

Node 20.19+. No environment variables, backend or storage; state resets on refresh.

## Algorithm

* **Semver** (`semver.ts`): a dependency-free subset — versions `MAJOR.MINOR.PATCH[-pre]`, comparators, caret (with 0.x rules), tilde, x-ranges, hyphen ranges and `||` unions. Unparsable ranges and empty ranges never match, so a typo can never widen a match. `describeUnsupportedRange` names *why* a specifier is outside the subset (alias, path, git, tarball, tag) for the unresolved-edge reasons.
* **Lockfile importer** (`lockfile.ts`, `convertPackageLock(text, { imports?, includeDev?, advisories?, policy? })`): checks the UTF-8 byte cap *before* `JSON.parse`, requires `lockfileVersion` 2 or 3 (1 is rejected with a message; the legacy v2 `dependencies` tree is never read), caps the `packages` map at 2 500 entries and scans it iteratively (depth ≤ 10, finite numbers, value cap) before mapping. `packages[""]` becomes `root` (version defaults to `0.0.0` with a note) and its `dependencies` + `optionalDependencies` (+ `devDependencies` with `includeDev`) become `direct`; every other key yields a name from its last `node_modules/` segment (scoped names kept; alias installs recorded under the install name and noted), a required semver `version`, `license` string or `''`, `hasInstallScript`, `deprecated` (only when set), and dependency ranges from `dependencies` + `optionalDependencies` — `peerDependencies` are excluded and counted. Ranges the semver subset cannot parse become entries of the additive `unparsable` list (unresolved edges, never a crash, never a widened match); entries flagged `dev: true` are excluded unless `includeDev`; the same `name@version` installed at several paths collapses into one record with the union of its ranges; `registry` lists the versions present in the lock per name; `advisories` and `imports` are the supplied lists or empty, each stated in a note; `policy` is the supplied one or the demo policy. The result carries `source` provenance and is run through the same validator as a pasted snapshot, so it is valid `rootstock.lockgraph/1` by construction or rejected with path-addressed errors.
* **Graph** (`graph.ts`): each declared range binds to the highest snapshot version that satisfies it; multiple versions of one name coexist; ranges nothing satisfies become *unresolved edges* (surfaced, never dropped), as do unparsable ranges. Depth, one shortest path per node and the set of direct dependencies that can reach each node are computed **breadth-first** (exact, linear per direct dependency). Alternative paths to the root are then enumerated depth-first under an explicit **traversal budget** (`BUDGET`: 20 000 node expansions per direct dependency, 50 000 stored paths; also depth ≤ 12 and 20 paths per node). When the budget runs out the graph, the review and the report carry `truncated: true` and the UI says so — depth and reachability stay exact, only the listed paths are incomplete.
* **Review** (`review.ts`): advisories match by name and `satisfies(version, vulnerable)`; blocking = severity at or above the policy threshold. Licence expressions are parsed by a bounded recursive-descent parser (`license.ts`) with SPDX precedence — parentheses, then `AND`, then `OR` — and evaluated bottom-up (`OR` → most permissive side, `AND` → strictest). Anything the parser cannot accept **fails closed to `unknown`**: unbalanced or dangling operators, more than 64 tokens, nesting deeper than 8, `WITH` exceptions, `+` (or-later) operators, identifiers with unexpected characters, empty strings. Unlisted identifiers are `unknown`; operators are case-insensitive, identifiers are not. Reachability: *known* = direct and in import evidence; *inferred* = reachable from an imported direct dependency (exact, breadth-first); otherwise *unknown* (including "declared but not imported" and, for every package, "no import evidence supplied"). Flags: install script, deprecated, multiple versions. `notes.data` states whether the snapshot is the synthetic demo or an offline lockfile conversion and that nothing was fetched.
* **Plan**: the lowest registry version above the current one that satisfies every matching advisory's `patched` range. If no advisory has a patched range or no version satisfies it → `no-fix-available`. If every parent range accepts the target → `bump-in-range`. Otherwise `parent-conflict` listing each blocking parent and whether newer parent versions exist in the snapshot (whose dependency ranges the snapshot does not record — stated as such). For a converted lockfile the "registry" is only the versions present in the lock, so plans can only point at versions already installed somewhere in the tree.

## Architecture

```
src/engine/  semver · schema (validation + limits + canonical snapshot serialiser) · lockfile (offline package-lock.json → lockgraph) · graph (budgeted traversal) · review (advisories, licence, reachability, plan) · report
src/fixtures/ledgerly-lockgraph.json (deliberately conflicting tree: two colourkit versions, a cycle, an unresolved edge, an empty licence, a denied licence)
src/fixtures/sample-package-lock.json (synthetic v3 lockfile: scoped name, two pricebook versions, dev-only, optional and peer dependencies, an npm: alias)
src/App.tsx  tree + detail + filters + import (snapshot or package-lock.json)
```

## Tests

Two Vitest files, **48 tests** (`Tests  48 passed (48)`):

* `src/engine/__tests__/rootstock.test.ts` — 21 tests (seven added after an independent council review found `(MIT OR Apache-2.0) AND GPL-3.0-only` evaluating to allow): version parsing/ordering with prereleases; caret/tilde/comparator/x-range/hyphen/union semantics (16 assertions); snapshot acceptance; rejection of malformed versions, unknown severities, oversized input, duplicate `name@version` and over-limit package lists; graph resolution to highest satisfying version, coexistence of two `colourkit` versions, cycle tolerance, exact unresolved-edge reporting (now including the reason); bounded root paths and depth; advisory matching and non-matching; the three plan kinds with the exact blocking parent; reachability labels and the "not exploitability" note; licence verdicts including `OR` and empty; provenance flags; summary counts; determinism; report schema and Markdown content.
* `src/engine/__tests__/lockfile.test.ts` — 27 tests added in the October 2026 round: v3 conversion round-trips through `validateLockgraph`; v2 accepted with a 20-level legacy `dependencies` tree ignored; v1 and missing `lockfileVersion` rejected; byte cap checked before parsing, 2 501 entries and 251-dependency entries rejected with path-addressed errors; eleven hostile inputs never throw; scoped names, last-`node_modules/`-segment naming and alias installs; two versions of one package with correct resolution and `multiple-versions` flags; licence / install-script / deprecation / optional-dependency mapping with absent fields absent; `includeDev` on and off with the dev-only count noted; peer ranges excluded; `npm:` alias → unresolved edge with reason, never matched; `file:`/`link:`/git/`workspace:`/tarball/dist-tag ranges unresolved with reasons; duplicate `name@version` collapsed with union of ranges; root version default `0.0.0` and version-less entries skipped; no advisories / no imports stated with reachability unknown everywhere; supplied imports and advisories drive `known`/`inferred` labels and a parent-conflict plan against the lock registry; invalid options rejected with `options.imports[0]`-style paths; default and supplied policy; conversion stated in `notes.data`, the report and the Markdown; determinism independent of key order. Graph budget: `BUDGET` exported and the demo completes untruncated; a layered 300-package graph (25 direct roots, 3^11 simple paths each) completes under the per-direct budget with `truncated: true`, one shortest path per node and exact depth 12 at the last layer; tiny budgets flag truncation while depth, `roots` and reachability stay exact; truncation surfaces through `review.truncated`, `notes.traversal` and the report. Snapshot export: the canonical serialisation of a converted snapshot (with `source` and `unparsable`) re-imports through `parseLockgraph` identically and reviews identically; an advisory appended to the exported document re-imports and yields a plan; the demo snapshot serialises without invented fields.

See `EVIDENCE.md` for the measured runs.

## Data handling and safety

* Browser-local; no network, storage or analytics. Nothing is fetched from npm, OSV, GitHub Advisories or any registry — also when a real lockfile is converted.
* Input bounded: 2 MiB UTF-8 (checked before parsing), 2 500 packages, 250 dependencies per package, 200 advisories, 200 import names, registry lists ≤ 300 versions, nesting ≤ 6 for snapshots and ≤ 10 for a lockfile's `packages` map, iterative structural scans with value caps. Package names and ranges must parse before they are used; unparsable lockfile ranges are kept only as unresolved edges.
* Graph traversal has an explicit budget (20 000 expansions per direct dependency, 50 000 stored paths) and reports `truncated`; the tree view additionally stops drawing after 4 000 rows and says so.
* Exports are JSON/Markdown only: the evidence report, the Markdown plan, and the loaded snapshot re-serialised in canonical form (fixed key order, optional fields only when present) so that it re-imports through the same validator.

## Limitations and unsupported cases

* **Advisories and import evidence are never fetched.** A converted `package-lock.json` arrives with an empty advisory list and (unless you type them) no import evidence, so every package is `unknown` and nothing is vulnerable *as far as this tool can tell*. That is a statement about the input, not about the project. An offline advisory list can be added to the exported snapshot and re-imported.
* Only `package-lock.json` lockfileVersion 2 and 3 are supported (the `packages` map). lockfileVersion 1, `yarn.lock`, `pnpm-lock.yaml`, CycloneDX and SPDX documents are not importers yet. Workspace (`link: true` / keys without `node_modules/`) entries and entries without a semver version are skipped and listed in the notes; legacy mixed-case package names (which the name pattern rejects) are skipped too.
* `peerDependencies` are not edges; `npm:` alias installs are recorded under the install name, so an advisory for the real package name would not match them (the notes say so). The "registry" of a converted lockfile is just the versions present in the lock, so plans cannot suggest versions that are not already installed somewhere.
* The semver subset omits prerelease-inclusion rules for ranges, build metadata comparison and npm's `latest`/tag semantics (treated as invalid, so never matching).
* Reachability is import-evidence only. It is not call-graph analysis and must not be read as exploitability.
* Plans look one level up: they tell you which parent blocks a fix and whether newer parent versions exist, not whether those versions resolve the conflict.
* Licence evaluation is a policy list lookup, not legal advice; `WITH` exceptions and `+` operators are not understood and fall to *unknown* (fail closed).
* When the traversal budget is exhausted, the listed paths to the root are incomplete (the UI and the report say so); depth and reachability remain exact.

## JD evidence (truthful framing)

Demonstrates supply-chain risk reasoning (advisory matching, semver range analysis, licence policy, provenance signals, lockfile structure), honest uncertainty handling, and written deliverables (plan and evidence export). It is not experience with a commercial SCA product and makes no claim about real packages.

## AI-assistance disclosure

Built in October 2026 with AI assistance for code drafting under a human-directed plan; the lockfile importer, traversal budget and this round's tests were added the same way. `INTERVIEW_GUIDE.md` lists what the author should explain unaided.

## References

* SPDX License List (v3.29.0, 2026-09-16): https://spdx.org/licenses/
* npm semver range syntax (reference behaviour this subset follows): https://github.com/npm/node-semver#ranges
* npm `package-lock.json` format (lockfileVersion 2/3, `packages` map): https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json

License: MIT. Third-party notices in `THIRD_PARTY_NOTICES.md`.
