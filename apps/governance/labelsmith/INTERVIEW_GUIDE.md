# INTERVIEW GUIDE — Labelsmith

## Core engine in two minutes

Classification here is a *ranked precedence* problem, not a probability problem. Every rule declares a class and a weight. All rules run on every field and leave a trace line. The winner is the matched rule with the highest sensitivity rank — so a column that looks like an email *and* like an API key is Secret · Credential, because leaking a credential is worse than leaking an email. Confidence is computed only from rules that agree with the winner, combined as `1 − Π(1 − w)`, so two moderate pieces of evidence beat one. Anything below 0.6, any declared/computed mismatch and any no-match goes to review; no-match without a declared class is **Unknown**, which has its own conservative handling policy ("treat as confidential until reviewed").

## One failure case

`cardholder_reference` holds random 16-digit strings. The Luhn rule correctly says `0/6 samples match`. But the first version of the phone-shape check accepted any 8+ digit string, so the field was labelled Restricted · PII with 0.5 confidence — plausible-looking and wrong. The fix was a domain fact: E.164 numbers have at most 15 digits. I wrote the failing test first (`checkValue('phone', '4539148803436468') === false`), then bounded the check. The lesson: value-shape heuristics need *upper* bounds as much as lower bounds, and the trace made the false positive visible in seconds.

## Why the tests look like this

- Precedence and gating are tested with adversarial fields (credential + PII name; Luhn-invalid digits) rather than happy paths.
- The trace test asserts one entry per rule in order and at least one `skipped` reason, because the explainability is the product.
- Exception rules (downgrade-only, ≥ 20 chars, ≤ 365 days, `fromClass` must equal computed) are enumerated individually so each guard can fail on its own.
- Keyword rules are tested for regex metacharacters because user-supplied patterns are the classic ReDoS entry point.

## Q: You replaced substring matching with token-boundary matching. What did it fix, what did it not, and how did you keep the true positives?

The first release matched keywords as substrings, so `token` fired on `tokenizer_version`, `health` on `healthcheck_status`, `city` on `velocity`, and any md5 column looked like an API key — all documented as known false positives. The October 2026 round tokenises the normalised name (underscores, camelCase humps, acronym runs, letter→digit boundaries) and requires a keyword to equal a whole token or a contiguous token sequence, so `card_number` still matches `card_number_last4` but `pan` cannot match `span`. On top of that, a short allow-list of metadata words (`version`, `count`, `verified`…) discounts *name* evidence of sensitive rules — `email_verified` is a boolean about an email, not an email — and per-rule exception tokens veto a rule outright (`ip_address` is not a postal address; `created_at` is not a birth date). Bare hex became its own Confidential rule at weight 0.5 that steps aside when the name says credential. The true positives were protected three ways: every existing test and the demo-fixture test stayed in the suite unchanged, I reviewed all 31 built-ins one by one and kept substring mode only for the password stem (glued legacy names like `userpassword`, and no ordinary word contains it), and value evidence is never discounted, so `verified_email` with email samples is still PII. What it does not fix is semantics — `budget`, `forecast`, `expiry` are ambiguous whole words, 8–15-digit ids still look like phones, dash-less UUIDs look like digests — and the allow-list can produce false negatives when a column has an allow-listed word and no samples. Those are listed in the README rather than hidden, and the waterfall now prints `Suppressed:` with the token that fired or vetoed so a reviewer can see why.

## Production next steps

1. Sample real column statistics behind a privacy boundary (counts, shapes, entropy) instead of literal values.
2. Calibrate weights against a labelled corpus and report precision/recall per class.
3. Add an approval workflow and expiry reminders for exceptions; sign exports.
4. Map handling policies to the organisation's actual standard and cite it.
5. Connect to a catalog (e.g. a warehouse information schema) read-only.
