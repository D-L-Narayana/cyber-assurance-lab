import { describe, expect, it } from 'vitest';
import { evaluateAll, ruleCoverage, runExpectations } from './analysis';
import { parseWorkspace, serializeWorkspace } from './workspace';
import demo from '../fixtures/demo-workspace.json';
import type { Workspace } from './types';

function load(): Workspace {
  const r = parseWorkspace(JSON.stringify(demo));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.workspace;
}

describe('evaluateAll', () => {
  it('evaluates every event in the workspace once, in event order', () => {
    const ws = load();
    const decisions = evaluateAll(ws);
    expect(decisions.map((d) => d.eventId)).toEqual(ws.events.map((e) => e.id));
  });
});

describe('runExpectations (policy regression suite)', () => {
  it('passes for the bundled fixture expectations', () => {
    const ws = load();
    const result = runExpectations(ws);
    expect(result.total).toBe(ws.expectations.length);
    expect(result.failed).toEqual([]);
  });

  it('reports a failing expectation with the observed outcome', () => {
    const ws = load();
    const first = ws.expectations[0]!;
    const broken = { ...ws, expectations: [{ ...first, expect: first.expect === 'allow' ? 'deny' as const : 'allow' as const }] };
    const result = runExpectations(broken);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ eventId: first.eventId, expected: broken.expectations[0]!.expect });
    expect(result.failed[0]?.observed).toBe(first.expect);
  });

  it('flags expectations that reference unknown events instead of silently passing', () => {
    const ws = load();
    const result = runExpectations({ ...ws, expectations: [{ eventId: 'ghost', expect: 'allow' }] });
    expect(result.failed[0]?.observed).toBe('missing-event');
  });
});

describe('ruleCoverage (rule-level mutation analysis)', () => {
  it('reports, for every rule, how many fixture decisions change when the rule is disabled', () => {
    const ws = load();
    const coverage = ruleCoverage(ws);
    expect(coverage.map((c) => c.ruleId)).toContain('R06-gpc-signal');
    const gpc = coverage.find((c) => c.ruleId === 'R06-gpc-signal')!;
    expect(gpc.decisionsChanged).toBeGreaterThan(0);
    expect(gpc.changedEventIds.length).toBe(gpc.decisionsChanged);
  });

  it('marks a rule as unexercised when no fixture decision depends on it', () => {
    const ws = load();
    // Remove every subject with an opt-out preference signal so R06 can no longer matter.
    const noGpc = { ...ws, subjects: ws.subjects.map((s) => ({ ...s, gpcSignal: false })) };
    const coverage = ruleCoverage(noGpc);
    expect(coverage.find((c) => c.ruleId === 'R06-gpc-signal')?.exercised).toBe(false);
  });

  it('never counts the fallback rule as exercised unless something reaches it', () => {
    const ws = load();
    const fallback = ruleCoverage(ws).find((c) => c.ruleId === 'R99-fallback');
    expect(fallback?.decisionsChanged).toBe(0);
  });
});

describe('workspace import', () => {
  it('round-trips the demo workspace', () => {
    const ws = load();
    const again = parseWorkspace(serializeWorkspace(ws));
    expect(again.ok).toBe(true);
    expect(ws.purposes.length).toBeGreaterThanOrEqual(5);
    expect(ws.events.length).toBeGreaterThanOrEqual(10);
  });

  it('rejects oversized input before parsing', () => {
    const r = parseWorkspace('x'.repeat(10), { maxBytes: 5 });
    expect(r.ok).toBe(false);
  });

  it('rejects records that reference unknown subjects or purposes', () => {
    const bad = { ...demo, records: [{ ...demo.records[0], subjectId: 'nobody' }] };
    const r = parseWorkspace(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/unknown subject/);
  });

  it('rejects invalid enum values and timestamps', () => {
    const bad = { ...demo, subjects: [{ ...demo.subjects[0], regime: 'Mars' }] };
    expect(parseWorkspace(JSON.stringify(bad)).ok).toBe(false);
    const badTs = { ...demo, events: [{ ...demo.events[0], occurredAt: 'yesterday' }] };
    expect(parseWorkspace(JSON.stringify(badTs)).ok).toBe(false);
  });

  it('rejects deep nesting and too many events', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 12; i += 1) deep = [deep];
    expect(parseWorkspace(JSON.stringify({ ...demo, extra: deep })).ok).toBe(false);
    const many = { ...demo, events: Array.from({ length: 5001 }, (_, i) => ({ ...demo.events[0], id: `e${i}` })) };
    expect(parseWorkspace(JSON.stringify(many)).ok).toBe(false);
  });

  it('drops unknown keys', () => {
    const r = parseWorkspace(JSON.stringify({ ...demo, purposes: demo.purposes.map((p, i) => (i === 0 ? { ...p, mystery: 1 } : p)) }));
    expect(r.ok).toBe(true);
    if (r.ok) expect('mystery' in r.workspace.purposes[0]!).toBe(false);
  });
});

describe('hostile nesting (review finding)', () => {
  it('returns a validation error, not a RangeError, for 20,000 nested arrays inside the byte limit', () => {
    const deep = '['.repeat(20_000) + ']'.repeat(20_000);
    const text = `{"schema":"consentry.workspace","version":1,"policy":{"id":"p","version":1,"childAgeThreshold":{"EU-GDPR":16,"UK-GDPR":13,"US-CA-CCPA":16},"consentMaxAgeDays":395,"disabledRules":[]},"purposes":[],"subjects":[],"records":[],"events":[],"extra":${deep}}`;
    let result: ReturnType<typeof parseWorkspace> | undefined;
    expect(() => { result = parseWorkspace(text); }).not.toThrow();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.errors[0]).toMatch(/Nesting deeper than 8/);
  });
});

describe('R09a record regime in the fixture and at import (October 2026 upgrade round)', () => {
  it('the fixture exercises R09a-record-regime: disabling it changes ev-21', () => {
    const cov = ruleCoverage(load()).find((c) => c.ruleId === 'R09a-record-regime');
    expect(cov?.exercised).toBe(true);
    expect(cov?.changedEventIds).toContain('ev-21');
    expect(cov?.terminalFor).toBeGreaterThanOrEqual(1);
  });

  it('ev-21 (UK subject, grant captured under the EU notice) is expected to review with RECORD_REGIME_MISMATCH and the suite passes', () => {
    const ws = load();
    expect(ws.expectations.find((e) => e.eventId === 'ev-21')).toEqual({ eventId: 'ev-21', expect: 'review', reasonCode: 'RECORD_REGIME_MISMATCH' });
    expect(runExpectations(ws).failed).toEqual([]);
  });

  it('disabling R09a-record-regime at import is called out as a protective-rule override', () => {
    const r = parseWorkspace(JSON.stringify({ ...demo, policy: { ...demo.policy, disabledRules: ['R09a-record-regime'] } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/R09a-record-regime.*educational override/);
  });
});

describe('import warns when protective rules are disabled (sixth-review finding)', () => {
  it('lists each disabled protective rule as an educational-override warning', () => {
    const r = parseWorkspace(JSON.stringify({ ...demo, policy: { ...demo.policy, disabledRules: ['R05-child-consent', 'R06-gpc-signal', 'R07-opt-out-on-record'] } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = r.warnings.join(' ');
      expect(text).toMatch(/R05-child-consent/);
      expect(text).toMatch(/R06-gpc-signal/);
      expect(text).toMatch(/R07-opt-out-on-record/);
      expect(text).toMatch(/educational override/i);
    }
  });
});
