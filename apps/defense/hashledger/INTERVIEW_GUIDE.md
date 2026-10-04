# Interview guide — Hashledger

> Rehearsal script, written in the first person for the candidate to practise. It describes how the engine works and why; it is not a record of work the candidate has already performed or reviewed. Rehearse it against the code before presenting.

## Core engine
A snapshot is the sorted list of `{path, sha256, size, mode, owner}`. The chain hash is SHA-256 over the previous chain hash plus a canonical serialisation of the entries, so each snapshot commits to its whole history. Verification recomputes every chain hash and checks the previous-link pointer. Diffing is a map join by path with three outcomes: new/removed, hash changed, or hash equal but mode/owner changed. Classification picks the highest-ranked matched signal; DLP applies ordered rules keyed on label × channel; the ledger is append-only with id-based replay rejection and opens a case for block/quarantine.

## One failure case
Order numbers in `sales/orders_export.csv` are 16 digits and were first flagged as payment cards, making a harmless export "restricted". The fix was to require a Luhn-valid checksum before counting a digit run as a card — the real control works the same way. The test *does not treat Luhn-invalid 16-digit order numbers as payment data* keeps that behaviour honest, and the fixture is deliberately kept so reviewers can see a false positive that was engineered away rather than ignored.

## A second failure case, found in review
The chain originally hashed only the entries, so a reviewer could set a snapshot's `takenAt` to 2020 and rename its id while `verifyChain` still said OK — for FIM evidence the capture time *is* part of the claim. The fix hashes `(prev | takenAt | entries)` and derives the id from the digest, with a failing test first (forged time, forged id, reordered entries). I would also say plainly that this is integrity, not authenticity: without a signature nobody can prove who took the snapshot.

## "Why does a manifest validator care about the owner field and a path character set?" (October 2026 round)
Because both end up inside the chain hash. `canonical()` serialises `path\0hash\0size\0mode\0owner` per entry, so a snapshot's integrity claim is only as meaningful as the fields it commits to. Before this round `owner` was never checked — an empty string, a 5,000-character string or a control character would have been hashed without complaint — and a path could contain a space, a zero-width character or a Cyrillic "а", which lets two visually identical paths coexist in one manifest and in one diff. The hardened `validateManifest` takes `unknown`, never throws (a `null` row used to crash it with `Cannot read properties of null`), and checks in a fixed order: path length, then the segment rules (`.`/`..`/empty/absolute/backslash), then the allow-list `^[A-Za-z0-9._/-]+$`, then uniqueness; content length; octal mode; and `owner` as a printable string of 1–64 characters. Every error is addressed as `files[3].owner: …`, and the Add-file dialog strips its own row index and lists what is wrong instead of showing only the first message. The tests were written first and failed on behaviour — empty owner accepted, `team notes.md` accepted, `null` row throwing — while the fourth test (the shipped fixture stays valid) already passed at RED, which is exactly what a regression guard should do.

## Why the tests look like this
The hash function is pinned to the published SHA-256 test vector for "abc". Chain tests mutate a stored hash and assert the exact broken index, because an integrity control that cannot localise tampering is not useful. DLP tests cover each rule family with an allow and a deny. Ledger tests apply the same event twice and assert one case and one rejected replay.

## Next steps in production
Signed snapshots (Ed25519) and an append-only store; real file watchers with inode/ctime; exact-data-match and fingerprinting for DLP; reviewer release workflow for quarantines; and metrics on false-positive rates before any block mode is enabled.
