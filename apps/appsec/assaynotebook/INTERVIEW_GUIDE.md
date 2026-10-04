# INTERVIEW GUIDE — Assay Notebook

## Core engine in two minutes

The target is a function of (build, request), so every exchange is reproducible and hashable. Oracles are declarative checks on an exchange (`reflects-unencoded`, `cross-user-object`, `cookie-missing-flags`, `stack-trace-disclosed` and, since October 2026, `security-headers-missing`), each carrying its CWE/OWASP mapping and default rating. The notebook only lets you open a finding if the oracle fired on the cited observation; findings are keyed by endpoint + oracle so repeats merge; severity is a published impact × likelihood matrix; and the state machine makes "fixed" and "still open" the exclusive outcome of an automated retest that replays the original request against a chosen build.

## One failure case

TC-04 on build v2. The partial fix closed reflection and IDOR but left the error handler alone: `GET /receipts/not-a-receipt` still returns HTTP 500 with stack frames and an internal connection string. Walk through why a retest on v2 lands on **still open** (oracle regex matches a `\n    at Name (file:line)` frame on a 5xx) and on v3 lands on **fixed** (400 with a generic JSON error). Then discuss the limits of the oracle: a framework that prints traces without the `at` pattern would be missed, which is why oracles are documented as checks, not proofs of absence.

## Why the tests are shaped this way

* Lab tests pin each weakness to specific builds, so a change to the lab that silently "fixes" v1 fails the suite.
* `it.each` over every oracle asserts fired-on-v1 / quiet-on-v3 so a new oracle must come with both behaviours.
* The retest test asserts the whole history trail, not just the final state.
* Guards (manual `fixed`, `wont-fix` without rationale, retest without a request) are tested because they encode the discipline the tool exists to teach.
* One GREEN-phase mismatch: the test's stack-frame regex expected `(file:line)` and the lab emitted `(file:line:col)`. The lab was adjusted to the spec; the oracle regex accepts both.

## October 2026 upgrade: one question worth being ready for

**Q: Why is the fifth oracle restricted to rendered HTML, and what did adding it force you to change?** `security-headers-missing` (CWE-693, A05:2021) fires when a response lacks `Content-Security-Policy` or `X-Content-Type-Options`. Applied to every response it would be noisy and wrong: a JSON API response is not rendered, and the lab's `POST /login` answers 302 with `text/html` and an empty body — flagging that would be a false positive a reviewer would stop trusting. So the oracle has an explicit applicability predicate, `isRenderedHtml` (`text/html` content type, status not 3xx, non-empty body), and header lookup is case-insensitive because HTTP header names are and recorded exchanges may be cased either way. Adding the oracle pulled on three threads at once: the `it.each` over `ORACLES` demands a catalog entry that fires on v1 and is quiet on v3, so `TC-05` (`GET /account` as alice) had to exist before the test could pass; the catalog count test became 5/3/0 — v2 still lacks the headers, so it keeps three findings; and the report test gained `CWE-693`. The RED run showed all of that failing with a metadata-only stub (`qa/red-security-headers.txt`), and v3 needed no change because it already sent the headers. Honest limit: it is a presence check — `default-src *` would pass it — and it says nothing about frame-ancestors, Referrer-Policy or HSTS.

## Production next steps

1. Replace the in-tab lab with an adapter to a containerised, authorised lab (e.g. a local Docker target) while keeping oracles, hashing and the state machine unchanged.
2. Attach screenshots/HAR fragments as evidence with their own hashes.
3. CVSS v4 calculator alongside the teaching rubric.
4. Multi-assessor notebooks with sign-off and export to a ticketing system.

## Honest boundaries

Educational. Shows assessment method and documentation discipline — not authorised testing experience against real systems.
