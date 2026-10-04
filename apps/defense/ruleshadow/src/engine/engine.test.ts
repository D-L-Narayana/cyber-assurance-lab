import { describe, it, expect } from 'vitest';
import { parseCidr, parsePorts, addressCount, subtractIntervals } from './net';
import { parseRuleCsv, type Rule } from './rules';
import { analyzeRules, analyzeCoverage, KIND_META } from './analyze';
import { proposeChange, applyProposals, diffRuleSets } from './change';
import { explainRule } from './explain';
import { toCsv, buildReport, findingRows } from './report';
import { SAMPLE_RULES_CSV } from './fixtures';

describe('network primitives', () => {
  it('parses CIDR blocks into inclusive 32-bit intervals', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual({ lo: 167772160, hi: 184549375 });
    expect(parseCidr('192.168.1.7/32')).toEqual({ lo: 3232235783, hi: 3232235783 });
    expect(parseCidr('192.168.1.7')).toEqual({ lo: 3232235783, hi: 3232235783 });
    expect(parseCidr('any')).toEqual({ lo: 0, hi: 4294967295 });
    expect(parseCidr('300.1.1.1/8')).toBeNull();
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(addressCount({ lo: 167772160, hi: 184549375 })).toBe(16777216);
  });
  it('parses port expressions and rejects out-of-range or reversed values', () => {
    expect(parsePorts('443')).toEqual([{ lo: 443, hi: 443 }]);
    expect(parsePorts('80-443')).toEqual([{ lo: 80, hi: 443 }]);
    expect(parsePorts('22,80-81')).toEqual([{ lo: 22, hi: 22 }, { lo: 80, hi: 81 }]);
    expect(parsePorts('any')).toEqual([{ lo: 0, hi: 65535 }]);
    expect(parsePorts('70000')).toBeNull();
    expect(parsePorts('443-80')).toBeNull();
  });
  it('subtracts covered intervals leaving the uncovered remainder', () => {
    expect(subtractIntervals([{ lo: 80, hi: 443 }], [{ lo: 80, hi: 200 }, { lo: 201, hi: 443 }])).toEqual([]);
    expect(subtractIntervals([{ lo: 80, hi: 443 }], [{ lo: 80, hi: 200 }])).toEqual([{ lo: 201, hi: 443 }]);
    expect(subtractIntervals([{ lo: 1, hi: 10 }], [{ lo: 4, hi: 5 }])).toEqual([{ lo: 1, hi: 3 }, { lo: 6, hi: 10 }]);
  });
});

const base = (over: Partial<Rule>): Rule => ({
  id: 'r', seq: 1, action: 'allow', src: '10.0.0.0/8', dst: '10.0.5.10/32', proto: 'tcp', ports: '443',
  zoneFrom: 'corp', zoneTo: 'dmz', enabled: true, owner: 'netops', expires: '', lastHit: '2026-09-20', comment: '', ...over,
});
const NOW = '2026-10-01';

