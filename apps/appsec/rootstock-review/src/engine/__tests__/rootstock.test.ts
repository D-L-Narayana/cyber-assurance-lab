import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/ledgerly-lockgraph.json';
import { parseVersion, compareVersions, satisfies } from '../semver';
import { parseLockgraph, validateLockgraph, LIMITS } from '../schema';
import { buildGraph } from '../graph';
import { reviewDependencies, evaluateLicense } from '../review';
import { buildReport, reportToMarkdown } from '../report';
import type { Lockgraph } from '../types';

const lock = (): Lockgraph => { const r = validateLockgraph(fixture); if (!r.ok) throw new Error(r.errors.join('\n')); return r.lockgraph; };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const row = (name: string, version: string) => reviewDependencies(lock()).rows.find((r) => r.name === name && r.version === version)!;

describe('semver', () => {
  it('parses and orders versions, with prereleases below their release', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('v1.2')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0-beta.2')).toBeLessThan(0);
  });
  it('implements caret, tilde, comparators, x-ranges, hyphen ranges and unions', () => {
    expect(satisfies('1.9.9', '^1.2.3')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfies('0.9.5', '^0.9.0')).toBe(true);
    expect(satisfies('0.10.0', '^0.9.0')).toBe(false);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.5.0', '>=1.2.3 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.2.3 <2.0.0')).toBe(false);
    expect(satisfies('3.4.0', '<=3.4.0')).toBe(true);
    expect(satisfies('1.7.0', '1.x')).toBe(true);
    expect(satisfies('1.7.0', '1.2.0 - 1.6.0')).toBe(false);
    expect(satisfies('5.0.0', '^1.0.0 || ^5.0.0')).toBe(true);
    expect(satisfies('5.0.0', '*')).toBe(true);
    expect(satisfies('5.0.0', '')).toBe(false);
    expect(satisfies('1.0.0', 'latest')).toBe(false);
  });
});

describe('lockgraph validation', () => {
  it('accepts the synthetic snapshot', () => { expect(validateLockgraph(fixture).ok).toBe(true); });
  it('rejects malformed versions, unknown severities, oversized input and duplicate name@version', () => {
    const a = clone(fixture); a.packages[0].version = 'two';
    expect(validateLockgraph(a).ok).toBe(false);
    const b = clone(fixture); b.advisories[0].severity = 'scary';
    expect(validateLockgraph(b).ok).toBe(false);
    expect(parseLockgraph(JSON.stringify(fixture) + ' '.repeat(LIMITS.maxBytes)).ok).toBe(false);
    const c = clone(fixture); c.packages.push({ ...c.packages[1] });
    const r = validateLockgraph(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/duplicate package deepset@1.0.4/);
    const d = clone(fixture); d.packages = Array.from({ length: LIMITS.maxPackages + 1 }, (_, i) => ({ name: `p${i}`, version: '1.0.0', license: 'MIT', dependencies: {} }));
    expect(validateLockgraph(d).ok).toBe(false);
  });
});

describe('graph', () => {
  it('resolves each range to the highest satisfying package, keeps multiple versions, tolerates cycles and marks unresolved edges', () => {
    const g = buildGraph(lock());
    expect(g.nodes.get('colourkit@2.3.1')?.parents.map((p) => p.from)).toContain('formatlib@2.1.0');
    expect(g.nodes.get('colourkit@0.9.2')?.parents.map((p) => p.from)).toContain('uikit@3.2.4');
    expect(g.nodes.get('fontparse@3.4.0')?.parents.map((p) => p.from)).toContain('pdfkit-lite@5.2.0');
    expect(g.nodes.get('pdfkit-lite@5.2.0')?.parents.map((p) => p.from)).toContain('fontparse@3.4.0');
    expect(g.unresolved).toEqual([{ from: 'fontparse@3.4.0', name: 'glyphcache', range: '^1.0.0', reason: 'no package in the snapshot satisfies this range' }]);
    expect(g.nodes.size).toBe(11);
  });
  it('enumerates bounded root paths and depth', () => {
    const g = buildGraph(lock());
    const deepset = g.nodes.get('deepset@1.0.4')!;
    expect(deepset.paths.map((p) => p.join(' > '))).toEqual(expect.arrayContaining(['formatlib@2.1.0 > deepset@1.0.4', 'left-util@0.4.1 > deepset@1.0.4']));
    expect(deepset.depth).toBe(2);
    expect(g.nodes.get('fontparse@3.4.0')!.paths.length).toBeLessThanOrEqual(20);
  });
});

