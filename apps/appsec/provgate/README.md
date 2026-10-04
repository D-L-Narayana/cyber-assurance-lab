# Provenance Gate — secure-SDLC evidence gate

**Educational prototype (October 2026).** Provenance Gate answers one reviewer question before a release: *is there current, trustworthy evidence — threat model, independent review, tests, scans, dependency decisions and time-boxed risk acceptances — for exactly the change that is shipping?* It evaluates a release manifest against a policy written as JSON, entirely inside the browser, and exports a digest-stamped bundle. It is not a CI system, a compliance attestation or an audit opinion.

## The problem

Release evidence usually lives in five tools and is stitched together from memory. Common failure modes are quiet: a threat model from three months ago that covered a different module, a code review where the author approved their own change, a test report from the previous commit, a risk acceptance that expired in July, an artifact whose recorded hash no longer matches. The gate makes each of those a named, inspectable state instead of a green tick — and, since the October 2026 round, turns each named state into a concrete remediation step.

## Key workflows

1. **Open the vulnerable demo release 1.4.0.** The train shows red signals at Threat model, Code review, Verification and Risk acceptance; the gate is **BLOCKED** with seven blockers carrying eight problem codes (threat model: stale + scope-gap; code review: self-review with duplicate reviewers; unit-test artifact hash mismatch; SAST from the wrong commit; missing security retest; an open high finding with no acceptance; another with an expired acceptance).
2. **Read the remediation checklist** under the blockers: ten items for 1.4.0, one per problem the gate raised, each naming its target and a policy-aware action — e.g. `stale` → "Re-run threat-model against commit a1b2c3d and record a new artifact; policy allows 30 days …", `expired` → "Renew the acceptance for DEP-4: an identity holding the "security" role, other than the release author, must approve a new window of at most 90 days …".
3. **Click any ticket** to see provenance (who, when, which commit), the SHA-256 status and the inline artifact that was hashed.
4. **Switch to release 1.4.1.** Every requirement is satisfied; one open high dependency finding is carried under a valid acceptance, so the verdict is **RELEASE WITH ACCEPTED RISK** (amber), not a plain release, and the checklist is empty.
5. **Move the as-of date** to December: the same evidence goes stale and the acceptance expires; the checklist follows the as-of date because it is derived from the evaluation.
6. **Edit the policy** (age limits, same-commit types, change classes with globs and reviewer minimums, blocking severity, acceptance rules). Invalid policy is rejected with field-level messages; a changed limit changes the numbers quoted in the checklist.
7. **Import a synthetic manifest** (bounded JSON) and **export** the bundle (`provgate.bundle/1`, which now carries the checklist as an additive `remediation` array) or a Markdown gate memo with a "Remediation checklist" section.

## Quickstart

```bash
npm ci
npm test        # vitest, 27 engine tests
npm run build   # tsc --noEmit + vite build → dist/
npm run dev     # http://localhost:6111
```

Node 20.19+. No environment variables, backend or storage APIs; state resets on refresh.

## Algorithm

1. **Classify changes** (`classify.ts`). Each policy change class has globs (`auth/**`, `db/**/*.sql`, `**/package-lock.json`); `**` spans segments, `*` stays inside one. Required evidence = baseline types ∪ the `requires` of every matched class; the reviewer minimum is the strictest matched value; each evidence type must cover the paths of the classes that require it.
2. **Assess candidates** (`gate.ts`). For each required type, every evidence item of that type is scored for problems: `future-dated`, `stale` (older than `maxEvidenceAgeDays` relative to the as-of time), `wrong-commit` (for types in `requireSameCommit`), `hash-mismatch` (SHA-256 of the inline artifact ≠ `artifactHash`, computed with Web Crypto), `failed`, and for code review `self-review`, `reviewer-role`, `insufficient-reviewers` (duplicates and the author do not count), plus `scope-gap`, and `scope-missing` when evidence satisfying a *change-class* requirement declares no scope at all (silence is not coverage; baseline types cover the whole release by definition). The strongest candidate (fewest problems, then newest) is selected; the rest are listed as alternatives. Evidence with no inline artifact is `unverified` — accepted as recorded, flagged as a warning, never silently treated as verified.
3. **Findings and acceptances.** Every acceptance referencing a finding is evaluated; the gate deterministically uses a valid one (latest expiry first), otherwise the least-broken one, and warns when a finding has several acceptances — list order can never change the verdict. Open findings at or above the policy severity block unless the chosen acceptance is valid: approver has the approver role, is not the release author (unless policy allows), window ≤ `maxDays`, effective and unexpired at the as-of time. Acceptances that reference unknown findings are warnings.
4. **Verdict.** `blocked` if any requirement is unsatisfied or any finding blocks; `release-with-accepted-risk` if a valid acceptance is carrying an open finding; otherwise `release`.
5. **Remediation checklist** (`remediation.ts`). `remediationFor(evaluation, { policy, manifest })` walks the evaluation in order and emits one `{ code, target, action, detail }` item per requirement problem, per acceptance problem, per blocking finding with no acceptance (`no-acceptance`, the one blocker the gate raises without a code) and per acceptance that references a finding nobody recorded (`unknown-finding`). Actions quote the release commit, the author, the policy limits (`maxEvidenceAgeDays`, `minReviewers`, `reviewerRole`, `acceptance.maxDays`, `approverRole`) and, for scope gaps, the uncovered paths recomputed from the change classes. Without policy/manifest context the same items carry generic actions. `ACTION_SUMMARY` is a `Record<ProblemCode | AcceptanceProblemCode, string>`, so adding a code without an action fails `tsc` — which `npm run build` runs.
6. **Bundle.** `{manifest, policy, evaluation, remediation}` plus a SHA-256 content digest over the canonical JSON. The bundle says so explicitly: a digest detects accidental edits; it is **not** a signature.

