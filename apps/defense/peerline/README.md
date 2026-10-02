# Peerline — explainable UEBA baseline and anomaly triage

Educational prototype built October 2026. Peerline scores a synthetic population (30 fictional users × 28 days × 4 features) with **robust statistics you can read**: per-user median and MAD by day type, a peer-group comparison, weighted reason codes, and analyst feedback that visibly changes the score. It is not a UEBA product and must not be used to monitor real people.

## Key workflows
1. **Generate** a population by seed; days 1–21 train the baselines, days 22–28 are scored.
2. **Read the queue** — cards ranked by score with reason-code chips; toggle "show normal days" to see what sits inside the band.
3. **Inspect a user-day** — four band charts (median ± z·MAD/0.6745) with the training/scoring split and the selected day highlighted; each reason is a full sentence with value, baseline, MAD, sample size and z.
4. **Give feedback** — suppress one reason code for one user with a rationale; the score recomputes and the suppression is listed and reversible.
5. **Record a disposition** (true positive / false positive / benign explained) for the report.
6. **Tune** the alert threshold and spike z-threshold with sliders and watch measured precision/recall against the injected answer key change.
7. **Import** a bounded JSON array of records (≤ 5,000) — labels are then unavailable and the evaluation strip says so.
8. **Export** `peerline.report/1` JSON.

## Quickstart
```bash
npm ci
npm test
npm run build
npm run dev   # http://127.0.0.1:6131
```

## Algorithm
- **Baselines** (`src/engine/ueba.ts`): per user, per day type (weekday/weekend), over *active* training days only; `robustStats` = median and median absolute deviation. If the same day type has fewer than 5 active days, the other day type is used and the result is flagged; with no usable baseline the day is **unscored**, not scored.
- **Spike reasons**: `z = 0.6745 · (x − median) / max(MAD, floor)`; a feature with `z ≥ 3.5` adds `weight × min(3, z / 3.5)` to the score. Weights: upload 5, hosts 4, logins 3, after-hours 2.
- **Peer deviation**: the user's weekday median compared with the department's distribution of user medians; fires only when no own-baseline spike fired, so it reads as "normal for them, abnormal for the group".
- **Alert** when score ≥ 5 (slider).
- **Feedback**: suppressions are `(user, code, rationale)` entries in config; scoring skips them and reports them separately.
- **Evaluation** (`evaluate.ts`): precision/recall against the five injected anomalies — measured on the synthetic seed, reported as such.

## Measured on seed 11 (default)
recall 100 % (5/5 injected), precision 50 % (5 false positives, all `PEER_DEVIATION` for the habitual heavy uploader `orla.example`, which is exactly the case the suppression workflow exists for). Numbers come from `npm test` and the evaluation strip, not from a slide.

## Architecture
`src/engine/*` (stats, ueba, synth, evaluate, validate, report) is framework-free TypeScript. `src/App.tsx` and `src/ui/BandChart.tsx` are presentation. In-memory state only; refresh resets; export JSON to keep work.

## Tests
12 vitest tests: median/MAD, z scaling and MAD floor, weekday/weekend separation, spike reason content, NO_BASELINE state, peer deviation, feedback suppression, deterministic generation, precision/recall arithmetic, measured recall ≥ 0.8 and precision ≥ 0.5 on the default seed, import validation (size, format, negatives), report schema. RED/GREEN runs in `EVIDENCE.md`.

## Data handling
Users are fictional `name.example` labels. Imported data stays in the browser. The tool is built for synthetic or aggregated data and says so in the import dialog.

## Limitations
- Four daily features only; no sessions, geo, or device signals.
- Robust z assumes roughly unimodal behaviour; multi-modal users (two jobs, two shifts) will look noisy.
- Peer groups are departments as given; no automatic clustering.
- Weekend baselines are sparse by construction; the fallback is flagged but still heuristic.
- No persistence beyond export.

## JD evidence (educational, not professional experience)
UBA/UEBA concepts (baseline, anomaly score, reason codes, feedback loop), analytical reasoning with measured precision/recall, explanations written for non-specialists.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; tests were written and run (failing) before implementation. Human review of every design decision has not been independently confirmed; `INTERVIEW_GUIDE.md` is provided and the candidate should rehearse it before presenting this project.
