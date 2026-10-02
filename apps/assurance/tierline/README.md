# Tierline — third-party risk segmentation and review queue

**Educational prototype. Synthetic vendors only. The scoring model is a custom heuristic, not a published standard or regulatory classification.**

Tierline helps a small vendor-risk team answer three questions with an explainable trail: *how much inherent risk does this vendor carry, which tier does that put them in, and what assurance evidence is missing or about to lapse?* An eight-question inherent-risk questionnaire produces a 0–100 score and a tier (1 = critical, 3 = standard) with hard triggers that override the score. A sensitivity analysis shows every single answer change that would move the tier ("one answer away"). Each tier has evidence requirements with validity windows; coverage, exceptions, expiry and periodic review cadence feed a prioritised review queue.

## Key workflows

1. **Portfolio quadrant** — inherent score (x) vs assurance coverage (y), coloured by tier; the selected vendor shows hollow "ghost" dots where one changed answer would place it.
2. **Vendor detail** — answer the questionnaire with live contributions, read the tier reasons and hard triggers, review the sensitivity flips, see each requirement's state (valid / expiring / expired / missing / exception / exception-expired) and the review cadence.
3. **Evidence and exceptions** — add dated evidence with validity months; add time-boxed exceptions approved by a named role (they count half and expire).
4. **Review queue** — nine item kinds (missing, expired, expiring, exception expired/expiring, review overdue/due soon, tier drift, incomplete questionnaire) ordered by priority; filter by kind or vendor; export CSV.
5. **Change the assessment date** to see what lapses; import/export the register (`tierline.register/1`) or the full assessment JSON.

## Quickstart

```bash
npm ci
npm test          # vitest, 29 tests
npm run build
npm run preview   # http://127.0.0.1:6122/
```

## Algorithm (custom educational heuristic)

| Element | Rule |
|---|---|
| Questionnaire | 8 questions, weights 25/20/20/10/10/5/5/5 (= 100), options scored 0–4. `inherent = Σ weight × points / 4`. Unanswered questions are scored **4** (conservative) and flagged. |
| Tier | ≥ 60 → tier 1; ≥ 35 → tier 2; else tier 3. Hard triggers (never downward): confidential/regulated data **and** persistent privileged access → tier 1; undisclosed subprocessors with personal data or more → at least tier 2. |
| Sensitivity | For every question and every alternative option, recompute the tier; report changes with their score delta, nearest first. Distances to the next boundary up/down are shown (down is `null` when a hard trigger holds the tier). |
| Evidence requirements | Tier 1: assurance report, pen test, BCP/DR test, questionnaire, insurance (12 mo each), DPA (36). Tier 2: assurance report (24), questionnaire (12), DPA (36). Tier 3: questionnaire (24). Newest item of a type wins; the requirement's validity caps the item's own. Expiring = ≤ 60 days left. |
| Exceptions | Active exception for a missing/expired type → state `exception`, credit 0.5, only if it ends within `MAX_EXCEPTION_DAYS = 180` days of the assessment date; a longer one is `exception-out-of-policy`, credit 0, queued. Expired exception → `exception-expired`, credit 0. |
| Future-dated evidence | `issuedOn > asOf` earns nothing (`future-dated`, credit 0, queued as `future-dated-evidence`) and never shadows an older valid item of the same type. The validator still accepts it so the record can be corrected in the app. |
| Coverage / residual | `coverage = Σ credit / requirements`. `residual = inherent × (1 − 0.6 × coverage)`. |
| Cadence | Review due = last review + 12/24/36 months by tier; no review recorded = overdue. |
| Queue priority | `tierWeight(3/2/1) × urgency(3/2/1) + min(daysOverdue/30, 6)`, sorted descending, then vendor name. |

Known limits: no financial/ESG/concentration risk; no questionnaire scoring of vendor *answers* (only our intake answers); evidence is metadata (no document hashing — see Weft); exceptions are not an approval workflow (see Graceline).

## Architecture

```
src/engine/model.ts     questions, thresholds, hard triggers, requirements, cadences, constants
src/engine/assess.ts    scoring, tiering, sensitivity, requirement states, residual, queue, CSV
src/engine/validate.ts  bounded import validation (1 MiB, 200 vendors, 40 evidence / 20 exceptions each)
src/ui/*                React 19: App, Quadrant (SVG), VendorDetail, Queue
src/fixtures/           15 synthetic vendors (qa/make-fixture.mjs regenerates)
tests/engine.test.ts    29 tests
```

Memory-only state; hash deep links (`#/V-08`); self-hosted Archivo + JetBrains Mono (OFL-1.1); hardened `vercel.json`.

## Tests

Model invariants (weights sum, option uniqueness, tier strictness), score extremes and weighting, inclusive thresholds, both hard triggers, conservative unanswered scoring, sensitivity up/down/hard-trigger cases, month-end date arithmetic, requirement states and newest-wins/cap rules, exception credit, residual formula, cadence, queue kinds/ordering/quiet case/determinism, CSV safety, validation bounds and paths, and the fixture's planned defects.

## Data handling

Fictional vendors, people and documents; "SOC 2" / "ISO/IEC 27001" appear only as example evidence *types*. No network or storage APIs; CSV cells are formula-escaped.

## JD evidence (truthful framing)

Third-party risk identification, segmentation and scoring; explainable prioritisation; evidence expiry management; exception handling; analyst-to-manager communication through the quadrant and queue. Not a claim of TPRM platform (OneTrust/CENTRL/ServiceNow) experience or real vendor assessments.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance: an AI coding agent drafted the design plan, code, tests and documentation and executed the verification recorded in `EVIDENCE.md`. This does not by itself establish the candidate's understanding; the candidate should review the code and be able to explain it (see `INTERVIEW_GUIDE.md`) before presenting it. Framework text was transcribed from primary NIST publications; heuristic rules and paraphrases were written for this project and are labelled as such.
