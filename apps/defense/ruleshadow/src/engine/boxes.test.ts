import { describe, it, expect } from 'vitest';
import { parseCidr, parsePorts, ANY_V4, ANY_PORT } from './net';
import type { Rule } from './rules';
import { volume, ruleBoxes, subtractBoxes, coverage, zoneCovers, formatCoverage, DEFAULT_FRAGMENT_BUDGET, type Box } from './boxes';

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r', seq: 1, action: 'allow', src: '10.0.0.0/8', dst: '10.0.5.10/32', proto: 'tcp', ports: '443',
  zoneFrom: 'corp', zoneTo: 'dmz', enabled: true, owner: 'netops', expires: '', lastHit: '2026-09-20', comment: '', ...over,
});
const box = (src: string, dst: string, ports: string): Box => ({ src: parseCidr(src)!, dst: parseCidr(dst)!, ports: parsePorts(ports)![0] });
const ANY_BOX: Box = { src: { ...ANY_V4 }, dst: { ...ANY_V4 }, ports: { ...ANY_PORT } };
const sum = (boxes: Box[]) => boxes.reduce((acc, b) => acc + volume(b), 0n);

// Pathological "slab" rule sets: n src slabs, n dst slabs and n port slabs, deliberately non-adjacent (odd /8 blocks,
// port ranges with 100-port gaps) so every slab splits every fragment it crosses: the exact remainder of an any/any/any
// target has (n+1)^3 fragments.
const srcSlab = (i: number, seq: number) => rule({ id: `S${i}`, seq, src: `${2 * i + 1}.0.0.0/8`, dst: 'any', ports: 'any', zoneFrom: 'any', zoneTo: 'any' });
const dstSlab = (i: number, seq: number) => rule({ id: `D${i}`, seq, src: 'any', dst: `${2 * i + 1}.0.0.0/8`, ports: 'any', zoneFrom: 'any', zoneTo: 'any' });
const portSlab = (i: number, seq: number) => rule({ id: `P${i}`, seq, src: 'any', dst: 'any', ports: `${200 * i + 100}-${200 * i + 199}`, zoneFrom: 'any', zoneTo: 'any' });
const slabs = (n: number): Rule[] => [
  ...Array.from({ length: n }, (_, i) => srcSlab(i, i + 1)),
  ...Array.from({ length: n }, (_, i) => dstSlab(i, n + i + 1)),
  ...Array.from({ length: n }, (_, i) => portSlab(i, 2 * n + i + 1)),
];
const slabBoxes = (n: number): Box[] => slabs(n).map(r => ruleBoxes(r)!.tcp![0]);
const TARGET_ANY = rule({ id: 'T', seq: 10_000, src: 'any', dst: 'any', ports: 'any' });
// Exact uncovered volume of the any/any/any target after n slabs per axis: (2^32 − n·2^24)^2 · (65536 − 100n).
const exactRemainder = (n: number) => (2n ** 32n - BigInt(n) * 2n ** 24n) ** 2n * (65536n - 100n * BigInt(n));

describe('boxes: volumes', () => {
  it('computes BigInt volumes: any/any/any is 2^80, a host-to-host single port is 1', () => {
    expect(volume(ANY_BOX)).toBe(2n ** 80n);
    expect(volume(box('10.0.0.1/32', '10.0.0.2/32', '443'))).toBe(1n);
    expect(volume(box('10.0.0.0/8', 'any', 'any'))).toBe(2n ** 72n);
    expect(volume(box('10.0.0.0/24', '10.0.1.0/24', '80-443'))).toBe(256n * 256n * 364n);
  });
  it('builds per-protocol boxes: any → tcp/udp/icmp, icmp → full port interval, port lists → one box per interval', () => {
    const anyRule = ruleBoxes(rule({ proto: 'any', ports: '443' }))!;
    expect(Object.keys(anyRule).sort()).toEqual(['icmp', 'tcp', 'udp']);
    expect(anyRule.tcp![0].ports).toEqual({ lo: 443, hi: 443 });
    expect(anyRule.icmp![0].ports).toEqual({ lo: 443, hi: 443 });
    const icmp = ruleBoxes(rule({ proto: 'icmp', ports: 'any' }))!;
    expect(Object.keys(icmp)).toEqual(['icmp']);
    expect(icmp.icmp![0].ports).toEqual({ lo: 0, hi: 65535 });
    const multi = ruleBoxes(rule({ proto: 'tcp', ports: '22,80-443' }))!;
    expect(multi.tcp!.map(b => b.ports)).toEqual([{ lo: 22, hi: 22 }, { lo: 80, hi: 443 }]);
    expect(ruleBoxes(rule({ src: 'not-a-cidr' }))).toBeNull();
  });
});

