# Assay Notebook — web assessment notebook with an in-tab lab

**Educational prototype (October 2026).** Assay Notebook is a split-page notebook for learning how a web-application security assessment is *recorded*: the left page is a bench where requests are sent to a fictional expense application that lives entirely inside the browser tab; the right page is the write-up, where each finding carries a CWE mapping, a transparent severity rationale, SHA-256-hashed evidence and a retest trail that can only be advanced by replaying the original request. There is no scanner, no network traffic and no real target. It is not a penetration test.

## The problem

Junior assessors learn payloads before they learn discipline: which observation supports which finding, why a severity was chosen, whether a "fix" was actually re-verified, and how to avoid writing the same weakness up twice. The notebook makes those habits structural — the oracle must fire before a finding can be recorded, duplicates merge, and "fixed" is unreachable by hand.

## Key workflows

1. **Probe by hand.** Choose one of four lab routes, set parameters and a session, send. The exchange is shown as text (never rendered) with its evidence hash. Applicable oracles report *fired* or *quiet* with a one-line reason; a fired oracle offers **Record as finding**.
2. **Run the catalog.** Four authorised test cases execute against the selected build (v1 initial, v2 partial fix, v3 remediated). On v1 they open four findings; on v2 two; on v3 none.
3. **Rate and justify.** Impact × likelihood toggles drive the severity through a published matrix; the rationale is free text.
4. **Retest.** *Request retest*, switch the lab build, *Retest now*. The original request is replayed; the oracle decides **fixed** or **still open** and the rubber stamp changes. Attempting to set those states manually is refused. *Won't fix* requires a written rationale.
5. **Export** the notebook (`assaynotebook.report/1` JSON, session cookie values redacted) or a Markdown write-up with reproduction steps, evidence hashes, retests and remediation.

## Quickstart

```bash
npm ci
npm test        # vitest, 19 engine tests
npm run build   # tsc --noEmit + vite build → dist/
npm run dev     # http://localhost:6112
```

Node 20+. No environment variables, backend or storage APIs; refresh resets the notebook (export first).

## The lab application

`src/engine/lab.ts` — "Ledgerly", a pure function `labRequest(build, request)`. Routes: `GET /search?q=`, `GET /receipts/{id}` (session required; alice owns r-100/r-101, bob owns r-200), `POST /login`, `GET /account`. Seeded weaknesses:

| Case | Weakness | Builds affected | Oracle |
|---|---|---|---|
| TC-01 | Search term reflected into HTML unencoded | v1 | probe marker `<assay-xxxxxx>` present verbatim in body |
| TC-02 | Receipt returned to a non-owner (IDOR) | v1 | 200 with `owner` ≠ session |
| TC-03 | Session cookie without HttpOnly/Secure/SameSite | v1, v2 | Set-Cookie lacks any of the three |
| TC-04 | Malformed id → 500 with stack trace and internal connection string | v1, v2 | 5xx body matches stack-frame pattern |

Probes are harmless by construction: the marker is a bracketed hex tag, never a script or handler. `validateLabRequest` refuses absolute URLs and protocol-relative paths with `External target refused`, bounds parameters (≤ 8, ≤ 512 printable ASCII chars) and rejects `..`.

## Notebook engine

`src/engine/notebook.ts`:

* **Observation** = build + request + response + note + `sha256(canonical exchange)`. Identical exchanges hash identically, so evidence can be cross-checked.
* **Finding** signature = `endpoint|oracle`. Recording against an existing signature merges evidence instead of opening a duplicate. Recording is refused if the oracle did not fire on that observation.
* **Re-ratings are audited**: changing impact, likelihood or rationale appends a history entry (`Re-rated: …`); unchanged saves add nothing.
* **Severity** = matrix over impact × likelihood (`high×high → critical`, `high×medium / medium×high → high`, `high×low / medium×medium / low×high → medium`, else `low`). Transparent, coarse, not CVSS.
* **States**: `open → retest-requested → fixed | still-open`, `open|still-open → wont-fix` (rationale ≥ 10 chars), any terminal state → `retest-requested`. `fixed`/`still-open` are reachable only through `retest()`, which replays the first evidence request on a chosen build and appends a new observation.
* **Bounds**: 500 observations, 100 findings per notebook.

## Architecture

```
src/engine/  lab (target) · oracles (declarative checks + CWE/OWASP mapping) · catalog (4 cases) · notebook (state machine, hashing) · report (export, redaction)
src/App.tsx  bench page + notebook page
```

## Tests

`src/engine/__tests__/notebook.test.ts` — 20 tests (one added after the sixth-Fable review: re-rating history): each lab weakness present in the affected builds and absent in v3; refusal of external targets and oversized/traversal inputs; deterministic harmless markers; every oracle fires on v1 and is silent on v3; severity matrix; SHA-256 determinism; dedup/merge; refusal when the oracle is quiet; retest state trail (`open → retest-requested → still-open → retest-requested → fixed`); transition guards; catalog counts 4/2/0; notebook size limit; report schema, CWE ids and cookie redaction. See `EVIDENCE.md` for RED/GREEN records.

## Data handling and safety

* Browser-local only; the "target" is a function. No fetch, sockets, storage or analytics.
* All identities, receipts and tokens are fictional; the lab's session ids are constants and are still redacted on export.
* Response bodies are displayed as text in `<pre>`; nothing from the lab is ever inserted as HTML.
* Exports are JSON and Markdown (no CSV).

## Limitations and unsupported cases

* Four fixed weaknesses, four routes, three builds. The notebook does not discover anything; it records what the oracles check. Adding a weakness means adding an oracle and a lab behaviour.
* The reflection oracle detects *unencoded reflection* (a precondition for XSS), not exploitability. No payloads are generated.
* Severity is a teaching rubric; real programmes use CVSS or organisation-specific schemes.
* No attachments, screenshots or multi-user collaboration; one notebook per tab, in memory.

## JD evidence (truthful framing)

Demonstrates web-application security assessment method (test-case design, observation/evidence discipline, CWE/OWASP Top 10:2021 mapping, severity rationale, retest verification) and clear written deliverables. It does not constitute authorised penetration-testing experience or a vulnerability assessment of any real system.

## AI-assistance disclosure

Built in October 2026 with AI assistance for code drafting under a human-directed plan. `INTERVIEW_GUIDE.md` lists what the author should explain unaided.

## References

* CWE-79, CWE-639, CWE-1004, CWE-209 (CWE 4.20): https://cwe.mitre.org/data/definitions/79.html · /639.html · /1004.html · /209.html
* OWASP Top 10:2021: https://owasp.org/Top10/

License: MIT. Third-party notices in `THIRD_PARTY_NOTICES.md`.
