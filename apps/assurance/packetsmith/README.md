# Packetsmith — SP 800-53 Rev. 5 subset assessment packet builder

**Educational prototype. Synthetic data only. Not a FedRAMP, federal authorization, audit opinion or compliance determination.**

Packetsmith is an assessor's worksheet for a **12-control educational subset of NIST SP 800-53 Rev. 5** (Release 5.2.0, August 2025). For each control it structures the work the way SP 800-53A Rev. 5 describes it: determination statements, procedure steps using the three assessment methods (**examine, interview, test**), evidence artifacts with SHA-256 hashes, a result per determination, and corrective actions for anything *other than satisfied*. A completeness gate lists every reason a packet is not ready, and a small state machine moves the packet from drafting to review to approval with separation of duties.

Control identifiers, titles and families are NIST's. The determination statements and example assessment objects in this app are **paraphrased for teaching** and are labelled as such everywhere they appear; they are not the authoritative control statements or SP 800-53A procedures.

## Key workflows

1. **Scope controls** from the index (12 available). Each in-scope control needs ≥ 1 performed step and a result for every determination.
2. **Plan and perform steps** per method; attach artifacts from the evidence locker. Skipped steps need a ≥ 10-character reason.
3. **Add artifacts** (synthetic text: config snippets, log excerpts, interview notes, screenshot descriptions). Content is hashed locally with SHA-256; the locker shows `hash ok` / `hash mismatch` on every render, so edited-after-capture content is visible immediately.
4. **Record results** per determination (satisfied / other than satisfied / not assessed), citing performed steps. The control "stamp" rolls up: any *other than satisfied* dominates.
5. **Raise findings** for other-than-satisfied determinations with owner, due date and corrective action; the gate refuses missing owners, past due dates and findings that point at satisfied determinations.
6. **Move the packet**: drafting → ready-for-review (assessor only, zero blockers) → approved (named approver, never the assessor) or returned (note required) → drafting. Approved packets are immutable **within the session**: see *What approval does and does not mean* below.
7. **Export**: packet JSON (`packetsmith.packet/1`), Markdown memo, or the print memo dialog (print stylesheet). Every memo carries a SHA-256 digest of the packet's canonical content.

## Quickstart

```bash
npm ci
npm test          # vitest, 31 tests
npm run build     # tsc + vite → dist/
npm run preview   # http://127.0.0.1:6121/
```

## Algorithm

| Rule | Detail |
|---|---|
| Artifact integrity | `sha256 = SHA-256(UTF-8(content))` via a self-contained TypeScript implementation (FIPS 180-4), verified in tests against FIPS vectors, `node:crypto` and WebCrypto. Mismatch = blocker. |
| Control status | not-assessed (no results) → in-progress (some) → satisfied (all satisfied) ; any other-than-satisfied dominates. |
| Completeness gate | per in-scope control: ≥ 1 performed step; every determination has a result; each result cites ≥ 1 *performed* step; cited steps carry ≥ 1 artifact; OTS results have a finding with owner and a due date ≥ packet date (unless completed); skipped steps have a reason; no dangling artifact ids; no hash mismatches; no finding against a satisfied determination. |
| State machine | `drafting → ready-for-review` (assessor, no blockers) · `ready-for-review → approved` (approver ≠ assessor) · `ready-for-review → returned` (note) · `returned → drafting` · `approved` terminal and immutable. Every transition appends to history; inputs are never mutated. |
| Digest | SHA-256 over canonical JSON (sorted keys) of meta, scope, steps, artifact hashes, results and findings — stable across key order, sensitive to any content change. |

Unsupported / known limits: no sampling methodology, no control enhancements, no tailoring/parameters (organisation-defined values are shown as "defined"), no attachment of binary files (text only), single assessor/approver identities typed as strings (no authentication).

## Architecture

```
src/engine/catalog.ts   12 controls, paraphrased determinations, example objects per method
src/engine/sha256.ts    pure SHA-256 (sync, UTF-8)
src/engine/packet.ts    rollup, completeness gate, state machine, canonical digest, memo
src/engine/validate.ts  bounded import validation (1 MiB, 400 steps, 300 artifacts, 20k chars/artifact)
src/ui/*                React 19: App, Worksheet, Locker, Gate, MemoView (native <dialog>, print CSS)
src/fixtures/           synthetic Dispatch Portal packet with deliberate defects (qa/make-fixture.mjs regenerates it)
tests/engine.test.ts    31 tests
```

Memory-only state; hash deep links (`#/AC-2`); self-hosted IBM Plex Sans/Mono (OFL-1.1); CSP and hardening headers in `vercel.json`.

## Tests

31 vitest tests: SHA-256 vectors/oracles, catalog shape, integrity detection, rollup, every completeness rule, every state transition (including refusals and immutability), digest stability, memo content, import bounds and malformed input, and the bundled fixture's intended defects. RED/GREEN runs are recorded in `EVIDENCE.md` and `qa/`.

## Data handling

Synthetic system, fictional people, `.example` hosts. Nothing leaves the browser; no storage APIs; downloads are transient blob URLs. Imports are size-, count- and shape-checked before use.

## What approval does and does not mean

- **Session-only immutability.** The `approved` state locks editing in the running app. An exported packet is plain JSON: anyone can edit it offline and re-import it. The import validator now refuses packets whose history does not chain, whose final history entry disagrees with `state`, or whose history reached `approved` while `state` says otherwise — but it cannot detect a consistent forgery (e.g. editing a step *and* removing the approval entry).
- **Hashes are not signatures.** The packet digest covers content (controls, steps, artifacts, determinations, findings), deliberately not `state`/`history`, so the same work has one digest regardless of workflow position. Artifact SHA-256s prove content has not changed since capture, not who captured it. There is no key material, so nothing here is a signature or non-repudiable.
- **Separation of duties is checked early.** `assessor === approver` is a completeness blocker and an import validation error, so a packet cannot be assembled into an unapprovable state unnoticed; the approve transition still independently refuses the assessor.
- **Roles are self-asserted.** "Acting as" is a typed name; there is no directory or authentication. The guardrails demonstrate the policy logic, not an access-control system.

## JD evidence (truthful framing)

Shows working knowledge of SP 800-53 Rev. 5 control vocabulary and SP 800-53A assessment methods, evidence-backed determinations, POA&M-style corrective actions, separation of duties and print-ready deliverables. It is not a federal assessment, not RMF experience, and not ServiceNow/Archer experience.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance: an AI coding agent drafted the design plan, code, tests and documentation and executed the verification recorded in `EVIDENCE.md`. This does not by itself establish the candidate's understanding; the candidate should review the code and be able to explain it (see `INTERVIEW_GUIDE.md`) before presenting it. Framework text was transcribed from primary NIST publications; heuristic rules and paraphrases were written for this project and are labelled as such.

## References

- NIST SP 800-53 Rev. 5 (Release 5.2.0): https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
- Summary of changes, Release 5.2.0 (Aug 27, 2025): https://csrc.nist.gov/News/2025/nist-releases-revision-to-sp-800-53-controls
- NIST SP 800-53A Rev. 5 (assessment procedures; examine/interview/test): https://csrc.nist.gov/pubs/sp/800/53/a/r5/final
