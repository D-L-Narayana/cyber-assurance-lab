import { describe, expect, it } from 'vitest';
import sample from '../../fixtures/sample-package-lock.json';
import demo from '../../fixtures/ledgerly-lockgraph.json';
import { convertPackageLock } from '../lockfile';
import type { ConvertOptions, ConvertResult } from '../lockfile';
import { LIMITS, byteLength, parseLockgraph, serialiseLockgraph, validateLockgraph } from '../schema';
import { BUDGET, buildGraph } from '../graph';
import { reviewDependencies } from '../review';
import { buildReport, reportToMarkdown } from '../report';
import type { Lockgraph } from '../types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const convert = (doc: unknown = sample, opts: ConvertOptions = {}): ConvertResult => convertPackageLock(typeof doc === 'string' ? doc : JSON.stringify(doc), opts);
const must = (r: ConvertResult): { lockgraph: Lockgraph; notes: string[] } => { if (!r.ok) throw new Error(`conversion failed: ${r.errors.join(' | ')}`); return r; };
const find = (lock: Lockgraph, name: string, version?: string) => lock.packages.find((p) => p.name === name && (version === undefined || p.version === version));
const rowOf = (lock: Lockgraph, name: string, version?: string) => reviewDependencies(lock).rows.find((r) => r.name === name && (version === undefined || r.version === version))!;
const demoLock = (): Lockgraph => { const r = validateLockgraph(demo); if (!r.ok) throw new Error(r.errors.join('\n')); return r.lockgraph; };
/** Minimal synthetic package-lock builder: entries keyed by install path, root under "". */
const lockDoc = (packages: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: 'synthetic-app', version: '1.0.0', lockfileVersion: 3, requires: true, packages, ...extra });
const entry = (version: string, more: Record<string, unknown> = {}) => ({ version, resolved: `https://registry.example/pkg/-/pkg-${version}.tgz`, license: 'MIT', ...more });
const ROOT = 'orchard-kiosk@2.3.0';

