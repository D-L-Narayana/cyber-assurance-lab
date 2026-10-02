# Evidence — Packetsmith

Measured 2026-10-01, Node v20.20.1 / npm 10.8.2, Linux sandbox.

## RED → GREEN

1. `tests/engine.test.ts` (31 tests) written against the planned API; stubs that throw `not implemented` added so the file collects.
2. RED run (`qa/red-engine.txt`): **30 failed | 1 passed (31)** — only the catalog-shape test passed because the catalog existed.
3. `sha256.ts` implemented first → 3 sha256 tests green (FIPS vectors, `node:crypto` oracle on multi-byte/55/56/64/1000-byte inputs, WebCrypto agreement).
4. `packet.ts` + `validate.ts` + fixture generator → **29 passed, 2 failed**: (a) memo disclaimer regex did not match because `**not**` was bold-wrapped; (b) the unknown-`state` message did not name the field. Both fixed in source.
5. GREEN: `Tests 31 passed (31)` (`qa/green-engine.txt`).

## Build

`npm run build` → `✓ built`. Type-checking covers tests too (`@types/node` added for the `node:crypto` oracle).

## Audit

`npm audit` → `found 0 vulnerabilities` (vitest 4.1.11 via `--legacy-peer-deps`, see track HANDOFF for the npm 10.8.2 crash).

## Browser QA (http://127.0.0.1:6121/)

- `tools/browser_audit.mjs`: first run → **1 serious axe violation (color-contrast, 42 nodes)** from `--ink-3` and a 0.6-opacity index entry, plus **mobile overflow 426 > 375** from nowrap labels and grid children without `min-width: 0`. Three CSS iterations later: **0 violations, 0 page errors, no overflow at 1440 / 768 / 375** (`qa/audit/`).
- `qa/workflow.mjs`: **18/18** — demo gate shows blockers and the tampered artifact; submit refused with reasons; new packet → AC-6 scoped, artifact hashed, step performed and attached, results recorded, stamp "satisfied", gate clear; submit as assessor; approval by assessor refused (separation of duties); approval by approver; editing locked; memo dialog; Markdown memo has digest + disclaimer; exported packet carries 2 history entries; malformed import rejected; no console errors; mobile no overflow. Screenshots `qa/screens/01…07`.

## Sixth-Fable review fixes (test-first)

Review noted: validator accepted `assessor === approver` (packet silently unapprovable) and an imported packet whose history said approved while `state` was `drafting`. Four regression tests first — RED **4 failed | 31 passed** (`qa/red-engine.txt`). Fix: `completeness()` flags `assessor === approver` as a blocker (`ref: meta.approver`) so the SoD problem is visible before anyone tries to approve, while the approve transition still independently refuses the assessor (existing SoD demo unchanged, 18/18); the validator refuses `assessor === approver`, non-chaining history, a final history entry that disagrees with `state`, and any history that reached `approved` with a different state. README gains *What approval does and does not mean* (session-only immutability, offline-editable export, digest excludes state/history, hashes ≠ signatures, self-asserted names); AUDIT updated. GREEN **35 passed (35)**. Build ✓; workflow 18/18; axe 0.

## Resume-usable measured facts

31 unit tests (test-first); self-written SHA-256 verified against FIPS 180-4 vectors and two independent oracles; 12-control SP 800-53 Rev. 5 subset with 3-method procedures; 4-state packet lifecycle with separation-of-duties enforcement; 0 axe violations at 3 viewports.

## Not claimed

No real assessment performed; no FedRAMP/RMF artefacts; no cross-browser matrix (Chromium headless only).
