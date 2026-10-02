# INTERVIEW GUIDE — Provenance Gate

## Core engine in two minutes

Requirements are derived, not hard-coded: the policy's change classes match changed paths with a tiny glob dialect, and each matched class contributes required evidence types, a reviewer minimum and the paths that evidence must cover. For each required type the gate scores every candidate piece of evidence against time (as-of), commit, artifact hash, result, reviewer independence and scope, picks the strongest, and names each remaining problem with a code. Open findings above the blocking severity need a valid, time-boxed acceptance by someone with the right role who is not the author. The verdict distinguishes a clean release from a release carried on accepted risk.

## One failure case

Release 1.4.0's unit-test evidence: the artifact text says 212 tests passed and the record carries a hash, but SHA-256 of the text is not that hash. The ticket shows `hash-mismatch`; the gate blocks. Discuss what could cause it (edited artifact, wrong file hashed, copy-paste of a different record), why the tool cannot tell which, and why "unverified" (no artifact at all) is treated differently from "mismatch".

## Why the tests look like this

* Each bypass has a dedicated test written before the code: author-as-approver even with the security role; approver without the role; window longer than policy; duplicates counted once; reviewer lacking the role; future-dated evidence; older evidence of the same type not being preferred.
* One test failed during GREEN: the first scope rule required the threat model to cover *every* changed path including `package-lock.json`, which is wrong — the class that requires a threat model is `authentication`, so the threat model must cover the authentication paths. The rule was corrected to "scope per requiring class" and the test passed. That is the kind of over-strict rule that makes real gates get bypassed with overrides.
* As-of sensitivity is tested because an evidence gate that ignores time is a checklist, not a gate.

## Two reviewer-found bugs worth telling

1. `acceptances.find(findingRef)` made the verdict depend on list order: an expired acceptance listed before a valid one blocked the release; reversed, it passed. Fixed by evaluating all acceptances and choosing deterministically, plus a warning for duplicates.
2. Evidence without a `scope` array was assumed to cover everything, so deleting `scope` from the threat model made a class requirement pass. Fixed fail-closed: class-required evidence must declare scope (`scope-missing`); baseline types need not.

## Production next steps

1. Ingest manifests from CI (signed attestations such as in-toto/SLSA provenance) instead of hand-authored JSON.
2. Support detached hashes for binary artifacts and verify signatures rather than digests.
3. Policy versioning and an override workflow with its own expiry and approver rules.
4. Role mapping from an identity provider so "security" is not self-declared in the manifest.

## Honest boundaries

An educational evaluator for synthetic release metadata, not a compliance control. It shows the ability to design policy-as-code, reason about separation of duties and evidence freshness, and write a gate memo a manager can read.