describe('boxes: subtraction', () => {
  it('leaves a disjoint target untouched and removes a containing or identical cover completely', () => {
    const t = box('10.0.0.0/8', '10.0.5.10/32', '443');
    expect(subtractBoxes(t, [box('192.168.0.0/16', '10.0.5.10/32', '443')])).toEqual({ remainder: [t], approximate: false });
    expect(subtractBoxes(t, [box('10.0.0.0/8', '10.0.5.10/32', '80')])).toEqual({ remainder: [t], approximate: false });
    expect(subtractBoxes(t, [t]).remainder).toEqual([]);
    expect(subtractBoxes(t, [box('any', 'any', 'any')]).remainder).toEqual([]);
  });
  it('splits along src, then dst, then ports: an interior cover leaves six disjoint fragments whose volumes add up', () => {
    const t = box('10.0.0.0/8', '10.1.0.0/16', '0-999');
    const c = box('10.100.0.0/16', '10.1.100.0/24', '400-499');
    const { remainder, approximate } = subtractBoxes(t, [c]);
    expect(approximate).toBe(false);
    expect(remainder).toHaveLength(6);
    expect(sum(remainder)).toBe(volume(t) - volume(c));
    // src below / src above keep the full dst and port extent of the target
    expect(remainder[0]).toEqual({ src: { lo: t.src.lo, hi: c.src.lo - 1 }, dst: t.dst, ports: t.ports });
    expect(remainder[1]).toEqual({ src: { lo: c.src.hi + 1, hi: t.src.hi }, dst: t.dst, ports: t.ports });
    for (let i = 0; i < remainder.length; i++) for (let j = i + 1; j < remainder.length; j++) {
      const a = remainder[i], b = remainder[j];
      const overlap = a.src.lo <= b.src.hi && b.src.lo <= a.src.hi && a.dst.lo <= b.dst.hi && b.dst.lo <= a.dst.hi && a.ports.lo <= b.ports.hi && b.ports.lo <= a.ports.hi;
      expect(overlap, `fragments ${i} and ${j} overlap`).toBe(false);
    }
  });
  it('two half-space covers remove the target entirely; one half leaves exactly half the volume', () => {
    const t = box('10.0.0.0/8', '10.0.5.10/32', '443');
    const lower = box('10.0.0.0/9', '10.0.5.10/32', '443'), upper = box('10.128.0.0/9', '10.0.5.10/32', '443');
    expect(subtractBoxes(t, [lower, upper]).remainder).toEqual([]);
    const half = subtractBoxes(t, [lower]);
    expect(half.remainder).toEqual([upper]);
    expect(sum(half.remainder) * 2n).toBe(volume(t));
  });
  it('is exact under the budget (10 slabs per axis → 1 331 fragments) and matches the analytic remainder volume', () => {
    const { remainder, approximate } = subtractBoxes(ANY_BOX, slabBoxes(10), DEFAULT_FRAGMENT_BUDGET);
    expect(approximate).toBe(false);
    expect(remainder).toHaveLength(11 * 11 * 11);
    expect(sum(remainder)).toBe(exactRemainder(10));
  });
  it('stops splitting and flags approximate on a hostile 300-slab set, never holding more fragments than the budget', () => {
    const { remainder, approximate } = subtractBoxes(ANY_BOX, slabBoxes(100), 4000);
    expect(approximate).toBe(true);
    expect(remainder.length).toBeLessThanOrEqual(4000);
    // The early stop only skips subtractions, so the remainder is an over-estimate of the true uncovered volume.
    expect(sum(remainder)).toBeGreaterThanOrEqual(exactRemainder(100));
    expect(sum(remainder)).toBeLessThan(volume(ANY_BOX));
  }, 20_000);
});

