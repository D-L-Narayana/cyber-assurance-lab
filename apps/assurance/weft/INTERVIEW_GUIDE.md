# Interview guide — Weft

_Purpose:_ preparation material written during the AI-assisted build. It describes how the code works and what happened while building it; it is not a record of the candidate's existing knowledge. Study it against the code before presenting the project.

## The engine in two minutes

Everything hangs off two hashes. The **artifact hash** is SHA-256 of the evidence text; if a collector recorded a declared hash, a mismatch means the content changed after collection, and the artifact becomes *tainted* and can no longer support anything. The **binding hash** ties an assertion to its evidence: hash of the assertion text, period and the *sorted* list of linked artifacts, each as `{id, capturedOn, sha256}`. A sign-off stores that value, so any later change to the statement, the period, the evidence content, or the set of links makes the stored value stale — the UI shows it as an invalid sign-off and the ledger lists it as high severity. The manifest is the sorted list of artifact hashes plus the per-assertion binding hashes, rooted in one more hash; verification is set arithmetic between the manifest and the current bundle.

## Two failure cases

The first verification test expected `rootMatches` to be false after the bundle was edited. It was true, and the implementation was right: the root tells you whether the *manifest* was altered, not whether the bundle drifted — that is `intact`. Keeping the two apart matters: a tampered manifest and a tampered bundle are different incidents. The test was corrected and the distinction written into the README.

The second was a real bug found in external review: the first binding hash covered only the *set of content hashes*. Re-dating an artifact out of the assertion's period changed whether it supported the assertion, yet the sign-off stayed valid; and `verifyManifest` only walked the manifest's bindings, so an assertion appended afterwards left `intact` true. Both were reproduced as failing tests before the fix (binding v2 with id + capturedOn + sha256; verification now reports added and missing assertions). Lesson: bind every input that changes a decision, and verify in both directions.

## Why these tests

Binding hash: order-independence (reverse the links → same hash), sensitivity to statement text and evidence content. Sign-off: invalidated by edit, by unlinking, and refused for weak/unsupported/double-signing. Verify: four separate drift classes plus a forged-manifest case. Fixture: asserts that all eight planted defect kinds are actually reported — the demo must not be a happy path.

## Be ready to answer

- Why sort evidence hashes before hashing? (Links are a set; order must not change the binding.)
- What does a hash not give you? (Authenticity, non-repudiation, timestamps — those need signatures and a trusted clock.)
- Why mark out-of-period evidence weak rather than wrong? (It may be legitimately relevant; the reviewer decides, the engine just refuses to call it *supported*.)
- Production step one? Sign the manifest root with a key held outside the app.

## Production next steps

Detached signatures (e.g. Web Crypto ECDSA or Sigstore-style transparency); binary artifacts hashed client-side; timestamps and time zones; multi-reviewer sign-offs with roles; export to an evidence locker or GRC system; append-only history of bundle versions with diffs.
