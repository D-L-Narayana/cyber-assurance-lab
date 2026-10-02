# Interview guide — Ruleshadow

> Rehearsal script, written in the first person for the candidate to practise. It describes how the engine works and why; it is not a record of work the candidate has already performed or reviewed. Rehearse it against the code before presenting.

## Core engine
A rule's match space is source interval × destination interval × protocol set × port intervals × zones. Shadowing asks: is this rule's whole match space already consumed by earlier rules? Containment on source/destination/zones/protocols is a cheap filter; the only dimension where several earlier rules commonly combine is ports, so I subtract each covering rule's port intervals from the candidate's remaining port space. An empty remainder with same-action rules is `redundant`; with opposite-action rules it is `conflict`. Running the subtraction separately for the two action classes is what makes the two findings precise rather than "something earlier overlaps".

## One failure case
The first implementation flagged a rule as shadowed only when a *single* earlier rule contained it. The fixture then missed the classic case of two earlier rules covering 80–200 and 201–443 with a later 80–443 rule. The union test (`detects shadowing by the union of several earlier rules`) forced the subtraction approach. Equally important, the partial-overlap test guarantees that 80–200 does not shadow 80–443 — reviewers lose trust fast when a tool over-reports.

## A second failure case, found in review
The first shadow pass subtracted *every* containing earlier rule's ports, including rules that were themselves dead. With `A deny any`, `B allow any`, `C allow 443`, C was labelled redundant "because of B" even though the operative earlier decision is A's deny. The fix walks earlier containing rules in first-match order and lets each contribute only the port space it still owns — B contributes nothing, so C is correctly a conflict with A. The same walk makes mixed-action coverage explicit ("80–200 denied by A; 201–443 allowed by B").

## A third refinement from review
My first proposal set "resolved" an any/any allow by narrowing ports to 80,443 — which still left any→any and would have shown a misleadingly cleaner re-analysis. The honest answer is that the engine cannot know the right source/destination scope, so overbroad findings now carry a manual-review proposal with no automatic change, and VPN narrowing only happens when the reviewer supplies a jump host. Stale expiries are derived from the review date instead of a hard-coded day. A follow-up probe then showed that *any* valid CIDR was accepted as the jump host — `0.0.0.0/0` would have turned a `/8` rule into any — so the supplied destination must now be a strict subset (contained and smaller) of the current one.

## Why the tests look like this
Network primitives are pinned with exact integers (10.0.0.0/8 → 167,772,160–184,549,375) because an off-by-one on host bits silently breaks every finding. Each finding kind has a positive and a negative. The CSV import tests check that errors carry line numbers and that limits are enforced, since import is the only untrusted input. CSV export is tested for formula neutralisation because findings go to spreadsheets.

## Next steps in production
Address and service objects/groups, IPv6, vendor parsers (iptables/nftables, Cisco ASA, Palo Alto XML), hit-count integration, partial-shadow percentages, and a policy-as-code check that fails a change request when it introduces a conflict or an any/any allow.