describe('boxes: rule coverage', () => {
  const target = rule({ id: 'R', seq: 10 });
  it('two half-space earlier rules cover a later rule completely (fraction 1) although neither contains it', () => {
    const a = rule({ id: 'A', seq: 1, src: '10.0.0.0/9' }), b = rule({ id: 'B', seq: 2, src: '10.128.0.0/9' });
    expect(coverage(target, [a, b])).toEqual({ fraction: 1, coveringRuleIds: ['A', 'B'], approximate: false });
  });
  it('a quarter-space earlier rule gives 0.25; three quarters give 0.75; disjoint rules give 0', () => {
    expect(coverage(target, [rule({ id: 'A', seq: 1, src: '10.0.0.0/10' })]).fraction).toBe(0.25);
    expect(coverage(target, [rule({ id: 'A', seq: 1, src: '10.0.0.0/9' }), rule({ id: 'B', seq: 2, src: '10.128.0.0/10' })])).toEqual({ fraction: 0.75, coveringRuleIds: ['A', 'B'], approximate: false });
    expect(coverage(target, [rule({ id: 'A', seq: 1, src: '192.168.0.0/16' })])).toEqual({ fraction: 0, coveringRuleIds: [], approximate: false });
    expect(coverage(target, [rule({ id: 'A', seq: 1, ports: '80' })]).fraction).toBe(0);
    expect(coverage(target, [])).toEqual({ fraction: 0, coveringRuleIds: [], approximate: false });
  });
  it('does not credit an earlier rule whose volume was already removed by rules before it (first-match attribution)', () => {
    const a = rule({ id: 'A', seq: 1, src: '10.0.0.0/9' }), dup = rule({ id: 'DUP', seq: 2, src: '10.0.0.0/10' });
    expect(coverage(target, [a, dup])).toEqual({ fraction: 0.5, coveringRuleIds: ['A'], approximate: false });
  });
  it('handles ICMP and port-any asymmetrically, as the containment analysis does', () => {
    const icmpTarget = rule({ id: 'I', seq: 10, proto: 'icmp', ports: 'any' });
    expect(coverage(icmpTarget, [rule({ id: 'T', seq: 1, proto: 'tcp', ports: 'any' })]).fraction).toBe(0);           // other protocol
    expect(coverage(icmpTarget, [rule({ id: 'I0', seq: 1, proto: 'icmp', ports: 'any' })]).fraction).toBe(1);         // same protocol
    expect(coverage(icmpTarget, [rule({ id: 'ANY', seq: 1, proto: 'any', ports: 'any' })]).fraction).toBe(1);         // proto any, all ports
    const tiny = coverage(icmpTarget, [rule({ id: 'A443', seq: 1, proto: 'any', ports: '443' })]);                     // proto any, one port
    expect(tiny.fraction).toBeGreaterThan(0);
    expect(tiny.fraction).toBeLessThan(0.001);
    expect(tiny.coveringRuleIds).toEqual(['A443']);
    // A later proto-any rule assembled from per-protocol earlier rules is fully covered.
    const anyTarget = rule({ id: 'X', seq: 10, proto: 'any', ports: '443' });
    const perProto = [rule({ id: 'T', seq: 1, proto: 'tcp' }), rule({ id: 'U', seq: 2, proto: 'udp' }), rule({ id: 'C', seq: 3, proto: 'icmp', ports: 'any' })];
    expect(coverage(anyTarget, perProto)).toEqual({ fraction: 1, coveringRuleIds: ['T', 'U', 'C'], approximate: false });
    expect(coverage(anyTarget, perProto.slice(0, 2)).fraction).toBeCloseTo(2 / 3, 12);
  });
  it('excludes earlier rules whose zones do not cover the rule, and disabled earlier rules', () => {
    const full = { src: '10.0.0.0/8' };
    expect(coverage(target, [rule({ id: 'G', seq: 1, ...full, zoneFrom: 'guest' })]).fraction).toBe(0);
    expect(coverage(target, [rule({ id: 'G', seq: 1, ...full, zoneTo: 'internet' })]).fraction).toBe(0);
    expect(coverage(target, [rule({ id: 'Z', seq: 1, ...full, zoneFrom: 'any', zoneTo: 'any' })]).fraction).toBe(1);
    expect(coverage(target, [rule({ id: 'S', seq: 1, ...full })]).fraction).toBe(1);
    expect(coverage(target, [rule({ id: 'OFF', seq: 1, ...full, enabled: false })]).fraction).toBe(0);
    expect(zoneCovers('any', 'corp')).toBe(true);
    expect(zoneCovers('corp', 'corp')).toBe(true);
    expect(zoneCovers('corp', 'any')).toBe(false);
    expect(zoneCovers('corp', 'dmz')).toBe(false);
  });
  it('is exact for 30 slabs and flags approximate (lower-bound fraction) on the hostile 300-rule set', () => {
    const exact = coverage(TARGET_ANY, slabs(10));
    expect(exact.approximate).toBe(false);
    expect(exact.coveringRuleIds).toHaveLength(30);
    expect(exact.fraction).toBeCloseTo(1 - Number(exactRemainder(10)) / 2 ** 80, 12);
    const hostile = coverage(TARGET_ANY, slabs(100), 4000);
    expect(hostile.approximate).toBe(true);
    expect(hostile.fraction).toBeGreaterThan(0.3);
    expect(hostile.fraction).toBeLessThan(1);
    expect(hostile.coveringRuleIds.length).toBeGreaterThan(0);
  }, 20_000);
  it('is deterministic: identical inputs give identical results', () => {
    const earlier = [rule({ id: 'A', seq: 1, src: '10.0.0.0/9' }), rule({ id: 'B', seq: 2, src: '10.128.0.0/10' }), rule({ id: 'C', seq: 3, dst: 'any', ports: '400-500' })];
    expect(coverage(target, earlier)).toEqual(coverage(target, earlier));
    expect(coverage(TARGET_ANY, slabs(100), 4000)).toEqual(coverage(TARGET_ANY, slabs(100), 4000));
  }, 20_000);
  it('formats coverage without rounding a partial cover up to 100% or down to 0%', () => {
    expect(formatCoverage(1)).toBe('100%');
    expect(formatCoverage(0)).toBe('0%');
    expect(formatCoverage(0.5)).toBe('50%');
    expect(formatCoverage(0.25)).toBe('25%');
    expect(formatCoverage(0.996)).toBe('>99%');
    expect(formatCoverage(1 - Number.EPSILON)).toBe('>99%');
    expect(formatCoverage(0.004)).toBe('<1%');
    expect(formatCoverage(1 / 65536)).toBe('<1%');
  });
});
