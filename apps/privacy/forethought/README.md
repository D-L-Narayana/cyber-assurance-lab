# Forethought — privacy impact assessment workbench

Educational, browser-local workbench for running a repeatable privacy impact assessment on a feature. A ten-question rubric (with follow-ups revealed only when relevant) drives a weighted likelihood × impact model across ten privacy risk themes. Mitigations reduce residual risk only when implemented (or, where evidence is required, verified with a reference); planned ones change the projection. Approval invariants block sign-off until unanswered questions, unaccepted high residual risk, unresolved transfers, missing DPO consultation or evidence gaps are cleared. Signatures are bound to a SHA-256 content hash and go stale when anything changes. Three audience views (analyst, manager, executive) read the same scorecard.

> Educational prototype. The weights and bands are a teaching calibration, not a regulator's template; this is not legal advice and does not decide whether a DPIA is legally required. The synthetic scenarios ("recommendation feature", "kids learning app") are fictional.

## Key workflows

1. **Sketch the data flow.** From/to, categories, whether the destination is outside the origin region, and the transfer mechanism. A flow outside the region with mechanism `none` blocks sign-off.
2. **Answer the rubric.** Each option shows which themes it moves (e.g. `AD L+2 I+1`). Follow-ups (notice update, rights tooling at scale, age assurance, sharing contracts) appear only when triggered.
3. **Watch the constellation.** A 5×5 likelihood × impact grid: hollow dot = inherent, filled = residual, arrow = effect of counted mitigations.
4. **Apply mitigations.** Planned / implemented / verified with evidence reference. Evidence-required mitigations marked verified without a reference do not count and block sign-off.
5. **Accept residual risk.** High themes need a named acceptance with a 30+ character rationale; very-high themes only by the data-protection lead. DPIA-scale assessments need DPO consultation recorded.
6. **Sign and version.** Blockers are listed first-class. Signing binds the content hash; editing afterwards marks the signature stale. "Record version" stores a numbered snapshot with a change summary (answers, mitigations, flows, acceptances).
7. **Audience toggle.** Analyst (numbers and drivers), Manager (bands, controls, owner decisions), Executive (deterministic template summary).
8. **Import / export** assessment JSON; print to PDF through the browser; load calibration fixtures (low / very-high).

## Quickstart

```bash
npm ci
npm test        # 37 tests: engine 31 (26 test-first, 1 hostile nesting, 4 review-driven strictness) + UI integration 6
npm run build
npm run preview # http://127.0.0.1:6103
```

## Algorithm

- **Themes:** lawfulness, minimisation, transparency, rights, security, retention, third-party, cross-border, vulnerable subjects, automated decisions.
- **Inherent score:** per theme, L and I start at 1; each visible answer adds its option's effects (negative effects model protective answers); both clamped to 1..5; score = L × I.
- **Bands:** 1–4 low, 5–9 medium, 10–14 high, 15–25 very high (a common 5×5 matrix convention; documented, not standard-mandated).
- **Mitigations:** reduce L or I by 1 or 2 for their themes. Counted when `implemented`/`verified`, or for evidence-required mitigations only when `verified` with a non-empty `evidenceRef`. `planned` affects only the *projected* score. Residual ≤ inherent and projected ≤ residual hold by construction (property-tested).
- **DPIA-scale** (model definition): any theme with inherent band very-high. This triggers the DPO-consultation invariant, echoing GDPR Art. 35(2) ("seek the advice of the data protection officer… when carrying out a DPIA"); it does not determine legal necessity of a DPIA.
- **Sign-off blockers:** `UNANSWERED_QUESTIONS`, `HIGH_RESIDUAL_WITHOUT_ACCEPTANCE`, `VERY_HIGH_NEEDS_DP_LEAD`, `UNRESOLVED_TRANSFER`, `DPO_NOT_CONSULTED`, `EVIDENCE_MISSING`.
- **Content hash:** SHA-256 over canonical JSON of id, title, owner, description, sorted answers, mitigations, flows, acceptances and `dpoConsulted` — signatures and versions excluded so they can reference it.
- **Calibration fixtures:** internal roster tool → low; recommendation feature → high (signable as shipped thanks to verified pentest, SCCs, human review and an accepted vulnerable-subjects risk); kids learning app → very high, DPIA-scale, unsignable.
- **Import bounds:** 500 kB, nesting depth 6 (iterative check), 200 items per list; unknown question/option/mitigation ids rejected.

## Architecture

```
src/engine/  types, rubric (questions + mitigations), scoring, approval (blockers, hash, sign, snapshot), narrative, assessmentIO
src/fixtures/ recommendation-feature.json, calibration-low.json, calibration-very-high.json
src/ui/      Constellation (SVG)
src/App.tsx  worksheet, risk pane, sign-off, import dialog
```

React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, fast-check; Radix ToggleGroup and Dialog; self-hosted Literata and Manrope (Fontsource). Single view, `base: './'`.

## Tests

37 tests (1 Oct 2026). Engine tests were written first and run against stubs (24 failed, 2 rubric-shape tests passed because the rubric is data) before implementation (26 passed); a hostile-nesting test was added after a cross-track review, and four import-strictness tests (real calendar dates, no silent list filtering/truncation, duplicate ids/themes/roles/version numbers) ran red before their fix (see `EVIDENCE.md`). Highlights: band boundaries; progressive disclosure; planned vs implemented vs verified semantics; evidence requirement; a property test that residual ≤ inherent ≤ … over random mitigation sets; three calibration fixtures; every blocker; hash stability and staleness; version diff summaries; narrative determinism; import rejection.

## Data handling

Browser-local; no network after load; no storage APIs; fictional scenario text only; printing uses the browser's own dialog.

## Limitations

- Weights are an educational calibration. Real assessments depend on context the rubric cannot capture; the tool structures the reasoning, it does not replace it.
- "DPIA-scale" is a model flag, not the Art. 35(3) criteria or supervisory-authority lists.
- Version diffs are reconstructed from snapshots taken in the current session; versions imported from a file show "content changed" without field-level detail.
- Signatures are hash bindings in a JSON file, not cryptographic signatures by an identity.

## JD evidence (educational mapping)

Privacy risk assessment and design thinking (explicit model, invariants), communication to several audiences (analyst/manager/executive views, deterministic summary), quality deliverables (versioned, exportable, printable), HTML/CSS/TypeScript. Not legal expertise; not vendor product experience.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance (Claude) for design, tests, implementation and documentation. Human review and understanding of this code have **not** been independently established. Before this project is presented as personal work, the candidate should study the code and rehearse the material in `INTERVIEW_GUIDE.md`; this README makes no claim that such review has already happened.

## License

MIT; third-party notices in `THIRD_PARTY_NOTICES.md`.
