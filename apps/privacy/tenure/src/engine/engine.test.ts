import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normaliseCatalog } from './normalise';
import { buildGraph } from './graph';
import { effectiveRetentionDays, MAX_EXCEPTION_TERM_DAYS, runChecks } from './checks';
import { retentionReviews } from './review';
import { findingsToCsv, parseCatalog, serializeCatalog } from './catalogIO';
import demo from '../fixtures/demo-catalog.json';
import type { Catalog, DataElement, Flow, System } from './types';

function load(): Catalog {
  const r = parseCatalog(JSON.stringify(demo));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.catalog;
}

function tiny(overrides: Partial<Catalog> = {}): Catalog {
  return {
    schema: 'tenure.catalog',
    version: 1,
    asOf: '2026-10-01',
    owners: [{ id: 'own-a', name: 'Owner A', team: 'Data', active: true }],
    systems: [
      { id: 'crm', name: 'CRM', ownerId: 'own-a', region: 'EU', hosting: 'internal', purposes: ['service', 'marketing'] },
      { id: 'dwh', name: 'Warehouse', ownerId: 'own-a', region: 'EU', hosting: 'internal', purposes: ['analytics'] },
    ],
    schedules: [{ id: 'sch-2y', name: 'Two years', days: 730, trigger: 'last-activity', reviewEveryDays: 365 }],
    elements: [
      { id: 'crm.email', name: 'Email', category: 'contact', systemId: 'crm', purposes: ['service', 'analytics'], scheduleId: 'sch-2y', sensitivity: 2, lastReviewedOn: '2026-01-10' },
      { id: 'dwh.email', name: 'Email', category: 'contact', systemId: 'dwh', purposes: ['analytics'], scheduleId: 'sch-2y', sensitivity: 2, lastReviewedOn: '2026-01-10' },
    ],
    flows: [{ id: 'f1', fromSystemId: 'crm', toSystemId: 'dwh', elementIds: ['crm.email'], mechanism: 'not-applicable' }],
    exceptions: [],
    ...overrides,
  };
}

describe('normaliseCatalog', () => {
  it('trims and lower-cases ids and records each change as a note', () => {
    const raw = tiny({ systems: [{ id: ' CRM ', name: 'CRM', ownerId: 'own-a', region: 'EU', hosting: 'internal', purposes: ['service'] }] as System[] });
    const { catalog, notes } = normaliseCatalog(raw);
    expect(catalog.systems[0]?.id).toBe('crm');
    expect(notes.some((n) => n.rule === 'id-normalised' && n.from === ' CRM ' && n.to === 'crm')).toBe(true);
  });

  it('maps category, region and mechanism synonyms to the canonical vocabulary', () => {
    const raw = tiny({
      systems: [{ id: 'crm', name: 'CRM', ownerId: 'own-a', region: 'Europe' as never, hosting: 'internal', purposes: ['service'] }],
      elements: [{ id: 'e', name: 'Email address', category: 'PII' as never, systemId: 'crm', purposes: ['service'], sensitivity: 2 }],
      flows: [{ id: 'f', fromSystemId: 'crm', toSystemId: 'crm', elementIds: ['e'], mechanism: 'SCCs' as never }],
    });
    const { catalog, notes } = normaliseCatalog(raw);
    expect(catalog.systems[0]?.region).toBe('EU');
    expect(catalog.elements[0]?.category).toBe('identifier');
    expect(catalog.flows[0]?.mechanism).toBe('standard-contractual-clauses');
    expect(notes.filter((n) => n.rule === 'synonym').length).toBe(3);
  });

  it('removes duplicate purposes and element ids inside a flow', () => {
    const raw = tiny({ flows: [{ id: 'f1', fromSystemId: 'crm', toSystemId: 'dwh', elementIds: ['crm.email', 'crm.email'], mechanism: 'not-applicable' }] });
    const { catalog } = normaliseCatalog(raw);
    expect(catalog.flows[0]?.elementIds).toEqual(['crm.email']);
  });

  it('is idempotent', () => {
    const once = normaliseCatalog(load()).catalog;
    const twice = normaliseCatalog(once);
    expect(twice.catalog).toEqual(once);
    expect(twice.notes).toEqual([]);
  });
});

