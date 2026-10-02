import { describe, it, expect } from 'vitest';
import { robustStats, robustZ } from './stats';
import { buildBaselines, scoreRecords, DEFAULT_CONFIG, applyFeedback, type ActivityRecord } from './ueba';
import { generateActivity } from './synth';
import { evaluateDetections } from './evaluate';
import { validateRecords } from './validate';
import { buildReport } from './report';

describe('robust statistics', () => {
  it('computes median and MAD', () => {
    expect(robustStats([1, 2, 3, 4, 100])).toEqual({ median: 3, mad: 1, n: 5 });
    expect(robustStats([5, 5, 5, 5])).toEqual({ median: 5, mad: 0, n: 4 });
    expect(robustStats([])).toEqual({ median: 0, mad: 0, n: 0 });
  });
  it('scales z by 0.6745/MAD and applies a MAD floor so constant baselines do not explode', () => {
    expect(robustZ(10, { median: 3, mad: 1, n: 5 }, 0.5)).toBeCloseTo(0.6745 * 7, 4);
    expect(robustZ(6, { median: 5, mad: 0, n: 4 }, 0.5)).toBeCloseTo(0.6745 * 1 / 0.5, 4);
    expect(robustZ(5, { median: 5, mad: 0, n: 4 }, 0.5)).toBe(0);
  });
});

function rec(user: string, day: string, over: Partial<ActivityRecord> = {}): ActivityRecord {
  return { user, dept: 'finance', day, logins: 4, uploadMB: 20, distinctHosts: 3, afterHoursPct: 0.05, ...over };
}
const days = (n: number, start = 1) => Array.from({ length: n }, (_, i) => `2026-09-${String(start + i).padStart(2, '0')}`);

describe('baselines and scoring', () => {
  it('keeps weekday and weekend baselines separate so a habitual weekend worker is not flagged', () => {
    // 2026-09-05 and 09-06 are Saturday/Sunday.
    const train = days(21).map(d => rec('u1', d, { logins: ['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13', '2026-09-19', '2026-09-20'].includes(d) ? 12 : 4 }));
    const base = buildBaselines(train, DEFAULT_CONFIG);
    const weekend = rec('u1', '2026-09-26', { logins: 12 }); // Saturday
    const weekday = rec('u1', '2026-09-28', { logins: 12 }); // Monday
    const out = scoreRecords([weekend, weekday], base, DEFAULT_CONFIG);
    const codes = (d: string) => out.find(a => a.day === d)!.reasons.map(r => r.code);
    expect(codes('2026-09-26')).not.toContain('LOGIN_SPIKE');
    expect(codes('2026-09-28')).toContain('LOGIN_SPIKE');
  });
  it('flags an upload spike with the measured z and baseline in the reason', () => {
    const train = days(21).map(d => rec('u2', d, { uploadMB: 18 + (d.endsWith('3') ? 4 : 0) }));
    const base = buildBaselines(train, DEFAULT_CONFIG);
    const [a] = scoreRecords([rec('u2', '2026-09-28', { uploadMB: 900 })], base, DEFAULT_CONFIG);
    const r = a.reasons.find(x => x.code === 'UPLOAD_SPIKE');
    expect(r).toBeDefined();
    expect(r!.z).toBeGreaterThan(DEFAULT_CONFIG.zThreshold);
    expect(r!.baseline.median).toBe(18);
    expect(a.score).toBeGreaterThanOrEqual(DEFAULT_CONFIG.alertThreshold);
  });
  it('marks a user without history as NO_BASELINE instead of inventing a score', () => {
    const base = buildBaselines(days(21).map(d => rec('u3', d)), DEFAULT_CONFIG);
    const [a] = scoreRecords([rec('newbie', '2026-09-28', { uploadMB: 900 })], base, DEFAULT_CONFIG);
    expect(a.reasons.map(r => r.code)).toContain('NO_BASELINE');
    expect(a.state).toBe('unscored');
  });
  it('reports PEER_DEVIATION when a user is stable for themselves but far from their department', () => {
    const train = [
      ...days(21).map(d => rec('whale', d, { uploadMB: 400 })),
      ...days(21).map(d => rec('p1', d, { uploadMB: 20 })),
      ...days(21).map(d => rec('p2', d, { uploadMB: 22 })),
      ...days(21).map(d => rec('p3', d, { uploadMB: 19 })),
    ];
    const base = buildBaselines(train, DEFAULT_CONFIG);
    const [a] = scoreRecords([rec('whale', '2026-09-28', { uploadMB: 410 })], base, DEFAULT_CONFIG);
    expect(a.reasons.map(r => r.code)).toContain('PEER_DEVIATION');
    expect(a.reasons.map(r => r.code)).not.toContain('UPLOAD_SPIKE');
  });
  it('analyst feedback suppresses a reason code for one user and lowers the score deterministically', () => {
    const train = days(21).map(d => rec('u5', d));
    const base = buildBaselines(train, DEFAULT_CONFIG);
    const rows = [rec('u5', '2026-09-28', { afterHoursPct: 0.9 })];
    const before = scoreRecords(rows, base, DEFAULT_CONFIG)[0];
    expect(before.reasons.map(r => r.code)).toContain('AFTER_HOURS');
    const cfg = applyFeedback(DEFAULT_CONFIG, { user: 'u5', code: 'AFTER_HOURS', rationale: 'on-call rotation' });
    const after = scoreRecords(rows, base, cfg)[0];
    expect(after.reasons.map(r => r.code)).not.toContain('AFTER_HOURS');
    expect(after.score).toBeLessThan(before.score);
    expect(after.suppressed).toEqual([{ code: 'AFTER_HOURS', rationale: 'on-call rotation' }]);
  });
});

