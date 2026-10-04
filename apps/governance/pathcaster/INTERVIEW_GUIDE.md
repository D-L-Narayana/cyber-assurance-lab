# INTERVIEW GUIDE — Pathcaster

## Core engine in two minutes

Access questions are graph questions. An identity reaches an asset if there is a path identity → groups (nested) → role → permission → asset and every condition on that path holds for the identity's attributes. Pathcaster enumerates those paths with a bounded depth-first search and a per-path visited set so membership cycles cannot loop. Then it applies deny-overrides: it collects every `deny` edge from the identity or any of its transitive groups and, if one targets the asset or a permission the paths actually used, the verdict flips to `deny` — but the paths are kept, because "would have had access except for this deny" is exactly what a reviewer needs to see. Hotspots and toxic combinations re-use the same `reach` function across assets and rule pairs; what-if removes one edge and diffs the allowed sets.

## One failure case

My first unit fixture tried to create a membership cycle by adding `All staff → Engineering`. Reasoning through it before implementing, I realised that would make *every* identity a transitive member of Engineering, so the "Engineering must never reach payroll" deny would block everyone and the SoD tests would be meaningless. In a nested-group model one careless edge silently changes semantics for the whole organisation — which is precisely why the hotspot view exists: a stale group like "Legacy admins (2019)" nested under platform engineers is the realistic version of that mistake, and the demo seeds it.

## Why the tests look like this

- Deny-override is tested on an identity that *has* allow paths, so the test proves override rather than absence.
- ABAC is tested twice: a failing condition (service account) and a flipped attribute (MFA false) that turns `allow` into `none`.
- The cycle test checks termination *and* the exact transitive set.
- What-if is tested in both directions: removing an assignment loses access; removing a deny gains it.
- Validation enumerates each structural error class separately.

## Q: Why is the permission hierarchy an option rather than the default, and how do denies interact with it?

Because it changes what a verdict means. Without it, "who can read the vault?" is answered by `read` permissions only — the literal graph. Real products usually treat admin as implying write and read, so a reviewer asking that question literally would miss every admin. Making it the default would silently widen every existing review and every documented test expectation, so it is an explicit query option, off by default, threaded through `reach`, `toxicCombinations`, `whatIfRemoveEdge` and the export (`query.hierarchy`) so a saved review states which semantics it used. The implementation is one predicate at the asset step of the search: a permission's action satisfies the query if it is equal, or stronger under the fixed order admin ⊃ write ⊃ read when the option is on — nothing is ever implied upwards. Denies needed no change: the path records the permission node actually used, and deny hits are computed over those permissions, so an identity whose only route to `read` is an `admin` permission with a deny on it is `deny`, not `allow`. The tests pin both directions on a four-identity graph (admin-only, write-only, read-only, denied admin), check that `any` queries and hotspots are unchanged, that what-if counts follow the option, and that on the shipped fixture the option can only widen the allowed set, never narrow it.

## Production next steps

1. Import from a real IdP/IGA export read-only, with pseudonymised identities.
2. Add permission hierarchies and resource-attribute conditions; model time-bound and break-glass access.
3. Replace path-count hotspots with centrality metrics plus usage telemetry.
4. Turn "apply removal" into a change request with approval and rollback, never a direct write.
5. Scale traversal (memoised group closures, incremental recomputation) and add a persisted review log.
