import { parseCidr, parsePorts, ANY_PORT, type Interval } from './net';
import type { Rule } from './rules';

/**
 * Partial-shadow coverage by axis-aligned box subtraction.
 *
 * A rule's match space, per protocol, is a set of boxes over (source interval × destination interval × port interval).
 * `subtractBoxes` removes a sequence of covering boxes from a target box and returns the uncovered remainder as disjoint
 * fragments; `coverage` turns that into "what share of this rule's space do earlier rules already match". This is a
 * UNION over address space — deliberately broader than the containment-based shadow analysis in `analyze.ts`, which only
 * considers earlier rules that fully contain the later rule. Volumes are BigInt because 2^32 · 2^32 · 2^16 = 2^80
 * overflows a double's exact integer range.
 */
export interface Box { src: Interval; dst: Interval; ports: Interval }
export type BoxProto = 'tcp' | 'udp' | 'icmp';
export type RuleBoxes = Partial<Record<BoxProto, Box[]>>;
export interface Coverage {
  /** 1 − Σ uncovered volume / Σ target volume across the rule's protocol boxes, clamped to [0, 1]. */
  fraction: number;
  /** Earlier rules (in rule order) that removed at least some volume that no rule before them had already removed. */
  coveringRuleIds: string[];
  /** True when the fragment budget was reached: later covering rules were not subtracted, so `fraction` is a lower bound. */
  approximate: boolean;
}

/** Maximum number of remainder fragments held per target box before subtraction stops (R12 traversal budget). */
export const DEFAULT_FRAGMENT_BUDGET = 4000;
const PROTOS: BoxProto[] = ['tcp', 'udp', 'icmp'];

/** Zone semantics shared with `analyze.ts`: `any` covers every zone, otherwise string equality. */
export const zoneCovers = (outer: string, inner: string) => outer === 'any' || outer === inner;

const span = (iv: Interval) => BigInt(iv.hi - iv.lo + 1);
/** addresses × addresses × ports. any/any/any = 2^80. */
export function volume(b: Box): bigint { return span(b.src) * span(b.dst) * span(b.ports); }

/**
 * Boxes per protocol. `proto any` expands to tcp/udp/icmp; an `icmp` rule occupies the full port interval (as the
 * containment analysis models it), while a `proto any` rule with specific ports keeps those ports on its icmp box too
 * (so it never fully covers an ICMP rule — the same conservative asymmetry as `analyze.ts`). Returns null when the rule's
 * addresses or ports do not parse.
 */
export function ruleBoxes(r: Rule): RuleBoxes | null {
  const src = parseCidr(r.src), dst = parseCidr(r.dst), ports = parsePorts(r.ports);
  if (!src || !dst || !ports) return null;
  const protos: BoxProto[] = r.proto === 'any' ? PROTOS : [r.proto];
  const portIvs = r.proto === 'icmp' ? [{ ...ANY_PORT }] : ports;
  const out: RuleBoxes = {};
  for (const p of protos) out[p] = portIvs.map(iv => ({ src: { ...src }, dst: { ...dst }, ports: { ...iv } }));
  return out;
}

const ivOverlaps = (a: Interval, b: Interval) => a.lo <= b.hi && b.lo <= a.hi;
const boxesOverlap = (a: Box, b: Box) => ivOverlaps(a.src, b.src) && ivOverlaps(a.dst, b.dst) && ivOverlaps(a.ports, b.ports);

/** Precondition: t and c overlap. Pushes the parts of t outside c — split along src, then dst, then ports — onto out. */
function pushOutside(t: Box, c: Box, out: Box[]): void {
  const s = { lo: Math.max(t.src.lo, c.src.lo), hi: Math.min(t.src.hi, c.src.hi) };
  if (t.src.lo < s.lo) out.push({ src: { lo: t.src.lo, hi: s.lo - 1 }, dst: t.dst, ports: t.ports });
  if (s.hi < t.src.hi) out.push({ src: { lo: s.hi + 1, hi: t.src.hi }, dst: t.dst, ports: t.ports });
  const d = { lo: Math.max(t.dst.lo, c.dst.lo), hi: Math.min(t.dst.hi, c.dst.hi) };
  if (t.dst.lo < d.lo) out.push({ src: s, dst: { lo: t.dst.lo, hi: d.lo - 1 }, ports: t.ports });
  if (d.hi < t.dst.hi) out.push({ src: s, dst: { lo: d.hi + 1, hi: t.dst.hi }, ports: t.ports });
  const p = { lo: Math.max(t.ports.lo, c.ports.lo), hi: Math.min(t.ports.hi, c.ports.hi) };
  if (t.ports.lo < p.lo) out.push({ src: s, dst: d, ports: { lo: t.ports.lo, hi: p.lo - 1 } });
  if (p.hi < t.ports.hi) out.push({ src: s, dst: d, ports: { lo: p.hi + 1, hi: t.ports.hi } });
}

