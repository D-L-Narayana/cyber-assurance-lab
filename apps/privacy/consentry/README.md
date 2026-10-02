# Consentry — consent and preference decision engine

Educational, browser-local prototype that answers one question with a full explanation: **may this event be used for this purpose, for this person, at this instant?** A table-driven policy evaluator runs an ordered rule ladder over synthetic purposes, subjects and consent records, returns allow / deny / review with a reason code and the record it relied on, and shows the complete trace. A coverage analysis disables each rule in turn to prove which rules the fixtures actually exercise, and a regression suite replays stored expectations against the live table.

> Educational prototype. Not a consent management platform, not legal advice, and no cookies are set or visitors tracked. Vendor products (OneTrust and similar) are context only. All data is synthetic.

## Key workflows

1. **Simulate one decision.** Pick a subject, purpose and event time; toggle an opt-out preference signal (GPC) or change the age band. The rule ladder re-evaluates instantly: passed rungs dim, skipped (disabled) rungs are hatched, the terminal rung expands with the decision stamp, reason code, basis and the consent record used.
2. **Compare a what-if.** Side-by-side ladders for a variant (flip GPC, make the subject 13–15, switch regime, move the event 400 days later, record a withdrawal yesterday). Rungs that differ are marked.
3. **Edit the consent ledger.** Add a grant, withdrawal, objection or opt-out effective at a chosen instant and policy version. Records after the event are shown but never used (temporal validity).
4. **Batch decisions.** Every fixture event decided with the current policy; click to load one into the simulator; export a JSON audit trail with full traces.
5. **Rule coverage (mutation analysis).** For each rule: how many fixture decisions change when it is disabled, and whether it is exercised at all. Tick/untick to disable rules live.
6. **Policy regression suite.** Stored expectations replayed against the live table; disabling a rule shows exactly which expectations break and what was observed instead.
7. **Import / export** a `consentry.workspace` JSON (bounded, validated). In-memory only; refresh resets.

## Quickstart

```bash
npm ci
npm test        # 51 tests: engine (45, test-first) + UI integration (6)
npm run build   # tsc -b && vite build
npm run preview # http://127.0.0.1:6101
```

Node 20.19+ / 22.12+.

## Algorithm

### Rule ladder (`src/engine/evaluate.ts`)

Ordered rules; the first match is terminal; disabled rules are skipped and recorded as such. Facts computed once per evaluation: the purpose, the subject's regime, the configured lawful basis for that regime, the *effective* basis after regime adjustments, whether the subject is below the regime's child threshold, and the latest consent record at or before the event.

