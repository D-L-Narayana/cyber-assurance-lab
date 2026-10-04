# Weft — control-to-evidence lineage and integrity bundle

**Educational prototype. Synthetic text artifacts only. A hash proves content has not changed since it was hashed — not who produced it or whether it is genuine.**

Weft answers the reviewer's question *"which evidence supports this assertion, and is it still the evidence that was signed?"* A bundle holds control assertions (with an evidence period), evidence artifacts (text, hashed with SHA-256), links between them, and reviewer sign-offs. The engine finds orphan artifacts, unsupported and weak assertions, duplicate content under different names, broken links, out-of-period evidence, hash mismatches against declared hashes, and sign-offs that no longer bind because the statement or evidence changed. It emits an immutable manifest (sorted entries + per-assertion binding hashes + root digest) and can verify a bundle against a manifest or diff two bundles.

The weave grid is the main view: assertions are warp columns, artifacts are weft rows, and each knot encodes the link state.

## Key workflows

1. **Read the weave**: ● in-period link, ○ out-of-period, ⊗ tainted (hash mismatch), ✕ broken (unknown id). Column headers carry status and sign-off; row headers carry hash prefix, duplicate and mismatch markers.
2. **Inspect an assertion**: statement, period, linked evidence with its classification, binding hash, sign-off validity. Sign off only when *supported*; withdraw or clear stale sign-offs.
3. **Inspect an artifact**: computed vs declared SHA-256, duplicates, which assertions it supports. Edit content to see the hash change, the declared hash mismatch and every dependent sign-off invalidate — live.
4. **Link / unlink** by clicking knots (keyboard operable).
5. **Findings ledger** groups every issue by kind and severity with jump links.
6. **Generate manifest** (`weft.manifest/2`: root over bundle name, artifact entries incl. display names, assertion bindings and sign-offs), **verify** a bundle against an imported manifest (modified / missing / added / renamed / binding changed / assertions added or missing / sign-offs changed / bundle name / manifest self-consistency), **diff** against another bundle, export bundle and analysis JSON. v1 manifests (which did not bind sign-offs or names) are refused with a message; regenerate.
7. **Export CSV** — "Export findings CSV" (ledger header: `kind, severity, refs, message`, in ledger order) and "Export artifacts CSV" (`id, name, kind, capturedOn, sha256, bytes, declaredMatches, duplicateOf, linkedAssertions`, sorted by id). Both are formula-safe: cells that would start a spreadsheet formula are prefixed with `'` (see Algorithm → CSV export).

## Quickstart

```bash
npm ci
npm test          # vitest, 53 tests (36 engine + 11 csv + 6 validation audit)
npm run build     # tsc + vite → dist/
npm run preview   # http://127.0.0.1:6123/
```

Node ≥ 20.19 (Vite 7). No backend, no environment variables, no network calls at runtime.

## Algorithm

| Element | Rule |
|---|---|
| Artifact hash | `SHA-256(UTF-8(content))` via a self-contained implementation verified against FIPS vectors and `node:crypto`. `declaredSha256` (optional) is compared case-insensitively → `hash-mismatch` (high). |
| Duplicates | Identical content hash under different ids → `duplicate-content` (medium). |
| Links | Unknown assertion or artifact id → `broken-link` (high); repeated pair → `duplicate-link` (low). |
| Period | Evidence `capturedOn` within `[periodStart, periodEnd]` (inclusive) is in-period; otherwise `out-of-period` (medium). Mismatched artifacts are *tainted* and never support. |
| Assertion status | supported (≥ 1 in-period, untainted) · weak (only out-of-period) · unsupported (nothing usable) → `weak-assertion` / `unsupported-assertion`. |
| Orphans | Artifact linked to no known assertion → `orphan-artifact` (medium). |
| Binding hash | `SHA-256(canonical({v: 2, assertionId, controlRef, statement, periodStart, periodEnd, evidence: sorted [{id, capturedOn, sha256}]}))` — independent of link order; sensitive to statement text, period, the set of linked artifacts, each artifact's id, capture date **and** content. (v1 bound only the content-hash set, so re-dating or renaming evidence left a sign-off valid — found in parent review and fixed test-first.) |
| Sign-off | Allowed only for supported assertions without a valid sign-off; stores the binding hash. Any later change → `invalid-signoff` (high). |
| Manifest | `weft.manifest/2`: entries sorted by id `{id, name, sha256, bytes}` + bindings sorted by assertion id + sign-offs sorted by assertion id; `root = SHA-256(canonical({v: 2, bundleName, entries, bindings, signoffs}))` (`generatedOn` is metadata and not bound). |
| Verify | `rootMatches` (manifest self-consistent), artifacts `modified` / `missing` / `added` / `renamed`, assertions `bindingChanged` / `missingAssertions` / `addedAssertions` (present in the bundle but unbound in the manifest), `signoffsChanged` (added, removed, re-attributed, re-dated or re-bound, both directions) and `bundleNameChanged`; `intact` only when all of them are clear. |
| Diff | Added/removed/changed artifacts (by hash), assertions (by canonical JSON), links (by pair). |
| CSV export | Findings ledger (`kind, severity, refs, message`, ledger order) and artifact table (`id, name, kind, capturedOn, sha256, bytes, declaredMatches, duplicateOf, linkedAssertions`, sorted by id) through a local formula-safe writer: a cell that starts with `= + - @` — even behind leading whitespace or control characters — or with a tab/CR is prefixed with `'`; every cell is double-quoted (RFC 4180) and rows end with CRLF. |

