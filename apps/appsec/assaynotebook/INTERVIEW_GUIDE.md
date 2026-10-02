# INTERVIEW GUIDE — Assay Notebook

## Core engine in two minutes

The target is a function of (build, request), so every exchange is reproducible and hashable. Oracles are declarative checks on an exchange (`reflects-unencoded`, `cross-user-object`, `cookie-missing-flags`, `stack-trace-disclosed`), each carrying its CWE/OWASP mapping and default rating. The notebook only lets you open a finding if the oracle fired on the cited observation; findings are keyed by endpoint + oracle so repeats merge; severity is a published impact × likelihood matrix; and the state machine makes "fixed" and "still open" the exclusive outcome of an automated retest that replays the original request against a chosen build.

## One failure case

TC-04 on build v2. The partial fix closed reflection and IDOR but left the error handler alone: `GET /receipts/not-a-receipt` still returns HTTP 500 with stack frames and an internal connection string. Walk through why a retest on v2 lands on **still open** (oracle regex matches a `\n    at Name (file:line)` frame on a 5xx) and on v3 lands on **fixed** (400 with a generic JSON error). Then discuss the limits of the oracle: a framework that prints traces without the `at` pattern would be missed, which is why oracles are documented as checks, not proofs of absence.

## Why the tests are shaped this way

* Lab tests pin each weakness to specific builds, so a change to the lab that silently "fixes" v1 fails the suite.
* `it.each` over every oracle asserts fired-on-v1 / quiet-on-v3 so a new oracle must come with both behaviours.
* The retest test asserts the whole history trail, not just the final state.
* Guards (manual `fixed`, `wont-fix` without rationale, retest without a request) are tested because they encode the discipline the tool exists to teach.
* One GREEN-phase mismatch: the test's stack-frame regex expected `(file:line)` and the lab emitted `(file:line:col)`. The lab was adjusted to the spec; the oracle regex accepts both.

## Production next steps

1. Replace the in-tab lab with an adapter to a containerised, authorised lab (e.g. a local Docker target) while keeping oracles, hashing and the state machine unchanged.
2. Attach screenshots/HAR fragments as evidence with their own hashes.
3. CVSS v4 calculator alongside the teaching rubric.
4. Multi-assessor notebooks with sign-off and export to a ticketing system.

## Honest boundaries

Educational. Shows assessment method and documentation discipline — not authorised testing experience against real systems.
