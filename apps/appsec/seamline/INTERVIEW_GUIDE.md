# INTERVIEW GUIDE — Seamline

## Core engine in two minutes

A scenario is a time-ordered list of client messages. A tamper layer (an attacker who owns the device or the channel) edits copies of them. One server state machine runs under two policies: trusting (use what arrived) or enforcing (derive prices, discounts, points and roles from server state; verify freshness, nonce single-use and object ownership; validate the quantities the client is entitled to choose). A step is rejected if any run check fails, neutralized if client values were overridden, otherwise accepted. The oracle is policy-independent: any step whose claims diverge from server truth and still lands as "accepted" is a finding with a CWE.

## One failure case

Step s6, reward replay. The client re-sends s5's nonce and payload with a fresh timestamp. Trusting server: no nonce ledger, so the reward is redeemed twice and Maya's balance goes 150 → 30 → −90; finding CWE-294. Enforcing server: `nonce-single-use` fails, the step is rejected, balance stays 30, `pointsCharged = 0`. Then explain why freshness alone (s10, backdated by ten minutes) is a separate check and why both are needed: a replay inside the window would pass freshness but not single-use; a stale message with a fresh nonce would pass single-use but not freshness.

## Why the tests look like this

* The enforcing server must accept every untampered step — tested explicitly, because an "enforcing" model that rejects legitimate traffic is a different bug.
* The ledger test asserts balances across steps so that replay handling is checked by its consequence, not only by the decision label.
* Determinism is asserted with deep equality of two full runs.
* The quantity tests pin the exact divergence text (`beans-1kg × -1` vs `beans-1kg: integer 1–5`), the enforcing summary (5 accepted / 3 neutralized / 4 rejected / 0 findings) and that a `quantity-rewrite` within range raises nothing — the invariant must not become a false-positive generator.
* Two GREEN-phase corrections are recorded: the nesting cap (6) was tighter than the schema's legitimate depth (7), raised to 8; and rejected redemption steps initially reported no balance — the ledger view now always carries `balanceAfter`.

## A reviewer-found bug worth telling

The first oracle was "tampered and accepted ⇒ finding", keyed on the script's `tamper` flag. A reviewer sent an *untampered* step whose payload simply said `total: 0.5`; the trusting server billed 0.50 with no finding, because nobody had labelled it. The oracle was rewritten to compare client claims with server truth for every step (price, discount, points, role, owner, nonce, timestamp) and to raise findings from those divergences; tamper labels became annotations. Regression tests were written first; the fixture's six findings at the time were unchanged because they were real divergences all along (a seventh, quantity-bounds, was added in October 2026).

## Q: Why is `quantity-bounds` a different kind of invariant from the other seven, and how did you keep it honest?

**A.** Every earlier invariant is a value the server can *derive* — the price is in the catalog, the role is in the session, the owner is on the order — so the enforcing model's fix is "ignore the client and recompute". A quantity is different: the customer genuinely chooses it, so there is nothing to derive; the server's only defence is **validation** against a bound it owns (positive integer ≤ the item's `maxQty`, default 99). That is why the enforcing check is called `quantity-valid`, why it *rejects* instead of neutralising (there is no correct value to substitute), and why the finding on the trusting side is CWE-20 Improper Input Validation rather than CWE-602. The honest parts: (1) the importer stopped rejecting `qty: 0` or `-1` — a schema that silently refuses invalid quantities would hide the exact weakness the tool exists to show, so the schema now only bounds magnitude and the server judges; (2) the tamper (`quantity-rewrite`, default `-1`) recomputes the total from the client's *own* unit prices, so the message is internally consistent and only the quantity bound diverges — otherwise price-from-catalog would fire first and mask the new invariant; (3) the invariant sits last in the priority list, and a test pins that when both price and quantity diverge the finding is still CWE-602; (4) an untampered step with `qty: 0` is flagged with the identical finding shape — divergence, not label — and the enforcing server still accepts every untampered step of the fixture with zero findings. The fixture's twelfth step shows the trusting server "charging" −28.00 for a kilo of beans.

## Production next steps

1. Replace the JSON client with recorded traffic from an authorised test build and keep the tamper layer as a proxy plugin.
2. Add request signing with a device-bound key and show how it changes the origin of `nonce`/`ts` to "attested".
3. Model concurrency (two replays racing) to motivate idempotency keys stored transactionally.
4. Export findings in a ticket-friendly format with the enforcing-model control as the remediation.

## Honest boundaries

Educational. Demonstrates the reasoning behind server-side enforcement and replay protection, not mobile penetration-testing experience.
