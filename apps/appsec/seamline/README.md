# Seamline — client / server trust-boundary simulator

**Educational prototype (October 2026).** Seamline shows, one message at a time, what happens at the seam between an untrusted client and a server. A scripted sequence of synthetic "mobile app" events passes through a tamper layer (price rewrites, inflated discounts, replayed nonces, client-asserted roles, swapped object ids, backdated timestamps, rewritten quantities) into one of two server models: a **trusting** server that believes what it receives, and an **enforcing** server that derives every security-relevant value from its own state and validates the ones it cannot derive. The difference between the two is the lesson. The client is JSON, the servers are functions, and nothing here is a mobile or API penetration test.

## The problem

Client/server assessments keep finding the same family of flaws: the server used the price, discount, points, role or object id the client sent — or took a quantity of `-1` at face value. They are easy to describe and hard to *see*. Seamline makes the trust boundary visible: each field is coloured by who actually decides its value, each check is listed as run/skipped/failed, and the same event is shown under both server models side by side.

## Key workflows

1. **Scrub through the Brewline scenario** (12 events, 7 tampered). The diagram shows the message as composed on the client, the seam, and the message as received with origins: *client-controlled*, *server-derived*, *session-derived*, and tampered fields struck through in red.
2. **Flip the server mode.** Under the trusting server tampered steps are **accepted** and each raises a CWE-mapped finding; under the enforcing server they are **neutralized** (accepted with server-derived values) or **rejected** by a named check, and no finding is raised. Untampered steps are accepted by both (no false positives).
3. **Read the checks.** `session-valid`, `timestamp-window`, `nonce-single-use`, `quantity-valid`, `price-from-catalog`, `coupon-from-table`, `points-from-table`, `sufficient-balance`, `role-from-session`, `object-ownership` — each with a one-line explanation of what it compared.
4. **Compare both servers** in the table; click a row to jump the scrubber.
5. **Import** a synthetic scenario (bounded JSON) and **export** a JSON report (`seamline.report/1`, tokens redacted) or a Markdown review with the comparison table and findings.

## Quickstart

```bash
npm ci
npm test        # vitest, 25 engine tests
npm run build   # tsc --noEmit + vite build → dist/
npm run dev     # http://localhost:6113
```

Node 20.19+. No environment variables, backend or storage; state resets on refresh.

## Algorithm

