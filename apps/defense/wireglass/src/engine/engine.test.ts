import { describe, it, expect } from 'vitest';
import { parseLogs, shannonEntropy, isInternal } from './parse';
import { runRules, DEFAULT_RULE_CONFIG, correlateAlerts } from './rules';
import { createTriage, transitionAlert } from './triage';
import { buildReport } from './report';
import { generateScenario } from './scenario';
import { recordTuning } from './diff';

const DNS = '2026-09-14T08:00:01Z DNS 10.0.4.21 query A www.intranet.example NOERROR';
const HTTP = '2026-09-14T08:00:02Z HTTP 10.0.4.21 203.0.113.10 GET /index.html 200 512 "Mozilla/5.0 (X11)"';
const SMTP = '2026-09-14T08:00:03Z SMTP 10.0.4.21 mail.corp.example from=<ana@corp.example> to=<bo@partner.example> status=sent';

describe('parseLogs', () => {
  it('normalises DNS, HTTP and SMTP lines into typed events', () => {
    const r = parseLogs([DNS, HTTP, SMTP].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.events).toHaveLength(3);
    expect(r.events[0]).toMatchObject({ proto: 'dns', src: '10.0.4.21', fields: { qtype: 'A', qname: 'www.intranet.example', rcode: 'NOERROR' } });
    expect(r.events[1]).toMatchObject({ proto: 'http', dst: '203.0.113.10', fields: { method: 'GET', path: '/index.html', status: 200, bytes: 512, ua: 'Mozilla/5.0 (X11)' } });
    expect(r.events[2]).toMatchObject({ proto: 'smtp', fields: { from: 'ana@corp.example', to: 'bo@partner.example', status: 'sent' } });
    expect(r.events[0].ts).toBe(Date.parse('2026-09-14T08:00:01Z'));
  });
  it('reports malformed lines with their line number and keeps going', () => {
    const r = parseLogs([DNS, 'garbage line here', HTTP, '2026-09-14T08:00:02Z HTTP 10.0.4.21 203.0.113.10 GET /x notanumber 1 "ua"'].join('\n'));
    expect(r.events).toHaveLength(2);
    expect(r.errors.map(e => e.line)).toEqual([2, 4]);
    expect(r.errors[0].reason).toMatch(/unrecognised/i);
  });
  it('bounds input by lines and bytes and flags truncation', () => {
    const many = Array.from({ length: 50 }, () => DNS).join('\n');
    const r = parseLogs(many, { maxLines: 10 });
    expect(r.events).toHaveLength(10);
    expect(r.truncated).toBe(true);
    const r2 = parseLogs(many, { maxBytes: 100 });
    expect(r2.truncated).toBe(true);
    expect(r2.events.length).toBeLessThan(3);
  });
  it('rejects HTTP byte counts above the 13-digit bound instead of parsing them as huge numbers', () => {
    const r = parseLogs('2026-09-14T08:00:02Z HTTP 10.0.4.21 203.0.113.10 POST /u 200 99999999999999999999999 "curl/8.0"');
    expect(r.events).toHaveLength(0);
    expect(r.errors[0].reason).toMatch(/bytes/i);
    expect(parseLogs('2026-09-14T08:00:02Z HTTP 10.0.4.21 203.0.113.10 POST /u 200 1000000000000 "curl/8.0"').events).toHaveLength(1);
  });
  it('rejects a timestamp that cannot be parsed', () => {
    const r = parseLogs('not-a-date DNS 10.0.4.21 query A a.example NOERROR');
    expect(r.events).toHaveLength(0);
    expect(r.errors[0].reason).toMatch(/timestamp/i);
  });
});

describe('helpers', () => {
  it('computes Shannon entropy in bits per symbol', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 6);
    expect(shannonEntropy('')).toBe(0);
  });
  it('classifies RFC1918 addresses as internal and TEST-NET as external', () => {
    expect(isInternal('10.0.4.21')).toBe(true);
    expect(isInternal('192.168.1.9')).toBe(true);
    expect(isInternal('172.16.0.1')).toBe(true);
    expect(isInternal('172.32.0.1')).toBe(false);
    expect(isInternal('203.0.113.10')).toBe(false);
  });
});

function dns(ts: string, src: string, qname: string, rcode = 'NOERROR') {
  return `${ts} DNS ${src} query A ${qname} ${rcode}`;
}
function http(ts: string, src: string, dst: string, method: string, path: string, status: number, bytes: number, ua = 'Mozilla/5.0') {
  return `${ts} HTTP ${src} ${dst} ${method} ${path} ${status} ${bytes} "${ua}"`;
}
function smtp(ts: string, src: string, from: string, to: string) {
  return `${ts} SMTP ${src} mail.corp.example from=<${from}> to=<${to}> status=sent`;
}
const t = (sec: number) => new Date(Date.UTC(2026, 8, 14, 8, 0, sec)).toISOString().replace('.000Z', 'Z');

