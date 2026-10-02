# Firstlight — privacy incident triage & notification-readiness lab

Educational, browser-local prototype for the first 72 hours of a personal-data incident. Firstlight takes a synthetic incident bundle (event stream, affected-data scope, circumstances, containment tasks, facts) and turns it into a defensible picture: a deduplicated, sequence-checked timeline; an evidence clock per jurisdiction (72 hours under GDPR Art. 33; 30 calendar days under Cal. Civ. Code 1798.82 as amended by SB 446); an ENISA-style severity score with a visible formula; a notification-readiness checklist aligned to Art. 33(3); and an exportable readiness packet with optional redaction of names and e-mail addresses.

**Educational prototype — not legal advice.** It assembles and checks facts. It does not decide whether an incident is a notifiable breach, and nothing is ever sent to any authority or person. All data is synthetic (`*.example` domains, fictional people).

## Key workflows

1. **Timeline hygiene.** Events are sorted, exact duplicates removed, and sequence problems reported with stable codes (`DUPLICATE_EVENT`, `MISSING_DETECTION`, `MISSING_AWARENESS`, `AWARE_BEFORE_DETECTED`, `CONTAINED_BEFORE_DETECTED`, `LARGE_GAP`, `OUT_OF_ORDER`). New events can be added with an explicit "contains personal detail" flag.
2. **Evidence clock.** Pick "now"; the band shows occurrence, detection, awareness, containment, now and the shortest deadline present, with a chip per jurisdiction (`within-window` / `window-exceeded` / `clock-not-started`). Phase is decided on exact timestamps; displayed hours are rounded afterwards.
3. **Scope and severity.** Affected-data items by class (simple → behavioural → financial → sensitive). The subject count shown is the largest single item, labelled as a **lower bound** because overlap between items is unknown. Severity recomputes live as circumstances change; a non-zero context adjustment demands a written justification.
4. **Readiness packet.** Nine required and two optional facts plus three derived checks (timeline consistent, containment complete with evidence, severity assessed with justification). Completeness is a measured ratio, not a verdict.
5. **Containment with evidence.** A task can only be marked done with an evidence reference; "done" without evidence is impossible by construction.
6. **Redaction and export.** Toggle the redaction preview; export the packet (redacted or full) or the whole bundle as JSON. Import validates against a schema with byte, depth and item limits.

## Quickstart

```bash
npm ci
npm test          # vitest: 36 tests
npm run build     # vite → dist/ (relative asset base, single view)
npm run preview   # http://127.0.0.1:6104/
```

Requires Node 20+. No environment variables, no backend.

## Algorithm

**Timeline** (`timeline.ts`): stable sort by timestamp, duplicate detection on `(at, kind, summary)`, anchor selection (first `detected`, first `aware`, first `occurred`, first `contained`), then the issue rules above. A property test (fast-check) checks that the result is idempotent and independent of input order.

**Clock** (`clock.ts`): a table of teaching rules per jurisdiction — `EU-GDPR` and `UK-GDPR` 72 hours from awareness (Art. 33(1)), `US-CA` 30 calendar days from discovery (Civ. Code 1798.82(a)(2), SB 446, effective 1 January 2026). `deadline = aware + hours`; `phase = now > deadline ? exceeded : within`. Statutory exceptions (law-enforcement delay, scope determination) and the separate Californian 15-day Attorney General sample-copy rule are described in the note text, not modelled.

The implementation represents the California window as exactly 720 hours from the recorded timestamp. It does not implement end-of-day counting, local-time or daylight-saving rules. The shared `aware` anchor is used as a proxy for discovery in this demonstration; real discovery and GDPR awareness can differ and require separate legal assessment.

**Severity** (`severity.ts`): an adaptation of the ENISA 2013 recommendation `SE = DPC × EI + CB`. DPC base 1–4 from the highest data class present, adjusted by a bounded (−3..+3) justified context adjustment and clamped to 1–4; EI ∈ {0.25, 0.5, 0.75, 1}; CB sums confidentiality, integrity and availability loss (0 / 0.25 / 0.5 each) plus 0.5 for malicious intent. Bands: `< 2` low, `< 3` medium, `< 4` high, `≥ 4` very high. The rationale array prints every term so the number is explainable.