describe('buildGraph', () => {
  it('assigns layers by longest path from source systems and counts degrees', () => {
    const g = buildGraph(tiny());
    const crm = g.nodes.find((n) => n.id === 'crm')!;
    const dwh = g.nodes.find((n) => n.id === 'dwh')!;
    expect(crm.layer).toBe(0);
    expect(dwh.layer).toBe(1);
    expect(crm.outbound).toBe(1);
    expect(dwh.inbound).toBe(1);
    expect(crm.maxRetentionDays).toBe(730);
  });

  it('flags cross-region edges', () => {
    const c = tiny();
    c.systems[1]!.region = 'US';
    const g = buildGraph(c);
    expect(g.edges[0]?.crossRegion).toBe(true);
  });

  it('detects cycles and still assigns every node a layer', () => {
    const c = tiny({ flows: [
      { id: 'f1', fromSystemId: 'crm', toSystemId: 'dwh', elementIds: ['crm.email'], mechanism: 'not-applicable' },
      { id: 'f2', fromSystemId: 'dwh', toSystemId: 'crm', elementIds: ['dwh.email'], mechanism: 'not-applicable' },
    ] });
    const g = buildGraph(c);
    expect(g.cycles.length).toBe(1);
    expect(new Set(g.cycles[0])).toEqual(new Set(['crm', 'dwh']));
    expect(g.nodes.every((n) => Number.isFinite(n.layer))).toBe(true);
  });

  it('layers form a DAG ordering for acyclic graphs (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.array(fc.tuple(fc.nat(7), fc.nat(7)), { maxLength: 12 }), (n, pairs) => {
        const systems: System[] = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}`, ownerId: 'own-a', region: 'EU', hosting: 'internal', purposes: ['p'] }));
        // Only forward edges (a < b) so the graph is acyclic.
        const flows: Flow[] = pairs.filter(([a, b]) => a < b && b < n).map(([a, b], i) => ({ id: `f${i}`, fromSystemId: `s${a}`, toSystemId: `s${b}`, elementIds: [], mechanism: 'not-applicable' as const }));
        const g = buildGraph(tiny({ systems, elements: [], flows }));
        const layer = new Map(g.nodes.map((x) => [x.id, x.layer]));
        return g.cycles.length === 0 && g.edges.every((e) => layer.get(e.to)! > layer.get(e.from)!);
      }),
    );
  });
});

describe('effectiveRetentionDays', () => {
  it('prefers an element override over the schedule, and returns undefined when neither exists', () => {
    const c = tiny();
    expect(effectiveRetentionDays(c.elements[0]!, c.schedules)).toBe(730);
    expect(effectiveRetentionDays({ ...c.elements[0]!, retentionDaysOverride: 90 }, c.schedules)).toBe(90);
    expect(effectiveRetentionDays({ ...c.elements[0]!, scheduleId: undefined } as DataElement, c.schedules)).toBeUndefined();
  });
});

describe('runChecks', () => {
  const codes = (c: Catalog) => runChecks(c, buildGraph(c), c.asOf).map((f) => f.code);

  it('is clean for a consistent catalog', () => {
    expect(codes(tiny())).toEqual([]);
  });

  it('flags an element whose system does not exist', () => {
    const c = tiny();
    c.elements.push({ id: 'ghost.x', name: 'X', category: 'technical', systemId: 'ghost', purposes: ['analytics'], scheduleId: 'sch-2y', sensitivity: 1, lastReviewedOn: '2026-01-10' });
    expect(codes(c)).toContain('ORPHAN_ELEMENT');
  });

  it('flags missing and inactive owners with different codes', () => {
    const c = tiny();
    delete c.systems[0]!.ownerId;
    c.owners.push({ id: 'own-gone', name: 'Left', team: 'Data', active: false, leftOn: '2026-03-01' });
    c.systems[1]!.ownerId = 'own-gone';
    const found = codes(c);
    expect(found).toContain('MISSING_OWNER');
    expect(found).toContain('INACTIVE_OWNER');
  });

  it('flags missing schedules, with a higher-severity code for special-category data', () => {
    const c = tiny();
    delete c.elements[0]!.scheduleId;
    c.elements.push({ id: 'crm.health', name: 'Health note', category: 'special-category', systemId: 'crm', purposes: ['service'], sensitivity: 4 });
    const findings = runChecks(c, buildGraph(c), c.asOf);
    expect(findings.find((f) => f.subject.id === 'crm.email')?.code).toBe('MISSING_SCHEDULE');
    const special = findings.find((f) => f.subject.id === 'crm.health');
    expect(special?.code).toBe('SPECIAL_CATEGORY_UNSCHEDULED');
    expect(special?.severity).toBe('critical');
  });

  it('flags retention inflation when a downstream copy is kept longer than its source', () => {
    const c = tiny();
    c.elements[1]!.retentionDaysOverride = 3650;
    const f = runChecks(c, buildGraph(c), c.asOf).find((x) => x.code === 'RETENTION_INFLATION');
    expect(f).toBeDefined();
    expect(f?.message).toMatch(/3650/);
    expect(f?.subject.id).toBe('dwh.email');
  });

  it('flags purpose drift when a flow carries an element to a system with no shared purpose', () => {
    const c = tiny();
    c.systems[1]!.purposes = ['payroll'];
    expect(codes(c)).toContain('PURPOSE_DRIFT');
  });

  it('flags an unmapped cross-region transfer but accepts an adequacy mechanism', () => {
    const c = tiny();
    c.systems[1]!.region = 'US';
    c.flows[0]!.mechanism = 'none';
    expect(codes(c)).toContain('UNMAPPED_TRANSFER');
    c.flows[0]!.mechanism = 'adequacy';
    expect(codes(c)).not.toContain('UNMAPPED_TRANSFER');
  });

  it('does not treat a same-region flow with mechanism none as a transfer problem', () => {
    const c = tiny();
    c.flows[0]!.mechanism = 'none';
    expect(codes(c)).not.toContain('UNMAPPED_TRANSFER');
  });

  it('flags flows that carry elements the source system does not hold', () => {
    const c = tiny();
    c.flows[0]!.elementIds = ['dwh.email'];
    expect(codes(c)).toContain('DANGLING_FLOW');
  });

  it('reports cycles once per cycle', () => {
    const c = tiny({ flows: [
      { id: 'f1', fromSystemId: 'crm', toSystemId: 'dwh', elementIds: ['crm.email'], mechanism: 'not-applicable' },
      { id: 'f2', fromSystemId: 'dwh', toSystemId: 'crm', elementIds: ['dwh.email'], mechanism: 'not-applicable' },
    ] });
    expect(codes(c).filter((x) => x === 'FLOW_CYCLE')).toHaveLength(1);
  });

  it('an approved, unexpired exception by an active owner marks the finding accepted', () => {
    const c = tiny();
    c.elements[1]!.retentionDaysOverride = 3650;
    c.exceptions.push({ id: 'ex1', elementId: 'dwh.email', acceptsFinding: 'RETENTION_INFLATION', rationale: 'Regulatory reporting (synthetic)', approvedBy: 'own-a', approvedOn: '2026-09-01', expiresOn: '2027-09-01', status: 'approved' });
    const f = runChecks(c, buildGraph(c), c.asOf).find((x) => x.code === 'RETENTION_INFLATION');
    expect(f?.accepted).toBe(true);
    expect(f?.exceptionId).toBe('ex1');
  });

  it('an expired exception no longer accepts the finding and is itself reported', () => {
    const c = tiny();
    c.elements[1]!.retentionDaysOverride = 3650;
    c.exceptions.push({ id: 'ex1', elementId: 'dwh.email', acceptsFinding: 'RETENTION_INFLATION', rationale: 'old', approvedBy: 'own-a', approvedOn: '2025-01-01', expiresOn: '2026-01-01', status: 'approved' });
    const findings = runChecks(c, buildGraph(c), c.asOf);
    expect(findings.find((x) => x.code === 'RETENTION_INFLATION')?.accepted).toBe(false);
    expect(findings.map((x) => x.code)).toContain('EXCEPTION_EXPIRED');
  });

  it('an exception approved by an inactive owner is reported and does not accept the finding', () => {
    const c = tiny();
    c.owners.push({ id: 'own-gone', name: 'Left', team: 'Data', active: false });
    c.elements[1]!.retentionDaysOverride = 3650;
    c.exceptions.push({ id: 'ex1', elementId: 'dwh.email', acceptsFinding: 'RETENTION_INFLATION', rationale: 'x', approvedBy: 'own-gone', approvedOn: '2026-09-01', expiresOn: '2027-09-01', status: 'approved' });
    const findings = runChecks(c, buildGraph(c), c.asOf);
    expect(findings.map((x) => x.code)).toContain('EXCEPTION_APPROVER_INACTIVE');
    expect(findings.find((x) => x.code === 'RETENTION_INFLATION')?.accepted).toBe(false);
  });

  it('gives every finding a stable id so repeated runs can be diffed', () => {
    const c = load();
    const a = runChecks(c, buildGraph(c), c.asOf).map((f) => f.id);
    const b = runChecks(c, buildGraph(c), c.asOf).map((f) => f.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('the demo catalog contains the seeded defects', () => {
    const found = new Set(codes(load()));
    for (const code of ['ORPHAN_ELEMENT', 'INACTIVE_OWNER', 'MISSING_SCHEDULE', 'SPECIAL_CATEGORY_UNSCHEDULED', 'RETENTION_INFLATION', 'PURPOSE_DRIFT', 'UNMAPPED_TRANSFER', 'FLOW_CYCLE', 'EXCEPTION_EXPIRED', 'REVIEW_OVERDUE']) {
      expect(found, code).toContain(code);
    }
  });
});

describe('retentionReviews', () => {
  it('classifies review status from the last review date and cadence', () => {
    const c = tiny();
    c.elements[0]!.lastReviewedOn = '2025-01-01'; // overdue (365-day cadence)
    c.elements[1]!.lastReviewedOn = '2025-10-15'; // due within 30 days of 2026-10-01
    c.elements.push({ id: 'crm.new', name: 'New', category: 'technical', systemId: 'crm', purposes: ['service'], scheduleId: 'sch-2y', sensitivity: 1 });
    const items = retentionReviews(c, '2026-10-01');
    expect(items.find((i) => i.elementId === 'crm.email')?.status).toBe('overdue');
    expect(items.find((i) => i.elementId === 'dwh.email')?.status).toBe('due-soon');
    expect(items.find((i) => i.elementId === 'crm.new')?.status).toBe('never-reviewed');
  });

  it('sorts overdue first, then by days until due', () => {
    const items = retentionReviews(load(), '2026-10-01');
    const order = items.map((i) => i.status);
    const firstNonOverdue = order.findIndex((s) => s !== 'overdue');
    expect(order.slice(0, firstNonOverdue).every((s) => s === 'overdue')).toBe(true);
  });
});

describe('catalog import/export', () => {
  it('round-trips the demo catalog', () => {
    const c = load();
    const again = parseCatalog(serializeCatalog(c));
    expect(again.ok).toBe(true);
    expect(c.systems.length).toBeGreaterThanOrEqual(10);
    expect(c.elements.length).toBeGreaterThanOrEqual(30);
  });

  it('rejects oversized, deeply nested and over-limit inputs', () => {
    expect(parseCatalog('x'.repeat(100), { maxBytes: 50 }).ok).toBe(false);
    let deep: unknown = 1;
    for (let i = 0; i < 10; i += 1) deep = { deep };
    expect(parseCatalog(JSON.stringify({ ...demo, extra: deep })).ok).toBe(false);
    const many = { ...demo, elements: Array.from({ length: 2001 }, (_, i) => ({ ...demo.elements[0], id: `e${i}` })) };
    expect(parseCatalog(JSON.stringify(many)).ok).toBe(false);
  });

  it('rejects bad enums, dates, sensitivity and duplicate ids', () => {
    expect(parseCatalog(JSON.stringify({ ...demo, systems: [{ ...demo.systems[0], hosting: 'cloudy' }, ...demo.systems.slice(1)] })).ok).toBe(false);
    expect(parseCatalog(JSON.stringify({ ...demo, asOf: '1/10/2026' })).ok).toBe(false);
    expect(parseCatalog(JSON.stringify({ ...demo, elements: [{ ...demo.elements[0], sensitivity: 9 }, ...demo.elements.slice(1)] })).ok).toBe(false);
    const dup = parseCatalog(JSON.stringify({ ...demo, systems: [demo.systems[0], demo.systems[0], ...demo.systems.slice(1)] }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join(' ')).toMatch(/Duplicate/);
  });

  it('accepts unknown synonyms through normalisation but rejects truly unknown categories', () => {
    const synonym = parseCatalog(JSON.stringify({ ...demo, elements: [{ ...demo.elements[0], category: 'PII' }, ...demo.elements.slice(1)] }));
    expect(synonym.ok).toBe(true);
    const unknown = parseCatalog(JSON.stringify({ ...demo, elements: [{ ...demo.elements[0], category: 'quantum' }, ...demo.elements.slice(1)] }));
    expect(unknown.ok).toBe(false);
  });

  it('escapes CSV cells that could be interpreted as formulas', () => {
    const c = load();
    const findings = runChecks(c, buildGraph(c), c.asOf).slice(0, 1).map((f) => ({ ...f, message: '=HYPERLINK("x")', why: '+1' }));
    const csv = findingsToCsv(findings);
    const lines = csv.split('\n');
    expect(lines[0]).toMatch(/^id,code,severity/);
    expect(lines[1]).toContain('"\'=HYPERLINK(""x"")"');
    expect(lines[1]).toContain("'+1");
  });
});

describe('hostile nesting (review finding)', () => {
  it('returns a validation error, not a RangeError, for 20,000 nested arrays inside the byte limit', () => {
    const deep = '['.repeat(20_000) + ']'.repeat(20_000);
    const text = `{"schema":"tenure.catalog","version":1,"asOf":"2026-10-01","owners":[],"systems":[],"schedules":[],"elements":[],"flows":[],"exceptions":[],"extra":${deep}}`;
    let result: ReturnType<typeof parseCatalog> | undefined;
    expect(() => { result = parseCatalog(text); }).not.toThrow();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.errors[0]).toMatch(/Nesting deeper than 6/);
  });
});

describe('strict dates (review finding)', () => {
  it('rejects impossible calendar dates that match the YYYY-MM-DD pattern', () => {
    expect(parseCatalog(JSON.stringify({ ...demo, asOf: '2026-02-30' })).ok).toBe(false);
    const badOwner = { ...demo, owners: [{ ...demo.owners[0], leftOn: '2026-13-01' }, ...demo.owners.slice(1)] };
    expect(parseCatalog(JSON.stringify(badOwner)).ok).toBe(false);
  });
});

describe('exception policy bounds (sixth-Fable finding)', () => {
  const setup = () => {
    const c = load();
    const findings = runChecks(c, buildGraph(c), c.asOf);
    const crit = findings.find((f) => f.code === 'SPECIAL_CATEGORY_UNSCHEDULED')!;
    const approver = c.owners.find((o) => o.active)!;
    return { c, crit, approver };
  };
  it('an exception approved after asOf cannot apply and is reported out of policy', () => {
    const { c, crit, approver } = setup();
    const x = { id: 'x-future', elementId: crit.subject.id, acceptsFinding: 'SPECIAL_CATEGORY_UNSCHEDULED' as const, rationale: 'r', status: 'approved' as const, approvedBy: approver.id, approvedOn: '2030-01-01', expiresOn: '2027-01-01' };
    const f = runChecks({ ...c, exceptions: [...c.exceptions, x] }, buildGraph(c), c.asOf);
    expect(f.find((y) => y.id === crit.id)!.accepted).toBe(false);
    expect(f.some((y) => y.code === 'EXCEPTION_OUT_OF_POLICY' && y.subject.id === 'x-future')).toBe(true);
  });
  it(`a term longer than ${MAX_EXCEPTION_TERM_DAYS} days cannot hide a finding`, () => {
    const { c, crit, approver } = setup();
    const x = { id: 'x-long', elementId: crit.subject.id, acceptsFinding: 'SPECIAL_CATEGORY_UNSCHEDULED' as const, rationale: 'r', status: 'approved' as const, approvedBy: approver.id, approvedOn: '2026-01-01', expiresOn: '2076-01-01' };
    const f = runChecks({ ...c, exceptions: [...c.exceptions, x] }, buildGraph(c), c.asOf);
    expect(f.find((y) => y.id === crit.id)!.accepted).toBe(false);
    expect(f.some((y) => y.code === 'EXCEPTION_OUT_OF_POLICY' && y.subject.id === 'x-long')).toBe(true);
  });
  it('an approved exception without an approval date is not live', () => {
    const { c, crit, approver } = setup();
    const x = { id: 'x-nodate', elementId: crit.subject.id, acceptsFinding: 'SPECIAL_CATEGORY_UNSCHEDULED' as const, rationale: 'r', status: 'approved' as const, approvedBy: approver.id, expiresOn: '2027-01-01' };
    const f = runChecks({ ...c, exceptions: [...c.exceptions, x] }, buildGraph(c), c.asOf);
    expect(f.find((y) => y.id === crit.id)!.accepted).toBe(false);
  });
  it('the demo fixture exception within the cap still accepts its finding', () => {
    const c = load();
    const f = runChecks(c, buildGraph(c), c.asOf);
    expect(f.filter((y) => y.accepted).map((y) => y.exceptionId)).toContain('ex-001');
  });
});