interface Subtraction { remainder: Box[]; approximate: boolean; applied: number; contributed: boolean[] }

/**
 * Subtract covers in order. Fragments never exceed `budget`: when applying the next cover would push the count over the
 * budget, that cover and all later ones are skipped (all-or-nothing per cover, so the remainder is exactly
 * "target minus the first `applied` covers") and `approximate` is set. `contributed[k]` is true when cover k removed
 * volume that no earlier cover had already removed.
 */
function subtractDetailed(target: Box, covers: Box[], budget: number): Subtraction {
  const cap = Math.max(1, Math.floor(budget));
  let remainder: Box[] = [target];
  const contributed: boolean[] = covers.map(() => false);
  for (let k = 0; k < covers.length; k++) {
    const c = covers[k];
    const next: Box[] = [];
    let hit = false, over = false;
    for (const t of remainder) {
      if (boxesOverlap(t, c)) { hit = true; pushOutside(t, c, next); } else next.push(t);
      if (next.length > cap) { over = true; break; }
    }
    if (over) return { remainder, approximate: true, applied: k, contributed };
    remainder = next;
    contributed[k] = hit;
    if (!remainder.length) return { remainder, approximate: false, applied: covers.length, contributed };
  }
  return { remainder, approximate: false, applied: covers.length, contributed };
}

/** 3-D interval subtraction: the parts of `target` not inside any of `covers`, as disjoint boxes (see subtractDetailed). */
export function subtractBoxes(target: Box, covers: Box[], budget: number = DEFAULT_FRAGMENT_BUDGET): { remainder: Box[]; approximate: boolean } {
  const { remainder, approximate } = subtractDetailed(target, covers, budget);
  return { remainder, approximate };
}

const NONE: Coverage = { fraction: 0, coveringRuleIds: [], approximate: false };

/**
 * Share of `rule`'s match space already matched by `earlierRules` (enabled, zones covering the rule), as a union across
 * address space per protocol. Rule order is first-match order: a later earlier-rule is credited only for volume that no
 * rule before it already removed.
 */
export function coverage(rule: Rule, earlierRules: Rule[], budget: number = DEFAULT_FRAGMENT_BUDGET): Coverage {
  const targets = ruleBoxes(rule);
  if (!targets) return { ...NONE, coveringRuleIds: [] };
  const candidates: { id: string; boxes: RuleBoxes }[] = [];
  for (const e of earlierRules) {
    if (!e.enabled || !zoneCovers(e.zoneFrom, rule.zoneFrom) || !zoneCovers(e.zoneTo, rule.zoneTo)) continue;
    const b = ruleBoxes(e);
    if (b) candidates.push({ id: e.id, boxes: b });
  }
  let total = 0n, uncovered = 0n, approximate = false;
  const credited = new Set<string>();
  for (const proto of PROTOS) {
    const tBoxes = targets[proto];
    if (!tBoxes) continue;
    const covers: Box[] = []; const owner: number[] = [];
    candidates.forEach((cand, i) => { for (const b of cand.boxes[proto] ?? []) { covers.push(b); owner.push(i); } });
    for (const t of tBoxes) {
      total += volume(t);
      const s = subtractDetailed(t, covers, budget);
      for (const f of s.remainder) uncovered += volume(f);
      if (s.approximate) approximate = true;
      s.contributed.forEach((hit, k) => { if (hit) credited.add(candidates[owner[k]].id); });
    }
  }
  if (total === 0n) return { ...NONE, coveringRuleIds: [] };
  const fraction = Math.min(1, Math.max(0, 1 - Number(uncovered) / Number(total)));
  return { fraction, coveringRuleIds: candidates.filter(c => credited.has(c.id)).map(c => c.id), approximate };
}

/** Whole-percent label that never rounds a partial cover up to 100% or down to 0%. */
export function formatCoverage(fraction: number): string {
  if (fraction >= 1) return '100%';
  if (fraction <= 0) return '0%';
  const pct = Math.round(fraction * 100);
  if (pct >= 100) return '>99%';
  if (pct <= 0) return '<1%';
  return `${pct}%`;
}
