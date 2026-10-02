import { describe, expect, it } from 'vitest';
import { labRequest, LAB_ROUTES, validateLabRequest, makeMarker } from '../lab';
import { ORACLES, evaluateOracle } from '../oracles';
import { CATALOG } from '../catalog';
import { createNotebook, rateSeverity } from '../notebook';
import { buildReport, reportToMarkdown } from '../report';

describe('lab application', () => {
  it('v1 reflects a search marker unencoded; v3 encodes it', () => {
    const marker = makeMarker('seed-1');
    const v1 = labRequest('v1', { method: 'GET', path: '/search', query: { q: marker } });
    const v3 = labRequest('v3', { method: 'GET', path: '/search', query: { q: marker } });
    expect(v1.body).toContain(marker);
    expect(v3.body).not.toContain(marker);
    expect(v3.body).toContain(marker.replace('<', '&lt;').replace('>', '&gt;'));
  });
  it('v1 returns another user\u2019s receipt; v2 denies it', () => {
    const v1 = labRequest('v1', { method: 'GET', path: '/receipts/r-200', session: 'alice' });
    const v2 = labRequest('v2', { method: 'GET', path: '/receipts/r-200', session: 'alice' });
    expect(v1.status).toBe(200);
    expect(v1.body).toContain('"owner":"bob"');
    expect(v2.status).toBe(403);
    expect(labRequest('v2', { method: 'GET', path: '/receipts/r-100', session: 'alice' }).status).toBe(200);
  });
  it('v1 and v2 set the session cookie without HttpOnly/Secure/SameSite; v3 sets all three', () => {
    const v1 = labRequest('v1', { method: 'POST', path: '/login', body: { user: 'alice' } });
    const v3 = labRequest('v3', { method: 'POST', path: '/login', body: { user: 'alice' } });
    expect(v1.headers['set-cookie']).toMatch(/^sid=/);
    expect(v1.headers['set-cookie']).not.toMatch(/HttpOnly/i);
    expect(v3.headers['set-cookie']).toMatch(/HttpOnly/);
    expect(v3.headers['set-cookie']).toMatch(/Secure/);
    expect(v3.headers['set-cookie']).toMatch(/SameSite=Lax/);
  });
  it('v1 leaks a stack trace on malformed ids; v3 returns a generic 400', () => {
    const v1 = labRequest('v1', { method: 'GET', path: '/receipts/not-a-receipt', session: 'alice' });
    const v3 = labRequest('v3', { method: 'GET', path: '/receipts/not-a-receipt', session: 'alice' });
    expect(v1.status).toBe(500);
    expect(v1.body).toMatch(/at ReceiptRepo\.find \(receipts\.ts:\d+\)/);
    expect(v3.status).toBe(400);
    expect(v3.body).not.toMatch(/receipts\.ts/);
  });
  it('refuses anything that is not a relative lab path and bounds inputs', () => {
    expect(validateLabRequest({ method: 'GET', path: 'https://victim.example/search' }).ok).toBe(false);
    expect(validateLabRequest({ method: 'GET', path: '//victim.example/x' }).ok).toBe(false);
    const r = validateLabRequest({ method: 'GET', path: 'http://localhost:6112/search' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/External target refused/);
    expect(validateLabRequest({ method: 'GET', path: '/search', query: { q: 'x'.repeat(600) } }).ok).toBe(false);
    expect(validateLabRequest({ method: 'GET', path: '/receipts/../etc' }).ok).toBe(false);
    expect(labRequest('v1', { method: 'GET', path: '/nope' }).status).toBe(404);
    expect(LAB_ROUTES.length).toBeGreaterThanOrEqual(4);
  });
  it('generates deterministic, harmless markers', () => {
    expect(makeMarker('a')).toBe(makeMarker('a'));
    expect(makeMarker('a')).not.toBe(makeMarker('b'));
    expect(makeMarker('a')).toMatch(/^<assay-[0-9a-f]{6}>$/);
  });
});

describe('oracles', () => {
  it.each(Object.keys(ORACLES))('%s fires on v1 and is silent on v3', (kind) => {
    const entry = CATALOG.find((c) => c.oracle.kind === kind)!;
    const v1 = labRequest('v1', entry.request);
    const v3 = labRequest('v3', entry.request);
    expect(evaluateOracle(entry.oracle, entry.request, v1).vulnerable).toBe(true);
    expect(evaluateOracle(entry.oracle, entry.request, v3).vulnerable).toBe(false);
  });
});

describe('severity rubric', () => {
  it('combines impact and likelihood deterministically', () => {
    expect(rateSeverity('high', 'high')).toBe('critical');
    expect(rateSeverity('high', 'low')).toBe('medium');
    expect(rateSeverity('medium', 'medium')).toBe('medium');
    expect(rateSeverity('low', 'low')).toBe('low');
    expect(rateSeverity('medium', 'high')).toBe('high');
  });
});

describe('notebook', () => {
  it('hashes each observation with SHA-256 and is deterministic for identical exchanges', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    const req = { method: 'GET' as const, path: '/search', query: { q: makeMarker('s') } };
    const a = await nb.observe('v1', req, 'manual search probe');
    const b = await nb.observe('v1', req, 'again');
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
    expect(nb.state().observations).toHaveLength(2);
  });
  it('deduplicates findings by signature and merges evidence', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    const entry = CATALOG.find((c) => c.oracle.kind === 'cross-user-object')!;
    const o1 = await nb.observe('v1', entry.request, 'first');
    const o2 = await nb.observe('v1', entry.request, 'second');
    const f1 = nb.recordFinding(o1.id, entry.oracle, { impact: 'high', likelihood: 'high' });
    const f2 = nb.recordFinding(o2.id, entry.oracle, { impact: 'high', likelihood: 'high' });
    expect(f1.ok && f2.ok).toBe(true);
    if (f1.ok && f2.ok) {
      expect(f2.finding.id).toBe(f1.finding.id);
      expect(nb.state().findings).toHaveLength(1);
      expect(nb.state().findings[0].evidence).toHaveLength(2);
    }
  });
  it('refuses to record a finding when the oracle did not fire', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    const entry = CATALOG.find((c) => c.oracle.kind === 'reflects-unencoded')!;
    const o = await nb.observe('v3', entry.request, 'fixed build');
    const r = nb.recordFinding(o.id, entry.oracle, { impact: 'medium', likelihood: 'medium' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not fire/);
  });
  it('retest replays the original request: still-open on v1, fixed on v3', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    const entry = CATALOG.find((c) => c.oracle.kind === 'stack-trace-disclosed')!;
    const o = await nb.observe('v1', entry.request, 'error probe');
    const rec = nb.recordFinding(o.id, entry.oracle, { impact: 'low', likelihood: 'high' });
    if (!rec.ok) throw new Error(rec.error);
    const id = rec.finding.id;
    expect(nb.requestRetest(id).ok).toBe(true);
    expect(nb.state().findings[0].status).toBe('retest-requested');
    const still = await nb.retest(id, 'v1');
    expect(still.ok && still.status).toBe('still-open');
    expect(nb.requestRetest(id).ok).toBe(true);
    const fixed = await nb.retest(id, 'v3');
    expect(fixed.ok && fixed.status).toBe('fixed');
    const f = nb.state().findings[0];
    expect(f.history.map((h) => h.to)).toEqual(['open', 'retest-requested', 'still-open', 'retest-requested', 'fixed']);
    expect(f.retests).toHaveLength(2);
    expect(f.retests[1].build).toBe('v3');
  });
  it('enforces transitions: no manual fixed, wont-fix needs a rationale, retest requires a request first', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    const entry = CATALOG.find((c) => c.oracle.kind === 'cookie-missing-flags')!;
    const o = await nb.observe('v1', entry.request, 'login');
    const rec = nb.recordFinding(o.id, entry.oracle, { impact: 'medium', likelihood: 'medium' });
    if (!rec.ok) throw new Error(rec.error);
    const id = rec.finding.id;
    expect(nb.transition(id, 'fixed').ok).toBe(false);
    expect(nb.transition(id, 'wont-fix').ok).toBe(false);
    expect(nb.transition(id, 'wont-fix', 'Legacy client cannot send SameSite; compensating CSRF token in place.').ok).toBe(true);
    const r = await nb.retest(id, 'v3');
    expect(r.ok).toBe(false);
  });
  it('runCatalog records 4 findings on v1, 2 on v2 and 0 on v3', async () => {
    for (const [build, count] of [['v1', 4], ['v2', 2], ['v3', 0]] as const) {
      const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
      const summary = await nb.runCatalog(build);
      expect(summary.recorded).toBe(count);
      expect(nb.state().findings).toHaveLength(count);
      expect(nb.state().observations).toHaveLength(CATALOG.length);
    }
  });
  it('bounds the notebook size', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z', maxObservations: 3 });
    const req = { method: 'GET' as const, path: '/search', query: { q: 'a' } };
    await nb.observe('v1', req, '1'); await nb.observe('v1', req, '2'); await nb.observe('v1', req, '3');
    await expect(nb.observe('v1', req, '4')).rejects.toThrow(/limit/);
  });
});

