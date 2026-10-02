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

## Production next steps

1. Import from a real IdP/IGA export read-only, with pseudonymised identities.
2. Add permission hierarchies and resource-attribute conditions; model time-bound and break-glass access.
3. Replace path-count hotspots with centrality metrics plus usage telemetry.
4. Turn "apply removal" into a change request with approval and rollback, never a direct write.
5. Scale traversal (memoised group closures, incremental recomputation) and add a persisted review log.
