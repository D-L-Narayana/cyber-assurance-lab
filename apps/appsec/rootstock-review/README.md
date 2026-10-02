# Rootstock Review — dependency and supply-chain risk explainer

**Educational prototype (October 2026).** Rootstock Review turns a lock snapshot into a review a maintainer can act on: the resolved dependency graph (multiple versions, cycles and unresolved edges included), advisories matched with real semver semantics, a licence policy decision per package, a reachability *hint* labelled known / inferred / unknown, provenance flags, and an upgrade plan that names exactly which parent range blocks a fix. Every package, version, advisory and registry entry in the demo is synthetic; the app never contacts a registry or advisory database. It is not a vulnerability scanner, an SBOM attestation or a legal licence opinion.

## The problem

Dependency reports usually stop at "3 high". The questions that decide what to do next — is this code even reachable from our app, can we bump it without touching anything else, which parent pins the vulnerable range, is the licence actually a problem, what do we *not* know — are left to the reader. Rootstock Review answers each of those explicitly and marks the unknowns as unknowns.

## Key workflows

1. **Read the graft tree.** Direct dependencies with their declared ranges, transitive children indented, cycles marked, each row showing reachability glyph (● known, ◐ inferred, ○ unknown), licence verdict, advisories and plan/flags.
2. **Select a package** for its paths to the root, advisory ranges (vulnerable / patched), the licence decision with its reason, the plan rationale and provenance flags.
3. **Filter** to advisories, licence issues, unknowns or provenance flags.
4. **Follow the plan.** `deepset@1.0.4` → bump in range to 1.2.3 (every parent accepts it); `colourkit@0.9.2` → parent conflict: `uikit@3.2.4` declares `~0.9.0`, which excludes 1.0.0, and the snapshot lists newer uikit versions to check; `fontparse@3.4.0` → no fix available (advisory lists no patched version), with the honest options.
5. **Import** a synthetic snapshot (bounded JSON) and **export** the evidence (`rootstock.report/1`) or a Markdown plan.

## Quickstart

```bash
npm ci
npm test        # vitest, 14 engine tests
npm run build   # tsc --noEmit + vite build → dist/
npm run dev     # http://localhost:6114
```

Node 20+. No environment variables, backend or storage; state resets on refresh.

## Algorithm

* **Semver** (`semver.ts`): a dependency-free subset — versions `MAJOR.MINOR.PATCH[-pre]`, comparators, caret (with 0.x rules), tilde, x-ranges, hyphen ranges and `||` unions. Unparsable ranges and empty ranges never match, so a typo can never widen a match.
* **Graph** (`graph.ts`): each declared range binds to the highest snapshot version that satisfies it; multiple versions of one name coexist; ranges nothing satisfies become *unresolved edges* (surfaced, never dropped). Bounded DFS from each direct dependency records up to 20 root paths per node and cuts cycles.
* **Review** (`review.ts`): advisories match by name and `satisfies(version, vulnerable)`; blocking = severity at or above the policy threshold. Licence expressions are parsed by a bounded recursive-descent parser (`license.ts`) with SPDX precedence — parentheses, then `AND`, then `OR` — and evaluated bottom-up (`OR` → most permissive side, `AND` → strictest). Anything the parser cannot accept **fails closed to `unknown`**: unbalanced or dangling operators, more than 64 tokens, nesting deeper than 8, `WITH` exceptions, `+` (or-later) operators, identifiers with unexpected characters, empty strings. Unlisted identifiers are `unknown`; operators are case-insensitive, identifiers are not. Reachability: *known* = direct and in import evidence; *inferred* = a root path begins at an imported direct dependency; otherwise *unknown* (including "declared but not imported"). Flags: install script, deprecated, multiple versions.
* **Plan**: the lowest registry version above the current one that satisfies every matching advisory's `patched` range. If no advisory has a patched range or no version satisfies it → `no-fix-available`. If every parent range accepts the target → `bump-in-range`. Otherwise `parent-conflict` listing each blocking parent and whether newer parent versions exist in the snapshot (whose dependency ranges the snapshot does not record — stated as such).

## Architecture

```
src/engine/  semver · schema (validation + limits) · graph · review (advisories, licence, reachability, plan) · report
src/fixtures/ledgerly-lockgraph.json (deliberately conflicting tree: two colourkit versions, a cycle, an unresolved edge, an empty licence, a denied licence)
src/App.tsx  tree + detail + filters + import
```

## Tests

`src/engine/__tests__/rootstock.test.ts` — 21 tests (seven added after an independent council review found `(MIT OR Apache-2.0) AND GPL-3.0-only` evaluating to allow): version parsing/ordering with prereleases; caret/tilde/comparator/x-range/hyphen/union semantics (16 assertions); snapshot acceptance; rejection of malformed versions, unknown severities, oversized input, duplicate `name@version` and over-limit package lists; graph resolution to highest satisfying version, coexistence of two `colourkit` versions, cycle tolerance, exact unresolved-edge reporting; bounded root paths and depth; advisory matching and non-matching; the three plan kinds with the exact blocking parent; reachability labels and the "not exploitability" note; licence verdicts including `OR` and empty; provenance flags; summary counts; determinism; report schema and Markdown content. See `EVIDENCE.md`.

## Data handling and safety

* Browser-local; no network, storage or analytics. Nothing is fetched from npm, OSV, GitHub Advisories or any registry.
* Input bounded: 256 KB UTF-8, 400 packages, 60 dependencies per package, 200 advisories, nesting ≤ 6; validated iteratively. Package names and ranges must parse before they are used.
* Exports are JSON/Markdown only.

## Limitations and unsupported cases

* The snapshot format is bespoke (`rootstock.lockgraph/1`); there is no importer for `package-lock.json`, CycloneDX or SPDX documents yet. The registry section is a hand-written list of versions, not registry metadata.
* The semver subset omits prerelease-inclusion rules for ranges, build metadata comparison and npm's `latest`/tag semantics (treated as invalid, so never matching).
* Reachability is import-evidence only. It is not call-graph analysis and must not be read as exploitability.
* Plans look one level up: they tell you which parent blocks a fix and whether newer parent versions exist, not whether those versions resolve the conflict.
* Licence evaluation is a policy list lookup, not legal advice; `WITH` exceptions and `+` operators are not understood and fall to *unknown* (fail closed).

## JD evidence (truthful framing)

Demonstrates supply-chain risk reasoning (advisory matching, semver range analysis, licence policy, provenance signals), honest uncertainty handling, and written deliverables (plan and evidence export). It is not experience with a commercial SCA product and makes no claim about real packages.

## AI-assistance disclosure

Built in October 2026 with AI assistance for code drafting under a human-directed plan. `INTERVIEW_GUIDE.md` lists what the author should explain unaided.

## References

* SPDX License List (v3.29.0, 2026-09-16): https://spdx.org/licenses/
* npm semver range syntax (reference behaviour this subset follows): https://github.com/npm/node-semver#ranges

License: MIT. Third-party notices in `THIRD_PARTY_NOTICES.md`.
