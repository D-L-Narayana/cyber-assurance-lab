# Interview guide — Wireglass

> Rehearsal script, written in the first person for the candidate to practise. It describes how the engine works and why; it is not a record of work the candidate has already performed or reviewed. Rehearse it against the code before presenting.

## Core engine in two minutes
Three protocol parsers turn synthetic log lines into one normalised event shape `{ts, proto, src, dst, fields}`. Five rules run over those events. Two are per-event predicates (DNS label entropy/length, large scripted upload) and three are **sliding-window counters** grouped by source (NXDOMAIN burst, auth-failure burst, SMTP recipient-domain fan-out). The window scan is the classic two-pointer technique: sort by time, advance `hi`, move `lo` forward while `ts[hi] - ts[lo] > window`, and fire when `hi - lo + 1 ≥ n`. Alerts carry the exact numbers that crossed the threshold so an analyst can argue with the rule.

## One failure case I can explain
CDN asset hostnames (`f3a9c1e7….assets.cdn.example`) are 32 hex characters with entropy near 4 bits/char, which looks exactly like DNS tunnelling. The first fixture made `DNS-001` fire on them. The fix was a **suffix allowlist**, not a higher entropy threshold — raising the threshold would also hide base32 tunnelling labels. The test `DNS-001 flags a long high-entropy label and not an allowlisted CDN suffix` locks that decision in.

## Why the tests look the way they do
Every rule has a positive fixture and a negative fixture (sparse typos, three failures, internal backup, allowlisted relay). Parsing tests cover malformed lines, line/byte caps and bad timestamps because user paste is the only untrusted input. Alert ids are tested for determinism because triage notes are keyed by id and must survive threshold changes.

## What I would do next in production
Adapters for real formats (BIND/Unbound query logs, NGINX/Apache access logs, Postfix), per-rule suppression with owner and expiry, a proper case store, IPv6, and measuring precision/recall on labelled corpora before trusting any threshold.
