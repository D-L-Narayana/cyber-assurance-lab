# Seamline — client / server trust-boundary simulator

**Educational prototype (October 2026).** Seamline shows, one message at a time, what happens at the seam between an untrusted client and a server. A scripted sequence of synthetic "mobile app" events passes through a tamper layer (price rewrites, inflated discounts, replayed nonces, client-asserted roles, swapped object ids, backdated timestamps) into one of two server models: a **trusting** server that believes what it receives, and an **enforcing** server that derives every security-relevant value from its own state. The difference between the two is the lesson. The client is JSON, the servers are functions, and nothing here is a mobile or API penetration test.

## The problem

Client/server assessments keep finding the same family of flaws: the server used the price, discount, points, role or object id the client sent. They are easy to describe and hard to *see*. Seamline makes the trust boundary visible: each field is coloured by who actually decides its value, each check is listed as run/skipped/failed, and the same event is shown under both server models side by side.

## Key workflows

1. **Scrub through the Brewline scenario** (11 events, 6 tampered). The diagram shows the message as composed on the client, the seam, and the message as received with origins: *client-controlled*, *server-derived*, *session-derived*, and tampered fields struck through in red.
2. **Flip the server mode.** Under the trusting server tampered steps are **accepted** and each raises a CWE-mapped finding; under the enforcing server they are **neutralized** (accepted with server-derived values) or **rejected** by a named check, and no finding is raised. Untampered steps are accepted by both (no false positives).
3. **Read the checks.** `session-valid`, `timestamp-window`, `nonce-single-use`, `price-from-catalog`, `coupon-from-table`, `points-from-table`, `sufficient-balance`, `role-from-session`, `object-ownership` — each with a one-line explanation of what it compared.
4. **Compare both servers** in the table; click a row to jump the scrubber.
5. **Import** a synthetic scenario (bounded JSON) and **export** a JSON report (`seamline.report/1`, tokens redacted) or a Markdown review with the comparison table and findings.

## Quickstart

```bash
npm ci
npm test        # vitest, 14 engine tests
npm run build   # tsc --noEmit + vite build → dist/
npm run dev     # http://localhost:6113
```

Node 20+. No environment variables, backend or storage; state resets on refresh.

## Algorithm

* **Scenario** (`scenario.ts`): users with session roles, a price catalog, coupon table, orders, rewards and point balances, plus ordered steps `{client: {user, event, nonce, tOffset, payload}, tamper?}`. Validation enforces schema, per-event payload shapes, known references, monotonic time, replay-of-earlier-step, byte/step/nesting limits and finite numbers.
* **Tamper layer** (`tamper.ts`): pure edits to a copy of the message, returning the list of changed fields. Replay copies nonce and payload from an earlier step.
* **Servers** (`simulate.ts`): one state machine with two policies. Generic boundary checks (freshness window ±120 s, nonce ledger) and event-specific checks. In enforcing mode prices, discounts, points and roles come from server state; ownership is verified for object reads. Decision: `rejected` if any run check failed, `neutralized` if client values were overridden, else `accepted`.
* **Oracle — divergence, not labels.** For every step, in both modes, the engine compares the security-relevant claims in the received message with what the server can establish itself: price vs catalog, discount vs coupon table, points vs reward table, asserted role vs session role, order owner vs session, nonce vs the ledger of nonces already seen, timestamp vs the server clock. Each disagreement is a recorded `divergence`. A **finding** exists only when a step is `accepted` while at least one divergence is present; the finding's CWE is chosen by the highest-priority violated invariant (ownership → CWE-639, role → CWE-269, nonce/freshness → CWE-294, price/discount/points → CWE-602). The script's `tamper` labels only annotate how a divergent message was produced; an untampered step whose client simply states a wrong total is flagged exactly the same way, and a tamper label that produces no actual divergence raises nothing. The scenario is **scripted**: the tool illustrates known weakness classes and does not discover arbitrary flaws.
* The nonce ledger is server truth in both modes (the trusting policy just does not consult it). A message rejected for freshness still consumes its nonce — a deliberate conservative choice; a legitimate retry must carry a fresh nonce.

## Architecture

```
src/engine/  types · scenario (validation) · tamper · simulate (both server models + oracle) · report
src/fixtures/brewline-scenario.json
src/App.tsx  diagram (client | seam | server), scrubber, comparison table, import panel
```

## Tests

`src/engine/__tests__/seamline.test.ts` — 17 tests (three added after the sixth-Fable review: untampered divergent total is flagged, divergences recorded per step, tamper label without divergence raises nothing): fixture acceptance; rejection of unknown tamper kinds, unknown users, duplicate ids, replay of a later step, oversized documents, too many steps, negative prices and `1e999`; tamper-layer behaviour (price rewrite, replay copying nonce/payload, immutability of the original); trusting server accepts all and charges client totals, produces exactly six CWE-mapped findings, labels fields client-controlled; enforcing server neutralizes price/coupon/role, rejects replay/backdate/cross-user with named checks, accepts all untampered steps with zero findings, and keeps the points ledger consistent (one redemption, not two; the trusting server goes to −90); determinism; report schema and token redaction. See `EVIDENCE.md`.

## Data handling and safety

* No device data, no network, no storage, no analytics. Session tokens in the fixture are placeholders and are still redacted on export as `[token:<user>]`.
* Scenario input is bounded (96 KB UTF-8, 60 steps, 12 users, 40 catalog items, 10 lines per order, nesting ≤ 8) and validated iteratively.
* Exports are JSON/Markdown only.

## Limitations and unsupported cases

* No real mobile client, transport, TLS, certificate pinning, device attestation or signature scheme is modelled; the "token" is symbolic. Tamper resistance on the device is explicitly out of scope — the point is that the server must not depend on it.
* Seven tamper kinds and five event types; the scenario format does not express branching or concurrency.
* The freshness window and nonce ledger are illustrative controls, not a replay-protection design recommendation for a specific protocol.
* Findings cover the seven modelled invariants only; a claim outside them (e.g. a quantity the server would never verify) produces no divergence. The tool does not discover unknown weaknesses.

## JD evidence (truthful framing)

Demonstrates client/server (mobile-style) application-security reasoning: trust-boundary analysis, server-side enforcement, replay and freshness controls, object ownership, and the ability to explain each weakness with a CWE reference and a concrete server-side fix. It is not evidence of mobile penetration-testing experience against real applications. Mapping context: OWASP Mobile Top 10 (2024) lists insecure authentication/authorization and insufficient input/output validation among its risks; CWE-602 names the underlying pattern.

## AI-assistance disclosure

Built in October 2026 with AI assistance for code drafting under a human-directed plan. `INTERVIEW_GUIDE.md` lists what the author should explain unaided.

## References

* CWE-602 Client-Side Enforcement of Server-Side Security: https://cwe.mitre.org/data/definitions/602.html
* CWE-294 Authentication Bypass by Capture-replay: https://cwe.mitre.org/data/definitions/294.html
* CWE-639 Authorization Bypass Through User-Controlled Key: https://cwe.mitre.org/data/definitions/639.html
* OWASP Mobile Top 10 (2024 final release): https://owasp.org/www-project-mobile-top-10/2023-risks/

License: MIT. Third-party notices in `THIRD_PARTY_NOTICES.md`.
