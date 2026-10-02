# EVIDENCE — Labelsmith

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Publication fixture regression

On 2026-10-02 UTC, added assertions to the existing demo test requiring explicit non-provider credential placeholders and a matching API-key classification trace. RED: 1 failed, 33 passed. Replaced generated provider-shaped samples and two test literals with `DEMO_ONLY_NOT_A_SECRET_` examples; GREEN: 34 passed, production build passed, dependency audit reported zero vulnerabilities. Counts remain unchanged because the regression extends an existing test. Captures: `qa/safe-fixture-red.txt` and `qa/safe-fixture-green.txt`.

## Test-first (RED → GREEN)

1. `src/engine/classify.test.ts` (19 tests) was written against a stub `classify.ts` whose exports throw `not implemented` and whose `BUILT_IN_RULES` is empty. First run (`qa/red-classify.txt`): **19 failed (19)**.
2. After implementing the engine: `1 failed | 28 passed` — the trace test expected value checks to be *skipped* for incompatible field types (a date column should not be Luhn-tested). Added the `APPLICABLE` type-compatibility table → `29 passed`.
3. Browser QA showed `cardholder_reference` (random 16-digit strings) labelled Restricted · PII via the phone shape. Added a failing test first (`qa/red-phone.txt`: `1 failed | 19 passed`), then bounded the phone check to 8–15 digits (E.164) → the field now lands in Unknown as designed.

4. Sixth-Fable review (2026-10-01): the review message said a stricter declared class was "kept" while the effective class and policy used the weaker computed class. One failing test added first (`qa/red-declared-stricter.txt`: `1 failed | 22 passed`), then `effectiveLabels` keeps the stricter declared class as effective and the message was corrected → `34 passed` (`qa/green-declared-stricter.txt`). Known substring false positives are now pinned by a test and documented in the README. The demo's `ledger.status` field (declared Confidential, computed Internal) shows the behaviour; the workflow log records `Effective class Confidential — the stricter declared class is kept pending review` with the Confidential policy card.

## Final test run

```
$ npm test
 ✓ src/engine/safe.test.ts (10 tests)
 ✓ src/engine/classify.test.ts (23 tests)
 ✓ src/fixtures/validate-demo.test.ts (1 test)
 Test Files  3 passed (3)
      Tests  34 passed (34)
```

## Build

```
$ npm run build
> tsc --noEmit -p tsconfig.json && vite build
✓ built in ~1.3s
```

`npm audit`: 0 vulnerabilities (2026-10-01).

## Browser workflow (`qa/workflow.mjs`, Chromium, vite preview :6141) — `qa/screens/workflow-log.txt`

- Initial state: 40 fields → Public 3 · Internal 2 · Confidential 4 · Restricted-PII 15 · Financial 4 · Health 2 · Secret 3 · Unknown 7; 18 need review; 27 rules.
- `card_number` → Restricted · Financial, effective Confidential via active exception `exc-001` until 2027-03-31.
- `cardholder_reference` → Unknown; Luhn trace reads `0/6 samples (0%) match; need 60% | not-matched` (`02-luhn-trace.png`).
- Live edit: `preferred_locale` (Unknown) renamed to `contact_email` → Restricted · PII confidence 0.70; adding three email samples → confidence 0.93; "Save to catalog" re-labels the catalog.
- Exception with empty form → `Justification must be at least 20 characters. approvedBy is required. grantedOn and expiresOn must be ISO dates.`; valid form → `exc-003 recorded: restricted-pii → confidential until 2027-03-01` (`03-exception.png`).
- Keyword rule `(a+)+` → `Keywords are plain text; regex characters are not allowed.`; `codename, plan_tier` → 28 rules; `plan_tier` becomes Confidential.
- Export CSV: 41 lines (header + 40). Export JSON: `labelsmith.catalog/v1`, 40 fields, 28 rules, 17 need review.
- Invalid import (`asOf: 2026-02-30`, `fields: [null]`) → `asOf must be a valid ISO date. · fields[0] is not an object.`
- `mobile scrollWidth=375`, `tablet scrollWidth=768`, `pageErrors=[]`.

Axe (`qa/audit/browser-audit.json`): **0 violations**, 0 page errors, 0 failed requests at 1440/768/375.

## Measured facts for resume use

- 34 automated tests; 27 built-in rules; 13 value-shape validators; 8 classes incl. explicit Unknown.
- Synthetic fixture: 40 fields, 5 systems, 2 exceptions (1 expired).
