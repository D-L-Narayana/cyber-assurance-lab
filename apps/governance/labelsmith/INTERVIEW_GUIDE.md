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

## Production next steps

1. Sample real column statistics behind a privacy boundary (counts, shapes, entropy) instead of literal values.
2. Calibrate weights against a labelled corpus and report precision/recall per class.
3. Add an approval workflow and expiry reminders for exceptions; sign exports.
4. Map handling policies to the organisation's actual standard and cite it.
5. Connect to a catalog (e.g. a warehouse information schema) read-only.