* **Scenario** (`scenario.ts`): users with session roles, a price catalog (each item optionally carrying `maxQty`, an integer 1–10 000; default 99), coupon table, orders, rewards and point balances, plus ordered steps `{client: {user, event, nonce, tOffset, payload}, tamper?}`. Validation enforces schema, per-event payload shapes, known references, monotonic time, replay-of-earlier-step, byte/step/nesting limits and finite numbers. Client-stated line quantities are *untrusted input*: the schema only bounds their magnitude (|qty| ≤ 1 000 000, finite), so a scenario may legitimately carry a zero, negative or fractional quantity — judging it is the server's job, not the importer's.
* **Tamper layer** (`tamper.ts`): pure edits to a copy of the message, returning the list of changed fields. Replay copies nonce and payload from an earlier step. `quantity-rewrite` sets the first order line's `qty` to `tamper.value` (default `-1`, a negative quantity that turns the order into a credit) and recomputes `total` from the client's own unit prices, so the message stays internally consistent and only the quantity bound is violated.
* **Servers** (`simulate.ts`): one state machine with two policies. Generic boundary checks (freshness window ±120 s, nonce ledger) and event-specific checks. In enforcing mode prices, discounts, points and roles come from server state; ownership is verified for object reads; and quantities — which the client legitimately chooses, so they cannot be derived — are **validated** (`quantity-valid`: positive integer ≤ the item's `maxQty`) before the order is priced; an invalid line rejects the order (`orderCreated = false`). Decision: `rejected` if any run check failed, `neutralized` if client values were overridden, else `accepted`.
* **Oracle — divergence, not labels.** For every step, in both modes, the engine compares the security-relevant claims in the received message with what the server can establish itself: price vs catalog, discount vs coupon table, points vs reward table, asserted role vs session role, order owner vs session, nonce vs the ledger of nonces already seen, timestamp vs the server clock, and each line quantity vs the allowed range (positive integer ≤ `maxQty`). Each disagreement is a recorded `divergence`. A **finding** exists only when a step is `accepted` while at least one divergence is present; the finding's CWE is chosen by the highest-priority violated invariant (ownership → CWE-639, role → CWE-269, nonce/freshness → CWE-294, price/discount/points → CWE-602, quantity bounds → CWE-20, lowest priority). The script's `tamper` labels only annotate how a divergent message was produced; an untampered step whose client simply states a wrong total — or a quantity of 0 — is flagged exactly the same way, and a tamper label that produces no actual divergence raises nothing. The scenario is **scripted**: the tool illustrates known weakness classes and does not discover arbitrary flaws.
* The nonce ledger is server truth in both modes (the trusting policy just does not consult it). A message rejected for freshness still consumes its nonce — a deliberate conservative choice; a legitimate retry must carry a fresh nonce.

## Architecture

```
src/engine/  types · scenario (validation) · tamper · simulate (both server models + oracle) · report
src/fixtures/brewline-scenario.json
src/App.tsx  diagram (client | seam | server), scrubber, comparison table, import panel
```

## Tests

`src/engine/__tests__/seamline.test.ts` — **25 tests** (`Tests  25 passed (25)`): three were added after an independent review round on 1 October 2026 (untampered divergent total is flagged, divergences recorded per step, tamper label without divergence raises nothing) and eight in the October 2026 upgrade round for the eighth invariant. Coverage: fixture acceptance; rejection of unknown tamper kinds, unknown users, duplicate ids, replay of a later step, oversized documents, too many steps, negative prices and `1e999`; tamper-layer behaviour (price rewrite, replay copying nonce/payload, immutability of the original); trusting server accepts all and charges client totals, produces exactly seven CWE-mapped findings, labels fields client-controlled; enforcing server neutralizes price/coupon/role, rejects replay/backdate/cross-user/invalid-quantity with named checks, accepts all untampered steps with zero findings, and keeps the points ledger consistent (one redemption, not two; the trusting server goes to −90); determinism; report schema and token redaction. Quantity-bounds: `maxQty` validation (integer 1–10 000, optional), `quantity-rewrite` validation (place-order only, optional finite `value`), client quantities outside 1–`maxQty` accepted at import but magnitude-bounded, the tamper edit itself (default −1, total recomputed, original untouched), trusting server accepting a −28.00 "order" with a CWE-20 finding, enforcing server rejecting it via `quantity-valid` without creating the order (summary 5 / 3 / 4 / 0), an **untampered** qty-0 step flagged identically (same finding shape, "No tamper annotation" in the detail), per-item `maxQty` versus the default 99, fractional quantities, and price outranking quantity when both diverge. See `EVIDENCE.md`.

## Data handling and safety

* No device data, no network, no storage, no analytics. Session tokens in the fixture are placeholders and are still redacted on export as `[token:<user>]`.
* Scenario input is bounded (96 KB UTF-8, 60 steps, 12 users, 40 catalog items, 10 lines per order, nesting ≤ 8, quantities and `tamper.value` finite with magnitude ≤ 1 000 000, `maxQty` ≤ 10 000) and validated iteratively.
* Exports are JSON/Markdown only.

## Limitations and unsupported cases

* No real mobile client, transport, TLS, certificate pinning, device attestation or signature scheme is modelled; the "token" is symbolic. Tamper resistance on the device is explicitly out of scope — the point is that the server must not depend on it.
* Eight tamper kinds and five event types; the scenario format does not express branching or concurrency.
* The freshness window and nonce ledger are illustrative controls, not a replay-protection design recommendation for a specific protocol.
* Findings cover the eight modelled invariants only; a claim outside them produces no divergence. Quantity bounds are checked per line against the catalog's `maxQty`; stock levels, per-customer limits and duplicate SKUs across lines are not modelled. The tool does not discover unknown weaknesses.
* The oracle maps each invariant to one CWE; a negative quantity accepted by a trusting server is reported as CWE-20 (improper input validation) even though the business impact (a credit instead of a charge) might also be described as CWE-840 or CWE-602 in a real report.

## JD evidence (truthful framing)

Demonstrates client/server (mobile-style) application-security reasoning: trust-boundary analysis, server-side enforcement and input validation, replay and freshness controls, object ownership, and the ability to explain each weakness with a CWE reference and a concrete server-side fix. It is not evidence of mobile penetration-testing experience against real applications. Mapping context: OWASP Mobile Top 10 (2024) lists insecure authentication/authorization and insufficient input/output validation among its risks; CWE-602 names the underlying pattern.

## AI-assistance disclosure

Built in October 2026 with AI assistance for code drafting under a human-directed plan; the quantity-bounds invariant and its tests were added the same way. `INTERVIEW_GUIDE.md` lists what the author should explain unaided.

## References

* CWE-602 Client-Side Enforcement of Server-Side Security: https://cwe.mitre.org/data/definitions/602.html
* CWE-294 Authentication Bypass by Capture-replay: https://cwe.mitre.org/data/definitions/294.html
* CWE-639 Authorization Bypass Through User-Controlled Key: https://cwe.mitre.org/data/definitions/639.html
* CWE-20 Improper Input Validation: https://cwe.mitre.org/data/definitions/20.html
* OWASP Mobile Top 10 (2024 final release): https://owasp.org/www-project-mobile-top-10/2023-risks/

License: MIT. Third-party notices in `THIRD_PARTY_NOTICES.md`.
