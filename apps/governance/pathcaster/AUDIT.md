# AUDIT — Pathcaster

Date 2026-10-01. Educational prototype; not a certification.

## Threat model

Assets: the in-memory graph and exported review. Untrusted input: user-selected graph JSON.

| Threat | Mitigation | Residual |
|---|---|---|
| Pathological graph causing exponential traversal, memory exhaustion or a hang (self-DoS on import) | Bounds: 400 nodes, 1 200 edges, depth 12, 50 collected paths (allowed + blocked) and 4 000 node expansions per identity, per-path visited set; truncated results become `indeterminate` rather than a false verdict; regression test uses the reviewer's 60-node/359-edge graph | `hotspots` runs `reach` once per asset; still O(assets × identities × budget) |
| Dangling/self-loop/kind-mismatched edges producing wrong verdicts | `validateGraph` rejects them with bounded errors; traversal also guards lookups | — |
| Misreading "deny" semantics as a product's behaviour | README states the prototype's semantics; export carries a disclaimer | — |
| CSV formula injection | `csvCell` apostrophe prefix (whitespace/control-char aware) | — |
| XSS / eval | React escaping; SVG text nodes React-rendered; no `dangerouslySetInnerHTML` | — |
| Deployment headers | CSP `default-src 'self'`, `style-src 'unsafe-inline'` (inline bar widths), `frame-ancestors 'none'`, nosniff, no-referrer | — |

## Data flow

fixture → `parseBoundedJson` → `validateGraph` → React state → `reach`/`hotspots`/`toxicCombinations`/`whatIfRemoveEdge` (pure) → UI / `exportReview` → Blob download. No network, no storage.

## Dependency findings

`npm audit`: 0 vulnerabilities. Runtime: React, React DOM, 3 Fontsource packages.

## Accessibility

Axe: 0 violations after fixes. Identity nodes in the SVG are keyboard-focusable buttons (`role=button`, Enter/Space); the SVG is `role=group` with a text label and the identity table is the full fallback; the summary sentence is `aria-live`; colour is paired with ✓/✕/· glyphs and text pills.

## Unresolved limitations

- Heuristic hotspot ranking; no permission hierarchy inference; coarse deny granularity.
- Layout is per-query and can become tall for broad queries.