describe('rules', () => {
  it('DNS-001 flags a long high-entropy label and not an allowlisted CDN suffix (false-positive fixture)', () => {
    const bad = dns(t(0), '10.0.4.21', 'q3x9v2k8m1p7z4w6r0t5y8u2i9o3a1s7.tunnel.example');
    const cdn = dns(t(1), '10.0.4.22', 'f3a9c1e7b2d8a4c6e0f1b3d5a7c9e2f4.assets.cdn.example');
    const alerts = runRules(parseLogs([bad, cdn].join('\n')).events, DEFAULT_RULE_CONFIG);
    const dns1 = alerts.filter(a => a.ruleId === 'DNS-001');
    expect(dns1).toHaveLength(1);
    expect(dns1[0].src).toBe('10.0.4.21');
    expect(dns1[0].evidence.join(' ')).toMatch(/entropy/i);
  });
  it('DNS-002 flags an NXDOMAIN burst within the window and ignores sparse typos', () => {
    const burst = Array.from({ length: 8 }, (_, i) => dns(t(i * 5), '10.0.4.30', `h${i}.example`, 'NXDOMAIN'));
    const sparse = Array.from({ length: 8 }, (_, i) => dns(t(i * 120), '10.0.4.31', `typo${i}.example`, 'NXDOMAIN'));
    const alerts = runRules(parseLogs([...burst, ...sparse].join('\n')).events, DEFAULT_RULE_CONFIG);
    const hits = alerts.filter(a => a.ruleId === 'DNS-002');
    expect(hits.map(h => h.src)).toEqual(['10.0.4.30']);
    expect(hits[0].eventIds).toHaveLength(8);
  });
  it('HTTP-001 flags an auth-failure burst to one destination but not three failures', () => {
    const burst = Array.from({ length: 10 }, (_, i) => http(t(i * 3), '10.0.4.40', '10.0.9.5', 'POST', '/login', 401, 120));
    const few = Array.from({ length: 3 }, (_, i) => http(t(i * 3), '10.0.4.41', '10.0.9.5', 'POST', '/login', 401, 120));
    const alerts = runRules(parseLogs([...burst, ...few].join('\n')).events, DEFAULT_RULE_CONFIG);
    expect(alerts.filter(a => a.ruleId === 'HTTP-001').map(a => a.src)).toEqual(['10.0.4.40']);
  });
  it('HTTP-002 flags a large scripted upload to an external host, not an internal backup', () => {
    const ext = http(t(0), '10.0.4.50', '198.51.100.7', 'POST', '/upload', 200, 9_000_000, 'python-requests/2.31');
    const int = http(t(1), '10.0.4.51', '10.0.20.8', 'POST', '/backup', 200, 9_000_000, 'python-requests/2.31');
    const alerts = runRules(parseLogs([ext, int].join('\n')).events, DEFAULT_RULE_CONFIG);
    expect(alerts.filter(a => a.ruleId === 'HTTP-002').map(a => a.src)).toEqual(['10.0.4.50']);
  });
  it('SMTP-001 flags a host mailing many external domains unless it is an allowlisted relay', () => {
    const rogue = Array.from({ length: 12 }, (_, i) => smtp(t(i * 10), '10.0.4.60', 'ops@corp.example', `p${i}@dom${i}.example`));
    const relay = Array.from({ length: 12 }, (_, i) => smtp(t(i * 10), '10.0.9.25', 'news@corp.example', `p${i}@dom${i}.example`));
    const cfg = { ...DEFAULT_RULE_CONFIG, smtpRelayAllowlist: ['10.0.9.25'] };
    const alerts = runRules(parseLogs([...rogue, ...relay].join('\n')).events, cfg);
    expect(alerts.filter(a => a.ruleId === 'SMTP-001').map(a => a.src)).toEqual(['10.0.4.60']);
  });
  it('produces deterministic alert ids for the same input', () => {
    const lines = Array.from({ length: 8 }, (_, i) => dns(t(i), '10.0.4.30', `h${i}.example`, 'NXDOMAIN')).join('\n');
    const a = runRules(parseLogs(lines).events, DEFAULT_RULE_CONFIG);
    const b = runRules(parseLogs(lines).events, DEFAULT_RULE_CONFIG);
    expect(a.map(x => x.id)).toEqual(b.map(x => x.id));
  });
  it('correlates alerts from two protocols on one source into a chain within 30 minutes', () => {
    const lines = [
      ...Array.from({ length: 8 }, (_, i) => dns(t(i), '10.0.4.70', `h${i}.example`, 'NXDOMAIN')),
      http(t(600), '10.0.4.70', '198.51.100.7', 'POST', '/u', 200, 9_000_000, 'curl/8.0'),
      http(t(601), '10.0.4.71', '198.51.100.7', 'POST', '/u', 200, 9_000_000, 'curl/8.0'),
    ].join('\n');
    const alerts = runRules(parseLogs(lines).events, DEFAULT_RULE_CONFIG);
    const chains = correlateAlerts(alerts, 30 * 60_000);
    expect(chains).toHaveLength(1);
    expect(chains[0].src).toBe('10.0.4.70');
    expect(chains[0].protocols.sort()).toEqual(['dns', 'http']);
  });
});

