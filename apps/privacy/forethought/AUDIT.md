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
| Imported `versions[].content` (new optional field, October 2026) steering a change summary or bloating state | optional; when present it must be a string ≤ 64 KiB that parses as canonical content (`fromCanonical`), otherwise the file is rejected with the path; before any diff, `snapshot` re-hashes the stored content and requires it to equal that version's `contentHash` | a forged but self-consistent hash+content pair yields a forged *change summary* only — never a changed score, blocker or signature status |

## Security headers

`vercel.json` applies the lab-wide canonical header set to every path (`/(.*)`), with `cleanUrls: true`:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

`form-action 'none'` is compatible because both `<form>`s (add a data flow, record a risk acceptance) handle `onSubmit` with `preventDefault()` and never navigate; `style-src 'unsafe-inline'` remains for Radix inline style attributes. Fonts ship as files: `vite.config.ts` sets `build.assetsInlineLimit: 0`, because the October 2026 browser review (the built `dist/` served with these headers) found one small font subset inlined into the CSS as a `data:` URL, which `font-src 'self'` blocks (2 CSP violations and 1 console error per load); the CSP was not widened — the build was changed so the policy is honoured (measurements in EVIDENCE.md). The October 2026 round replaced the earlier `default-src 'self'` / `base-uri 'self'` / `form-action 'self'` / `upgrade-insecure-requests` / `interest-cohort=()` variant. The headers apply only when the built `dist/` is served through Vercel with this file.

## Data flow

Fixture → `parseAssessment` → state → `score` / `signOffBlockers` / `executiveSummary` (pure) + `contentHash`/`signOff`/`snapshot` (async, Web Crypto) → views → download / print.

## Dependencies

`npm audit` 1 Oct 2026: 0 vulnerabilities. Lockfile committed. Unused `@radix-ui/react-tabs` removed before handoff.

## Accessibility and QA

Playwright + axe at 1440/768/375. Initial run: `color-contrast` on the low band tag (`#4d7560` → `#3a5d4a`, 6.20:1); horizontal overflow at 768/375 from the six-column flows table and a `<details>` import popover → table wrapped in a focusable scroll region, popover replaced by a Radix dialog. Final run: 0 violations, 0 page overflow, 0 console/page errors; 10-step workflow replay. Radio groups use native inputs inside `fieldset/legend`; the constellation SVG carries a full textual summary in its accessible name and the analyst table is the non-visual equivalent.

## Unresolved limitations

- Print layout has not been checked on paper sizes other than A4/Letter defaults.
- Version diffs for imported histories are summarised as "content changed". *(October 2026: now true only for versions recorded without retained content — legacy files or canonical content above 64 KiB; files exported by this version carry the content and diff field by field.)*
- Light theme only.
