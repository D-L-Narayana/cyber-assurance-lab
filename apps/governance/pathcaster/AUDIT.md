# AUDIT — Pathcaster

Date 2026-10-01. Educational prototype; not a certification.

## Threat model

Assets: the in-memory graph and exported review. Untrusted input: user-selected graph JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Pathological graph causing exponential traversal, memory exhaustion or a hang (self-DoS on import) | Bounds: 400 nodes, 1 200 edges, depth 12, 50 collected paths (allowed + blocked) and 4 000 node expansions per identity, per-path visited set; truncated results become `indeterminate` rather than a false verdict; regression test uses the reviewer's 60-node/359-edge graph | `hotspots` runs `reach` once per asset; still O(assets × identities × budget) |
| Dangling/self-loop/kind-mismatched edges producing wrong verdicts | `validateGraph` rejects them with bounded errors; traversal also guards lookups | — |
| Misreading "deny" semantics as a product's behaviour | README states the prototype's semantics; export carries a disclaimer | — |
| Hierarchy option (October 2026) mistaken for the graph's own semantics, or a reviewer forgetting which mode a review used | Off by default; the summary sentence, the UI label and the export's `query.hierarchy` state when it was applied; denies on the permission actually used still apply because deny hits are computed over the permissions on the found paths | A reviewer who leaves it off sees the narrower picture; the fixed order admin ⊃ write ⊃ read may not match a given product |
| CSV formula injection | `csvCell` apostrophe prefix (whitespace/control-char aware) | — |
| XSS / eval | React escaping; SVG text nodes React-rendered; no `dangerouslySetInnerHTML` | — |
| Deployment headers | Canonical lab-wide set (see "Security headers" below): CSP `default-src 'none'` with explicit `'self'` sources, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; nosniff, DENY, no-referrer, Permissions-Policy, COOP, CORP, HSTS | Headers exist only on the Vercel deployment; `vite preview` serves without them |

## Security headers

`vercel.json` (updated in the October 2026 lab-wide round to the canonical set shared by all 25 apps) sends, for every path:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` — `style-src 'unsafe-inline'` stays for the inline hotspot bar widths and SVG presentation attributes; `form-action 'none'` is compatible because the UI has no `<form>` element. Fonts are self-hosted Fontsource packages, and since the October 2026 round `vite.config.ts` sets `build.assetsInlineLimit: 0` so that every font subset ships as a file: the previous build inlined one sub-4 KiB subset as a `data:font/woff2` URL in the CSS, which `font-src 'self'` blocks (two CSP violations and one console error per load were measured by the lead's browser survey under the production headers). The CSP was not widened; the asset was moved out of the stylesheet (see EVIDENCE.md).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

Previously the CSP used `default-src 'self'`, `base-uri 'self'`, `form-action 'self'` and omitted CORP and HSTS.

## Data flow

fixture → `parseBoundedJson` → `validateGraph` → React state → `reach`/`hotspots`/`toxicCombinations`/`whatIfRemoveEdge` (pure) → UI / `exportReview` → Blob download. No network, no storage.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime: React, React DOM, 3 Fontsource packages.

## Accessibility

Axe: 0 violations after fixes. Identity nodes in the SVG are keyboard-focusable buttons (`role=button`, Enter/Space); the SVG is `role=group` with a text label and the identity table is the full fallback; the summary sentence is `aria-live`; colour is paired with ✓/✕/· glyphs and text pills.

## Unresolved limitations

- Heuristic hotspot ranking; permission hierarchy is a fixed opt-in query option (admin ⊃ write ⊃ read), not inferred or configurable; coarse deny granularity.
- Layout is per-query and can become tall for broad queries.