describe('triage state machine', () => {
  it('requires a disposition and note to close, and rejects reopening a closed alert to new', () => {
    const tri = createTriage(['a1']);
    expect(transitionAlert(tri, 'a1', { to: 'closed' }).ok).toBe(false);
    const inv = transitionAlert(tri, 'a1', { to: 'investigating' });
    expect(inv.ok).toBe(true);
    const closed = transitionAlert(inv.ok ? inv.state : tri, 'a1', { to: 'closed', disposition: 'false_positive', note: 'CDN hash hostnames' });
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.state.a1.status).toBe('closed');
      expect(closed.state.a1.history).toHaveLength(2);
      const bad = transitionAlert(closed.state, 'a1', { to: 'new' });
      expect(bad.ok).toBe(false);
    }
  });
  it('rejects unknown alert ids', () => {
    expect(transitionAlert(createTriage([]), 'nope', { to: 'investigating' }).ok).toBe(false);
  });
});

describe('scenario generator and report', () => {
  it('generates the same synthetic log for the same seed and includes the three protocols', () => {
    const a = generateScenario('mixed-day', 7);
    const b = generateScenario('mixed-day', 7);
    expect(a).toBe(b);
    const parsed = parseLogs(a);
    expect(parsed.errors).toEqual([]);
    expect(new Set(parsed.events.map(e => e.proto))).toEqual(new Set(['dns', 'http', 'smtp']));
  });
  it('cdn-noise reliably raises DNS-001 on CDN content-hash hostnames for every seed, and the suffix allowlist silences it', () => {
    for (let seed = 0; seed < 25; seed++) {
      const events = parseLogs(generateScenario('cdn-noise', seed)).events;
      const fired = runRules(events, DEFAULT_RULE_CONFIG).filter(a => a.ruleId === 'DNS-001');
      expect(fired.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(fired.every(a => a.explanation.includes('edge.media.example')), `seed ${seed} zone`).toBe(true);
      const tuned = { ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [...DEFAULT_RULE_CONFIG.dnsSuffixAllowlist, '.edge.media.example'] };
      expect(runRules(events, tuned).filter(a => a.ruleId === 'DNS-001'), `seed ${seed} tuned`).toHaveLength(0);
    }
  });
  it('mixed-day CDN hostnames sit under an allowlisted suffix and only alert once that suffix is removed', () => {
    const events = parseLogs(generateScenario('mixed-day', 7)).events;
    const cdnAlerts = (cfg: typeof DEFAULT_RULE_CONFIG) => runRules(events, cfg).filter(a => a.ruleId === 'DNS-001' && a.explanation.includes('assets.cdn.example'));
    expect(cdnAlerts(DEFAULT_RULE_CONFIG)).toHaveLength(0);
    expect(cdnAlerts({ ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [] }).length).toBeGreaterThan(0);
  });
  it('builds a stable report schema with counts derived from alerts', () => {
    const events = parseLogs(generateScenario('mixed-day', 7)).events;
    const alerts = runRules(events, DEFAULT_RULE_CONFIG);
    const report = buildReport({ events, alerts, triage: createTriage(alerts.map(a => a.id)), config: DEFAULT_RULE_CONFIG, generatedAt: '2026-10-01T00:00:00Z' });
    expect(report.schema).toBe('wireglass.report/1');
    expect(report.summary.alerts).toBe(alerts.length);
    expect(report.summary.events).toBe(events.length);
    expect(report.summary.open).toBe(alerts.length);
    expect(report.dataNotice).toMatch(/synthetic/i);
    expect(report.tuning, 'no tuning record unless a change was applied').toBeUndefined();
    expect(Object.keys(report)).not.toContain('tuning');
  });
  it('report gains an additive tuning record only when a config change was applied in the session', () => {
    const events = parseLogs(generateScenario('cdn-noise', 7)).events;
    const tuned = { ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [...DEFAULT_RULE_CONFIG.dnsSuffixAllowlist, '.edge.media.example'] };
    const before = runRules(events, DEFAULT_RULE_CONFIG);
    const after = runRules(events, tuned);
    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual([]);
    const tuning = recordTuning(events, DEFAULT_RULE_CONFIG, tuned);
    const report = buildReport({ events, alerts: after, triage: createTriage([]), config: tuned, generatedAt: '2026-10-04T00:00:00Z', tuning });
    expect(report.schema).toBe('wireglass.report/1');
    expect(report.tuning).toEqual({ from: DEFAULT_RULE_CONFIG, to: tuned, removed: before.map(a => a.id), added: [] });
    expect(report.summary.alerts).toBe(0);
    const roundTrip = JSON.parse(JSON.stringify(report));
    expect(roundTrip.tuning.removed).toHaveLength(before.length);
    expect(roundTrip.tuning.to.dnsSuffixAllowlist).toContain('.edge.media.example');
  });
});
