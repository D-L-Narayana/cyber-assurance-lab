# INTERVIEW GUIDE — Permit Matrix

## The core engine in two minutes

The contract declares, per endpoint, which roles may call it and how the target object must relate to the caller (`any`, `own`, `same-tenant`), plus which fields may be written and which must never be returned. `generateCases` walks endpoint × principal × target (own / peer / cross-tenant) and derives an expectation from those rules, so every expectation is traceable to one sentence of policy. The mock server implements the same contract literally, with named flaws that switch off one check on one endpoint. The runner executes each case on a fresh server, compares outcome to expectation, and for property probes inspects server state the way an integration test would query the database. Findings are grouped per endpoint and mapped to OWASP API1/API3/API5:2023.

## One failure case to walk through

`PATCH /users/{id}` with `writableFields: ["displayName"]` and the `accept-all-fields` flaw. Riley (member) sends `{displayName: "Riley-tampered", role: "member-tampered"}`. Response is 200 either way, so the response alone proves nothing; the oracle reads the record after the write and sees `role` changed → verdict `mass-assignment`, severity high because `role` matches the privilege-bearing field pattern. On the fixed build the body is bound to the allow-list and `role` is unchanged → `pass`. Explain why checking the response is insufficient and why inspecting state is the honest oracle.

## Why the tests are shaped this way

* The first RED run failed because the engine modules did not exist; the second RED (after an external source review) failed on five concrete gaps: UTF-16 vs UTF-8 byte limit, duplicate record ids, `1e999` → `Infinity`, uncapped builds/flaws/servers, and a real `RangeError` from spreading a 200 000-element array. Each got a regression test before the fix.
* "Zero findings on the remediated build" is the most important test: it proves the generator does not manufacture false positives from the contract itself.
* "Over-deny is not a pass" encodes the view that an authorization tester must distinguish *secure* from *broken*.

## A reviewer-found bug worth telling

An independent reviewer added a second `GET /invoices/{id}` endpoint (admin, `any`) to the fixture. Validation accepted it, the router sent every request to the first registration, and the *remediated* build reported false `function-bypass` and `over-deny` findings against the new endpoint. The fix was to reject duplicate method + path templates at validation (plus only-`{id}` parameters and literal-before-parameter routing), with regression tests written before the change. Lesson: an authorization tester that can produce findings against a flawless server is worse than none.

## October 2026 upgrade: two questions worth being ready for

**Q: Why did create-path mass assignment need its own probe, and how does the oracle decide?** Before this round the fixture had no `POST` endpoint and the README admitted "POST/create mass assignment … not probed". An update probe can diff the target record before and after, but a create has no "before": the record does not exist yet. The probe therefore sends a plausible create body (every writable field, values derived from a representative record) plus one non-writable field — `status` on `POST /invoices` — and then reads the record the server says it created (`inspect(resource, response.body.id)`). If that record carries the non-writable field *with the value from the body*, the verdict is `mass-assignment`; if the server discarded it, `pass`; if the server answered 2xx without identifying the record, `error`, because the case could not be judged. The non-writable set is the union of field names across the resource's records minus `writableFields`, in first-seen order, so the ids are stable and the set follows the data rather than a hand-written list. Only expected-allow principals get probes: a member's 403 says nothing about field binding. On 1.4.0 that adds exactly one finding (`create-invoice|mass-assignment`, API3:2023, high because `status` is privilege-bearing); on 1.4.1 nothing.

**Q: What does "compare with previous run" prove, and what does it not?** `compareRuns(before, after)` keys findings by `endpoint|kind` and cases by id, and reports closed / opened / persisted findings plus every case whose verdict changed, all sorted so the diff is byte-identical for the same inputs. It turns a retest from "the count went from 5 to 0" into "these five closed, these 33 cases moved to pass, nothing opened". It does not prove the fix is correct — it compares two runs of the same contract against the mock, so a wrong contract yields a confidently wrong diff — and it cannot compare runs of different contracts (the UI clears the previous run on import). The comparison is additive in the report (`comparison?`), so older exports still import unchanged.

## Production next steps

1. Replace the mock with an adapter that records and replays real HTTP exchanges from an **authorised** staging environment, keeping the same case generator and verdict logic.
2. Import OpenAPI 3.1 with a vendor extension for ownership rules, instead of the bespoke schema.
3. Add attribute-based conditions (time, status, delegated access) and multi-parameter paths.
4. Persist runs with signed provenance so a retest can prove which build was tested (the in-memory comparison added in October 2026 is the first step: it keeps one previous run and diffs findings and verdicts, but nothing survives a refresh).

## Honest boundaries

This is an educational simulator. It does not make anyone a penetration tester; it demonstrates that the candidate can model authorization, generate negative tests, and explain findings to engineers and managers.
