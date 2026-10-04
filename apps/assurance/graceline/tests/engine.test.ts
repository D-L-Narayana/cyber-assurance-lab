import { describe, expect, it } from 'vitest';
import { POLICY } from '../src/engine/policy';
import { addDays, applyEvent, derive, GuardrailError, newException, prioritise, tick } from '../src/engine/lifecycle';
import { validateBoard, MAX_BOARD_BYTES } from '../src/engine/validate';
import type { Board, Exception } from '../src/engine/types';

const AS_OF = '2026-10-01';

function exc(p: Partial<Exception> = {}): Exception {
  return newException({
    id: 'EX-1',
    title: 'Legacy report server cannot receive October patches',
    policyRef: 'SEC-POL-07 §4.2 Patch timelines',
    riskLevel: 'high',
    requester: 'app.owner',
    owner: 'infra.lead',
    compensatingControls: ['Network isolation to reporting VLAN', 'Weekly vulnerability scan with manual review'],
    justification: 'Vendor patch breaks the reporting module; replacement platform is in procurement with go-live in December.',
    requestedOn: '2026-09-20',
    startOn: '2026-10-01',
    expiresOn: '2026-12-15',
    remediation: { plan: 'Migrate reports to the new platform and decommission the server.', dueOn: '2026-12-10', status: 'planned' },
    ...p,
  });
}

function toReview(e: Exception): Exception {
  return applyEvent(applyEvent(e, { type: 'submit', actor: e.requester }, AS_OF), { type: 'start-review', actor: 'grc.analyst' }, AS_OF);
}

function activate(e: Exception): Exception {
  let r = toReview(e);
  r = applyEvent(r, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: 'Accepted with isolation.' }, AS_OF);
  if (e.riskLevel === 'critical') r = applyEvent(r, { type: 'approve', actor: 'ciso', role: 'ciso', note: 'ok' }, AS_OF);
  else if (e.riskLevel === 'high') r = applyEvent(r, { type: 'approve', actor: 'line.manager', role: 'manager', note: 'ok' }, AS_OF);
  return r;
}

describe('policy', () => {
  it('has stricter duration, compensating-control and quorum rules for higher risk', () => {
    expect(POLICY.maxDurationDays.critical).toBeLessThan(POLICY.maxDurationDays.high);
    expect(POLICY.maxDurationDays.high).toBeLessThan(POLICY.maxDurationDays.moderate);
    expect(POLICY.maxDurationDays.moderate).toBeLessThan(POLICY.maxDurationDays.low);
    expect(POLICY.requireCompensating).toEqual(['high', 'critical']);
    expect(POLICY.quorum.critical.count).toBeGreaterThanOrEqual(POLICY.quorum.high.count);
    expect(POLICY.maxRenewals).toBe(2);
  });
});

