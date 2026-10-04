# Hashledger — file-integrity and DLP policy simulator

Educational prototype built October 2026; manifest validation hardened in the October 2026 lab-wide upgrade round. Hashledger reasons about two endpoint controls on a **synthetic in-memory fixture directory**: file-integrity monitoring (SHA-256 snapshots chained together, diffs for content/permission changes, tamper detection) and data-loss-prevention decisions (pattern-based classification → channel policy → allow / block / quarantine with a written trace), with an idempotent event ledger that opens cases. It never reads the host filesystem and never sends data anywhere.

## Key workflows
1. **Take a baseline snapshot** — every fixture file is hashed; the snapshot links to the previous chain hash.
2. **Edit a file, change its mode, add or remove one**, then **take another snapshot** — the Diff panel shows added / removed / modified / permission-only changes with before/after hashes and sizes; FIM events are recorded. The Add-file dialog takes a path, an **owner** and content, validates the whole manifest and lists every problem by field (`path: …`, `owner: …`).
3. **Classify** — each file's label (public / internal / confidential / restricted) is derived from documented signals: identifier shape, Luhn-valid card numbers, PEM private-key headers, CONFIDENTIAL markers, payroll keywords, source extensions.
4. **Simulate egress** — pick a channel (internal share, internal mail, external mail + recipient domain, USB, cloud share) and an actor. The decision card says *allowed/blocked because* with the ordered reasons and the evidence hash.
5. **Replay** the last event — the ledger rejects duplicate event ids and counts them.
6. **Cases** — block/quarantine decisions open a case carrying the hash, rule and channel; close it with a resolution note.
7. **Verify chain / simulate tamper** — recompute every chain hash; the demo tamper zeroes one stored entry hash so you can watch verification fail at the right index.
8. **Policy** — edit partner domains and the USB/cloud label caps; decisions change immediately.
9. **Export** `hashledger.report/1` JSON (classifications, snapshots, events, cases, chain status).

## Quickstart
```bash
npm ci
npm test      # vitest, 21 tests
npm run build
npm run dev   # http://127.0.0.1:6132
```

## Algorithm
- **Hashing** (`hash.ts`): `crypto.subtle.digest('SHA-256')`, hex.
- **Snapshot** (`snapshot.ts`): entries sorted by path `{path, hash, size, mode, owner}`; `chainHash = SHA-256((prevChainHash ?? 'genesis') | takenAt | canonical(entries))` and `id = 'snap-' + chainHash[0:12]`, so the capture time and id are bound to the digest; `verifyChain` recomputes each chain hash from `(prev, takenAt, entries)`, re-derives the id and checks each `prevChainHash` link.
- **Integrity, not authenticity.** The chain detects *modification* of entries, capture time, id or order after the fact. It does not prove *who* took a snapshot or that the clock was honest at capture time — there is no signature or trusted timestamp. A production FIM would sign snapshots and anchor them in append-only storage.
- **Diff**: map by path; hash mismatch → modified; same hash but different mode/owner → permission change.
- **Classification** (`classify.ts`): highest-ranked signal wins; files with no signals are `internal`; README/LICENSE/CHANGELOG without signals are `public`. Card numbers must pass Luhn — a 16-digit order number that fails Luhn is deliberately *not* a card (false-positive fixture `sales/orders_export.csv`).
- **DLP** (`dlp.ts`): ordered rules — public anywhere; internal channels record only; restricted never external; confidential external mail allowed only to partner domains else quarantine; USB/cloud capped by label.
- **Ledger** (`ledger.ts`): append-only in memory; duplicate event id → `replaysRejected++`; block/quarantine egress opens a case with hash evidence.
- **Manifest validation** (`snapshot.ts`, `validateManifest(files: unknown)`): accepts anything and never throws — a non-array manifest and non-object rows are reported as errors. Per row, in order: `path` is a string of 1–200 characters; relative, `/`-separated, with no empty, `.` or `..` segments and no backslashes; then only `[A-Za-z0-9._/-]` characters (no spaces, non-ASCII or shell metacharacters); unique. `content` is a string ≤ 65,536 characters; `mode` is four octal digits; `owner` is a printable string of 1–64 characters (no control, format, surrogate or private-use code points). Errors are path-addressed (`files[3].owner: …`) and capped at 20.