describe('report', () => {
  it('exports a stable schema with CWE ids, hashes and redacted cookie values', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    await nb.runCatalog('v1');
    const report = buildReport(nb.state(), { generatedAt: '2026-10-01T11:00:00.000Z', scope: 'Ledgerly lab (in-browser simulation)' });
    expect(report.schema).toBe('assaynotebook.report/1');
    expect(report.findings.map((f) => f.cwe).sort()).toEqual(['CWE-1004', 'CWE-209', 'CWE-639', 'CWE-79']);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/sid=[a-z0-9]{8,}/i);
    expect(text).toMatch(/sid=\[redacted\]/);
    const md = reportToMarkdown(report);
    expect(md).toContain('CWE-639');
    expect(md).toContain('not a penetration test');
  });
});

describe('sixth-Fable regression — severity re-ratings are part of the audit trail', () => {
  it('logs a history entry when impact, likelihood or rationale changes, and nothing when unchanged', async () => {
    const nb = createNotebook({ clock: () => '2026-10-01T10:00:00.000Z' });
    const entry = CATALOG.find((c) => c.oracle.kind === 'cross-user-object')!;
    const o = await nb.observe('v1', entry.request, 'x');
    const rec = nb.recordFinding(o.id, entry.oracle, { impact: 'high', likelihood: 'high' });
    if (!rec.ok) throw new Error(rec.error);
    const id = rec.finding.id;
    expect(nb.state().findings[0].history).toHaveLength(1);
    expect(nb.rerate(id, 'high', 'low').ok).toBe(true);
    const h = nb.state().findings[0].history;
    expect(h).toHaveLength(2);
    expect(h[1].note).toMatch(/critical → medium/);
    expect(h[1].from).toBe('open');
    expect(h[1].to).toBe('open');
    nb.rerate(id, 'high', 'low');
    expect(nb.state().findings[0].history).toHaveLength(2);
    nb.rerate(id, 'high', 'low', 'Exploitable only with a valid session.');
    expect(nb.state().findings[0].history).toHaveLength(3);
    expect(nb.state().findings[0].history[2].note).toMatch(/rationale/);
  });
});
