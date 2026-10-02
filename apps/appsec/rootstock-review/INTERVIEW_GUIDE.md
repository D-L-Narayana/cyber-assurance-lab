# INTERVIEW GUIDE — Rootstock Review

## Core engine in two minutes

Resolution first: each declared range binds to the highest snapshot version that satisfies it, which is how two versions of `colourkit` end up in one tree and how an unsatisfiable range becomes an unresolved edge instead of silently vanishing. Then review per node: advisories by semver range; licence by SPDX-style policy lookup; reachability as an import-evidence hint; flags for install scripts, deprecation and duplicate versions. The plan looks for the lowest registry version above the current one that satisfies every patched range, and then asks each parent whether its range accepts that version — the answer is the difference between "refresh the lockfile" and "someone upstream has to move".

## One failure case

`colourkit@0.9.2` under `uikit@3.2.4`. Advisory SYN-2026-0002 (`<1.0.0`, patched `>=1.0.0`). Target is 1.0.0, but uikit declares `~0.9.0`, which means `>=0.9.0 <0.10.0`, so the fix cannot be installed without changing uikit. The snapshot shows uikit 3.3.0 exists — but it does not record 3.3.0's dependency ranges, so the tool says "check", not "upgrade uikit". Meanwhile `colourkit@2.3.1` under `formatlib` is clean but deprecated. Walk through why a naive "upgrade colourkit" instruction would fail and why the plan names the parent.

## Why the tests look like this

* Semver has sixteen targeted assertions because every later verdict depends on `satisfies`; the 0.x caret cases (`^0.9.0` excludes 0.10.0; `^0.0.3` excludes 0.0.4) are the ones people get wrong.
* The graph test pins the exact unresolved edge and both parents of each `colourkit` version so refactors cannot quietly change resolution.
* Plan tests assert the exact `blockedBy` entry and that the detail mentions the newer parent version — the explanation is the product.
* The reachability test asserts the "not exploitability" note exists in the output, because the label is only safe with that caveat attached.

## A reviewer-found bug worth telling

The first licence evaluator stripped parentheses and split on `OR` first, so `(MIT OR Apache-2.0) AND GPL-3.0-only` became `MIT` | `Apache-2.0 AND GPL-3.0-only` → allow. An independent council reproduced it. The replacement is a small precedence parser that fails closed; seven regression tests (grouping, precedence, nested groups, malformed strings, `WITH`, bounds, explanation text) were written first and four failed at assertion level before the fix. Lesson: in a policy engine, a parser shortcut is a fail-open bug.

## Production next steps

1. Importers for `package-lock.json` v3 and CycloneDX/SPDX SBOMs, mapping into the same internal snapshot.
2. Replace the synthetic advisory list with an offline OSV export loaded by the user (still no live calls from the browser).
3. Multi-level plan search: walk parent versions whose manifests are available to find a consistent upgrade set.
4. Optional static import analysis to upgrade "inferred" to "called" where a call graph is available.

## Honest boundaries

Educational. Demonstrates dependency-risk reasoning and explanation, not operation of a commercial SCA tool or any claim about real packages.