describe('shadow and conflict analysis', () => {
  it('reports a later rule fully covered by an earlier same-action rule as redundant', () => {
    const rules = [base({ id: 'A', seq: 1, src: '10.0.0.0/8', ports: 'any' }), base({ id: 'B', seq: 2, src: '10.0.4.0/24', ports: '443' })];
    const f = analyzeRules(rules, { now: NOW });
    const red = f.find(x => x.kind === 'redundant');
    expect(red?.ruleId).toBe('B');
    expect(red?.relatedRuleIds).toEqual(['A']);
  });
  it('reports a later rule fully covered by an earlier opposite-action rule as a conflict', () => {
    const rules = [base({ id: 'A', seq: 1, action: 'deny', ports: 'any' }), base({ id: 'B', seq: 2, action: 'allow', ports: '443' })];
    const f = analyzeRules(rules, { now: NOW });
    expect(f.find(x => x.kind === 'conflict')?.ruleId).toBe('B');
  });
  it('does not flag partial overlap as shadowing', () => {
    const rules = [base({ id: 'A', seq: 1, ports: '80-200' }), base({ id: 'B', seq: 2, ports: '80-443' })];
    const f = analyzeRules(rules, { now: NOW });
    expect(f.filter(x => x.kind === 'redundant' || x.kind === 'conflict')).toEqual([]);
  });
  it('detects shadowing by the union of several earlier rules', () => {
    const rules = [base({ id: 'A', seq: 1, ports: '80-200' }), base({ id: 'B', seq: 2, ports: '201-443' }), base({ id: 'C', seq: 3, ports: '80-443' })];
    const f = analyzeRules(rules, { now: NOW });
    const red = f.find(x => x.kind === 'redundant');
    expect(red?.ruleId).toBe('C');
    expect(red?.relatedRuleIds).toEqual(['A', 'B']);
  });
  it('does not treat an already-shadowed earlier rule as operative coverage (first-match precedence)', () => {
    const rules = [
      base({ id: 'A', seq: 1, action: 'deny', src: 'any', dst: 'any', ports: 'any' }),
      base({ id: 'B', seq: 2, action: 'allow', src: 'any', dst: 'any', ports: 'any' }),
      base({ id: 'C', seq: 3, action: 'allow', ports: '443' }),
    ];
    const f = analyzeRules(rules, { now: NOW });
    const c = f.find(x => x.ruleId === 'C' && (x.kind === 'redundant' || x.kind === 'conflict'));
    expect(c?.kind).toBe('conflict');
    expect(c?.relatedRuleIds).toEqual(['A']);
    expect(f.find(x => x.ruleId === 'B' && x.kind !== 'overbroad' && x.kind !== 'stale')?.kind).toBe('conflict');
  });
  it('classifies full shadowing by mixed-action earlier rules as a conflict with a per-range trace', () => {
    const rules = [base({ id: 'A', seq: 1, action: 'deny', ports: '80-200' }), base({ id: 'B', seq: 2, action: 'allow', ports: '201-443' }), base({ id: 'C', seq: 3, action: 'allow', ports: '80-443' })];
    const f = analyzeRules(rules, { now: NOW });
    const c = f.find(x => x.ruleId === 'C' && (x.kind === 'redundant' || x.kind === 'conflict'));
    expect(c?.kind).toBe('conflict');
    expect(c?.relatedRuleIds).toEqual(['A', 'B']);
    expect(c?.detail).toMatch(/80–200.*denied by A/);
    expect(c?.detail).toMatch(/201–443.*allowed by B/);
    expect(c?.detail).toMatch(/mixed/i);
  });
  it('ignores disabled rules when computing shadows', () => {
    const rules = [base({ id: 'A', seq: 1, ports: 'any', enabled: false }), base({ id: 'B', seq: 2 })];
    expect(analyzeRules(rules, { now: NOW }).filter(x => x.kind === 'redundant')).toEqual([]);
  });
});

describe('hygiene findings', () => {
  it('flags any/any allows as overbroad and plain /8-to-host 443 as fine', () => {
    const f = analyzeRules([base({ id: 'A', src: 'any', dst: 'any', ports: 'any', proto: 'any' }), base({ id: 'B', seq: 2 })], { now: NOW });
    expect(f.filter(x => x.kind === 'overbroad').map(x => x.ruleId)).toEqual(['A']);
  });
  it('flags expired rules and rules with no hits in 90 days', () => {
    const f = analyzeRules([
      base({ id: 'E', seq: 1, expires: '2026-06-30' }),
      base({ id: 'S', seq: 2, lastHit: '2026-05-01' }),
      base({ id: 'N', seq: 3, lastHit: '' }),
      base({ id: 'OK', seq: 4 }),
    ], { now: NOW, staleDays: 90 });
    expect(f.filter(x => x.kind === 'expired').map(x => x.ruleId)).toEqual(['E']);
    expect(f.filter(x => x.kind === 'stale').map(x => x.ruleId).sort()).toEqual(['N', 'S']);
  });
  it('flags VPN-zone allows reaching management ports on broad destinations', () => {
    const f = analyzeRules([
      base({ id: 'V1', seq: 1, zoneFrom: 'vpn', src: '10.200.0.0/16', dst: 'any', ports: '3389' }),
      base({ id: 'V2', seq: 2, zoneFrom: 'vpn', src: '10.200.0.0/16', dst: '10.0.5.10/32', ports: '3389' }),
    ], { now: NOW });
    expect(f.filter(x => x.kind === 'vpn-management').map(x => x.ruleId)).toEqual(['V1']);
  });
  it('reports a missing explicit final deny', () => {
    const f1 = analyzeRules([base({ id: 'A' })], { now: NOW });
    expect(f1.some(x => x.kind === 'no-final-deny')).toBe(true);
    const f2 = analyzeRules([base({ id: 'A' }), base({ id: 'Z', seq: 2, action: 'deny', src: 'any', dst: 'any', proto: 'any', ports: 'any', zoneFrom: 'any', zoneTo: 'any' })], { now: NOW });
    expect(f2.some(x => x.kind === 'no-final-deny')).toBe(false);
    const f3 = analyzeRules([base({ id: 'A' }), base({ id: 'Z', seq: 2, action: 'deny', src: 'any', dst: 'any', proto: 'any', ports: 'any', zoneFrom: 'corp', zoneTo: 'dmz' })], { now: NOW });
    expect(f3.some(x => x.kind === 'no-final-deny'), 'zone-scoped deny is not a global final deny').toBe(true);
  });
});

