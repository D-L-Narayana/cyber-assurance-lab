# INTERVIEW GUIDE — Seamline

## Core engine in two minutes

A scenario is a time-ordered list of client messages. A tamper layer (an attacker who owns the device or the channel) edits copies of them. One server state machine runs under two policies: trusting (use what arrived) or enforcing (derive prices, discounts, points and roles from server state; verify freshness, nonce single-use and object ownership). A step is rejected if any run check fails, neutralized if client values were overridden, otherwise accepted. The oracle is policy-independent: any tampered step that lands as "accepted" is a finding with a CWE.

## One failure case

Step s6, reward replay. The client re-sends s5's nonce and payload with a fresh timestamp. Trusting server: no nonce ledger, so the reward is redeemed twice and Maya's balance goes 150 → 30 → −90; finding CWE-294. Enforcing server: `nonce-single-use` fails, the step is rejected, balance stays 30, `pointsCharged = 0`. Then explain why freshness alone (s10, backdated by ten minutes) is a separate check and why both are needed: a replay inside the window would pass freshness but not single-use; a stale message with a fresh nonce would pass single-use but not freshness.

## Why the tests look like this

* The enforcing server must accept every untampered step — tested explicitly, because an "enforcing" model that rejects legitimate traffic is a different bug.
* The ledger test asserts balances across steps so that replay handling is checked by its consequence, not only by the decision label.
* Determinism is asserted with deep equality of two full runs.
* Two GREEN-phase corrections are recorded: the nesting cap (6) was tighter than the schema's legitimate depth (7), raised to 8; and rejected redemption steps initially reported no balance — the ledger view now always carries `balanceAfter`.

## A reviewer-found bug worth telling

The first oracle was "tampered and accepted ⇒ finding", keyed on the script's `tamper` flag. A reviewer sent an *untampered* step whose payload simply said `total: 0.5`; the trusting server billed 0.50 with no finding, because nobody had labelled it. The oracle was rewritten to compare client claims with server truth for every step (price, discount, points, role, owner, nonce, timestamp) and to raise findings from those divergences; tamper labels became annotations. Regression tests were written first; the fixture's six findings are unchanged because they were real divergences all along.

## Production next steps

1. Replace the JSON client with recorded traffic from an authorised test build and keep the tamper layer as a proxy plugin.
2. Add request signing with a device-bound key and show how it changes the origin of `nonce`/`ts` to "attested".
3. Model concurrency (two replays racing) to motivate idempotency keys stored transactionally.
4. Export findings in a ticket-friendly format with the enforcing-model control as the remediation.

## Honest boundaries

Educational. Demonstrates the reasoning behind server-side enforcement and replay protection, not mobile penetration-testing experience.
