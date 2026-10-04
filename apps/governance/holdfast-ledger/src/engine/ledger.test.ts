import { describe, expect, it } from 'vitest';
import {
  computeDue, planDisposal, executePlan, verifyChain, reconcile, validateFixture, exportAudit, activeHoldsFor, sha256Hex,
  releaseHold, reinstateHold, LIMITS,
} from './ledger';
import type { Fixture, Receipt } from './types';
import { daysBetween } from './safe';

const fx: Fixture = {
  schemaVersion: 1, label: 'unit', asOf: '2026-10-01',
  systems: [{ id: 'hris', name: 'HR records', steward: 'people-ops' }, { id: 'desk', name: 'Support desk', steward: 'support' }],
  schedules: [
    { id: 'hr-7y', name: 'Employee file', category: 'employee_file', trigger: 'terminated', retainDays: 2555, action: 'delete', basis: 'Synthetic policy: 7 years after termination.' },
    { id: 'tix-2y', name: 'Support ticket', category: 'ticket', trigger: 'closed', retainDays: 730, action: 'anonymise', basis: 'Synthetic policy: 2 years after closure.' },
  ],
  records: [
    { id: 'r1', systemId: 'hris', category: 'employee_file', subjectRef: 'subj-1', triggerDate: '2018-01-01', status: 'active' }, // overdue
    { id: 'r2', systemId: 'hris', category: 'employee_file', subjectRef: 'subj-2', triggerDate: '2024-01-01', status: 'active' }, // retained
    { id: 'r3', systemId: 'desk', category: 'ticket', subjectRef: 'subj-1', triggerDate: '2024-09-15', status: 'active' },        // due ~2026-09-15 overdue 16d
    { id: 'r4', systemId: 'desk', category: 'ticket', subjectRef: 'subj-3', triggerDate: '2024-10-01', status: 'active' },        // due exactly today
    { id: 'r5', systemId: 'desk', category: 'ticket', subjectRef: 'subj-4', triggerDate: '2020-01-01', status: 'anonymised' },    // already disposed
    { id: 'r6', systemId: 'desk', category: 'chat_log', subjectRef: 'subj-5', triggerDate: '2020-01-01', status: 'active' },      // no schedule
  ],
  holds: [
    { id: 'h-subj1', name: 'Litigation hold — subject 1', authority: 'legal.example', placedOn: '2026-01-10', releasedOn: null, scope: { subjectRef: 'subj-1' } },
    { id: 'h-old', name: 'Released audit hold', authority: 'audit.example', placedOn: '2025-01-01', releasedOn: '2025-06-30', scope: { systemId: 'desk' } },
  ],
};

describe('computeDue', () => {
  const due = computeDue(fx, fx.asOf);
  const get = (id: string) => due.find((d) => d.recordId === id)!;
  it('derives due dates from schedule trigger and retention period', () => {
    expect(get('r2').dueOn).toBe('2030-12-30');
    expect(get('r2').state).toBe('retained');
    expect(get('r4').dueOn).toBe('2026-10-01');
    expect(get('r4').state).toBe('due');
  });
  it('marks overdue items with days overdue', () => {
    expect(get('r3').state).toBe('held'); // subj-1 is on hold, hold wins over overdue
    expect(get('r1').state).toBe('held');
    expect(get('r1').daysOverdue).toBe(daysBetween('2024-12-30', '2026-10-01')); // 2018-01-01 + 2555d = 2024-12-30 (two leap days)
  });
  it('hold takes precedence over due/overdue, released holds do not count', () => {
    expect(get('r1').holdIds).toEqual(['h-subj1']);
    expect(get('r4').holdIds).toEqual([]);
    expect(activeHoldsFor(fx.records[3]!, fx.holds, '2025-03-01').map((h) => h.id)).toEqual(['h-old']);
  });
  it('reports disposed and unscheduled records explicitly', () => {
    expect(get('r5').state).toBe('disposed');
    expect(get('r6').state).toBe('unscheduled');
    expect(get('r6').dueOn).toBeNull();
  });
});