describe('synthetic population and evaluation', () => {
  it('is deterministic by seed and labels injected anomalies', () => {
    const a = generateActivity(11);
    const b = generateActivity(11);
    expect(a.records).toEqual(b.records);
    expect(a.injected.length).toBeGreaterThan(3);
    expect(a.records.length).toBe(30 * 28);
  });
  it('computes precision/recall from labeled injections', () => {
    const m = evaluateDetections(
      [{ user: 'a', day: 'd1' }, { user: 'b', day: 'd1' }, { user: 'c', day: 'd2' }],
      [{ user: 'a', day: 'd1' }, { user: 'c', day: 'd2' }, { user: 'z', day: 'd9' }],
    );
    expect(m).toEqual({ tp: 2, fp: 1, fn: 1, precision: 2 / 3, recall: 2 / 3 });
  });
  it('recovers most injected anomalies on the default seed (measured, not asserted as perfect)', () => {
    const { records, injected } = generateActivity(11);
    const base = buildBaselines(records.filter(r => r.day < '2026-09-22'), DEFAULT_CONFIG);
    const scored = scoreRecords(records.filter(r => r.day >= '2026-09-22'), base, DEFAULT_CONFIG);
    const alerts = scored.filter(s => s.state === 'alert').map(s => ({ user: s.user, day: s.day }));
    const m = evaluateDetections(alerts, injected.map(i => ({ user: i.user, day: i.day })));
    expect(m.recall).toBeGreaterThanOrEqual(0.8);
    expect(m.precision).toBeGreaterThanOrEqual(0.5);
  });
});

describe('import validation', () => {
  it('rejects oversized, malformed and negative inputs with field-level messages', () => {
    const tooMany = Array.from({ length: 5001 }, (_, i) => rec('u', `2026-09-${String((i % 28) + 1).padStart(2, '0')}`));
    expect(validateRecords(tooMany).ok).toBe(false);
    const bad = validateRecords([{ ...rec('u', '14/09/2026'), logins: -1 } as unknown]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join(' ')).toMatch(/day/);
      expect(bad.errors.join(' ')).toMatch(/logins/);
    }
    expect(validateRecords('not an array' as unknown).ok).toBe(false);
    expect(validateRecords([rec('u', '2026-09-01')]).ok).toBe(true);
  });
});

describe('report', () => {
  it('emits a stable schema with no raw identities beyond synthetic user labels', () => {
    const { records } = generateActivity(11);
    const base = buildBaselines(records.filter(r => r.day < '2026-09-22'), DEFAULT_CONFIG);
    const scored = scoreRecords(records.filter(r => r.day >= '2026-09-22'), base, DEFAULT_CONFIG);
    const report = buildReport({ scored, config: DEFAULT_CONFIG, dispositions: {}, generatedAt: '2026-10-01T00:00:00Z' });
    expect(report.schema).toBe('peerline.report/1');
    expect(report.summary.alerts).toBe(scored.filter(s => s.state === 'alert').length);
    expect(report.dataNotice).toMatch(/synthetic/i);
  });
});