describe('CSV import', () => {
  it('parses the shipped fixture and bounds rule count', () => {
    const r = parseRuleCsv(SAMPLE_RULES_CSV);
    expect(r.errors).toEqual([]);
    expect(r.rules.length).toBe(41);
    const big = ['seq,id,action,src,dst,proto,ports,zoneFrom,zoneTo,enabled,owner,expires,lastHit,comment', ...Array.from({ length: 501 }, (_, i) => `${i},r${i},allow,any,any,tcp,80,a,b,true,o,,,`)].join('\n');
    expect(parseRuleCsv(big).errors.map(e => e.reason).join(' ')).toMatch(/500/);
  });
  it('reports invalid CIDR, port and action values with line numbers', () => {
    const txt = 'seq,id,action,src,dst,proto,ports,zoneFrom,zoneTo,enabled,owner,expires,lastHit,comment\n1,a,allow,999.1.1.1,any,tcp,80,x,y,true,o,,,\n2,b,permit,any,any,tcp,80,x,y,true,o,,,\n3,c,allow,any,any,tcp,99999,x,y,true,o,,,';
    const r = parseRuleCsv(txt);
    expect(r.rules).toEqual([]);
    expect(r.errors.map(e => e.line)).toEqual([2, 3, 4]);
  });
  it('rejects calendar-invalid dates such as 2026-02-30 and 2026-99-99', () => {
    const txt = 'seq,id,action,src,dst,proto,ports,zoneFrom,zoneTo,enabled,owner,expires,lastHit,comment\n1,a,allow,any,any,tcp,80,x,y,true,o,2026-02-30,,\n2,b,allow,any,any,tcp,80,x,y,true,o,,2026-99-99,\n3,c,allow,any,any,tcp,80,x,y,true,o,2026-02-28,2024-02-29,';
    const r = parseRuleCsv(txt);
    expect(r.rules.map(x => x.id)).toEqual(['c']);
    expect(r.errors.map(e => e.line)).toEqual([2, 3]);
    expect(r.errors[0].reason).toMatch(/expires/);
    expect(r.errors[1].reason).toMatch(/lastHit/);
  });
  it('golden counts for the shipped 41-rule fixture: the 17 original findings are unchanged and the new kind is counted separately', () => {
    const f = analyzeRules(parseRuleCsv(SAMPLE_RULES_CSV).rules, { now: NOW });
    const original = f.filter(x => x.kind !== 'partially-shadowed');
    const kinds = new Set(original.map(x => x.kind));
    for (const k of ['redundant', 'conflict', 'overbroad', 'expired', 'stale', 'vpn-management', 'no-final-deny'] as const) expect(kinds.has(k), k).toBe(true);
    expect(original.length).toBe(17);
    expect((['critical', 'high', 'medium', 'low'] as const).map(s => original.filter(x => x.severity === s).length)).toEqual([1, 4, 3, 9]);
    expect(original.filter(x => x.kind === 'redundant').map(x => x.ruleId).sort()).toEqual(['CORP-TELNET-LEGACY', 'FIN-ERP-DUP', 'ICMP-MON', 'PARTNER-SFTP', 'PARTNER-SFTP-OLD']);
    expect(original.filter(x => x.kind === 'conflict').map(x => x.ruleId).sort()).toEqual(['DENY-DMZ-TO-CORP', 'DENY-TELNET', 'DMZ-DB-LEGACY']);
    const partial = f.filter(x => x.kind === 'partially-shadowed');
    expect(partial.map(x => x.ruleId)).toEqual(['FIN-ERP-WIDE']);
    expect(partial[0]).toMatchObject({ severity: 'info', relatedRuleIds: ['FIN-ERP'], id: 'partially-shadowed:FIN-ERP-WIDE' });
    expect(partial[0].detail).toMatch(/50%/);
    expect(partial[0].detail).toMatch(/FIN-ERP/);
    expect(partial[0].detail).not.toMatch(/approximate/i);
    expect(f.length).toBe(18);
    expect(f[f.length - 1].kind, 'info sorts last').toBe('partially-shadowed');
    // The two safe fixture proposals (HR-PAYROLL disable, VPN-RDP-ALL narrowing to a supplied jump host) still remove
    // exactly two findings; the info finding is manual-review and stays.
    const rules = parseRuleCsv(SAMPLE_RULES_CSV).rules;
    const safe = f.filter(x => (x.kind === 'expired' && x.ruleId === 'HR-PAYROLL') || (x.kind === 'vpn-management' && x.ruleId === 'VPN-RDP-ALL'))
      .map(x => ({ ...proposeChange(rules, x, { now: NOW, jumpHost: '10.0.5.10/32' }), approved: true }));
    expect(safe.map(p => p.op).sort()).toEqual(['disable', 'narrow']);
    const afterFindings = analyzeRules(applyProposals(rules, safe), { now: NOW });
    expect(afterFindings).toHaveLength(16);
    expect(afterFindings.filter(x => x.kind !== 'partially-shadowed')).toHaveLength(15);
  });
});