describe('planDisposal', () => {
  it('includes due/overdue records, skips held ones with the hold id, and ignores retained/disposed/unscheduled', async () => {
    const plan = await planDisposal(fx, fx.asOf);
    const by = (id: string) => plan.items.find((i) => i.recordId === id);
    expect(by('r4')?.decision).toBe('dispose');
    expect(by('r4')?.action).toBe('anonymise');
    expect(by('r1')?.decision).toBe('skip');
    expect(by('r1')?.reason).toContain('h-subj1');
    expect(by('r3')?.decision).toBe('skip');
    expect(by('r2')).toBeUndefined();
    expect(by('r5')).toBeUndefined();
    expect(by('r6')).toBeUndefined();
    expect(plan.counts).toEqual({ dispose: 1, skip: 2 });
  });
  it('is idempotent: same inputs give the same plan id; a released hold changes it', async () => {
    const a = await planDisposal(fx, fx.asOf);
    const b = await planDisposal(fx, fx.asOf);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[a-f0-9]{64}$/);
    const released: Fixture = { ...fx, holds: fx.holds.map((h) => h.id === 'h-subj1' ? { ...h, releasedOn: '2026-09-30' } : h) };
    const c = await planDisposal(released, fx.asOf);
    expect(c.id).not.toBe(a.id);
    expect(c.counts.dispose).toBe(3);
  });
});

describe('executePlan, verifyChain, reconcile', () => {
  it('produces hash-chained receipts only for dispose items and updates record status', async () => {
    const plan = await planDisposal(fx, fx.asOf);
    const { receipts, records } = await executePlan(plan, fx, []);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.prevHash).toBe('0'.repeat(64));
    expect(receipts[0]!.recordId).toBe('r4');
    expect(records.find((r) => r.id === 'r4')!.status).toBe('anonymised');
    expect(records.find((r) => r.id === 'r1')!.status).toBe('active');
    const v = await verifyChain(receipts);
    expect(v.ok).toBe(true);
  });
  it('chains across executions and detects tampering, reordering and gaps', async () => {
    const released: Fixture = { ...fx, holds: [] };
    const plan = await planDisposal(released, fx.asOf);
    const { receipts } = await executePlan(plan, released, []);
    expect(receipts).toHaveLength(3);
    expect(receipts[1]!.prevHash).toBe(receipts[0]!.hash);
    expect((await verifyChain(receipts)).ok).toBe(true);
    const tampered: Receipt[] = receipts.map((r, i) => i === 1 ? { ...r, action: 'delete' } : r);
    const t = await verifyChain(tampered);
    expect(t.ok).toBe(false); expect(t.brokenAt).toBe(2);
    const reordered = [receipts[0]!, receipts[2]!, receipts[1]!];
    expect((await verifyChain(reordered)).ok).toBe(false);
    const gap = [receipts[0]!, receipts[2]!];
    const g = await verifyChain(gap);
    expect(g.ok).toBe(false); expect(g.reason).toMatch(/sequence|gap/i);
    expect((await verifyChain([])).ok).toBe(true);
  });
  it('reconciles a plan against receipts and reports missing/unexpected', async () => {
    const released: Fixture = { ...fx, holds: [] };
    const plan = await planDisposal(released, fx.asOf);
    const { receipts } = await executePlan(plan, released, []);
    expect(reconcile(plan, receipts).ok).toBe(true);
    const partial = reconcile(plan, receipts.slice(0, 2));
    expect(partial.ok).toBe(false);
    expect(partial.missing).toHaveLength(1);
    const foreign = reconcile(plan, [...receipts, { ...receipts[0]!, recordId: 'r2', seq: 99 }]);
    expect(foreign.unexpected).toEqual(['r2']);
  });
  it('refuses to execute a plan twice (idempotent execution)', async () => {
    const plan = await planDisposal(fx, fx.asOf);
    const first = await executePlan(plan, fx, []);
    const second = await executePlan(plan, { ...fx, records: first.records }, first.receipts);
    expect(second.receipts).toHaveLength(first.receipts.length);
    expect(second.skippedAlreadyExecuted).toBe(true);
  });
});