describe('submit guardrails', () => {
  it('submits a well-formed request and records history', () => {
    const r = applyEvent(exc(), { type: 'submit', actor: 'app.owner' }, AS_OF);
    expect(r.state).toBe('submitted');
    expect(r.history.at(-1)).toMatchObject({ event: 'submit', from: 'draft', to: 'submitted', actor: 'app.owner' });
  });
  it('refuses durations beyond the policy maximum for the risk level, listing every violated guardrail', () => {
    const tooLong = exc({ expiresOn: '2027-06-01' }); // > 90 days for high
    try {
      applyEvent(tooLong, { type: 'submit', actor: 'app.owner' }, AS_OF);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GuardrailError);
      expect((e as GuardrailError).reasons.join(' ')).toMatch(/90 days/);
    }
  });
  it('requires a compensating control for high and critical, not for moderate', () => {
    expect(() => applyEvent(exc({ compensatingControls: [] }), { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(/compensating/i);
    expect(applyEvent(exc({ riskLevel: 'moderate', compensatingControls: [] }), { type: 'submit', actor: 'app.owner' }, AS_OF).state).toBe('submitted');
  });
  it('requires a substantive justification, an owner, and a remediation plan due before expiry', () => {
    expect(() => applyEvent(exc({ justification: 'because' }), { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(/justification/i);
    expect(() => applyEvent(exc({ owner: '' }), { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(/owner/i);
    expect(() => applyEvent(exc({ remediation: { plan: '', dueOn: '2026-12-10', status: 'planned' } }), { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(/remediation plan/i);
    expect(() => applyEvent(exc({ remediation: { plan: 'Migrate.', dueOn: '2026-12-31', status: 'planned' } }), { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(/before .*expir/i);
  });
  it('only the requester can submit; expiry must be after start', () => {
    expect(() => applyEvent(exc(), { type: 'submit', actor: 'someone.else' }, AS_OF)).toThrow(/requester/i);
    expect(() => applyEvent(exc({ expiresOn: '2026-09-30' }), { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(/after .*start/i);
  });
});

describe('approval quorum and separation of duties', () => {
  it('high risk needs two approvals including a risk-owner; one approval keeps it under review', () => {
    let r = toReview(exc());
    r = applyEvent(r, { type: 'approve', actor: 'line.manager', role: 'manager', note: 'ok' }, AS_OF);
    expect(r.state).toBe('under-review');
    expect(derive(r, AS_OF).quorum).toMatchObject({ have: 1, need: 2, met: false, missingRoles: ['risk-owner'] });
    r = applyEvent(r, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: 'ok' }, AS_OF);
    expect(r.state).toBe('active');
    expect(r.history.at(-1)).toMatchObject({ event: 'approve', to: 'active' });
  });
  it('two approvals without the required role do not activate', () => {
    let r = toReview(exc());
    r = applyEvent(r, { type: 'approve', actor: 'a', role: 'manager', note: '' }, AS_OF);
    r = applyEvent(r, { type: 'approve', actor: 'b', role: 'control-owner', note: '' }, AS_OF);
    expect(r.state).toBe('under-review');
    expect(derive(r, AS_OF).quorum.missingRoles).toEqual(['risk-owner']);
  });
  it('critical needs both ciso and risk-owner; low needs one approval of any role', () => {
    const crit = exc({ riskLevel: 'critical', expiresOn: '2026-10-25', remediation: { plan: 'Fix.', dueOn: '2026-10-20', status: 'planned' } });
    let r = toReview(crit);
    r = applyEvent(r, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: '' }, AS_OF);
    expect(r.state).toBe('under-review');
    r = applyEvent(r, { type: 'approve', actor: 'ciso', role: 'ciso', note: '' }, AS_OF);
    expect(r.state).toBe('active');
    const low = toReview(exc({ riskLevel: 'low', compensatingControls: [], expiresOn: '2027-03-01', remediation: { plan: 'Fix.', dueOn: '2027-02-01', status: 'planned' } }));
    expect(applyEvent(low, { type: 'approve', actor: 'anyone', role: 'control-owner', note: '' }, AS_OF).state).toBe('active');
  });
  it('refuses approvals by the requester or the risk owner (separation of duties) and duplicate approvers', () => {
    const r = toReview(exc());
    expect(() => applyEvent(r, { type: 'approve', actor: 'app.owner', role: 'manager', note: '' }, AS_OF)).toThrow(/separation of duties/i);
    expect(() => applyEvent(r, { type: 'approve', actor: 'infra.lead', role: 'risk-owner', note: '' }, AS_OF)).toThrow(/separation of duties/i);
    const once = applyEvent(r, { type: 'approve', actor: 'x', role: 'manager', note: '' }, AS_OF);
    expect(() => applyEvent(once, { type: 'approve', actor: 'x', role: 'risk-owner', note: '' }, AS_OF)).toThrow(/already approved/i);
  });
  it('rejection needs a note and is terminal; withdrawal is allowed before activation only', () => {
    const r = toReview(exc());
    expect(() => applyEvent(r, { type: 'reject', actor: 'risk.owner', note: ' ' }, AS_OF)).toThrow(/note/i);
    const rej = applyEvent(r, { type: 'reject', actor: 'risk.owner', note: 'Isolation is not in place yet.' }, AS_OF);
    expect(rej.state).toBe('rejected');
    expect(() => applyEvent(rej, { type: 'submit', actor: 'app.owner' }, AS_OF)).toThrow(GuardrailError);
    expect(applyEvent(exc(), { type: 'withdraw', actor: 'app.owner', note: 'no longer needed' }, AS_OF).state).toBe('withdrawn');
    expect(() => applyEvent(activate(exc()), { type: 'withdraw', actor: 'app.owner', note: 'x' }, AS_OF)).toThrow(GuardrailError);
  });
});

describe('time: expiry, escalation, renewal', () => {
  it('tick moves active past expiry to expired, and expired past the grace window to escalated', () => {
    const a = activate(exc());
    expect(tick(a, '2026-12-15').state).toBe('active'); // expiry day is still active
    const ex = tick(a, '2026-12-16');
    expect(ex.state).toBe('expired');
    expect(ex.history.at(-1)).toMatchObject({ event: 'tick', to: 'expired' });
    expect(tick(ex, '2026-12-29').state).toBe('expired'); // within 14-day grace
    const es = tick(ex, '2026-12-30');
    expect(es.state).toBe('escalated');
    expect(es.history.at(-1)?.to).toBe('escalated');
  });
  it('tick is idempotent and never touches terminal or pre-approval states', () => {
    const a = activate(exc());
    const once = tick(a, '2027-02-01');
    expect(JSON.stringify(tick(once, '2027-02-01'))).toBe(JSON.stringify(once));
    const d = exc();
    expect(tick(d, '2028-01-01')).toBe(d);
  });
  it('derive flags expiring within the warning window and counts overdue days', () => {
    const a = activate(exc());
    expect(derive(a, '2026-12-01').expiring).toBe(true);
    expect(derive(a, '2026-11-01').expiring).toBe(false);
    expect(derive(tick(a, '2026-12-20'), '2026-12-20').overdueDays).toBe(5);
  });
  it('renewal request resets approvals and parks the new date as pending; the counter moves only on approval', () => {
    const a = activate(exc());
    const r1 = applyEvent(a, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-03-01', note: 'Procurement slipped.' }, '2026-12-10');
    expect(r1.state).toBe('active');
    expect(r1.renewals).toBe(0);
    expect(r1.approvals).toEqual([]);
    expect(r1.expiresOn).toBe('2026-12-15');
    expect(r1.pendingRenewal?.newExpiresOn).toBe('2027-03-01');
    const a2 = applyEvent(applyEvent(r1, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: '' }, '2026-12-11'), { type: 'approve', actor: 'mgr', role: 'manager', note: '' }, '2026-12-11');
    expect(a2.renewals).toBe(1);
    expect(a2.expiresOn).toBe('2027-03-01');
  });
  it('renewal cannot extend beyond the policy maximum from the current expiry nor into the past', () => {
    const a = activate(exc());
    expect(() => applyEvent(a, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-06-01', note: 'x' }, '2026-12-10')).toThrow(/90 days/);
    expect(() => applyEvent(a, { type: 'renew', actor: 'app.owner', newExpiresOn: '2026-11-01', note: 'x' }, '2026-12-10')).toThrow(/after/i);
  });
  it('an expired exception can be renewed; an escalated one can be closed but not renewed', () => {
    const ex = tick(activate(exc()), '2026-12-20');
    expect(applyEvent(ex, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-02-01', note: 'late' }, '2026-12-20')).toMatchObject({ state: 'expired', pendingRenewal: { newExpiresOn: '2027-02-01' } });
    const es = tick(ex, '2027-01-15');
    expect(() => applyEvent(es, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-03-01', note: 'x' }, '2027-01-15')).toThrow(GuardrailError);
    const closed = applyEvent(es, { type: 'close', actor: 'infra.lead', evidence: 'Server decommissioned 2027-01-14; CMDB record CI-4411 retired.' }, '2027-01-15');
    expect(closed.state).toBe('closed');
    expect(closed.closure?.closedBy).toBe('infra.lead');
  });
});

describe('closure and remediation', () => {
  it('closure requires substantive evidence', () => {
    const a = activate(exc());
    expect(() => applyEvent(a, { type: 'close', actor: 'infra.lead', evidence: 'done' }, AS_OF)).toThrow(/evidence/i);
    expect(applyEvent(a, { type: 'close', actor: 'infra.lead', evidence: 'Migrated to new platform; old server powered off and removed from inventory.' }, AS_OF).state).toBe('closed');
  });
  it('remediation status can be updated while active and is recorded in history', () => {
    const a = activate(exc());
    const r = applyEvent(a, { type: 'update-remediation', actor: 'infra.lead', status: 'in-progress', note: 'Vendor kickoff done.' }, AS_OF);
    expect(r.remediation.status).toBe('in-progress');
    expect(r.history.at(-1)).toMatchObject({ event: 'update-remediation', from: 'active', to: 'active' });
  });
  it('history is append-only and the input is never mutated', () => {
    const e = exc();
    const snap = JSON.stringify(e);
    const r = applyEvent(e, { type: 'submit', actor: 'app.owner' }, AS_OF);
    expect(JSON.stringify(e)).toBe(snap);
    expect(r.history.length).toBe(e.history.length + 1);
  });
});

describe('prioritisation', () => {
  it('ranks escalated critical above expiring high above active low; compensating controls reduce priority', () => {
    const esc = tick(tick(activate(exc({ id: 'A', riskLevel: 'critical', expiresOn: '2026-10-20', remediation: { plan: 'x', dueOn: '2026-10-15', status: 'planned' } })), '2026-10-21'), '2026-11-10');
    const expiring = activate(exc({ id: 'B', expiresOn: '2026-11-15', remediation: { plan: 'x', dueOn: '2026-11-10', status: 'planned' } }));
    const low = activate(exc({ id: 'C', riskLevel: 'low', compensatingControls: [], expiresOn: '2027-06-01', remediation: { plan: 'x', dueOn: '2027-05-01', status: 'planned' } }));
    const board: Board = { schema: 'graceline.board/1', asOf: '2026-11-10', exceptions: [low, expiring, esc] };
    const ranked = prioritise(board);
    expect(ranked.map((d) => d.id)).toEqual(['A', 'B', 'C']);
    const withCc = derive(expiring, '2026-11-10').priority;
    const without = derive({ ...expiring, compensatingControls: [] }, '2026-11-10').priority;
    expect(without).toBeGreaterThan(withCc);
  });
  it('derive reports live guardrail violations on existing records (e.g. imported over-long active exceptions)', () => {
    const a = { ...activate(exc()), expiresOn: '2027-09-01' };
    expect(derive(a, AS_OF).guardrails.join(' ')).toMatch(/90 days/);
  });
});

describe('validation', () => {
  const board = (exceptions: Exception[]): Board => ({ schema: 'graceline.board/1', asOf: AS_OF, exceptions });
  it('accepts a valid board', () => {
    expect(validateBoard(JSON.stringify(board([exc(), activate(exc({ id: 'EX-2' }))]))).ok).toBe(true);
  });
  it('rejects oversized (UTF-8), malformed and wrong-schema input', () => {
    expect(validateBoard('€'.repeat(Math.ceil(MAX_BOARD_BYTES / 3) + 1)).ok).toBe(false);
    expect(validateBoard('{').ok).toBe(false);
    expect(validateBoard(JSON.stringify({ ...board([]), schema: 'x' })).ok).toBe(false);
  });
  it('rejects unknown states, roles and risk levels, bad dates, negative renewals and duplicate ids with paths', () => {
    const bad = exc();
    (bad as unknown as { state: string }).state = 'limbo';
    (bad as unknown as { riskLevel: string }).riskLevel = 'extreme';
    bad.renewals = -1;
    bad.approvals = [{ approver: 'a', role: 'king' as never, decidedOn: '2026-02-30', note: '' }];
    const r = validateBoard(JSON.stringify(board([bad, exc()])));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('exceptions[0].state');
      expect(paths).toContain('exceptions[0].riskLevel');
      expect(paths).toContain('exceptions[0].renewals');
      expect(paths).toContain('exceptions[0].approvals[0].role');
      expect(paths).toContain('exceptions[0].approvals[0].decidedOn');
      expect(paths).toContain('exceptions[1].id');
    }
  });
  it('rejects more than 300 exceptions', () => {
    expect(validateBoard(JSON.stringify(board(Array.from({ length: 301 }, (_, i) => exc({ id: 'E' + i }))))).ok).toBe(false);
  });
});

describe('bundled fixture', () => {
  it('validates and covers every lifecycle state after ticking to the board date', async () => {
    const demo = (await import('../src/fixtures/harbourline-board.json')).default;
    const r = validateBoard(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ticked = r.board.exceptions.map((e) => tick(e, r.board.asOf));
    const states = new Set(ticked.map((e) => e.state));
    for (const s of ['draft', 'submitted', 'under-review', 'active', 'expired', 'escalated', 'closed', 'rejected']) expect(states.has(s as never)).toBe(true);
    expect(ticked.some((e) => derive(e, r.board.asOf).expiring)).toBe(true);
    expect(ticked.some((e) => derive(e, r.board.asOf).guardrails.length > 0)).toBe(true);
  });
});

describe('sixth review regressions — renewal governance', () => {
  it('only the requester or the risk owner may request a renewal', () => {
    const a = activate(exc());
    expect(() => applyEvent(a, { type: 'renew', actor: 'anyone', newExpiresOn: '2027-01-31', note: '' }, '2026-12-10')).toThrow(/Only the requester .* or the risk owner/i);
    expect(applyEvent(a, { type: 'renew', actor: 'infra.lead', newExpiresOn: '2027-01-31', note: 'owner asks' }, '2026-12-10').pendingRenewal?.newExpiresOn).toBe('2027-01-31');
  });
  it('a renewal request keeps the current term: state and expiry are unchanged until the renewal is approved', () => {
    const a = activate(exc());
    const r = applyEvent(a, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-02-20', note: 'slip' }, '2026-12-10');
    expect(r.state).toBe('active');
    expect(r.expiresOn).toBe('2026-12-15');
    expect(r.approvals).toEqual([]);
    expect(r.pendingRenewal).toMatchObject({ newExpiresOn: '2027-02-20', requestedBy: 'app.owner' });
    expect(r.renewals).toBe(0); // counted only when approved
  });
  it('an unapproved renewal still expires and escalates on schedule and stays overdue (repro gl-adverse)', () => {
    const ex = tick(activate(exc()), '2026-12-20'); // expired
    const r = applyEvent(ex, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-02-20', note: 'late' }, '2026-12-20');
    expect(r.state).toBe('expired');
    const later = tick(r, '2028-01-24');
    expect(later.state).toBe('escalated');
    const d = derive(later, '2028-01-24');
    expect(d.overdueDays).toBeGreaterThan(300);
    expect(d.priority).toBeGreaterThan(derive(ex, '2026-12-20').priority);
  });
  it('approving a pending renewal to quorum applies the new expiry, increments renewals and reactivates', () => {
    const ex = tick(activate(exc()), '2026-12-20');
    let r = applyEvent(ex, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-02-20', note: 'late' }, '2026-12-20');
    r = applyEvent(r, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: '' }, '2026-12-21');
    expect(r.state).toBe('expired'); // quorum not yet met → term unchanged
    r = applyEvent(r, { type: 'approve', actor: 'line.manager', role: 'manager', note: '' }, '2026-12-21');
    expect(r.state).toBe('active');
    expect(r.expiresOn).toBe('2027-02-20');
    expect(r.renewals).toBe(1);
    expect(r.pendingRenewal).toBeUndefined();
    expect(r.history.at(-1)).toMatchObject({ event: 'approve', to: 'active' });
  });
  it('rejecting a pending renewal clears it and leaves the record in its current state (not terminal)', () => {
    const a = activate(exc());
    const r = applyEvent(a, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-02-20', note: '' }, '2026-12-10');
    const rej = applyEvent(r, { type: 'reject', actor: 'risk.owner', note: 'No more extensions.' }, '2026-12-11');
    expect(rej.state).toBe('active');
    expect(rej.pendingRenewal).toBeUndefined();
    expect(rej.history.at(-1)).toMatchObject({ event: 'reject', from: 'active', to: 'active' });
  });
  it('approve/reject are refused on active records without a pending renewal; a second renew while one is pending is refused', () => {
    const a = activate(exc());
    expect(() => applyEvent(a, { type: 'approve', actor: 'x', role: 'manager', note: '' }, AS_OF)).toThrow(GuardrailError);
    const r = applyEvent(a, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-02-20', note: '' }, '2026-12-10');
    expect(() => applyEvent(r, { type: 'renew', actor: 'app.owner', newExpiresOn: '2027-03-01', note: '' }, '2026-12-10')).toThrow(/pending/i);
  });
  it('the renewal cap counts approved renewals only', () => {
    let e = activate(exc());
    for (let i = 0; i < 2; i++) {
      e = applyEvent(e, { type: 'renew', actor: 'app.owner', newExpiresOn: addDays(e.expiresOn, 60), note: '' }, addDays(e.expiresOn, -5));
      e = applyEvent(e, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: '' }, addDays(e.expiresOn, -4));
      e = applyEvent(e, { type: 'approve', actor: 'line.manager', role: 'manager', note: '' }, addDays(e.expiresOn, -4));
    }
    expect(e.renewals).toBe(2);
    expect(() => applyEvent(e, { type: 'renew', actor: 'app.owner', newExpiresOn: addDays(e.expiresOn, 30), note: '' }, addDays(e.expiresOn, -5))).toThrow(/new exception/i);
  });
});