Limits: text artifacts only (no binary files); hashes are not signatures (no keys, no identity); period logic uses dates, not timestamps/time zones.

## Architecture

```
src/engine/sha256.ts    pure SHA-256
src/engine/lineage.ts   analyze, bindingHash, signOff, buildManifest, verifyManifest, diffBundles, canonical
src/engine/csv.ts       formula-safe toCsv + findingsToCsvRows / artifactsToCsvRows (October 2026)
src/engine/validate.ts  bounded validation for bundles and manifests (2 MiB, 300 artifacts, 200 assertions, 2000 links, 50k chars)
src/ui/*                React 19: App, Weave (table grid), Panels (assertion/artifact/ledger)
src/fixtures/           synthetic Q3 bundle with planted defects (qa/make-fixture.mjs)
tests/engine.test.ts    36 tests (engine, validation bounds, fixture, review regressions)
tests/csv.test.ts       11 tests (writer, findings ledger, artifact table)
tests/validation.test.ts 6 tests (strict calendar dates in every date field, 20 000-deep hostile nesting, committed invalid sample)
qa/samples/              invalid-bundle-calendar-date.json — synthetic bundle the importer must reject (three exact-path date issues)
```

Memory-only state; hash deep links (`#/assertion/AS-02`, `#/artifact/AR-05`); self-hosted Instrument Serif + IBM Plex Mono (OFL-1.1); `vercel.json` carries the lab-wide canonical header set (CSP, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP `same-origin`, HSTS — see `AUDIT.md`). Toolchain: Vite 7.3, @vitejs/plugin-react 5.2, Vitest 4.1, TypeScript 5.9; Node ≥ 20.19.

## Tests

`npm test` runs 53 tests (`Tests  53 passed (53)`). `tests/engine.test.ts` (36): hash oracle and canonical JSON; declared-hash comparison; duplicates; orphans/unsupported; broken/duplicate links; inclusive period boundaries; tainted evidence; binding-hash invariants (order-independent, text- and content-sensitive); sign-off validity and invalidation by edit, unlink or re-link; refusal rules; input immutability; manifest ordering and root stability; verify intact/modified/missing/added/binding-changed, added/removed assertions and forged-manifest detection; parent-review and sixth-review regressions (appended assertion, re-dated and renamed evidence after sign-off, manifest v2 binding sign-offs and names); diff; validation bounds and paths; fixture defect coverage. `tests/csv.test.ts` (11): the formula-safe writer (leading `= + - @`, whitespace/control-character and tab/CR variants, quoting of commas, quotes and newlines, CRLF), the findings-ledger header and order, the artifact-table header and order, hostile ids pushed through `analyze()`, fixture rows and determinism. `tests/validation.test.ts` (6): calendar-invalid dates (`2026-02-30`) rejected in every date field with the exact path, leap days accepted, 20 000-deep hostile nesting handled without a stack overflow, and the committed sample `qa/samples/invalid-bundle-calendar-date.json` rejected with exactly its three date paths (the same file can be imported through "Import bundle" to see the path-addressed refusal in the UI). RED/GREEN evidence: `qa/red-engine.txt` / `qa/green-engine.txt` (original build), `qa/red-csv.txt` / `qa/green-csv.txt` (CSV export), `qa/audit-validation.txt` (validation audit, passed unchanged).

## Data handling

Synthetic artifacts (`.example` style content, fictional reviewers). No network, no storage APIs; downloads via transient Blob URLs. CSV exports neutralise spreadsheet formulas: a cell beginning with `= + - @` (even after leading whitespace or control characters) or with a tab/carriage return is prefixed with `'`; every cell is quoted.

## Limitations

- Hashes are not signatures: nothing binds a reviewer identity or a trusted time.
- Text artifacts only; no binary files; period logic uses calendar dates, not timestamps or time zones.
- Single user, memory-only; no history of bundle versions.
- The CSV exports are flat views of the ledger and the artifact table; the manifest and the analysis JSON remain the authoritative, re-verifiable records.

## JD evidence (truthful framing)

Evidence traceability, self-review and "little rework" habits: every artifact must be explained, every assertion supported, every sign-off provably bound. Shows integrity-manifest thinking and tamper-evidence design. Not a claim of audit experience or of cryptographic signing.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance: an AI coding agent drafted the design plan, code, tests and documentation and executed the verification recorded in `EVIDENCE.md`. This does not by itself establish the candidate's understanding; the candidate should review the code and be able to explain it (see `INTERVIEW_GUIDE.md`) before presenting it. Framework text was transcribed from primary NIST publications; heuristic rules and paraphrases were written for this project and are labelled as such.