describe('validation and export', () => {
  it('rejects malformed fixtures without throwing', () => {
    for (const bad of [null, [], { schemaVersion: 1 }, { ...fx, records: [null] }, { ...fx, schedules: [{ id: 's' }] }, { ...fx, holds: [{ id: 'h', scope: 'x' }] }, { ...fx, records: [{ ...fx.records[0]!, systemId: 'ghost' }] }, { ...fx, asOf: '2026-02-30' }]) {
      let r: ReturnType<typeof validateFixture> | undefined;
      expect(() => { r = validateFixture(bad); }).not.toThrow();
      expect(r!.ok).toBe(false);
    }
    expect(validateFixture({ ...fx, records: Array.from({ length: 5001 }, (_, i) => ({ ...fx.records[0]!, id: `r${i}` })) }).ok).toBe(false);
    expect(validateFixture(fx).ok).toBe(true);
  });
  it('exports a stable audit schema with formula-safe CSV', async () => {
    const plan = await planDisposal(fx, fx.asOf);
    const { receipts, records } = await executePlan(plan, fx, []);
    const out = await exportAudit({ ...fx, records }, [plan], receipts);
    expect(out.json.schema).toBe('holdfast.audit/v1');
    expect(out.json.plans[0]!.reconciliation.ok).toBe(true);
    expect(out.json.chain.ok).toBe(true);
    expect(out.csv.split('\r\n')[0]).toContain('receipt_hash');
    const evil = await exportAudit({ ...fx, records: fx.records.map((r) => ({ ...r, subjectRef: '=cmd' })) }, [], []);
    expect(evil.csvRecords).toContain("'=cmd");
  });
  it('sha256Hex is deterministic and 64 hex chars', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('stale plan rejection (review of 2026-10-01: holds were checked at planning, not execution)', () => {
  it('refuses atomically to execute a plan whose inputs (holds/records) changed since it was generated', async () => {
    const plan = await planDisposal(fx, fx.asOf);
    const target = plan.items.find((i) => i.decision === 'dispose')!.recordId;
    const late: Fixture = { ...fx, holds: [...fx.holds, { id: 'h-late', name: 'Late hold', authority: 'legal.example', placedOn: fx.asOf, releasedOn: null, scope: { recordIds: [target] } }] };
    const r = await executePlan(plan, late, []);
    expect(r.rejectedStale).toBe(true);
    expect(r.reason).toMatch(/stale|changed/i);
    expect(r.receipts).toHaveLength(0);
    expect(r.records.find((x) => x.id === target)!.status).toBe('active');
  });
  it('also rejects when a record was disposed or added since planning, and accepts an unchanged situation', async () => {
    const plan = await planDisposal(fx, fx.asOf);
    const extra: Fixture = { ...fx, records: [...fx.records, { id: 'r7', systemId: 'desk', category: 'ticket', subjectRef: 'subj-9', triggerDate: '2020-01-01', status: 'active' }] };
    expect((await executePlan(plan, extra, [])).rejectedStale).toBe(true);
    const ok = await executePlan(plan, fx, []);
    expect(ok.rejectedStale).toBe(false);
    expect(ok.receipts).toHaveLength(1);
  });
});

describe('guarded hold release and reinstatement with trail (October 2026 upgrade round)', () => {
  const input = { holdId: 'h-subj1', on: '2026-10-01', actor: 'legal-counsel@example.test', reason: 'Matter closed; counsel confirmed no further preservation duty.' };

  it('refuses unknown holds, already-released holds, dates before placedOn and non-calendar dates', () => {
    expect(releaseHold(fx, { ...input, holdId: 'ghost' })).toMatchObject({ ok: false, error: expect.stringMatching(/unknown/i) });
    expect(releaseHold(fx, { ...input, holdId: 'h-old' })).toMatchObject({ ok: false, error: expect.stringMatching(/already/i) });
    expect(releaseHold(fx, { ...input, on: '2026-01-09' })).toMatchObject({ ok: false, error: expect.stringMatching(/placed/i) });
    expect(releaseHold(fx, { ...input, on: '2026-02-30' })).toMatchObject({ ok: false, error: expect.stringMatching(/date/i) });
    expect(releaseHold(fx, { ...input, on: '01/10/2026' })).toMatchObject({ ok: false, error: expect.stringMatching(/date/i) });
  });

  it('requires an actor of 1–120 characters and a reason of at least 10 characters', () => {
    expect(releaseHold(fx, { ...input, actor: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/actor/i) });
    expect(releaseHold(fx, { ...input, actor: '   ' })).toMatchObject({ ok: false, error: expect.stringMatching(/actor/i) });
    expect(releaseHold(fx, { ...input, actor: 'x'.repeat(121) })).toMatchObject({ ok: false, error: expect.stringMatching(/actor/i) });
    expect(releaseHold(fx, { ...input, reason: 'too short' })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/i) });
    expect(releaseHold(fx, { ...input, reason: '             ' })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/i) });
    expect(releaseHold(fx, { ...input, actor: 'x'.repeat(120) }).ok).toBe(true);
  });

  it('releases on the given date, appends a release event, recomputes due states and never mutates the input', () => {
    const before = JSON.stringify(fx);
    const r = releaseHold(fx, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.fixture.holds.find((x) => x.id === 'h-subj1')!;
    expect(h.releasedOn).toBe('2026-10-01');
    expect(h.placedOn).toBe('2026-01-10');
    expect(r.fixture.holdHistory).toEqual([{ seq: 1, holdId: 'h-subj1', action: 'release', on: '2026-10-01', actor: input.actor, reason: input.reason }]);
    expect(JSON.stringify(fx)).toBe(before);
    expect(fx.holdHistory).toBeUndefined();
    expect(computeDue(r.fixture, '2026-10-01').find((d) => d.recordId === 'r1')!.state).toBe('overdue');
    // releasing on the placement day itself is allowed (the hold was then never active)
    expect(releaseHold(fx, { ...input, on: '2026-01-10' }).ok).toBe(true);
  });

  it('reinstates only released holds, not before the release date, clears releasedOn and keeps seq contiguous', () => {
    expect(reinstateHold(fx, input)).toMatchObject({ ok: false, error: expect.stringMatching(/not released/i) });
    const released = releaseHold(fx, input);
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(reinstateHold(released.fixture, { ...input, on: '2026-09-30' })).toMatchObject({ ok: false, error: expect.stringMatching(/release/i) });
    expect(reinstateHold(released.fixture, { ...input, holdId: 'ghost' })).toMatchObject({ ok: false, error: expect.stringMatching(/unknown/i) });
    expect(reinstateHold(released.fixture, { ...input, reason: 'short' })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/i) });
    expect(reinstateHold(released.fixture, { ...input, actor: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/actor/i) });
    expect(reinstateHold(released.fixture, { ...input, on: '2026-02-30' })).toMatchObject({ ok: false, error: expect.stringMatching(/date/i) });
    const r = reinstateHold(released.fixture, { ...input, on: '2026-10-05', reason: 'New claim filed; preservation duty resumes.' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixture.holds.find((x) => x.id === 'h-subj1')!.releasedOn).toBeNull();
    expect(r.fixture.holds.find((x) => x.id === 'h-subj1')!.placedOn).toBe('2026-01-10');
    expect(r.fixture.holdHistory!.map((e) => [e.seq, e.action, e.on])).toEqual([[1, 'release', '2026-10-01'], [2, 'reinstate', '2026-10-05']]);
    expect(released.fixture.holdHistory).toHaveLength(1); // input untouched
    // a legacy released hold (no trail yet) can be reinstated and starts the trail at seq 1
    const legacy = reinstateHold(fx, { ...input, holdId: 'h-old', reason: 'Audit reopened after new evidence surfaced.' });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.fixture.holdHistory).toEqual([{ seq: 1, holdId: 'h-old', action: 'reinstate', on: '2026-10-01', actor: input.actor, reason: 'Audit reopened after new evidence surfaced.' }]);
  });

  it('is deterministic and refuses to grow the trail past the cap', () => {
    expect(releaseHold(fx, input)).toEqual(releaseHold(fx, input));
    const full: Fixture = { ...fx, holdHistory: Array.from({ length: LIMITS.holdHistory }, (_, i) => ({ seq: i + 1, holdId: 'h-old', action: i % 2 === 0 ? 'reinstate' as const : 'release' as const, on: '2025-06-30', actor: 'a', reason: 'synthetic trail entry' })) };
    expect(releaseHold(full, input)).toMatchObject({ ok: false, error: expect.stringMatching(/limit|cap|full/i) });
  });

  const ev = { seq: 1, holdId: 'h-old', action: 'release' as const, on: '2025-06-30', actor: 'audit.example', reason: 'Audit completed; no further preservation duty.' };

  it('validateFixture accepts legacy fixtures without holdHistory and well-formed trails, rejects malformed entries with the path', () => {
    expect(validateFixture(fx).ok).toBe(true); // legacy: no holdHistory key at all
    const again = validateFixture(JSON.parse(JSON.stringify({ ...fx, holdHistory: [ev] })));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.fixture.holdHistory).toEqual([ev]);
    const bad: unknown[] = [
      { ...fx, holdHistory: 'x' },
      { ...fx, holdHistory: [null] },
      { ...fx, holdHistory: [{ ...ev, holdId: 'ghost' }] },
      { ...fx, holdHistory: [{ ...ev, seq: 2 }] },
      { ...fx, holdHistory: [ev, { ...ev, seq: 3 }] },
      { ...fx, holdHistory: [{ ...ev, on: '2026-02-30' }] },
      { ...fx, holdHistory: [{ ...ev, action: 'delete' }] },
      { ...fx, holdHistory: [{ ...ev, actor: '' }] },
      { ...fx, holdHistory: [{ ...ev, reason: 7 }] },
      { ...fx, holdHistory: Array.from({ length: LIMITS.holdHistory + 1 }, (_, i) => ({ ...ev, seq: i + 1 })) },
    ];
    for (const b of bad) {
      let v: ReturnType<typeof validateFixture> | undefined;
      expect(() => { v = validateFixture(b); }).not.toThrow();
      expect(v!.ok).toBe(false);
    }
    const v = validateFixture({ ...fx, holdHistory: [{ ...ev, holdId: 'ghost' }] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(' ')).toMatch(/holdHistory\[0\]/);
    // unknown keys inside an event are dropped
    const extra = validateFixture({ ...fx, holdHistory: [{ ...ev, surprise: true }] });
    expect(extra.ok).toBe(true);
    if (extra.ok) expect(extra.fixture.holdHistory![0]).toEqual(ev);
    // a trail written by the engine round-trips through JSON and the validator
    const r = releaseHold(fx, input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateFixture(JSON.parse(JSON.stringify(r.fixture))).ok).toBe(true);
  });

  it('a release after planning makes the plan stale, and the trail travels in the audit export', async () => {
    expect((await exportAudit({ ...fx, holdHistory: [ev] }, [], [])).json.holdHistory).toEqual([ev]);
    expect((await exportAudit(fx, [], [])).json.holdHistory).toEqual([]); // legacy fixture exports an empty trail
    const plan = await planDisposal(fx, fx.asOf);
    const r = releaseHold(fx, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const exec = await executePlan(plan, r.fixture, []);
    expect(exec.rejectedStale).toBe(true);
    expect(exec.receipts).toHaveLength(0);
    const fresh = await planDisposal(r.fixture, fx.asOf);
    expect(fresh.id).not.toBe(plan.id);
    expect(fresh.counts.dispose).toBe(3);
    const out = await exportAudit(r.fixture, [], []);
    expect(out.json.holdHistory).toEqual(r.fixture.holdHistory);
    expect(out.json.holds.find((h) => h.id === 'h-subj1')!.releasedOn).toBe('2026-10-01');
  });
});
