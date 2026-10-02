# Interview guide — Peerline

> Rehearsal script, written in the first person for the candidate to practise. It describes how the engine works and why; it is not a record of work the candidate has already performed or reviewed. Rehearse it against the code before presenting.

## Core engine
For each user and day type I compute the median and MAD of each feature over active training days. The robust z is `0.6745·(x−median)/max(MAD, floor)`; 0.6745 makes MAD comparable to a standard deviation for normal data, and the floor stops a constant baseline (MAD = 0) from turning a +1 change into infinity. Each feature that clears z ≥ 3.5 adds `weight × min(3, z/3.5)`; the cap keeps one absurd value from dominating while still letting an extreme single feature alert. Peer deviation compares the user's own median to the distribution of their department's medians and only fires when the user is *not* spiking against themselves — that is the "normal for them, not for the group" case.

## One failure case
The first version counted inactive weekend days as evidence. Non-weekend workers then had weekend medians of zero, and any Saturday activity (e.g. 60 MB) produced z ≈ 8 — three false positives in a week. The fix was conceptual, not numeric: inactive days are not behavioural evidence, so baselines use active days only, and a day type with fewer than 5 active days falls back to the other day type with a visible flag, or becomes an explicit `unscored` state.

## Why the tests look like this
`median/MAD` and the z formula are unit-tested with hand-computable values. Behavioural tests pin the weekday/weekend separation, the NO_BASELINE state, peer deviation without own-spike, and that feedback suppression lowers the score deterministically. The evaluation test asserts a *measured* floor (recall ≥ 0.8, precision ≥ 0.5) on the fixed seed and records the real values rather than claiming perfection.

## Next steps in production
Seasonality beyond day type (pay cycles, quarter ends), per-group thresholds, calibrated weights from labelled history, drift handling when baselines move, and strict governance: purpose limitation, access logging and a documented policy before any real identity is ever processed.