**Readiness** (`readiness.ts`): facts aligned to Art. 33(3)(a)–(d) plus derived checks; `completeness = requiredPresent / requiredTotal`.

**Packet** (`packet.ts`): deterministic JSON with incident, anchors, clocks, severity, facts, readiness and containment; redaction replaces e-mail addresses and every `personalTokens` entry (case-insensitive) with `[REDACTED]` and withholds summaries of events flagged `personal`.

**Import** (`bundleIO.ts`): byte limit (1,000,000) before parsing; iterative, bounded depth check (≤ 5) that cannot overflow the stack; strict enum, strict calendar-valid ISO timestamps (Feb 30, month 99, 24:00 and minute 60 are rejected), finite non-negative counts, duplicate-id rejection across events / data scope / containment, unknown fact keys dropped with a warning, and `personalTokens` rejected (not filtered) when malformed or over the limit.

## Architecture

```
src/engine/   pure TypeScript, no React: types, timeline, clock, severity, readiness, packet, bundleIO
src/ui/       ClockBand (the signature evidence-clock band)
src/App.tsx   single view; all state in React useState; derived values via useMemo
src/fixtures/ misdirected-export.json (INC-2026-0093, synthetic)
qa/           tdd-red-engine.log, tdd-green-engine.log, tdd-red/green-review-fixes.log, browser-audit-summary.json, screens/
```

Design direction: a dark "dawn command board" (navy `#0E1626`, amber `#F2A33A` for the clock, sky `#9CC9F2`, red/green for state), Sora for text and IBM Plex Mono for every timestamp and number. The evidence-clock band is the one signature element; everything else is quiet.

## Tests

36 tests in 2 files (`npx vitest run`): 30 engine tests (timeline, clock, severity, readiness, packet, import, 1 property test) and 6 integration tests through the rendered app. Engine tests were written first and run RED (27 failed) before implementation; the review-driven tests (strict timestamps, personalTokens, unrounded phase, SB 446 clock, lower-bound label) also ran RED (5 failed) before the fix. The 6 app tests were written after the UI, as integration coverage. Logs in `qa/`.

## Data handling

Everything runs in the tab. No `localStorage`, `sessionStorage`, IndexedDB, cookies or network requests after load (verified by the browser audit, which records request hosts). Import reads a file or pasted text in memory; export creates a Blob download. Reloading the page discards all state by design.

## Limitations

- Teaching model of notification windows, not a compliance determination. "Awareness" is whichever event you record as `aware`; the law's concept of awareness is a judgement the tool does not make.
- Statutory delay exceptions, the GDPR Art. 34 data-subject notice, and California's 15-day Attorney General sample copy are described, not modelled.
- Subject count is a lower bound (largest single item); de-duplication across data items is not attempted.
- Severity bands follow the ENISA 2013 methodology's structure but the DPC-per-class mapping and the context adjustment are this project's simplification.
- Redaction is token- and e-mail-based; it will not catch names that are not listed in `personalTokens`.
- Single view, single incident; no persistence, collaboration, or authority-specific forms.

## JD evidence (educational mapping)

Incident response for personal data, breach notification timelines (GDPR Art. 33, CCPA/Civ. Code 1798.82), risk scoring with a transparent formula, evidence-first containment tracking, data minimisation in exports (redaction), defensive JSON import, accessibility (axe 0 violations at 375/768/1440), test-first engineering.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance (Claude) for design, tests, implementation and documentation. Human review and understanding of this code have **not** been independently established. Before this project is presented as personal work, the candidate should study the code and rehearse the material in `INTERVIEW_GUIDE.md`; this README makes no claim that such review has already happened.

## References

- GDPR Art. 33 text: https://gdpr-text.com/read/article-33/
- ENISA, *Recommendations for a methodology of the assessment of severity of personal data breaches*, v1.0, Dec 2013: https://www.enisa.europa.eu/sites/default/files/publications/Data%20breach%20severity%20methodology_1.0.pdf
- California SB 446 (2025) amending Civ. Code 1798.82 — bill text: https://legiscan.com/CA/text/SB446/2025 ; summary: https://www.pillsburylaw.com/en/news-and-insights/california-data-breach-notification-requirements.html

## License

MIT — see `LICENSE`. Third-party components are listed in `THIRD_PARTY_NOTICES.md`.
