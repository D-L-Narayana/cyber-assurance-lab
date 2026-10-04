# EVIDENCE — Labelsmith

Commands run 2026-10-01, Node v20.20.1 / npm 10.8.2. Raw captures in `qa/`.

## Publication fixture regression

On 2026-10-02 UTC, added assertions to the existing demo test requiring explicit non-provider credential placeholders and a matching API-key classification trace. RED: 1 failed, 33 passed. Replaced generated provider-shaped samples and two test literals with `DEMO_ONLY_NOT_A_SECRET_` examples; GREEN: 34 passed, production build passed, dependency audit reported zero vulnerabilities. Counts remain unchanged because the regression extends an existing test. Captures: `qa/safe-fixture-red.txt` and `qa/safe-fixture-green.txt`.

## Test-first (RED → GREEN)

1. `src/engine/classify.test.ts` (19 tests) was written against a stub `classify.ts` whose exports throw `not implemented` and whose `BUILT_IN_RULES` is empty. First run (`qa/red-classify.txt`): **19 failed (19)**.
2. After implementing the engine: `1 failed | 28 passed` — the trace test expected value checks to be *skipped* for incompatible field types (a date column should not be Luhn-tested). Added the `APPLICABLE` type-compatibility table → `29 passed`.
3. Browser QA showed `cardholder_reference` (random 16-digit strings) labelled Restricted · PII via the phone shape. Added a failing test first (`qa/red-phone.txt`: `1 failed | 19 passed`), then bounded the phone check to 8–15 digits (E.164) → the field now lands in Unknown as designed.

4. Sixth review (2026-10-01): the review message said a stricter declared class was "kept" while the effective class and policy used the weaker computed class. One failing test added first (`qa/red-declared-stricter.txt`: `1 failed | 22 passed`), then `effectiveLabels` keeps the stricter declared class as effective and the message was corrected → `34 passed` (`qa/green-declared-stricter.txt`). Known substring false positives are now pinned by a test and documented in the README. The demo's `ledger.status` field (declared Confidential, computed Internal) shows the behaviour; the workflow log records `Effective class Confidential — the stricter declared class is kept pending review` with the Confidential policy card.

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

- 34 automated tests; 27 built-in rules; 13 value-shape validators; 8 classes incl. explicit Unknown. *(Superseded in October 2026: 58 tests in 4 files, 31 built-in rules, 14 value-shape checks — see below.)*
- Synthetic fixture: 40 fields, 5 systems, 2 exceptions (1 expired). *(October 2026: 46 fields — six false-positive regression fields appended; exceptions unchanged.)*

## Upgrade round — October 2026 (lab-wide)

Commands were run on 2026-10-04 in this directory with Node v20.20.1 / npm 10.8.2, through a thin wrapper that only
sets `CI=1`/`NO_COLOR=1` and writes the verbatim output to the named `qa/*.txt` file (each capture starts with the
exact command line, the UTC timestamp, the Node version and the exit code). Lines quoted below are copied from those
captures. Paths are repo-relative. The pre-existing `qa/screens/*.png`, `qa/screens/workflow-log.txt` and
`qa/audit/browser-audit.json` were **not** regenerated: no browser run was performed in this round, so they predate the
new "Match mode" control, the `Suppressed:` waterfall lines and the changed class counts (46 fields; `created_at`,
`updated_at`, `client_ip_last_login` and `remote_addr` are no longer PII-ranked).

### Hygiene (contracts C1–C3)

