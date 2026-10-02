# AUDIT.md — Forethought

Self-review, 1 Oct 2026.

## Threat model

**Assets:** in-memory assessment, exported JSON, printed PDF. **Boundary:** single tab; no backend, auth or persistence. **Untrusted input:** imported assessment JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Oversized / hostile nesting | byte check before parse; iterative bounded depth check (≤ 6) that cannot overflow the stack; list caps | ≤ 500 kB parsed |
| Unknown ids steering scores | question, option and mitigation ids validated against the rubric; unknown keys dropped | rubric itself is code |
| Fake sign-off | blockers computed from the same scorecard the UI shows; `signOff` throws with the blocker list; signatures bound to a content hash and shown stale after edits | hash binding ≠ identity signature |
| Mitigation theatre | planned mitigations never reduce residual; evidence-required ones need a reference when verified, else they block | reference is a free-text pointer |
| XSS via fixture text | React escaping; CSP `script-src 'self'` | `style-src 'unsafe-inline'` for Radix |
| Exfiltration | no network after load (QA: local host only); no storage APIs; export/print are user-initiated | none known |
| Clickjacking / sniffing | security headers in `vercel.json` | applies when hosted with the config |

## Data flow

Fixture → `parseAssessment` → state → `score` / `signOffBlockers` / `executiveSummary` (pure) + `contentHash`/`signOff`/`snapshot` (async, Web Crypto) → views → download / print.

## Dependencies

`npm audit` 1 Oct 2026: 0 vulnerabilities. Lockfile committed. Unused `@radix-ui/react-tabs` removed before handoff.

## Accessibility and QA

Playwright + axe at 1440/768/375. Initial run: `color-contrast` on the low band tag (`#4d7560` → `#3a5d4a`, 6.20:1); horizontal overflow at 768/375 from the six-column flows table and a `<details>` import popover → table wrapped in a focusable scroll region, popover replaced by a Radix dialog. Final run: 0 violations, 0 page overflow, 0 console/page errors; 10-step workflow replay. Radio groups use native inputs inside `fieldset/legend`; the constellation SVG carries a full textual summary in its accessible name and the analyst table is the non-visual equivalent.

## Unresolved limitations

- Print layout has not been checked on paper sizes other than A4/Letter defaults.
- Version diffs for imported histories are summarised as "content changed".
- Light theme only.