describe('change proposals and diff', () => {
  it('proposes disable for expired rules, narrows VPN exposure only to a supplied jump host, and diffs before/after', () => {
    const rules = [base({ id: 'E', seq: 1, expires: '2026-06-30' }), base({ id: 'V', seq: 2, zoneFrom: 'vpn', src: '10.200.0.0/16', dst: 'any', ports: '3389' })];
    const findings = analyzeRules(rules, { now: NOW });
    const props = findings.filter(f => f.kind === 'expired' || f.kind === 'vpn-management').map(f => proposeChange(rules, f, { now: NOW, jumpHost: '10.0.5.10/32' }));
    expect(props.find(p => p.ruleId === 'E')?.op).toBe('disable');
    const v = props.find(p => p.ruleId === 'V');
    expect(v?.op).toBe('narrow');
    expect(v?.after?.dst).toBe('10.0.5.10/32');
    const after = applyProposals(rules, props.map(p => ({ ...p, approved: true })));
    expect(after.find(r => r.id === 'E')?.enabled).toBe(false);
    const d = diffRuleSets(rules, after);
    expect(d.map(c => c.ruleId).sort()).toEqual(['E', 'V']);
    expect(d.find(c => c.ruleId === 'E')?.fields).toContain('enabled');
    expect(applyProposals(rules, props.map(p => ({ ...p, approved: false })))).toEqual(rules);
    expect(analyzeRules(after, { now: NOW }).filter(f => f.ruleId === 'V' && f.kind === 'vpn-management')).toEqual([]);
  });
  it('requires manual review for VPN narrowing when no jump host is supplied, and for overbroad allows (no automatic address scoping)', () => {
    const rules = [base({ id: 'T', seq: 1, src: 'any', dst: 'any', proto: 'any', ports: 'any' }), base({ id: 'V', seq: 2, zoneFrom: 'vpn', src: '10.200.0.0/16', dst: 'any', ports: '3389' })];
    const findings = analyzeRules(rules, { now: NOW });
    const t = proposeChange(rules, findings.find(f => f.kind === 'overbroad')!, { now: NOW });
    expect(t.op).toBe('review');
    expect(t.manualReview).toBe(true);
    expect(t.after).toBeNull();
    expect(t.rationale).toMatch(/source|destination/i);
    const v = proposeChange(rules, findings.find(f => f.kind === 'vpn-management')!, { now: NOW });
    expect(v.op).toBe('review');
    expect(v.manualReview).toBe(true);
    const bad = proposeChange(rules, findings.find(f => f.kind === 'vpn-management')!, { now: NOW, jumpHost: 'not-a-cidr' });
    expect(bad.op).toBe('review');
  });
  it('only narrows VPN exposure when the supplied jump host is a strict subset of the original destination', () => {
    const rules = [base({ id: 'V', seq: 1, zoneFrom: 'vpn', src: '10.200.0.0/16', dst: '10.0.0.0/8', ports: '3389' })];
    const f = analyzeRules(rules, { now: NOW }).find(x => x.kind === 'vpn-management')!;
    const broader = proposeChange(rules, f, { now: NOW, jumpHost: '0.0.0.0/0' });
    expect(broader.op).toBe('review');
    expect(broader.manualReview).toBe(true);
    expect(broader.rationale).toMatch(/not a strict subset|broader|outside/i);
    expect(proposeChange(rules, f, { now: NOW, jumpHost: '10.0.0.0/8' }).op).toBe('review');       // identical
    expect(proposeChange(rules, f, { now: NOW, jumpHost: '192.168.5.10/32' }).op).toBe('review');  // outside
    expect(proposeChange(rules, f, { now: NOW, jumpHost: '10.0.0.0/7' }).op).toBe('review');       // broader superset
    const ok = proposeChange(rules, f, { now: NOW, jumpHost: '10.0.5.10/32' });
    expect(ok.op).toBe('narrow');
    expect(ok.after?.dst).toBe('10.0.5.10/32');
    const anyRule = [base({ id: 'W', seq: 1, zoneFrom: 'vpn', src: '10.200.0.0/16', dst: 'any', ports: '22' })];
    const fw = analyzeRules(anyRule, { now: NOW }).find(x => x.kind === 'vpn-management')!;
    expect(proposeChange(anyRule, fw, { now: NOW, jumpHost: '0.0.0.0/0' }).op).toBe('review');     // equivalent to any
    expect(proposeChange(anyRule, fw, { now: NOW, jumpHost: '10.0.5.0/24' }).op).toBe('narrow');
  });
  it('derives the stale-rule expiry from the review date instead of a hard-coded day', () => {
    const rules = [base({ id: 'S', seq: 1, lastHit: '2025-01-01' })];
    const f = analyzeRules(rules, { now: '2026-03-01' }).find(x => x.kind === 'stale')!;
    expect(proposeChange(rules, f, { now: '2026-03-01' }).after?.expires).toBe('2026-03-31');
    expect(proposeChange(rules, f, { now: '2026-12-15' }).after?.expires).toBe('2027-01-14');
  });
});