## Architecture

```
src/engine/  types · schema (validation + limits) · classify (globs, requirements) · gate (evaluation) · remediation (checklist) · bundle (SHA-256, export)
src/fixtures/ release-1.4.0.json (vulnerable) · release-1.4.1.json (remediated) · policy-default.json
src/App.tsx  single-view UI: release train, evidence tickets, gate decision with remediation checklist, policy editor, detail panel
```

## Tests

27 tests in two files — `npx vitest run` prints `Tests  27 passed (27)`.

* `src/engine/__tests__/gate.test.ts` — 22 tests (five added after the sixth review: acceptance order independence, least-broken acceptance, fail-closed `scope-missing`, fixture contract, 7-blockers/8-codes): schema acceptance and rejection (malformed JSON, byte limit, over-limit lists, unknown identities, bad timestamps, unknown evidence types in policy), glob semantics, requirement derivation, every weak-evidence state on 1.4.0, expired acceptance, clean 1.4.1 verdict, unverified vs verified hash status, and bypass attempts (author as approver even with the security role, over-long window, wrong approver role, duplicate reviewers, reviewers without the role, future-dated evidence, best-candidate selection, as-of sensitivity) plus SHA-256 correctness and digest reproducibility.
* `src/engine/__tests__/remediation.test.ts` — 5 tests (October 2026): a type-level exhaustiveness guard (`Record<ProblemCode | AcceptanceProblemCode, string>` of expected key words that fails to compile if a code is missing) checked against `ACTION_SUMMARY`; every problem in the 1.4.0 evaluation yields an action quoting the commit, author, reviewer minimum, uncovered paths and acceptance limits; the clean 1.4.1 evaluation yields an empty list and a ghost acceptance yields one `unknown-finding` item; determinism and the context-free fallback; the memo's "Remediation checklist" section after "Blockers". The `no-acceptance` action must name the evidence *type* of the finding's source ("new sast evidence", resolved from the manifest) — an assertion added after a browser-flow review caught the action quoting the evidence id stem instead.

See `EVIDENCE.md` for the RED/GREEN record, including the one GREEN-phase failure that corrected an over-broad scope rule and the October 2026 RED/GREEN files.

## Data handling and safety

* Browser-local only; no network calls, no storage APIs, no analytics.
* Manifests and policies are bounded (128 KB UTF-8; ≤ 60 evidence items, 50 identities, 500 changes, 20 change classes; artifacts ≤ 4000 chars; nesting ≤ 6; iterative structural scan before field validation).
* All identities, commits, advisories and artifacts are fictional. Do not paste real commit logs or names.
* Exports are JSON/Markdown only (no CSV, so no formula injection). The checklist text is built from the evaluation's own values (ids, commits, policy numbers); it is rendered as React text nodes and plain Markdown.

## Limitations and unsupported cases

* No connection to Git, CI or ticketing; the manifest is hand-authored or generated elsewhere. The project does not verify that commits exist.
* Hash verification only works for small inline text artifacts. Binary artifacts, external links and detached signatures are out of scope — hence the explicit `unverified` state.
* The glob dialect is deliberately tiny (no braces, character classes or negation).
* The digest is not a signature and the tool holds no keys; provenance of the bundle itself must come from elsewhere (e.g. a signed CI attestation).
* The remediation checklist is derived text: it knows the policy's numbers and the manifest's identities, not the organisation's workflow (who owns the threat model, which ticketing queue, whether a finding is already being fixed). `unverified` evidence is a warning, not a checklist item, because the policy accepts it.
* Policy semantics are the author's; they are inspired by, not a certified implementation of, NIST SSDF practices (SP 800-218 v1.1) and SLSA-style provenance thinking.

## JD evidence (truthful framing)

Demonstrates secure-development governance reasoning (evidence completeness, freshness, separation of duties, risk acceptance expiry, actionable remediation guidance), policy-as-code design, quality/self-review discipline and clear written deliverables (gate memo). It is not GRC platform experience (ServiceNow, Archer, OneTrust and similar are not involved) and not a production release control.

## AI-assistance disclosure

Built in October 2026 with AI assistance for code drafting under a human-directed plan; see `INTERVIEW_GUIDE.md` for the explanations the author should be able to give unaided.

## References

* NIST SP 800-218, Secure Software Development Framework v1.1 (Feb 2022): https://csrc.nist.gov/pubs/sp/800/218/final
* SLSA specification, security levels: https://slsa.dev/spec/v1.0/levels

License: MIT. Third-party notices in `THIRD_PARTY_NOTICES.md`.
