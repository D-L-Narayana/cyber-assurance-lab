# Interview guide — Tierline

_Purpose:_ preparation material written during the AI-assisted build. It describes how the code works and what happened while building it; it is not a record of the candidate's existing knowledge. Study it against the code before presenting the project.

## The engine in two minutes

Eight intake questions with weights that sum to 100; each option is worth 0–4 points, so a vendor's inherent score is a weighted percentage. Two thresholds cut the score into tiers, and two hard triggers can only push a tier *up* — "regulated data plus privileged access is always tier 1" is a policy statement, not a sum. Sensitivity analysis brute-forces every alternative answer (8 questions × ≤ 4 options = ≤ 32 evaluations) and lists the ones that change the tier; the quadrant draws them as hollow dots so a reviewer sees how fragile a classification is. Each tier has evidence requirements with validity windows; newest evidence of a type wins and the requirement's window caps it. Coverage is the average credit (exceptions count half) and residual is inherent × (1 − 0.6 × coverage). The queue is a flat list of concrete to-dos with a priority formula, not a dashboard gauge.

## One failure case

"Mooring Line Insurance Brokers" sits at exactly 35 — tier 2 by a hair. The UI said it was "0.01 points above the boundary" because 0.01 had been added to make the number non-zero; that is dishonest arithmetic. It now says 0 and "any decrease moves it down", which is what a reviewer needs to know.

## Why these tests

Inclusive thresholds are tested at the exact boundary and 0.01 below because an off-by-one here reclassifies real vendors. Month arithmetic is tested on Jan 31 → Feb 28/29 because naive `setMonth` overflows into March. The "quiet vendor" test proves the queue is empty when nothing is wrong — a queue that always has items trains people to ignore it. The fixture test asserts that every planned defect is actually surfaced.

## Be ready to answer

- Why score unanswered questions at maximum? (Unknown ≠ zero risk; it forces the questionnaire to be completed.)
- Why do exceptions count half rather than full or zero? (A time-boxed, approved exception is risk acceptance, not assurance; half keeps it visible in the residual.)
- Why is "SOC 2" only an example? (It is an AICPA attestation framework; the app has no opinion on which report a vendor should hold.)
- **How does the forecast know what will lapse without simulating every day?** (Added October 2026. Every date comparison in the requirement logic flips on a handful of known dates: an evidence item's `issuedOn` and its expiry + 1, an exception's expiry + 1 and expiry − 180 days. Between those dates the state is constant, so `forecastQueue` collects them per requirement, sorts them, and re-evaluates the requirement only at those points, reporting the first one where credit falls. That is exact, costs a few evaluations per requirement, and reuses the live `requirementResult` logic rather than a second implementation that could drift from it. It only forecasts requirements that earn credit today — anything already lapsed is the live queue's job — and a future-dated item that becomes usable before the current one expires cancels the lapse.)
- What is missing for real TPRM? Below.

## Production next steps

Inherent and residual history per vendor; vendor-supplied questionnaire scoring; document hashing and expiry reminders; approval workflow for exceptions; concentration risk across the portfolio; export to a GRC platform's import format (vendor-neutral).