describe('explanations and export', () => {
  it('translates a rule into plain language with address counts', () => {
    const s = explainRule(base({ id: 'A' }));
    expect(s).toMatch(/Allow TCP/);
    expect(s).toMatch(/16,777,216 addresses/);
    expect(s).toMatch(/port 443/);
  });
  it('neutralises CSV formula injection and quotes fields', () => {
    const csv = toCsv([{ a: '=SUM(1)', b: 'plain, comma', c: '+1' }]);
    expect(csv.split('\n')[1]).toBe("\"'=SUM(1)\",\"plain, comma\",\"'+1\"");
    const tricky = toCsv([{ a: '  =1+1', b: '\t+5', c: '\u0001-3', d: '\r\n@cmd', e: ' safe text' }]);
    expect(tricky.split('\n').slice(1).join('\n')).toBe("\"'  =1+1\",\"'\t+5\",\"'\u0001-3\",\"'\r\n@cmd\",\" safe text\"");
  });
  it('builds a stable report schema', () => {
    const rules = parseRuleCsv(SAMPLE_RULES_CSV).rules;
    const rep = buildReport({ rules, findings: analyzeRules(rules, { now: NOW }), proposals: [], generatedAt: '2026-10-01T00:00:00Z', now: NOW });
    expect(rep.summary.manualReview).toBe(0);
    expect(rep.schema).toBe('ruleshadow.report/1');
    expect(rep.summary.rules).toBe(41);
    expect(rep.dataNotice).toMatch(/synthetic/i);
  });
  it('report and findings CSV carry per-rule coverage (additive fields)', () => {
    const rules = parseRuleCsv(SAMPLE_RULES_CSV).rules;
    const findings = analyzeRules(rules, { now: NOW });
    const rep = buildReport({ rules, findings, proposals: [], generatedAt: '2026-10-01T00:00:00Z', now: NOW });
    expect(rep.schema).toBe('ruleshadow.report/1');
    expect(rep.coverage).toHaveLength(41);
    expect(rep.coverage.map(c => c.ruleId)).toEqual(rules.map(r => r.id));
    expect(rep.coverage.find(c => c.ruleId === 'FIN-ERP-WIDE')).toEqual({ ruleId: 'FIN-ERP-WIDE', enabled: true, fraction: 0.5, percent: '50%', coveringRuleIds: ['FIN-ERP'], approximate: false });
    expect(rep.coverage.find(c => c.ruleId === 'PARTNER-SFTP-OLD')).toMatchObject({ fraction: 1, percent: '100%', coveringRuleIds: ['TEMP-ANY'] });
    expect(rep.coverage.find(c => c.ruleId === 'CORP-DNS')).toMatchObject({ fraction: 0, percent: '0%', coveringRuleIds: [] });
    expect(rep.coverage.find(c => c.ruleId === 'DISABLED-OLD')).toEqual({ ruleId: 'DISABLED-OLD', enabled: false, fraction: null, percent: '', coveringRuleIds: [], approximate: false });
    expect(rep.summary.byKind['partially-shadowed']).toBe(1);
    expect(() => JSON.stringify(rep)).not.toThrow();
    const rows = findingRows(findings, [], {}, analyzeCoverage(rules));
    const csv = toCsv(rows);
    expect(csv.split('\n')[0]).toBe('"severity","kind","ruleId","relatedRuleIds","title","detail","proposal","approved","coverage"');
    expect(rows.find(r => r.ruleId === 'FIN-ERP-WIDE')?.coverage).toBe('50%');
    expect(rows.find(r => r.ruleId === 'PARTNER-SFTP-OLD')?.coverage).toBe('100%');
    expect(rows.find(r => r.kind === 'no-final-deny')?.coverage).toBe('');
  });
});