## Bounds
≤ 200 files, ≤ 65,536 characters per file, relative `/`-separated paths with no `.` or `..` segments (backslashes rejected) made only of letters, digits, `.`, `_`, `-` and `/`, four-digit octal modes, printable owners of 1–64 characters. Violations are reported field by field with the row index.

## Architecture
`src/engine/*` is framework-free TypeScript (hash, snapshot, classify, dlp, ledger, fixtures). `src/App.tsx` is presentation; the Add-file dialog collects path, owner and content and renders the validator's error list. In-memory state only; refresh resets; export to keep. The Vite build ships every font subset as a file (`assetsInlineLimit: 0`) because the deployment CSP is `font-src 'self'` without `data:`.

## Tests
21 vitest tests across two files (`vitest run` prints `Tests  21 passed (21)`):
- `engine.test.ts` (17): SHA-256 test vector, snapshot hashing and chaining, diff categories, tamper detection index, forged `takenAt`/`id`/entry-order detection (added after the sixth review as a failing test first), manifest bounds and traversal rejection including `.` segments, Luhn, classification labels (restricted/confidential/internal/public) with the Luhn false-positive fixture, DLP decisions for each rule family, ledger idempotency and case creation, fixture validity.
- `manifest.test.ts` (4): owner must be a printable 1–64 character string (empty, 65 chars, NUL, newline and a non-string rejected; 64 chars accepted); path character allow-list (space, `$`, accented letters rejected; `ok-1_2/File.TXT` accepted; `a/./b.txt` still caught by the segment rule); non-array manifests and `null`/string rows rejected without throwing, each addressed by index; the shipped fixture stays valid under the new rules (this regression guard passed already at RED, by design).
RED/GREEN runs are recorded in `EVIDENCE.md` (`qa/red-manifest-hardening.txt`, `qa/green-manifest-hardening.txt`, `qa/green-full-suite.txt`).

## Data handling
All fixture content is invented. Identifier patterns are shapes, not real numbers. Add-file dialog says to invent content. Nothing leaves the tab.

**Fake key material.** `ops/deploy_key.pem` and the private-key test fixtures contain only a PEM *header/footer marker* around a placeholder line (`SYNTHETIC-FIXTURE-NOT-A-REAL-KEY`); there is no base64 body and nothing can be parsed as a key. The `private-key-header` signal matches the `-----BEGIN … PRIVATE KEY-----` marker only, which is exactly what these fixtures exercise. Secret scanners that flag them are reporting the intentional marker, not a credential.

## Limitations
- The "filesystem" is a list of strings; there is no inotify/real FIM agent, no binary files, no ACLs beyond a mode string.
- Classification is regex-based on ≤ 64 KiB of text: no OCR, no fingerprinting, no ML, easy to evade with encoding.
- The tamper demo mutates stored history to demonstrate verification; a real system would protect the ledger with signatures or append-only storage. Chain verification is integrity-only (no authenticity).
- Luhn-valid 15-digit identifiers such as IMEI-shaped numbers are labelled as payment cards; the classifier does not distinguish card BIN ranges.
- Egress is simulated; no mail, USB or cloud integration exists.
- The path allow-list is ASCII-only by design, so fixture paths with non-ASCII names cannot be modelled.
- The qa screenshots predate the October 2026 round (the Add-file dialog gained an Owner field and a per-field error list; the rest of the UI did not change).

## JD evidence (educational, not professional experience)
Endpoint-security concepts (file-integrity monitoring, hash chains, least-privilege modes), DLP policy design with explainable decisions, case handling and evidence hashing.

## AI-assistance disclosure
Built with AI pair-programming assistance under test-first discipline; tests were run failing before implementation, in the original build and in the October 2026 round. Human review of all logic has not been independently confirmed; `INTERVIEW_GUIDE.md` is provided and the candidate should rehearse it before presenting this project.