- `vercel.json` now carries the canonical lab-wide header set (CSP `default-src 'none'` with explicit `'self'` sources,
  `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; nosniff, DENY, no-referrer,
  Permissions-Policy, COOP, CORP, HSTS); AUDIT.md "Security headers" describes it. `form-action 'none'` was checked
  against `src/ui/App.tsx`: there is no `<form>` element.
- `package.json` gained `"engines": { "node": ">=20.19" }`.
- `index.html` `color-scheme` changed from `light dark` to `light` — `src/styles.css` paints `html, body` with
  `--bench-2: #f6f6f8` (white bench) and has no `prefers-color-scheme` query.

### Test-first: token-boundary matching, allow-list, exception tokens, hex digests

1. Tests first. The "Known false positives" list of the previous README became the test table: a new block in
   `src/engine/classify.test.ts` (15 tests), a new `src/engine/tokens.test.ts` (8 tests at that point), six new
   assertions in `src/fixtures/validate-demo.test.ts` (expecting 46 fixture fields), and the former pinning test was
   inverted (`tokenizer_version` must *not* be Secret · Credential, `healthcheck_status` must *not* be Restricted · Health).
   The first run (`qa/red-token-boundary.txt`, 09:41 UTC) was `22 failed | 35 passed (57)`, but four of those failures
   were missing-API errors rather than behaviour (`normaliseName is not a function`, `ALLOW_TOKENS` undefined,
   `checkValue('hex-digest', …)` returning `undefined`, no `val-hex-digest` rule), so it is kept only as history.
2. Behavioural RED. The minimal API was exposed with placeholder behaviour (`normaliseName` exported unchanged,
   `tokensOf`, an empty `ALLOW_TOKENS`, `hex-digest` returning `false`) and the suite re-run:
   `npx vitest run --reporter=verbose` → `qa/red-token-boundary-2.txt` (18:55 UTC):
   ```
    × src/engine/classify.test.ts > token-boundary matching and allow-lists (October 2026 upgrade round) > README false-positive table: tokenizer_version is operational metadata, not a credential 1ms
      → expected 'secret-credential' not to be 'secret-credential' // Object.is equality
    × src/engine/classify.test.ts > token-boundary matching and allow-lists (October 2026 upgrade round) > README false-positive table: healthcheck_status (one token) and health_check_status (allow-listed check/status) are not health data 2ms
      → expected 'restricted-health' to be 'internal' // Object.is equality
    × src/engine/classify.test.ts > token-boundary matching and allow-lists (October 2026 upgrade round) > README false-positive table: expiry_warning_days is a setting, while expiry alone is still card data 1ms
      → expected 'restricted-financial' not to be 'restricted-financial' // Object.is equality
    × src/engine/classify.test.ts > token-boundary matching and allow-lists (October 2026 upgrade round) > README false-positive table: velocity and electricity_tariff do not contain the token city 0ms
      → expected 'restricted-pii' not to be 'restricted-pii' // Object.is equality
    × src/engine/classify.test.ts > token-boundary matching and allow-lists (October 2026 upgrade round) > README false-positive table: an md5 / git-SHA column under a non-credential name is Confidential via the hex-digest rule (and flagged for review), not a credential 4ms
      → expected 'secret-credential' to be 'confidential' // Object.is equality
    × src/engine/tokens.test.ts > field-name tokenisation > lower-cases, splits camelCase humps, acronym runs and letter→digit boundaries, and collapses separators 21ms
      → expected 'customeremail' to be 'customer_email' // Object.is equality
    × src/fixtures/validate-demo.test.ts > demo fixture > validates and exhibits every designed scenario 29ms
      → expected 40 to be 46 // Object.is equality
    Test Files  3 failed | 1 passed (4)
         Tests  22 failed | 35 passed (57)
   ```
   Twenty-one of the 22 are assertion failures; the remaining one is `Cannot read properties of undefined (reading
   'class')` because the `val-hex-digest` rule did not exist yet in `BUILT_IN_RULES`. Three of the fifteen new
   `classify.test.ts` tests passed on the old substring matcher by coincidence (token-sequence/camelCase, `pan` vs
   `span`, determinism) and are kept as regression guards.
3. Implementation: tokeniser (`normaliseName`, `tokensOf`), whole-token / token-sequence matching with tolerated
   plurals, `match: 'token' | 'substring'` per rule (every built-in reviewed; only `name-password` is substring),
   `ALLOW_TOKENS`, per-rule `exceptTokens`, the `suppressed` trace outcome, `val-hex-digest` (Confidential 0.5) and
   `val-hex-credential`, the bare-hex exclusion in the API-key shape, a weak separate `name-card-expiry` rule, the
   `match` option on `addKeywordRule`, `match` in the export `ruleSet`, and six regression fields appended by
   `scripts/generate-fixture.mjs` (which gained a portable `--out <file>` flag; it was run as
   `node scripts/generate-fixture.mjs --out src/fixtures/demo.json` and the fixture now has 46 `fld-` ids, the first
   40 byte-identical to before).
4. A real false positive surfaced by the fixture assertions: the first full run after the implementation
   (`qa/red-ip-phone.txt`, a verbatim copy of the run the wrapper had saved under the GREEN file name) was
   ```
    × src/fixtures/validate-demo.test.ts > demo fixture > validates and exhibits every designed scenario 89ms
      → expected 'restricted-pii' to be 'confidential' // Object.is equality
    Test Files  1 failed | 3 passed (4)
         Tests  1 failed | 56 passed (57)
   ```
   `client_ip_last_login` (dotted-quad samples such as `10.44.7.12`) was Restricted · PII at 0.5 because the phone
   shape accepts 8–15 digits with dots, and PII outranks Confidential. This was the baseline behaviour for both IP
   columns of the demo, not something the new matcher introduced; the expectation (Confidential) is right, so the
   phone check now rejects `^(\d{1,3}\.){3}\d{1,3}$` and one test was added to `tokens.test.ts` (9 there now).
5. GREEN. `npx vitest run --reporter=verbose` → `qa/green-token-boundary.txt`:
   ```
    Test Files  4 passed (4)
         Tests  58 passed (58)
   ```
   The file split is 38 (`classify.test.ts`) + 9 (`tokens.test.ts`) + 10 (`safe.test.ts`) + 1 (`validate-demo.test.ts`).
   After the RED runs, one `describe` title and one `it` title in `classify.test.ts` were renamed to the neutral
   labels `sixth-review follow-ups` / "pinned in the sixth review" (label text only — no assertion, id or count
   changed). The three RED captures were patched afterwards by a label-rename script (they now read
   `sixth review follow-ups`) and each carries a header note stating that labels were renamed after capture; the GREEN
   capture was recorded after the rename, so it is a byte-exact capture of the current labels.

### Build and audit

`npm run build` → `qa/build-2026-10.txt`:
```
> tsc --noEmit -p tsconfig.json && vite build
dist/assets/index-K8PJuqRQ.css                                          16.37 kB │ gzip:  6.43 kB
dist/assets/index-Cs97li_X.js                                          274.82 kB │ gzip: 86.50 kB
✓ built in 1.33s
```
The build's first step is the project's own typecheck (`tsc --noEmit -p tsconfig.json`, covering `src/**` including the
tests and `vite.config.ts`); it reported no errors.

`npm audit --audit-level=high` → `qa/audit-2026-10.txt`:
```
found 0 vulnerabilities
```
(The CSS figure above is superseded by the font-asset follow-up below; the JS bundle is unchanged.)

### Production CSP and font assets (follow-up, 2026-10-04)

The lead's browser survey served the built `dist/` with this app's own `vercel.json` response headers and measured,
on every load in both viewports, two CSP violations and one console error: Vite had inlined one font subset smaller
than its 4 KiB default as a `url(data:font/woff2;base64,…)` inside the compiled stylesheet, and `font-src 'self'`
(no `data:`) blocks it. Before the change, `grep -c "data:font" dist/assets/*.css` printed `1` for this app. The CSP
was **not** widened; instead `vite.config.ts` now sets `build.assetsInlineLimit: 0` so every asset ships as a file.
Rebuilt with `npm run build` → `qa/build-fonts-2026-10.txt`:
```
> tsc --noEmit -p tsconfig.json && vite build
dist/assets/martian-mono-cyrillic-ext-wght-normal-DAknEryR.woff2         3.17 kB
dist/assets/index-BbZ7Cc-M.css                                          12.17 kB │ gzip:  2.93 kB
dist/assets/index-K4Ggek5Z.js                                          274.82 kB │ gzip: 86.50 kB
✓ built in 1.65s
```
The 3.17 kB Martian Mono subset is the asset that used to be inlined; the stylesheet shrank from 16.37 kB to 12.17 kB
and `grep -c "data:font" dist/assets/*.css` now prints `0`. The repository-level dist checker (`check-dist`)
reports the rebuilt output as OK, and the suite was re-run afterwards → `qa/green-final-2026-10.txt`:
```
 Test Files  4 passed (4)
      Tests  58 passed (58)
```
Whether the production CSP is now honoured in a real browser is measured by the lead's harness, not by this document.

### Accessibility of the new UI (not browser-measured)

No axe run was performed in this round; the statements below come from reading the code and computing WCAG ratios by
hand (sRGB relative luminance, (L1+0.05)/(L2+0.05)):

- "Match mode" is a native `<select>` inside the existing labelled `.field` pattern (label `--slate #4a4f5c` on the
  white card = **8.19:1**), keyboard operable with the existing `:focus-visible` ring; the default is whole-token.
- Suppressed waterfall rows render at opacity 0.85 but the meaning is carried by text ("Suppressed: …" and the outcome
  word in the right column), not by opacity: the reason text (`--slate` at 0.85 over white ≈ `#656974`) = **5.49:1**,
  the rule name (`--graphite` at 0.85) = **10.3:1**.
- No animation was added, so `prefers-reduced-motion` behaviour is unchanged.

### Referenced files

Every relative path referenced in README/AUDIT/EVIDENCE/INTERVIEW_GUIDE resolves in this repository: the earlier
RED/GREEN captures (`qa/red-classify.txt`, `qa/red-phone.txt`, `qa/red-declared-stricter.txt`,
`qa/green-declared-stricter.txt`, `qa/safe-fixture-red.txt`, `qa/safe-fixture-green.txt`), `qa/workflow.mjs`,
`qa/screens/workflow-log.txt`, `qa/audit/browser-audit.json`, `scripts/generate-fixture.mjs`, `src/fixtures/demo.json`,
and this round's `qa/red-token-boundary.txt`, `qa/red-token-boundary-2.txt`, `qa/red-ip-phone.txt`,
`qa/green-token-boundary.txt`, `qa/build-2026-10.txt`, `qa/audit-2026-10.txt`, `qa/build-fonts-2026-10.txt`,
`qa/green-final-2026-10.txt`.

The two pre-existing captures `qa/safe-fixture-red.txt` and `qa/safe-fixture-green.txt` quoted, in their vitest `RUN`
banner, the working directory of the original build environment rather than a repository path. On 2026-10-04 that
prefix was replaced by the marker `<original-build>/` and a header note was inserted saying so; results, counts and
test ids are unchanged. The files they exercised are `src/fixtures/validate-demo.test.ts` and `src/fixtures/demo.json`
here.

### Artefact inventory

Nothing referenced by the four documents is absent from the repository. The only external dependency of the QA
material is the `playwright` package imported by the browser workflow script — deliberately not declared as a
dependency of this app (the script expects it on `NODE_PATH`); it was not run in this round.
