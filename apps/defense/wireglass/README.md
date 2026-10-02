# Wireglass — synthetic DNS/HTTP/SMTP detection workbench

Educational prototype built October 2026. Wireglass shows how protocol fields in DNS, HTTP and SMTP logs support alert triage: generate a synthetic day of traffic, run five deterministic detection rules with tunable thresholds, inspect *why* each rule fired, pivot on a host across protocols, close alerts with an evidence note, and export a JSON report. Everything runs in the browser on synthetic text. It is **not** an IDS, performs **no packet capture or network access**, and is not a security certification.

## Key workflows
1. **Generate** — pick a scenario (`mixed-day`, `quiet-baseline`, `cdn-noise`) and a seed. The same seed always yields the same log. In `mixed-day` the CDN content-hash hostnames sit under the allowlisted `.cdn.example` suffix, so they are *suppressed by default* — clear the allowlist in the Rules tab to see the false positive fire. `cdn-noise` uses 44-character content-hash labels under `edge.media.example` (not allowlisted) so DNS-001 fires on every seed; add `.edge.media.example` to the allowlist to practise tuning.
2. **Read the lanes** — the timeline draws three protocol swim-lanes; alerts are brackets spanning their correlation window. Click a bracket or a queue row.
3. **Understand the alert** — the detail pane lists the exact measured evidence (counts, thresholds, entropy, byte sizes) and the matched events.
4. **Tune** — change thresholds or allowlists in the Rules tab. Alerts recompute instantly; closed alerts keep their notes because alert ids are content-derived.
5. **Pivot** — show every event from one host across all protocols; chains flag hosts with alerts in ≥ 2 protocols within 30 minutes.
6. **Triage** — `new → investigating → closed` with a mandatory disposition (true positive / false positive / benign expected) and note.
7. **Paste your own synthetic logs** — bounded to 5,000 lines / 200,000 characters; malformed lines are listed with line numbers.
8. **Export** — `wireglass.report/1` JSON with config, summary, alerts and triage history.

## Quickstart
```bash
npm ci
npm test          # vitest, engine tests
npm run build     # tsc + vite build (base './')
npm run dev       # http://127.0.0.1:6130
```

## Log grammar (synthetic)
```
<iso-ts> DNS  <src-ip> query <qtype> <qname> <rcode>
<iso-ts> HTTP <src-ip> <dst-ip> <method> <path> <status> <bytes> "<user-agent>"
<iso-ts> SMTP <src-ip> <server> from=<addr> to=<addr> status=<status>
```
This is a deliberately simple fixture format, not a vendor log format.

## Algorithm
- **Parser** (`src/engine/parse.ts`): line-anchored regexes, ISO-8601 UTC timestamps, IPv4 validation, HTTP byte counts capped at 13 digits, per-line errors, byte/line caps, stable sort by time.
- **Rules** (`src/engine/rules.ts`):
  - `DNS-001` label length > 40 **or** (length ≥ 20 and Shannon entropy ≥ 3.8 bits/char); suffix allowlist for CDN content-hash hostnames; grouped per source + parent zone.
  - `DNS-002` sliding window: ≥ 8 NXDOMAIN answers from one source within 60 s.
  - `HTTP-001` sliding window: ≥ 10 responses 401/403 from one source to one destination within 120 s.
  - `HTTP-002` POST/PUT ≥ 5,000,000 bytes from RFC 1918 source to non-RFC 1918 destination with a scripted user agent.
  - `SMTP-001` ≥ 10 distinct recipient domains within 10 min from a host not in the relay allowlist.
- **Correlation**: alerts grouped by source; a chain exists when ≥ 2 protocols alert within 30 minutes.
- **Alert ids**: FNV-1a over rule id + source + event ids, so the same evidence always gets the same id.
- **Triage**: explicit state machine; closing requires disposition and note; history retained.

## Architecture
`src/engine/*` is framework-free TypeScript (parse, rules, triage, report, scenario). `src/App.tsx` and `src/ui/Timeline.tsx` are presentation only. State is in React memory; a refresh resets it (export JSON to keep work). No localStorage/sessionStorage/IndexedDB.

## Tests
`src/engine/engine.test.ts` — 20 tests covering parsing (including the HTTP byte bound) (all three protocols, malformed lines, limits, timestamps), helpers (entropy, RFC 1918), each rule with a positive and a false-positive/negative fixture, deterministic ids, cross-protocol correlation, triage transitions, seeded generation, the `cdn-noise` teaching fixture firing on 25 consecutive seeds and silencing via the allowlist, the `mixed-day` CDN suppression claim, and report schema. See `EVIDENCE.md` for the recorded RED/GREEN runs.

## Data handling
Synthetic `.example` domains, RFC 1918 / TEST-NET addresses, fictional mailboxes. Pasted text is processed locally and never transmitted. Do not paste real logs into a public deployment.

## Limitations
- The log grammar is synthetic; real DNS/HTTP/SMTP logs need adapters.
- Sliding-window rules report the first qualifying window per source, not every window.
- Entropy on short labels is noisy; the length gate (≥ 20) is a heuristic, not a tunnelling detector. 32-hex content hashes clear the 3.8 bits/char entropy threshold only occasionally, which is why the teaching fixture uses 44-character labels (long-label rule) rather than relying on entropy.
- No IPv6, no TLS/SNI, no reassembly, no live traffic.
- Export is JSON only; there is no case persistence beyond the session.

## JD evidence (educational, not professional experience)
Demonstrates TCP/IP application-layer field reasoning (DNS/HTTP/SMTP), IDS-style rule logic with false-positive controls, time-window correlation, analyst triage states and plain-language explanations suitable for non-specialist readers.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; engine tests were written and run (failing) before implementation. Human review of every line has not been independently confirmed; `INTERVIEW_GUIDE.md` explains the engine, one failure case and the test rationale, and the candidate should rehearse it before presenting this project.