| Rule | Decides | Grounding |
|---|---|---|
| R01 unknown purpose | review | registry hygiene |
| R02 essential | allow | strictly necessary processing |
| R03 unknown regime | review | the engine does not guess |
| R04 basis configured | review if missing | registry hygiene |
| R05 child / unknown age | deny when below threshold; **review** when the age band is unknown for an age-sensitive purpose (EU/UK consent, California sale/share) | GDPR Art. 8: 16, Member States may lower to 13 ([text](https://www.gdpr.org/regulation/article-8.html), [Commission](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_en)). UK default 13; CA under-16 opt-in. Unknown age is never treated as adult. |
| R06 GPC signal (California, sale/share) | deny | CCPA regulations § 7025 treat an opt-out preference signal as a valid opt-out request ([CPPA OOPS](https://cppa.ca.gov/pdf/oops.pdf)) |
| R07 opt-out on record | deny | honours the latest opt-out |
| R08 objection (legitimate interest) | deny | compelling grounds not modelled |
| R09 consent | deny / allow | no record → `NO_CONSENT`; withdrawn; expired (explicit `expiresAt` or older than `consentMaxAgeDays`, default 395); captured under an older notice version when the purpose requires re-consent; else `CONSENT_VALID` |
| R10 legitimate interest | allow if assessment documented, else review | LIA presence is a registry flag |
| R11 contract | allow | contractual necessity |
| R12 notice-and-opt-out | allow | US-style default |
| R99 fallback | review | must never be reached by fixtures |

Regime adjustment: in California, selling or sharing the personal information of a consumer under 16 requires affirmative authorisation, so for a minor the effective basis for a sale/share purpose becomes `consent` **whatever basis the purpose is configured with** (notice-and-opt-out, legitimate interest, contract or none). The guard depends on regime, purpose category and age only; a legitimate-interest assessment cannot bypass it.

**Explicit modelling choices (teaching policy, not a compliance claim):**
- Unknown age for an age-sensitive purpose routes to **review** (`AGE_UNKNOWN`); the engine neither assumes an adult nor a child. For purposes that do not depend on age (legitimate interest, contract, US notice-and-opt-out marketing) an unknown age does not block.
- `R02 essential` is evaluated **before** the regime and basis checks. An `essential` purpose is therefore allowed even when the subject's regime is unknown or no basis is configured for it. This encodes the position that strictly necessary processing does not depend on consent; it also means a purpose mis-registered as `essential` bypasses those checks, which is why the category is a registry decision and is displayed on every trace.
- Parental authorisation, compelling legitimate grounds for overriding an objection, and conflicts between an earlier consent and a later GPC signal are not modelled beyond deny/review.

### Coverage analysis (`src/engine/analysis.ts`)

`ruleCoverage` disables one rule at a time and re-decides every fixture event; a rule whose removal changes no decision is reported as unexercised. This is a rule-level mutation test of the fixture set, not of the code. `runExpectations` replays stored `(event → expected decision, reason)` pairs and reports observed outcomes on failure, including missing events.

### Import bounds (`src/engine/workspace.ts`)

2 MB, depth 8, 200 purposes, 1,000 subjects, 5,000 records, 5,000 events; enum, timestamp and referential checks (records must reference known subjects and purposes; events may reference unknown purposes, which routes them to review); duplicate ids rejected; unknown keys dropped.

## Architecture

```
src/engine/   types, evaluate (rule table), analysis (batch, coverage, suite, export), workspace (import/export)
src/fixtures/ demo-workspace.json: 8 purposes, 8 subjects, 11 records, 20 events, 20 expectations
src/ui/       Ladder (decision trace)
src/App.tsx   simulator, ledger, tabs, import dialog
```

React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, fast-check; Radix Tabs, Switch and Dialog; self-hosted Space Grotesk and JetBrains Mono (Fontsource). Single view, `base: './'`.

## Tests

51 tests (measured 1 Oct 2026; engine 45 + UI integration 6). Engine tests were written first and run red against stubs (38 failures) before implementation (38 passes); four further tests were added red-first after an independent source review (hostile 20,000-level nesting; unknown age); see `EVIDENCE.md`. Highlights: temporal validity (a consent granted after the event is ignored), re-grant after withdrawal, expiry by age and by explicit date, re-consent on notice version change, EU vs UK child thresholds, GPC only affecting sale/share, Californian minor opt-in, LIA presence, a determinism property over 200 random subject/purpose/record combinations asserting exactly one matched rung, coverage and suite behaviour, and import rejection cases.

## Data handling

Browser-local; no network after load; no storage APIs; synthetic subjects with no real identifiers; consent "proof" references are placeholders inspired by the [Kantara consent receipt](https://kantarainitiative.org/download/consent-receipt-specification/) idea but are not receipts.

## Limitations

- Three regimes with simplified bases; no ePrivacy cookie-specific rules, no sector rules, no LGPD/other laws.
- Consent expiry is a policy constant, not a legal rule.
- Single policy table; no versioned policy history or approvals.
- `policy.disabledRules` is an intentional teaching facility (rule-ablation coverage). Importing a workspace that disables a protective rule (R05 child consent, R06 GPC, R07 opt-out on record, R08 objection) is allowed but produces an explicit "educational override" warning at import and `skipped` entries in every affected trace; there is no authorisation model behind it.
- A consent record's own `regime` field is not compared with the subject's regime (a grant recorded under one regime satisfies R09 for a subject in another).

## JD evidence (educational mapping)

Privacy-platform concepts (purpose registry, consent records, preference signals), analytical/design thinking (explainable rule table, mutation-style coverage), API-shaped JSON contracts with validation, HTML/CSS/TypeScript. Not vendor product experience; not legal advice.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance (Claude) for design, tests, implementation and documentation. Human review and understanding of this code have **not** been independently established. Before this project is presented as personal work, the candidate should study the code and rehearse the material in `INTERVIEW_GUIDE.md`; this README makes no claim that such review has already happened.

## License

MIT. Third-party licences in `THIRD_PARTY_NOTICES.md`.