describe('convertPackageLock — shape and bounds', () => {
  it('converts a lockfileVersion 3 packages map into a valid rootstock.lockgraph/1 that round-trips through the validator', () => {
    const { lockgraph, notes } = must(convert());
    expect(lockgraph.schema).toBe('rootstock.lockgraph/1');
    expect(lockgraph.root).toEqual({ name: 'orchard-kiosk', version: '2.3.0' });
    expect(lockgraph.name).toMatch(/package-lock\.json/);
    expect(lockgraph.source).toMatchObject({ kind: 'package-lock.json', lockfileVersion: 3, includeDev: false });
    expect(lockgraph.source?.notes).toEqual(notes);
    expect(validateLockgraph(lockgraph).ok).toBe(true);
    expect(validateLockgraph(JSON.parse(JSON.stringify(lockgraph))).ok).toBe(true);
    expect(lockgraph.packages.map((p) => `${p.name}@${p.version}`)).toEqual([
      '@orchard/grafting@1.4.2', 'frost-sensor@1.2.0', 'pricebook@2.9.1', 'pricebook@3.1.0', 'rootstock-utils@0.3.4', 'seedvault@2.1.7', 'tallyboard@0.8.3',
    ]);
    expect(notes.some((n) => /lockfileVersion 3/.test(n))).toBe(true);
  });

  it('accepts lockfileVersion 2 and ignores the legacy dependencies tree however deeply it nests', () => {
    const legacy = (depth: number): Record<string, unknown> => depth === 0 ? { version: '1.0.0' } : { version: '1.0.0', requires: { child: '^1.0.0' }, dependencies: { child: legacy(depth - 1) } };
    const v2: Record<string, unknown> = { ...clone(sample), lockfileVersion: 2, dependencies: { pricebook: legacy(20) } };
    const a = must(convert(v2));
    const b = must(convert());
    expect(a.lockgraph.packages).toEqual(b.lockgraph.packages);
    expect(a.lockgraph.direct).toEqual(b.lockgraph.direct);
    expect(a.lockgraph.registry).toEqual(b.lockgraph.registry);
    expect(a.lockgraph.unparsable).toEqual(b.lockgraph.unparsable);
    expect(a.lockgraph.source?.lockfileVersion).toBe(2);
    expect(a.notes.some((n) => /lockfileVersion 2/.test(n))).toBe(true);
  });

  it('rejects lockfileVersion 1 and unknown versions with a clear error', () => {
    const v1 = convert({ name: 'old', version: '1.0.0', lockfileVersion: 1, requires: true, dependencies: { a: { version: '1.0.0' } } });
    expect(v1.ok).toBe(false);
    if (!v1.ok) expect(v1.errors.join(' ')).toMatch(/lockfileVersion 1 is not supported/);
    const none = convert({ name: 'x', packages: { '': { name: 'x', version: '1.0.0' } } });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors.join(' ')).toMatch(/lockfileVersion must be 2 or 3/);
  });

  it('checks the UTF-8 byte cap before parsing and bounds entry and dependency counts', () => {
    expect(LIMITS.maxBytes).toBe(2 * 1024 * 1024);
    expect(LIMITS.maxPackages).toBe(2500);
    const big = convert('{' + ' '.repeat(LIMITS.maxBytes));
    expect(big.ok).toBe(false);
    if (!big.ok) { expect(big.errors[0]).toMatch(/bytes/); expect(big.errors[0]).not.toMatch(/valid JSON/); }
    const many = lockDoc(Object.fromEntries([['', { name: 'big', version: '1.0.0' }], ...Array.from({ length: LIMITS.maxPackages + 1 }, (_, i) => [`node_modules/p${i}`, { version: '1.0.0' }])]));
    const tooMany = convert(many);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.join(' ')).toMatch(/2500/);
    const wide = lockDoc({ '': { name: 'wide', version: '1.0.0', dependencies: { hub: '^1.0.0' } }, 'node_modules/hub': entry('1.0.0', { dependencies: Object.fromEntries(Array.from({ length: LIMITS.maxDepsPerPackage + 1 }, (_, i) => [`d${i}`, '^1.0.0'])) }) });
    const tooWide = convert(wide);
    expect(tooWide.ok).toBe(false);
    if (!tooWide.ok) expect(tooWide.errors.join(' ')).toMatch(/node_modules\/hub.*dependencies/);
  });

  it('never throws on hostile or malformed input', () => {
    const inputs = ['', 'null', '[]', '"x"', '{', '{"lockfileVersion":3}', '{"lockfileVersion":3,"packages":[]}', '{"lockfileVersion":3,"packages":{"":5}}',
      '{"lockfileVersion":3,"packages":{"":{"name":"a","version":"1.0.0"},"node_modules/x":null}}',
      '{"lockfileVersion":3,"packages":{"":{"name":"a","version":"1.0.0","dependencies":{"x":5}},"node_modules/x":{"version":"1.0.0","dependencies":"nope","peerDependencies":[1]}}}',
      '{"lockfileVersion":3,"packages":{"":{"name":"a","version":"1.0.0"},"node_modules/x":{"version":"1.0.0","license":{"type":"MIT"},"deprecated":true}}}'];
    for (const text of inputs) {
      let r: ConvertResult | null = null;
      let threw: unknown = null;
      try { r = convertPackageLock(text); } catch (e) { threw = e; }
      expect(threw, text).toBeNull();
      expect(r, text).not.toBeNull();
      if (!r) continue;
      expect(typeof r.ok, text).toBe('boolean');
      if (!r.ok) expect(r.errors.length, text).toBeGreaterThan(0);
      else expect(validateLockgraph(r.lockgraph).ok, text).toBe(true);
    }
  });
});