describe('partial-shadow coverage findings', () => {
  it('raises partially-shadowed (info) when two half-space earlier rules cover a later rule that neither contains', () => {
    const rules = [base({ id: 'A', seq: 1, src: '10.0.0.0/9' }), base({ id: 'B', seq: 2, src: '10.128.0.0/9' }), base({ id: 'R', seq: 3 })];
    const f = analyzeRules(rules, { now: NOW });
    expect(f.filter(x => x.ruleId === 'R' && (x.kind === 'redundant' || x.kind === 'conflict'))).toEqual([]);
    const p = f.find(x => x.kind === 'partially-shadowed')!;
    expect(p).toMatchObject({ id: 'partially-shadowed:R', ruleId: 'R', severity: 'info', relatedRuleIds: ['A', 'B'] });
    expect(p.detail).toMatch(/100%/);
    expect(p.detail).toMatch(/A.*B/);
    expect(p.detail).not.toMatch(/approximate/i);
    expect(KIND_META['partially-shadowed']).toMatchObject({ label: 'Partially shadowed', severity: 'info' });
    expect(KIND_META['partially-shadowed'].explain.length).toBeGreaterThan(20);
  });
  it('reports coverage below the threshold without a finding, and honours a custom threshold', () => {
    const rules = [base({ id: 'A', seq: 1, src: '10.0.0.0/10' }), base({ id: 'R', seq: 2 })];
    expect(analyzeRules(rules, { now: NOW }).filter(x => x.kind === 'partially-shadowed')).toEqual([]);
    expect(analyzeCoverage(rules).R).toEqual({ fraction: 0.25, coveringRuleIds: ['A'], approximate: false });
    expect(analyzeCoverage(rules).A).toEqual({ fraction: 0, coveringRuleIds: [], approximate: false });
    const low = analyzeRules(rules, { now: NOW, partialShadowThreshold: 0.25 }).find(x => x.kind === 'partially-shadowed')!;
    expect(low.ruleId).toBe('R');
    expect(low.detail).toMatch(/25%/);
    const threeQuarters = [base({ id: 'A', seq: 1, src: '10.0.0.0/9' }), base({ id: 'B', seq: 2, src: '10.128.0.0/10' }), base({ id: 'R', seq: 3 })];
    const p = analyzeRules(threeQuarters, { now: NOW }).find(x => x.kind === 'partially-shadowed')!;
    expect(p.relatedRuleIds).toEqual(['A', 'B']);
    expect(p.detail).toMatch(/75%/);
  });
  it('does not duplicate redundant/conflict findings and ignores zone-mismatched earlier rules', () => {
    const contained = [base({ id: 'A', seq: 1, ports: 'any' }), base({ id: 'B', seq: 2 })];
    const f = analyzeRules(contained, { now: NOW });
    expect(f.find(x => x.ruleId === 'B' && x.kind === 'redundant')).toBeTruthy();
    expect(f.filter(x => x.kind === 'partially-shadowed')).toEqual([]);
    expect(analyzeCoverage(contained).B.fraction).toBe(1);
    const zoned = [base({ id: 'A', seq: 1, src: '10.0.0.0/9', zoneFrom: 'guest' }), base({ id: 'B', seq: 2, src: '10.128.0.0/9', zoneFrom: 'guest' }), base({ id: 'R', seq: 3 })];
    expect(analyzeRules(zoned, { now: NOW }).filter(x => x.kind === 'partially-shadowed')).toEqual([]);
    expect(analyzeCoverage(zoned).R.fraction).toBe(0);
  });
  it('detects per-protocol assembly (tcp + udp + icmp earlier rules covering a later proto-any rule)', () => {
    const rules = [base({ id: 'T', seq: 1, proto: 'tcp' }), base({ id: 'U', seq: 2, proto: 'udp' }), base({ id: 'C', seq: 3, proto: 'icmp', ports: 'any' }), base({ id: 'X', seq: 4, proto: 'any' })];
    const f = analyzeRules(rules, { now: NOW });
    expect(f.filter(x => x.ruleId === 'X' && (x.kind === 'redundant' || x.kind === 'conflict'))).toEqual([]);
    expect(f.find(x => x.kind === 'partially-shadowed')).toMatchObject({ ruleId: 'X', relatedRuleIds: ['T', 'U', 'C'] });
  });
  it('flags the approximation on a hostile 300-rule slab set and stays exact on the fixture', () => {
    const slab = (id: string, seq: number, over: Partial<Rule>) => base({ id, seq, src: 'any', dst: 'any', ports: 'any', zoneFrom: 'any', zoneTo: 'any', ...over });
    const rules = [
      ...Array.from({ length: 100 }, (_, i) => slab(`S${i}`, i + 1, { src: `${2 * i + 1}.0.0.0/8` })),
      ...Array.from({ length: 100 }, (_, i) => slab(`D${i}`, 101 + i, { dst: `${2 * i + 1}.0.0.0/8` })),
      ...Array.from({ length: 100 }, (_, i) => slab(`P${i}`, 201 + i, { ports: `${200 * i + 100}-${200 * i + 199}` })),
      base({ id: 'T', seq: 1000, src: 'any', dst: 'any', ports: 'any' }),
    ];
    const started = Date.now();
    const cov = analyzeCoverage(rules);
    expect(Date.now() - started, 'hostile 301-rule coverage pass completes quickly').toBeLessThan(10_000);
    expect(Object.keys(cov)).toHaveLength(301);
    expect(cov.T.approximate).toBe(true);
    expect(cov.T.fraction).toBeGreaterThan(0.3);
    expect(cov.T.fraction).toBeLessThan(1);
    expect(cov.S0, 'first slab has nothing earlier').toEqual({ fraction: 0, coveringRuleIds: [], approximate: false });
    const f = analyzeRules(rules, { now: NOW, partialShadowThreshold: 0.25, coverage: cov });
    const p = f.find(x => x.kind === 'partially-shadowed' && x.ruleId === 'T')!;
    expect(p.detail).toMatch(/approximate/i);
    expect(p.detail).toMatch(/\d+%/);
    const fixture = parseRuleCsv(SAMPLE_RULES_CSV).rules;
    expect(Object.values(analyzeCoverage(fixture)).every(c => !c.approximate)).toBe(true);
  }, 20_000);
  it('proposes manual review (no automatic change) for partially shadowed rules', () => {
    const rules = [base({ id: 'A', seq: 1, src: '10.0.0.0/9' }), base({ id: 'B', seq: 2, src: '10.128.0.0/9' }), base({ id: 'R', seq: 3 })];
    const f = analyzeRules(rules, { now: NOW }).find(x => x.kind === 'partially-shadowed')!;
    const p = proposeChange(rules, f, { now: NOW });
    expect(p).toMatchObject({ op: 'review', manualReview: true, after: null, ruleId: 'R', findingId: 'partially-shadowed:R' });
    expect(p.rationale).toMatch(/A, B/);
    expect(applyProposals(rules, [{ ...p, approved: true }])).toEqual(rules);
  });
});