describe('review', () => {
  it('matches advisories by semver range and ignores patched versions', () => {
    expect(row('deepset', '1.0.4').advisories.map((a) => a.id)).toEqual(['SYN-2026-0001']);
    expect(row('colourkit', '0.9.2').advisories.map((a) => a.id)).toEqual(['SYN-2026-0002']);
    expect(row('colourkit', '2.3.1').advisories).toEqual([]);
    expect(row('chrono', '1.6.2').advisories).toEqual([]);
  });
  it('plans an in-range bump, names a parent conflict, and reports no fix when none exists', () => {
    const deepset = row('deepset', '1.0.4').plan!;
    expect(deepset.kind).toBe('bump-in-range');
    expect(deepset.target).toBe('1.2.3');
    const colour = row('colourkit', '0.9.2').plan!;
    expect(colour.kind).toBe('parent-conflict');
    expect(colour.target).toBe('1.0.0');
    expect(colour.blockedBy).toEqual([{ parent: 'uikit@3.2.4', range: '~0.9.0' }]);
    expect(colour.detail).toMatch(/uikit 3.3.0/);
    const font = row('fontparse', '3.4.0').plan!;
    expect(font.kind).toBe('no-fix-available');
  });
  it('labels reachability as known, inferred or unknown — never as exploitability', () => {
    expect(row('formatlib', '2.1.0').reachability).toBe('known');
    expect(row('deepset', '1.0.4').reachability).toBe('inferred');
    expect(row('left-util', '0.4.1').reachability).toBe('unknown');
    expect(row('iconset', '4.1.0').reachability).toBe('inferred');
    const r = reviewDependencies(lock());
    expect(r.notes.reachability).toMatch(/not exploitability/i);
  });
  it('evaluates licence policy including OR expressions and empty licences', () => {
    expect(row('formatlib', '2.1.0').license.verdict).toBe('allow');
    expect(row('colourkit', '2.3.1').license.verdict).toBe('allow');
    expect(row('iconset', '4.1.0').license.verdict).toBe('review');
    expect(row('pdfkit-lite', '5.2.0').license.verdict).toBe('deny');
    expect(row('tzdata-mini', '2024.2.0').license.verdict).toBe('unknown');
  });
  it('raises provenance flags without turning them into verdicts', () => {
    expect(row('left-util', '0.4.1').flags).toContain('install-script');
    expect(row('colourkit', '2.3.1').flags).toContain('deprecated');
    expect(row('colourkit', '2.3.1').advisories).toEqual([]);
  });
  it('summarises blocking items and unknown states', () => {
    const r = reviewDependencies(lock());
    expect(r.summary.packages).toBe(11);
    expect(r.summary.vulnerable).toBe(3);
    expect(r.summary.blocking).toBe(2);
    expect(r.summary.licenseDeny).toBe(1);
    expect(r.summary.unknownLicense).toBe(1);
    expect(r.summary.unresolvedEdges).toBe(1);
    expect(r.summary.reachabilityUnknown).toBeGreaterThanOrEqual(1);
  });
  it('is deterministic', () => { expect(reviewDependencies(lock())).toEqual(reviewDependencies(lock())); });
});

describe('report', () => {
  it('exports a stable schema and a markdown plan that states its limits', () => {
    const r = reviewDependencies(lock());
    const report = buildReport(lock(), r, '2026-10-01T00:00:00.000Z');
    expect(report.schema).toBe('rootstock.report/1');
    expect(report.plan.map((p) => p.kind)).toEqual(expect.arrayContaining(['bump-in-range', 'parent-conflict', 'no-fix-available']));
    const md = reportToMarkdown(report);
    expect(md).toContain('SYN-2026-0002');
    expect(md).toMatch(/synthetic/i);
    expect(md).toMatch(/not exploitability/i);
  });
});

describe('licence expression parsing — council regressions (fail closed)', () => {
  const policy = () => lock().policy;
  const verdict = (expr: string) => evaluateLicense(expr, policy()).verdict;

  it('respects parentheses: (MIT OR Apache-2.0) AND GPL-3.0-only is deny, not allow', () => {
    expect(verdict('(MIT OR Apache-2.0) AND GPL-3.0-only')).toBe('deny');
    expect(verdict('GPL-3.0-only AND (MIT OR Apache-2.0)')).toBe('deny');
  });
  it('applies SPDX precedence: AND binds tighter than OR', () => {
    expect(verdict('MIT OR Apache-2.0 AND GPL-3.0-only')).toBe('allow');
    expect(verdict('GPL-3.0-only AND Apache-2.0 OR MIT')).toBe('allow');
    expect(verdict('(MIT AND LGPL-3.0-only) OR SSPL-1.0')).toBe('review');
    expect(verdict('MIT AND (LGPL-3.0-only OR SSPL-1.0)')).toBe('review');
  });
  it('handles nested groups and OR with nested AND', () => {
    expect(verdict('((MIT OR GPL-3.0-only) AND (Apache-2.0 OR SSPL-1.0)) OR LGPL-3.0-only')).toBe('allow');
    expect(verdict('(GPL-3.0-only AND MIT) OR (SSPL-1.0 AND Apache-2.0)')).toBe('deny');
    expect(verdict('LGPL-3.0-only OR (MIT AND (ISC AND BSD-3-Clause))')).toBe('allow');
  });
  it('fails closed to unknown on malformed or unbalanced expressions', () => {
    for (const bad of ['(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'MIT OR OR Apache-2.0', 'MIT Apache-2.0', '()', '(MIT) (Apache-2.0)', 'MIT AND', 'MIT; rm -rf /']) {
      expect(verdict(bad), bad).toBe('unknown');
    }
  });
  it('treats unsupported WITH exceptions and unknown identifiers conservatively', () => {
    expect(verdict('GPL-2.0-only WITH Classpath-exception-2.0')).toBe('unknown');
    expect(verdict('MIT AND FooLicense-1.0')).toBe('unknown');
    expect(verdict('MIT OR FooLicense-1.0')).toBe('allow');
    expect(verdict('mit')).toBe('unknown');
    expect(verdict('MIT or Apache-2.0')).toBe('allow');
  });
  it('bounds tokens and nesting', () => {
    const many = Array.from({ length: 40 }, () => 'MIT').join(' AND ');
    expect(verdict(many)).toBe('unknown');
    const deep = '('.repeat(9) + 'MIT' + ')'.repeat(9);
    expect(verdict(deep)).toBe('unknown');
    const okDepth = '('.repeat(4) + 'MIT' + ')'.repeat(4);
    expect(verdict(okDepth)).toBe('allow');
  });
  it('explains the decision in the detail text', () => {
    const r = evaluateLicense('(MIT OR Apache-2.0) AND GPL-3.0-only', policy());
    expect(r.detail).toMatch(/GPL-3.0-only/);
    expect(r.detail).toMatch(/deny/);
    expect(evaluateLicense('(MIT', policy()).detail).toMatch(/could not be parsed/i);
  });
});