describe('convertPackageLock — mapping', () => {
  it('keeps scoped names, derives names from the last node_modules segment and records alias installs honestly', () => {
    const { lockgraph, notes } = must(convert());
    const grafting = find(lockgraph, '@orchard/grafting', '1.4.2')!;
    expect(grafting).toBeDefined();
    expect(grafting.license).toBe('MIT');
    expect(grafting.dependencies).toEqual({ pricebook: '^2.0.0', 'rootstock-utils': '^0.3.0' });
    expect(find(lockgraph, 'pricebook', '2.9.1')).toBeDefined(); // node_modules/@orchard/grafting/node_modules/pricebook
    expect(find(lockgraph, 'tallyboard', '0.8.3')).toBeDefined(); // alias install: recorded under its install name
    expect(find(lockgraph, 'ledger-tally')).toBeUndefined();
    expect(notes.some((n) => /alias/.test(n) && /tallyboard/.test(n))).toBe(true);
  });

  it('keeps two versions of one package and lists both in the registry, resolved per declared range', () => {
    const { lockgraph } = must(convert());
    expect(lockgraph.packages.filter((p) => p.name === 'pricebook').map((p) => p.version)).toEqual(['2.9.1', '3.1.0']);
    expect(lockgraph.registry.pricebook).toEqual(['2.9.1', '3.1.0']);
    const g = buildGraph(lockgraph);
    expect(g.nodes.get('@orchard/grafting@1.4.2')?.children.map((c) => c.to)).toContain('pricebook@2.9.1');
    expect(g.nodes.get('pricebook@3.1.0')?.isDirect).toBe(true);
    expect(rowOf(lockgraph, 'pricebook', '2.9.1').flags).toContain('multiple-versions');
    expect(rowOf(lockgraph, 'pricebook', '3.1.0').flags).toContain('multiple-versions');
  });

  it('maps licence, install scripts, deprecation and optional dependencies; absent fields stay absent', () => {
    const { lockgraph } = must(convert());
    const seedvault = find(lockgraph, 'seedvault', '2.1.7')!;
    expect(seedvault.hasInstallScript).toBe(true);
    expect(seedvault.license).toBe('(MIT OR Apache-2.0)');
    expect(seedvault.dependencies).toEqual({ 'frost-sensor': '^1.0.0' }); // optionalDependencies become edges
    expect(find(lockgraph, 'rootstock-utils', '0.3.4')?.deprecated).toBe(true);
    expect(find(lockgraph, 'frost-sensor', '1.2.0')?.license).toBe('');
    const pricebook = find(lockgraph, 'pricebook', '3.1.0')!;
    expect('deprecated' in pricebook).toBe(false);
    expect('hasInstallScript' in pricebook).toBe(false);
    expect(lockgraph.direct).toEqual({ '@orchard/grafting': '^1.4.0', 'frost-sensor': '^1.0.0', pricebook: '^3.0.0', seedvault: '~2.1.0' });
  });

  it('excludes dev-only packages by default, includes them with includeDev, and counts them in a note', () => {
    const prod = must(convert());
    expect(find(prod.lockgraph, 'sapling-test')).toBeUndefined();
    expect(find(prod.lockgraph, 'leafsnap')).toBeUndefined();
    expect(prod.lockgraph.direct['sapling-test']).toBeUndefined();
    expect(prod.notes.some((n) => /2 dev-only/.test(n))).toBe(true);
    const dev = must(convert(sample, { includeDev: true }));
    expect(find(dev.lockgraph, 'sapling-test', '5.2.0')).toBeDefined();
    expect(find(dev.lockgraph, 'leafsnap', '1.0.5')).toBeDefined();
    expect(dev.lockgraph.direct['sapling-test']).toBe('^5.0.0');
    expect(dev.lockgraph.source?.includeDev).toBe(true);
    expect(dev.lockgraph.packages.length).toBe(prod.lockgraph.packages.length + 2);
  });

  it('excludes peerDependencies edges and says so', () => {
    const { lockgraph, notes } = must(convert());
    expect(find(lockgraph, '@orchard/grafting')?.dependencies.seedvault).toBeUndefined();
    expect(notes.some((n) => /peer/i.test(n) && /1 /.test(n))).toBe(true);
    const g = buildGraph(lockgraph);
    expect(g.nodes.get('seedvault@2.1.7')?.parents.map((p) => p.from)).toEqual([ROOT]);
  });

  it('turns an npm: alias range into an unresolved edge with a note — never a crash, never a widened match', () => {
    const { lockgraph, notes } = must(convert());
    expect(lockgraph.direct.tallyboard).toBeUndefined();
    expect(lockgraph.unparsable).toEqual([{ from: ROOT, name: 'tallyboard', range: 'npm:ledger-tally@^0.8.0' }]);
    expect(notes.some((n) => /npm: alias/.test(n) && /tallyboard/.test(n))).toBe(true);
    const g = buildGraph(lockgraph);
    const edge = g.unresolved.find((u) => u.name === 'tallyboard');
    expect(edge).toMatchObject({ from: ROOT, range: 'npm:ledger-tally@^0.8.0' });
    expect(edge?.reason).toMatch(/alias/);
    expect(g.nodes.get('tallyboard@0.8.3')?.parents).toEqual([]);
    expect(rowOf(lockgraph, 'tallyboard').reachability).toBe('unknown');
    expect(reviewDependencies(lockgraph).summary.unresolvedEdges).toBe(1);
  });

  it('leaves file:, link:, git, workspace:, tarball-URL and dist-tag ranges unresolved with reasons', () => {
    const ranges = { a: 'file:../a', b: 'link:../b', c: 'git+https://git.example/c.git#v1.0.0', d: 'latest', e: 'workspace:*', f: 'https://tarballs.example/f-1.0.0.tgz', g: '^1.0.0' };
    const doc = lockDoc({ '': { name: 'mixed', version: '1.0.0', dependencies: ranges }, ...Object.fromEntries(Object.keys(ranges).map((n) => [`node_modules/${n}`, entry('1.0.0')])) });
    const { lockgraph, notes } = must(convert(doc));
    expect(lockgraph.direct).toEqual({ g: '^1.0.0' });
    expect(lockgraph.unparsable?.map((u) => u.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(lockgraph.unparsable?.find((u) => u.name === 'c')?.range).toBe('git+https://git.example/c.git#v1.0.0');
    expect(notes.some((n) => /6 /.test(n) && /unresolved/.test(n))).toBe(true);
    const g = buildGraph(lockgraph);
    expect(g.unresolved.length).toBe(6);
    expect(g.unresolved.every((u) => typeof u.reason === 'string' && u.reason.length > 0)).toBe(true);
    expect(g.nodes.get('g@1.0.0')?.isDirect).toBe(true);
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) expect(g.nodes.get(`${n}@1.0.0`)?.parents, n).toEqual([]);
  });

  it('collapses the same name@version installed at two paths into one record with the union of ranges', () => {
    const doc = lockDoc({
      '': { name: 'dup', version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0' } },
      'node_modules/a': entry('1.0.0', { dependencies: { x: '^1.0.0' } }),
      'node_modules/b': entry('1.0.0', { dependencies: { x: '^1.0.0' } }),
      'node_modules/a/node_modules/x': entry('1.0.0', { dependencies: { y: '^1.0.0' } }),
      'node_modules/b/node_modules/x': entry('1.0.0', { dependencies: { z: '^1.0.0' } }),
      'node_modules/y': entry('1.0.0'),
      'node_modules/z': entry('1.0.0'),
    });
    const { lockgraph, notes } = must(convert(doc));
    expect(lockgraph.packages.filter((p) => p.name === 'x')).toHaveLength(1);
    expect(find(lockgraph, 'x')?.dependencies).toEqual({ y: '^1.0.0', z: '^1.0.0' });
    expect(notes.some((n) => /1 duplicate/.test(n))).toBe(true);
    expect(validateLockgraph(lockgraph).ok).toBe(true);
    expect(buildGraph(lockgraph).nodes.get('x@1.0.0')?.parents.map((p) => p.from).sort()).toEqual(['a@1.0.0', 'b@1.0.0']);
  });

  it('defaults a missing root version to 0.0.0 with a note and skips entries without a version', () => {
    const doc = lockDoc({ '': { name: 'noversion', dependencies: { a: '^1.0.0', b: '^1.0.0' } }, 'node_modules/a': entry('1.0.0'), 'node_modules/b': { resolved: 'https://registry.example/b/-/b.tgz' } });
    const { lockgraph, notes } = must(convert(doc));
    expect(lockgraph.root).toEqual({ name: 'noversion', version: '0.0.0' });
    expect(notes.some((n) => /0\.0\.0/.test(n))).toBe(true);
    expect(lockgraph.packages.map((p) => p.name)).toEqual(['a']);
    expect(notes.some((n) => /skipped/.test(n) && /node_modules\/b/.test(n))).toBe(true);
    expect(buildGraph(lockgraph).unresolved.map((u) => u.name)).toEqual(['b']);
  });

  it('supplies no advisories and no import evidence unless given, states it, and reachability is unknown everywhere', () => {
    const { lockgraph, notes } = must(convert());
    expect(lockgraph.advisories).toEqual([]);
    expect(lockgraph.imports).toEqual([]);
    expect(notes).toContain('No advisory data supplied — nothing was fetched from any registry or advisory database.');
    expect(notes.some((n) => /No import evidence supplied/.test(n) && /unknown/.test(n))).toBe(true);
    const review = reviewDependencies(lockgraph);
    expect(review.rows.every((r) => r.reachability === 'unknown')).toBe(true);
    expect(review.rows.every((r) => r.advisories.length === 0)).toBe(true);
  });

  it('uses supplied import evidence and advisories, including scoped direct dependencies, and plans against the lock registry', () => {
    const advisories = [{ id: 'SYN-2026-0101', package: 'pricebook', vulnerable: '<3.0.0', patched: '>=3.0.0', severity: 'high' as const, title: 'Synthetic: price-table injection' }];
    const { lockgraph, notes } = must(convert(sample, { imports: ['@orchard/grafting'], advisories }));
    expect(lockgraph.imports).toEqual(['@orchard/grafting']);
    expect(lockgraph.advisories).toEqual(advisories);
    expect(notes.some((n) => /1 advisor/.test(n) && /nothing was fetched/i.test(n))).toBe(true);
    expect(notes.some((n) => /1 import-evidence/.test(n))).toBe(true);
    expect(rowOf(lockgraph, '@orchard/grafting').reachability).toBe('known');
    expect(rowOf(lockgraph, 'rootstock-utils').reachability).toBe('inferred');
    expect(rowOf(lockgraph, 'pricebook', '2.9.1').reachability).toBe('inferred');
    expect(rowOf(lockgraph, 'seedvault').reachability).toBe('unknown');
    expect(rowOf(lockgraph, 'pricebook', '2.9.1').advisories.map((a) => a.id)).toEqual(['SYN-2026-0101']);
    expect(rowOf(lockgraph, 'pricebook', '3.1.0').advisories).toEqual([]);
    const plan = rowOf(lockgraph, 'pricebook', '2.9.1').plan!;
    expect(plan.kind).toBe('parent-conflict');
    expect(plan.target).toBe('3.1.0');
    expect(plan.blockedBy).toEqual([{ parent: '@orchard/grafting@1.4.2', range: '^2.0.0' }]);
    expect(plan.detail).toMatch(/@orchard\/grafting/);
  });

  it('rejects invalid import names or malformed advisories with path-addressed errors instead of guessing', () => {
    const bad = convert(sample, { imports: ['Not A Name!'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/imports\[0\]/);
    const adv = convert(sample, { advisories: [{ id: 'x', package: 'pricebook', vulnerable: 'nope', patched: '', severity: 'high', title: 't' }] });
    expect(adv.ok).toBe(false);
    if (!adv.ok) expect(adv.errors.join(' ')).toMatch(/advisor/);
  });

  it('uses the demo policy by default and the supplied policy otherwise', () => {
    expect(must(convert()).lockgraph.policy).toEqual(demo.policy);
    const custom = must(convert(sample, { policy: { ...demo.policy, blockSeverity: 'low' as const } }));
    expect(custom.lockgraph.policy.blockSeverity).toBe('low');
    expect(custom.notes.some((n) => /supplied/.test(n) && /policy/i.test(n))).toBe(true);
  });

  it('states the conversion in the review notes and the exported report', () => {
    const { lockgraph } = must(convert());
    const review = reviewDependencies(lockgraph);
    expect(review.notes.data).toMatch(/package-lock\.json/);
    expect(review.notes.data).toMatch(/nothing was fetched/i);
    expect(review.notes.data).toMatch(/no advisory/i);
    const report = buildReport(lockgraph, review, '2026-10-04T00:00:00.000Z');
    expect(report.notes.data).toMatch(/package-lock\.json/);
    expect(reportToMarkdown(report)).toMatch(/package-lock\.json/);
    expect(reviewDependencies(demoLock()).notes.data).toMatch(/synthetic/i);
  });

  it('is deterministic and independent of the key order in the lockfile', () => {
    const a = must(convert());
    const b = must(convert());
    expect(a).toEqual(b);
    const shuffled: Record<string, unknown> = { ...clone(sample), packages: Object.fromEntries(Object.entries(sample.packages).reverse()) };
    expect(must(convert(shuffled))).toEqual(a);
    expect(reviewDependencies(a.lockgraph)).toEqual(reviewDependencies(b.lockgraph));
  });
});

/** A layered graph: `width` packages per layer, each depending on `branching` packages of the next layer; layer 0 is the set of direct dependencies. */
function layered(total: number, width: number, branching: number): Lockgraph {
  const name = (i: number) => `p${String(i).padStart(3, '0')}`;
  const packages = Array.from({ length: total }, (_, i) => {
    const layer = Math.floor(i / width);
    const deps: Record<string, string> = {};
    if ((layer + 1) * width < total) for (let k = 0; k < branching; k++) deps[name((layer + 1) * width + ((i * branching + k) % width))] = '^1.0.0';
    return { name: name(i), version: '1.0.0', license: 'MIT', dependencies: deps };
  });
  const direct = Object.fromEntries(Array.from({ length: width }, (_, i) => [name(i), '^1.0.0']));
  const r = validateLockgraph({ schema: 'rootstock.lockgraph/1', name: 'layered', root: { name: 'layered-root', version: '1.0.0' }, direct, imports: [], packages, registry: {}, advisories: [], policy: demo.policy });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.lockgraph;
}

describe('graph traversal budget', () => {
  it('exposes an explicit budget and completes the demo graph without truncation', () => {
    expect(BUDGET.maxExpansionsPerDirect).toBeGreaterThanOrEqual(1000);
    expect(BUDGET.maxTotalPaths).toBeGreaterThanOrEqual(1000);
    const g = buildGraph(demoLock());
    expect(g.truncated).toBe(false);
    expect(g.expansions).toBeGreaterThan(0);
    expect(g.expansions).toBeLessThan(BUDGET.maxExpansionsPerDirect);
  });

  it('completes a layered 300-package graph within the per-direct budget and flags that path lists were cut', () => {
    const lock = layered(300, 25, 3); // 12 layers of 25; 25 direct roots with 3^11 ≈ 177 000 simple paths each — far beyond the budget
    const g = buildGraph(lock);
    expect(g.nodes.size).toBe(300);
    expect(g.truncated).toBe(true);
    expect(g.expansions).toBeLessThanOrEqual(g.directIds.length * BUDGET.maxExpansionsPerDirect);
    for (const n of g.nodes.values()) {
      expect(Number.isFinite(n.depth) && n.depth >= 1, n.id).toBe(true);
      expect(n.paths.length, n.id).toBeGreaterThanOrEqual(1);
      expect(n.paths.length, n.id).toBeLessThanOrEqual(20);
    }
    expect(g.nodes.get('p275@1.0.0')?.depth).toBe(12); // last layer: exact breadth-first depth even though enumeration was cut
  });

  it('flags truncation when the budget is tiny while depth and reachability stay exact', () => {
    const tiny = buildGraph(demoLock(), { maxExpansionsPerDirect: 2 });
    expect(tiny.truncated).toBe(true);
    expect(tiny.nodes.get('deepset@1.0.4')?.depth).toBe(2);
    expect(tiny.nodes.get('fontparse@3.4.0')?.depth).toBe(2);
    for (const n of tiny.nodes.values()) expect(n.paths.length, n.id).toBeGreaterThanOrEqual(1); // every demo package is reachable: one shortest path survives any budget
    expect(tiny.nodes.get('deepset@1.0.4')?.roots).toEqual(['formatlib@2.1.0', 'left-util@0.4.1']);
    const fewPaths = buildGraph(demoLock(), { maxTotalPaths: 3 });
    expect(fewPaths.truncated).toBe(true);
    expect(buildGraph(demoLock(), { maxExpansionsPerDirect: 1000, maxTotalPaths: 1000 }).truncated).toBe(false);
  });

  it('surfaces truncation through the review and the report', () => {
    const normal = reviewDependencies(demoLock());
    expect(normal.truncated).toBe(false);
    expect(normal.notes.traversal).toMatch(/within budget/i);
    const cut = reviewDependencies(demoLock(), { maxExpansionsPerDirect: 2 });
    expect(cut.truncated).toBe(true);
    expect(cut.notes.traversal).toMatch(/budget/i);
    expect(cut.notes.traversal).toMatch(/incomplete/i);
    const report = buildReport(demoLock(), cut, '2026-10-04T00:00:00.000Z');
    expect(report.truncated).toBe(true);
    expect(reportToMarkdown(report)).toMatch(/budget/i);
    // Reachability is computed breadth-first, so a cut path list never downgrades "inferred" to "unknown".
    expect(cut.rows.find((r) => r.id === 'deepset@1.0.4')?.reachability).toBe('inferred');
    expect(cut.rows.find((r) => r.id === 'iconset@4.1.0')?.reachability).toBe('inferred');
    expect(cut.rows.map((r) => [r.id, r.reachability])).toEqual(normal.rows.map((r) => [r.id, r.reachability]));
  });
});

describe('snapshot export — a converted lockgraph can be saved, edited offline and re-imported', () => {
  it('serialises a converted snapshot as rootstock.lockgraph/1 JSON that re-imports identically, including source and unparsable', () => {
    const { lockgraph } = must(convert(sample, { imports: ['@orchard/grafting'], includeDev: true }));
    const text = serialiseLockgraph(lockgraph);
    expect(text.endsWith('\n')).toBe(true);
    expect(byteLength(text)).toBeLessThanOrEqual(LIMITS.maxBytes);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['schema', 'name', 'root', 'direct', 'imports', 'packages', 'registry', 'advisories', 'policy', 'unparsable', 'source']);
    const back = parseLockgraph(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.lockgraph).toEqual(lockgraph);
    expect(reviewDependencies(back.lockgraph)).toEqual(reviewDependencies(lockgraph));
    expect(serialiseLockgraph(back.lockgraph)).toBe(text);
  });

  it('lets an offline advisory list be added to the exported snapshot and re-imported (the documented workflow)', () => {
    const { lockgraph } = must(convert());
    const doc = JSON.parse(serialiseLockgraph(lockgraph)) as Record<string, unknown>;
    expect(Array.isArray(doc.advisories)).toBe(true);
    (doc.advisories as unknown[]).push({ id: 'SYN-2026-0102', package: 'rootstock-utils', vulnerable: '<0.4.0', patched: '', severity: 'medium', title: 'Synthetic: unbounded cache growth' });
    const back = parseLockgraph(JSON.stringify(doc));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.lockgraph.source?.kind).toBe('package-lock.json');
    const review = reviewDependencies(back.lockgraph);
    const row = review.rows.find((r) => r.name === 'rootstock-utils')!;
    expect(row.advisories.map((a) => a.id)).toEqual(['SYN-2026-0102']);
    expect(row.plan?.kind).toBe('no-fix-available');
    expect(review.notes.data).toMatch(/1 user-supplied record/);
  });

  it('serialises the demo snapshot without inventing fields and round-trips it unchanged', () => {
    const text = serialiseLockgraph(demoLock());
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect('source' in parsed).toBe(false);
    expect('unparsable' in parsed).toBe(false);
    const back = parseLockgraph(text);
    expect(back.ok && back.lockgraph).toEqual(demoLock());
  });
});
