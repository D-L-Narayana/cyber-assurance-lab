import { describe, expect, it } from 'vitest';
import { findIssues, renewalQueue, transition, evidencePacket, validateRegister, exportIssues, effectiveStatus, parseWindowHours } from './register';
import type { Register } from './types';

const reg: Register = {
  schemaVersion: 1, label: 'unit', asOf: '2026-10-01', restrictedCategories: ['payroll', 'health', 'identity_documents'],
  systems: [{ id: 's-hris', name: 'HRIS' }, { id: 's-crm', name: 'CRM' }],
  vendors: [{ id: 'v-pay', name: 'PayCo Example', country: 'IE', role: 'processor' }, { id: 'v-mail', name: 'MailCo Example', country: 'US', role: 'processor' }],
  owners: [{ id: 'o-ada', name: 'Ada Example', status: 'active' }, { id: 'o-gone', name: 'Gone Person', status: 'left' }],
  agreements: [
    { id: 'ag-pay', title: 'Payroll processing DPA', vendorId: 'v-pay', ownerId: 'o-ada', status: 'active', startOn: '2025-01-01', endOn: '2026-11-15', noticeDays: 60, categories: ['payroll', 'contact'], purpose: 'Run payroll', transferMechanism: 'intra-EEA (synthetic label)',
      obligations: [
        { id: 'ob-1', kind: 'breach_notification', requirement: '24h', evidence: { ref: 'DPA §9', on: '2025-01-01' } },
        { id: 'ob-2', kind: 'encryption', requirement: 'AES-256 at rest', evidence: null },
        { id: 'ob-3', kind: 'deletion_on_termination', requirement: '30 days after end', evidence: null },
      ] },
    { id: 'ag-pay-2', title: 'PayCo analytics addendum', vendorId: 'v-pay', ownerId: 'o-gone', status: 'active', startOn: '2026-01-01', endOn: '2027-06-30', noticeDays: 90, categories: ['contact'], purpose: 'Reporting', transferMechanism: 'intra-EEA (synthetic label)',
      obligations: [{ id: 'ob-4', kind: 'breach_notification', requirement: '72h', evidence: { ref: 'Addendum §3', on: '2026-01-01' } }] },
    { id: 'ag-mail', title: 'Newsletter delivery', vendorId: 'v-mail', ownerId: 'o-ada', status: 'active', startOn: '2024-01-01', endOn: '2026-06-30', noticeDays: 30, categories: ['contact'], purpose: 'Marketing', transferMechanism: 'SCC-style clauses (synthetic label)',
      obligations: [{ id: 'ob-5', kind: 'deletion_on_termination', requirement: '14 days', evidence: null }] },
    { id: 'ag-draft', title: 'Draft support tool', vendorId: 'v-mail', ownerId: null, status: 'draft', startOn: '2026-10-01', endOn: '2027-10-01', noticeDays: 30, categories: [], purpose: 'Support', transferMechanism: 'tbd', obligations: [] },
  ],
  flows: [
    { id: 'fl-1', systemId: 's-hris', vendorId: 'v-pay', agreementId: 'ag-pay', categories: ['payroll', 'contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-28' },
    { id: 'fl-2', systemId: 's-hris', vendorId: 'v-pay', agreementId: 'ag-pay', categories: ['health'], direction: 'outbound', active: true, lastTransferOn: '2026-09-01' },     // category not covered
    { id: 'fl-3', systemId: 's-crm', vendorId: 'v-mail', agreementId: 'ag-mail', categories: ['contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-20' },  // after end
    { id: 'fl-4', systemId: 's-crm', vendorId: 'v-mail', agreementId: null, categories: ['contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-29' },       // no agreement
    { id: 'fl-5', systemId: 's-crm', vendorId: 'v-pay', agreementId: 'ag-pay-2', categories: ['contact'], direction: 'inbound', active: true, lastTransferOn: '2024-01-15' },    // stale
    { id: 'fl-6', systemId: 's-crm', vendorId: 'v-mail', agreementId: 'ag-pay', categories: ['contact'], direction: 'outbound', active: false, lastTransferOn: null },         // vendor mismatch but inactive
  ],
  history: [],
};

describe('effectiveStatus and issue detection', () => {
  const issues = findIssues(reg, reg.asOf);
  const kinds = (k: string) => issues.filter((i) => i.kind === k);
  it('treats an active agreement past its end date as expired', () => {
    expect(effectiveStatus(reg.agreements[2]!, reg.asOf)).toBe('expired');
    expect(kinds('expired_but_active').map((i) => i.agreementId)).toEqual(['ag-mail']);
  });
  it('flags missing or departed owners', () => {
    expect(kinds('missing_owner').map((i) => i.agreementId).sort()).toEqual(['ag-draft', 'ag-pay-2']);
  });
  it('opens the renewal window noticeDays before the end date', () => {
    expect(kinds('renewal_window_open').map((i) => i.agreementId)).toEqual(['ag-pay']); // 45 days to end, 60-day notice
  });
  it('flags flows without an agreement, with uncovered categories, after agreement end, stale, and vendor mismatches', () => {
    expect(kinds('flow_without_agreement').map((i) => i.flowId)).toEqual(['fl-4']);
    expect(kinds('flow_category_not_covered')[0]).toMatchObject({ flowId: 'fl-2', severity: 'high' });
    expect(kinds('flow_category_not_covered')[0]!.detail).toMatch(/health/);
    expect(kinds('flow_after_end').map((i) => i.flowId)).toEqual(['fl-3']);
    expect(kinds('stale_flow').map((i) => i.flowId)).toEqual(['fl-5']);
    expect(kinds('vendor_mismatch').map((i) => i.flowId)).toEqual(['fl-6']);
  });
  it('flags obligations without evidence and unmet deletion obligations after end', () => {
    expect(kinds('obligation_no_evidence').map((i) => i.detail).join(' ')).toMatch(/AES-256/);
    expect(kinds('deletion_obligation_unmet').map((i) => i.agreementId)).toEqual(['ag-mail']);
  });
  it('detects contradictory breach-notification windows for the same vendor', () => {
    const c = kinds('contradictory_breach_window');
    expect(c).toHaveLength(1);
    expect(c[0]!.detail).toMatch(/24h/); expect(c[0]!.detail).toMatch(/72h/);
  });
  it('assigns stable ids and sorts by severity', () => {
    expect(issues[0]!.severity).toBe('high');
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
    expect(findIssues(reg, reg.asOf)).toEqual(issues);
  });
});

describe('renewal priority', () => {
  it('scores closer expiry, restricted categories, active flows, open obligations and missing owner with an explained breakdown', () => {
    const q = renewalQueue(reg, reg.asOf);
    const pay = q.find((p) => p.agreementId === 'ag-pay')!;
    const pay2 = q.find((p) => p.agreementId === 'ag-pay-2')!;
    expect(pay.score).toBeGreaterThan(pay2.score);
    expect(pay.breakdown.map((b) => b.factor)).toEqual(expect.arrayContaining(['expiry', 'restricted categories', 'active flows', 'open obligations']));
    expect(pay2.breakdown.some((b) => b.factor === 'owner' && b.points > 0)).toBe(true);
    expect(pay.score).toBe(pay.breakdown.reduce((n, b) => n + b.points, 0));
    expect(q[0]!.score).toBeGreaterThanOrEqual(q[q.length - 1]!.score);
  });
  it('excludes drafts and terminated agreements from the queue', () => {
    expect(renewalQueue(reg, reg.asOf).some((p) => p.agreementId === 'ag-draft')).toBe(false);
  });
});

describe('transition guards', () => {
  it('draft → active requires an owner, categories and a later end date', () => {
    const r = transition(reg, { agreementId: 'ag-draft', to: 'active', reason: 'signed' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner/i);
    const fixed: Register = { ...reg, agreements: reg.agreements.map((a) => a.id === 'ag-draft' ? { ...a, ownerId: 'o-ada', categories: ['contact'] } : a) };
    const ok = transition(fixed, { agreementId: 'ag-draft', to: 'active', reason: 'signed' });
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.register.agreements.find((a) => a.id === 'ag-draft')!.status).toBe('active'); expect(ok.register.history.at(-1)).toMatchObject({ from: 'draft', to: 'active', seq: 1 }); }
  });
  it('termination with active flows requires explicit acknowledgement and records it', () => {
    const r = transition(reg, { agreementId: 'ag-pay', to: 'terminated', reason: 'vendor change' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2 active flows/);
    const ok = transition(reg, { agreementId: 'ag-pay', to: 'terminated', reason: 'vendor change', acknowledgeActiveFlows: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.register.history.at(-1)?.note).toMatch(/acknowledged/);
      expect(findIssues(ok.register, reg.asOf).filter((i) => i.kind === 'flow_after_end').map((i) => i.flowId)).toEqual(expect.arrayContaining(['fl-1', 'fl-2']));
    }
  });
  it('renewing → active needs a new end date after the old one and resets the renewal window', () => {
    let r = transition(reg, { agreementId: 'ag-pay', to: 'renewing', reason: 'notice sent' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bad = transition(r.register, { agreementId: 'ag-pay', to: 'active', reason: 'renewed', newEndOn: '2026-11-01' });
    expect(bad.ok).toBe(false);
    const good = transition(r.register, { agreementId: 'ag-pay', to: 'active', reason: 'renewed', newEndOn: '2028-11-15' });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.register.agreements.find((a) => a.id === 'ag-pay')!.endOn).toBe('2028-11-15');
      expect(findIssues(good.register, reg.asOf).some((i) => i.kind === 'renewal_window_open' && i.agreementId === 'ag-pay')).toBe(false);
    }
  });
  it('rejects undefined transitions and empty reasons', () => {
    expect(transition(reg, { agreementId: 'ag-mail', to: 'draft', reason: 'x' }).ok).toBe(false);
    expect(transition(reg, { agreementId: 'ag-pay', to: 'renewing', reason: '  ' }).ok).toBe(false);
    expect(transition(reg, { agreementId: 'nope', to: 'renewing', reason: 'x' }).ok).toBe(false);
  });
});

describe('evidence packet, validation, export', () => {
  it('builds a packet with agreement, vendor, owner, flows, obligations, issues, priority and markdown', () => {
    const p = evidencePacket(reg, 'ag-pay', reg.asOf);
    expect(p.json.schema).toBe('outflow.packet/v1');
    expect(p.json.vendor.name).toBe('PayCo Example');
    expect(p.json.flows).toHaveLength(3); // fl-1, fl-2 and the inactive mismatched fl-6 all reference ag-pay
    expect(p.json.obligations.filter((o) => o.status === 'no evidence')).toHaveLength(2);
    expect(p.json.issues.length).toBeGreaterThan(0);
    expect(p.markdown).toMatch(/# Evidence packet/);
    expect(p.markdown).toMatch(/Payroll processing DPA/);
  });
  it('validates malformed registers without throwing', () => {
    for (const bad of [null, [], { schemaVersion: 1 }, { ...reg, agreements: [null] }, { ...reg, flows: [{ id: 'f', vendorId: 'ghost' }] }, { ...reg, agreements: [{ ...reg.agreements[0]!, endOn: '2026-02-30' }] }, { ...reg, agreements: [{ ...reg.agreements[0]!, obligations: 'x' }] }]) {
      let r: ReturnType<typeof validateRegister> | undefined;
      expect(() => { r = validateRegister(bad); }).not.toThrow();
      expect(r!.ok).toBe(false);
    }
    expect(validateRegister({ ...reg, agreements: Array.from({ length: 501 }, (_, i) => ({ ...reg.agreements[0]!, id: `a${i}` })) }).ok).toBe(false);
    expect(validateRegister(reg).ok).toBe(true);
  });
  it('exports issues as formula-safe CSV and a stable JSON schema', () => {
    const evil: Register = { ...reg, vendors: reg.vendors.map((v) => ({ ...v, name: '=HYPERLINK()' })) };
    const out = exportIssues(evil, reg.asOf);
    expect(out.json.schema).toBe('outflow.register/v1');
    expect(out.csv).toContain("'=HYPERLINK");
    expect(out.json.issues.length).toBe(findIssues(evil, reg.asOf).length);
  });
});

describe('review follow-ups (2026-10-01)', () => {
  it('flags an active flow that references a draft (unsigned) agreement', () => {
    const r: Register = { ...reg, flows: [...reg.flows, { id: 'fl-draft', systemId: 's-crm', vendorId: 'v-mail', agreementId: 'ag-draft', categories: ['contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-30' }] };
    const mine = findIssues(r, r.asOf).filter((i) => i.flowId === 'fl-draft');
    expect(mine.map((i) => i.kind)).toContain('flow_under_draft');
    expect(mine.find((i) => i.kind === 'flow_under_draft')!.severity).toBe('high');
  });
  it('rejects obligation kinds outside the enum (typos cannot silently escape contradiction checks)', () => {
    const r = { ...reg, agreements: [{ ...reg.agreements[0]!, obligations: [{ id: 'ob-x', kind: 'breach_notifcation', requirement: '24h', evidence: null }] }] };
    const v = validateRegister(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(' ')).toMatch(/kind/);
  });
  it('renewal end date must be after the as-of date, not only after the old end date', () => {
    const past: Register = { ...reg, agreements: reg.agreements.map((a) => a.id === 'ag-mail' ? { ...a, status: 'renewing' as const, endOn: '2020-01-01' } : a) };
    const bad = transition(past, { agreementId: 'ag-mail', to: 'active', reason: 'renewed', newEndOn: '2020-06-01' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/as-of|today|future/i);
  });
});

describe('breach-window normalisation (October 2026 upgrade round)', () => {
  it.each([
    ['72h', 72], ['72 h', 72], ['72 hours', 72], ['72hrs', 72], ['72 hr', 72], ['24 hour', 24],
    ['3 days', 72], ['3d', 72], ['1 day', 24], ['1 week', 168], ['1w', 168], ['2 weeks', 336], ['2 wks', 336],
    ['within 72 hours', 72], ['no later than 3 days', 72], ['Within 48 Hours of becoming aware', 48], ['notify in 72h; weekly summary', 72],
  ])('parses %j as %i hours', (raw, hours) => {
    expect(parseWindowHours(raw)).toBe(hours);
  });

  it.each(['without undue delay', 'immediately', 'two days', '', '   ', 'ASAP', '24 business hours', 'quarterly', '72', 'h72'])('returns null for unparseable %j', (raw) => {
    expect(parseWindowHours(raw)).toBeNull();
  });

  const withWindows = (a: string, b: string, extra?: string): Register => ({
    ...reg,
    agreements: reg.agreements.map((x) => x.id === 'ag-pay' ? { ...x, obligations: [{ id: 'ob-1', kind: 'breach_notification' as const, requirement: a, evidence: null }] }
      : x.id === 'ag-pay-2' ? { ...x, obligations: [{ id: 'ob-4', kind: 'breach_notification' as const, requirement: b, evidence: null }] } : x)
      .concat(extra === undefined ? [] : [{ id: 'ag-pay-3', title: 'PayCo support addendum', vendorId: 'v-pay', ownerId: 'o-ada', status: 'active' as const, startOn: '2026-01-01', endOn: '2027-12-31', noticeDays: 30, categories: ['contact'], purpose: 'Support', transferMechanism: 'intra-EEA (synthetic label)', obligations: [{ id: 'ob-9', kind: 'breach_notification' as const, requirement: extra, evidence: null }] }]),
  });
  const contradictions = (r: Register) => findIssues(r, r.asOf).filter((i) => i.kind === 'contradictory_breach_window' && i.vendorId === 'v-pay');

  it('does not report a contradiction between 72h and 3 days (same window, different units)', () => {
    expect(contradictions(withWindows('72h', '3 days'))).toHaveLength(0);
    expect(contradictions(withWindows('1 week', '7 days'))).toHaveLength(0);
    expect(contradictions(withWindows('within 24 hours', '1d'))).toHaveLength(0);
  });

  it('reports a contradiction across units and lists unparseable requirements as "not compared"', () => {
    const c = contradictions(withWindows('24h', '3 days', 'without undue delay'));
    expect(c).toHaveLength(1);
    expect(c[0]!.detail).toMatch(/24h \(24 h\)/);
    expect(c[0]!.detail).toMatch(/3 days \(72 h\)/);
    expect(c[0]!.detail).toMatch(/not compared: "without undue delay"/);
    expect(c[0]!.id).toBe('contradictory_breach_window:ag-pay:-');
  });

  it('never raises a contradiction from unparseable text alone', () => {
    expect(contradictions(withWindows('without undue delay', 'immediately'))).toHaveLength(0);
    expect(contradictions(withWindows('72h', 'immediately'))).toHaveLength(0);
    expect(findIssues(withWindows('72h', 'immediately'), reg.asOf).some((i) => /not compared/.test(i.detail))).toBe(false);
  });
});
