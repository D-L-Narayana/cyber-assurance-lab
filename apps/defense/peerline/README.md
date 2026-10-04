# Peerline — explainable UEBA baseline and anomaly triage

Educational prototype built October 2026; import path hardened in the October 2026 lab-wide upgrade round. Peerline scores a synthetic population (30 fictional users × 28 days × 4 features) with **robust statistics you can read**: per-user median and MAD by day type, a peer-group comparison, weighted reason codes, and analyst feedback that visibly changes the score. It is not a UEBA product and must not be used to monitor real people.

## Key workflows
1. **Generate** a population by seed; days 1–21 train the baselines, days 22–28 are scored.
2. **Read the queue** — cards ranked by score with reason-code chips; toggle "show normal days" to see what sits inside the band.
3. **Inspect a user-day** — four band charts (median ± z·MAD/0.6745) with the training/scoring split and the selected day highlighted; each reason is a full sentence with value, baseline, MAD, sample size and z.
4. **Give feedback** — suppress one reason code for one user with a rationale; the score recomputes and the suppression is listed and reversible.
5. **Record a disposition** (true positive / false positive / benign explained) for the report.
6. **Tune** the alert threshold and spike z-threshold with sliders and watch measured precision/recall against the injected answer key change.
7. **Import** a bounded JSON array of records (≤ 5,000 rows, ≤ 2,000,000 bytes) through `parseRecords`: the UTF-8 byte cap is checked before parsing, nesting and value counts are scanned iteratively, `day` must be a real calendar date, `user`/`dept` must be printable, numbers finite and in range, one row per `(user, day)`; errors are reported by path (`records[2].day: …`, at most 20). Labels are then unavailable and the evaluation strip says so.
8. **Export** `peerline.report/1` JSON.

## Quickstart
```bash
npm ci
npm test      # vitest, 18 tests
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
- **Import validation** (`validate.ts`): `parseRecords(text)` → UTF-8 byte cap (2,000,000) before `JSON.parse` (exactly once; a decoded string is a value, not a second document) → iterative depth/value scan (≤ 3 container levels, ≤ 100,000 values) → `validateRecords`: array of ≤ 5,000 objects; `user`/`dept` printable strings of 1–64 characters (no control, format, surrogate or private-use code points); `day` in `YYYY-MM-DD` form that round-trips through `Date.UTC` (so `2026-02-30` and `2026-04-31` are rejected, `2028-02-29` accepted); `logins`/`uploadMB`/`distinctHosts` finite numbers 0–1e9; `afterHoursPct` finite 0–1; no duplicate `(user, day)` rows (the error names both indices); unknown keys dropped; the first 20 path-addressed errors are returned and the function never throws.

## Measured on seed 11 (default)
recall 100 % (5/5 injected), precision 50 % (5 false positives, all `PEER_DEVIATION` for the habitual heavy uploader `orla.example`, which is exactly the case the suppression workflow exists for). Numbers come from `npm test` and the evaluation strip, not from a slide.

## Architecture
`src/engine/*` (stats, ueba, synth, evaluate, validate, report) is framework-free TypeScript. `src/App.tsx` and `src/ui/BandChart.tsx` are presentation; the import dialog calls `parseRecords` and renders the returned error list. In-memory state only; refresh resets; export JSON to keep work.

## Tests
18 vitest tests across two files (`vitest run` prints `Tests  18 passed (18)`):
- `engine.test.ts` (12): median/MAD, z scaling and MAD floor, weekday/weekend separation, spike reason content, NO_BASELINE state, peer deviation, feedback suppression, deterministic generation, precision/recall arithmetic, measured recall ≥ 0.8 and precision ≥ 0.5 on the default seed, import validation (size, format, negatives), report schema.
- `validate.test.ts` (6): byte cap enforced before parsing (multi-byte text under the character count but over the byte cap), invalid JSON and single decoding (a JSON string literal that contains a record array is rejected, never parsed a second time); iterative depth/value caps on a 4,000-deep array and a nested unknown field; strict calendar days (`2026-02-30`, `2026-04-31`, `2026-13-01`, non-leap `2026-02-29` rejected; `2028-02-29` accepted); duplicate `(user, day)` rows with both indices; printable `user`/`dept` (NUL, zero-width space and newline rejected; accented letters and dashes accepted); path-addressed errors, finite numbers, unknown-key stripping and the 20-entry cap.
RED/GREEN runs are recorded in `EVIDENCE.md` (`qa/red-record-import.txt`, `qa/green-record-import.txt`, `qa/red-single-decode.txt`, `qa/green-single-decode.txt`, `qa/green-full-suite.txt`).

## Data handling
Users are fictional `name.example` labels. Imported data stays in the browser. The tool is built for synthetic or aggregated data and says so in the import dialog.

## Limitations
- Four daily features only; no sessions, geo, or device signals.
- Robust z assumes roughly unimodal behaviour; multi-modal users (two jobs, two shifts) will look noisy.
- Peer groups are departments as given; no automatic clustering.
- Weekend baselines are sparse by construction; the fallback is flagged but still heuristic.
- No persistence beyond export.
- The qa screenshots predate the October 2026 round (the import dialog text changed; the rest of the UI did not).

## JD evidence (educational, not professional experience)
UBA/UEBA concepts (baseline, anomaly score, reason codes, feedback loop), analytical reasoning with measured precision/recall, explanations written for non-specialists.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; tests were written and run (failing) before implementation, in the original build and in the October 2026 round. Human review of every design decision has not been independently confirmed; `INTERVIEW_GUIDE.md` is provided and the candidate should rehearse it before presenting this project.
