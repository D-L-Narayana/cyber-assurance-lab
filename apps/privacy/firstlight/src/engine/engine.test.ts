import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTimeline } from './timeline';
import { evidenceClock } from './clock';
import { severity, summariseScope } from './severity';
import { applyFlip, severitySensitivity } from './sensitivity';
import { readiness } from './readiness';
import { redactText, buildPacket } from './packet';
import { parseBundle, serializeBundle, completeTask } from './bundleIO';
import demo from '../fixtures/misdirected-export.json';
import type { IncidentBundle, IncidentEvent } from './types';

function load(): IncidentBundle {
  const r = parseBundle(JSON.stringify(demo));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.bundle;
}

const ev = (id: string, at: string, kind: IncidentEvent['kind'], summary = id): IncidentEvent => ({ id, at, kind, source: 'test', summary });

describe('buildTimeline', () => {
  it('sorts events chronologically and removes exact duplicates (same id, or same time+kind+summary)', () => {
    const t = buildTimeline([
      ev('b', '2026-09-20T10:00:00Z', 'detected'),
      ev('a', '2026-09-19T08:00:00Z', 'occurred'),
      ev('b', '2026-09-20T10:00:00Z', 'detected'),
      ev('c', '2026-09-20T10:00:00Z', 'detected', 'b'),
    ]);
    expect(t.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(t.duplicatesRemoved).toHaveLength(2);
    expect(t.issues.some((i) => i.code === 'DUPLICATE_EVENT')).toBe(true);
  });

  it('derives occurred, detected, aware and contained timestamps from the first event of each kind', () => {
    const t = buildTimeline([
      ev('1', '2026-09-19T08:00:00Z', 'occurred'),
      ev('2', '2026-09-20T10:00:00Z', 'detected'),
      ev('3', '2026-09-20T11:30:00Z', 'aware'),
      ev('4', '2026-09-20T13:00:00Z', 'contained'),
      ev('5', '2026-09-21T13:00:00Z', 'contained'),
    ]);
    expect(t.occurredAt).toBe('2026-09-19T08:00:00Z');
    expect(t.awareAt).toBe('2026-09-20T11:30:00Z');
    expect(t.containedAt).toBe('2026-09-20T13:00:00Z');
    expect(t.issues).toEqual([]);
  });

  it('flags a missing awareness event as a first-class unknown', () => {
    const t = buildTimeline([ev('1', '2026-09-19T08:00:00Z', 'occurred'), ev('2', '2026-09-20T10:00:00Z', 'detected')]);
    expect(t.awareAt).toBeUndefined();
    expect(t.issues.map((i) => i.code)).toContain('MISSING_AWARENESS');
  });

  it('flags containment or awareness recorded before detection', () => {
    const t = buildTimeline([
      ev('1', '2026-09-19T08:00:00Z', 'occurred'),
      ev('2', '2026-09-20T09:00:00Z', 'contained'),
      ev('3', '2026-09-20T10:00:00Z', 'detected'),
      ev('4', '2026-09-20T08:00:00Z', 'aware'),
    ]);
    const codes = t.issues.map((i) => i.code);
    expect(codes).toContain('CONTAINED_BEFORE_DETECTED');
    expect(codes).toContain('AWARE_BEFORE_DETECTED');
  });

  it('flags a gap of more than 7 days between occurrence and detection', () => {
    const t = buildTimeline([ev('1', '2026-09-01T08:00:00Z', 'occurred'), ev('2', '2026-09-20T10:00:00Z', 'detected'), ev('3', '2026-09-20T10:05:00Z', 'aware')]);
    expect(t.issues.map((i) => i.code)).toContain('LARGE_GAP');
  });

  it('is idempotent and order-independent (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.integer({ min: 0, max: 9 }), hour: fc.integer({ min: 0, max: 200 }), kind: fc.constantFrom<IncidentEvent['kind']>('occurred', 'detected', 'aware', 'contained', 'evidence', 'note') }), { maxLength: 12 }), (rows) => {
        const events = rows.map((r) => ev(`e${r.id}`, new Date(Date.UTC(2026, 8, 1, r.hour)).toISOString(), r.kind, `s${r.id}`));
        const a = buildTimeline(events);
        const b = buildTimeline([...events].reverse());
        const c = buildTimeline(a.events);
        return JSON.stringify(a.events) === JSON.stringify(b.events) && JSON.stringify(c.events) === JSON.stringify(a.events) && c.duplicatesRemoved.length === 0;
      }),
    );
  });
});

describe('evidenceClock', () => {
  it('runs a 72-hour clock from awareness for GDPR jurisdictions', () => {
    const c = evidenceClock('EU-GDPR', '2026-09-20T11:30:00Z', '2026-09-22T11:30:00Z');
    expect(c.rule).toBe('fixed-72h');
    expect(c.deadlineAt).toBe('2026-09-23T11:30:00Z');
    expect(c.elapsedHours).toBe(48);
    expect(c.remainingHours).toBe(24);
    expect(c.phase).toBe('within-window');
  });

  it('reports the window exceeded with the overrun and the reasons-for-delay note', () => {
    const c = evidenceClock('UK-GDPR', '2026-09-20T11:30:00Z', '2026-09-24T11:30:00Z');
    expect(c.phase).toBe('window-exceeded');
    expect(c.remainingHours).toBe(-24);
    expect(c.note).toMatch(/reasons for the delay/i);
  });

  it('cannot start without an awareness time', () => {
    const c = evidenceClock('EU-GDPR', undefined, '2026-09-22T11:30:00Z');
    expect(c.phase).toBe('clock-not-started');
    expect(c.deadlineAt).toBeUndefined();
  });

  it('runs a 30-calendar-day clock from discovery for California (Civ. Code 1798.82 as amended by SB 446, eff. 2026-01-01)', () => {
    const c = evidenceClock('US-CA', '2026-09-20T11:30:00Z', '2026-09-22T11:30:00Z');
    expect(c.rule).toBe('fixed-30d');
    expect(c.deadlineAt).toBe('2026-10-20T11:30:00Z');
    expect(c.phase).toBe('within-window');
    expect(c.remainingHours).toBe(672);
    expect(c.note).toMatch(/30 calendar days/);
    const late = evidenceClock('US-CA', '2026-09-20T11:30:00Z', '2026-10-21T11:30:00Z');
    expect(late.phase).toBe('window-exceeded');
  });

  it('decides the phase on the unrounded timestamp, so one minute past the deadline is exceeded', () => {
    const c = evidenceClock('EU-GDPR', '2026-09-20T11:30:00Z', '2026-09-23T11:31:00Z');
    expect(c.phase).toBe('window-exceeded');
    const edge = evidenceClock('EU-GDPR', '2026-09-20T11:30:00Z', '2026-09-23T11:30:00Z');
    expect(edge.phase).toBe('within-window');
  });
});

describe('summariseScope and severity (ENISA-inspired SE = DPC x EI + CB)', () => {
  it('aggregates subjects and records per data class and finds the highest class', () => {
    const s = summariseScope(load().dataScope);
    expect(s.subjectsLowerBound).toBeGreaterThan(0);
    expect(s.subjectsLowerBound).toBe(Math.max(...load().dataScope.map((d) => d.subjects)));
    expect(s.highestClass).toBe('financial');
    expect(s.encryptedShare).toBeGreaterThanOrEqual(0);
    expect(s.encryptedShare).toBeLessThanOrEqual(1);
  });

  it('uses the highest data class as the DPC base (simple 1, behavioural 2, financial 3, sensitive 4)', () => {
    const b = load();
    const base = { ...b.circumstances, dpcAdjustment: 0, easeOfIdentification: 'maximum' as const, confidentialityLoss: 'none' as const, integrityLoss: 'none' as const, availabilityLoss: 'none' as const, maliciousIntent: false };
    expect(severity({ ...b, circumstances: base }).dpcBase).toBe(3);
    expect(severity({ ...b, dataScope: b.dataScope.filter((d) => d.dataClass === 'simple'), circumstances: base }).dpcBase).toBe(1);
  });

  it('computes SE = DPC x EI + CB with the published factor values', () => {
    const b = load();
    const c = { ...b.circumstances, dpcAdjustment: 0, easeOfIdentification: 'significant' as const, confidentialityLoss: 'known-recipients' as const, integrityLoss: 'none' as const, availabilityLoss: 'none' as const, maliciousIntent: false };
    const s = severity({ ...b, circumstances: c });
    // DPC 3 (financial) x EI 0.75 + CB 0.25 = 2.5 -> medium
    expect(s.ei).toBe(0.75);
    expect(s.cb.total).toBe(0.25);
    expect(s.se).toBeCloseTo(2.5, 5);
    expect(s.band).toBe('medium');
  });

  it('adds circumstance points and applies the bands low <2, medium <3, high <4, very high >=4', () => {
    const b = load();
    const c = { ...b.circumstances, dpcAdjustment: 1, easeOfIdentification: 'maximum' as const, confidentialityLoss: 'unknown-recipients' as const, integrityLoss: 'recoverable' as const, availabilityLoss: 'temporary' as const, maliciousIntent: true };
    const s = severity({ ...b, circumstances: c });
    // DPC 4 x 1 + (0.5 + 0.25 + 0.25 + 0.5) = 5.5 -> very high
    expect(s.cb.total).toBe(1.5);
    expect(s.se).toBeCloseTo(5.5, 5);
    expect(s.band).toBe('very-high');
    const low = severity({ ...b, dataScope: b.dataScope.filter((d) => d.dataClass === 'simple'), circumstances: { ...c, dpcAdjustment: 0, easeOfIdentification: 'negligible', confidentialityLoss: 'none', integrityLoss: 'none', availabilityLoss: 'none', maliciousIntent: false } });
    expect(low.se).toBeCloseTo(0.25, 5);
    expect(low.band).toBe('low');
  });

  it('clamps the DPC adjustment to keep DPC within 1..4 and records the justification in the rationale', () => {
    const b = load();
    const s = severity({ ...b, circumstances: { ...b.circumstances, dpcAdjustment: 3, dpcJustification: 'Volume enables profiling (synthetic)' } });
    expect(s.dpcAdjusted).toBe(4);
    expect(s.rationale.join(' ')).toMatch(/Volume enables profiling/);
  });

  it('severity is monotonic in ease of identification (property)', () => {
    const b = load();
    const order = ['negligible', 'limited', 'significant', 'maximum'] as const;
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 }), (i) => {
      const lo = severity({ ...b, circumstances: { ...b.circumstances, easeOfIdentification: order[i]! } }).se;
      const hi = severity({ ...b, circumstances: { ...b.circumstances, easeOfIdentification: order[i + 1]! } }).se;
      return hi >= lo;
    }));
  });
});

describe('severitySensitivity: what would change the band (October 2026 upgrade round)', () => {
  it('lists at least one single-field change that moves the demo band, including ease of identification', () => {
    const b = load();
    const flips = severitySensitivity(b);
    expect(flips.length).toBeGreaterThan(0);
    // Demo: DPC 3 (financial) − 1 = 2, EI maximum (1), CB 0.25 → SE 2.25 medium; EI limited → 2 × 0.5 + 0.25 = 1.25 low.
    const ei = flips.find((f) => f.field === 'easeOfIdentification' && f.to === 'limited');
    expect(ei).toMatchObject({ from: 'maximum', bandFrom: 'medium', bandTo: 'low' });
    expect(ei?.seDelta).toBeCloseTo(-1, 5);
  });

  it('every flip really produces its bandTo and seDelta when applied (loop over all flips)', () => {
    const b = load();
    const base = severity(b);
    const flips = severitySensitivity(b);
    expect(flips.length).toBeGreaterThan(0);
    for (const f of flips) {
      const after = severity(applyFlip(b, f));
      expect(f.bandFrom, f.field).toBe(base.band);
      expect(f.bandTo, `${f.field} ${f.from}→${f.to}`).not.toBe(f.bandFrom);
      expect(after.band, `${f.field} ${f.from}→${f.to}`).toBe(f.bandTo);
      expect(after.se - base.se).toBeCloseTo(f.seDelta, 5);
    }
  });

  it('includes the highest data class moving one class up and one class down', () => {
    const cls = severitySensitivity(load()).filter((f) => f.field === 'dataScope.highestClass');
    expect(cls.map((f) => `${f.from}→${f.to}`).sort()).toEqual(['financial→behavioural', 'financial→sensitive']);
  });

  it('moves the context adjustment by ±1 only and never beyond −3..+3', () => {
    const b = load();
    // simple (1) + 3 clamps to DPC 4; EI maximum, CB 0.25 → SE 4.25 very high. The only in-range move is +2 → DPC 3 → SE 3.25 high.
    const top = severitySensitivity({ ...b, dataScope: b.dataScope.filter((d) => d.dataClass === 'simple'), circumstances: { ...b.circumstances, dpcAdjustment: 3 } });
    const topMoves = top.filter((f) => f.field === 'dpcAdjustment');
    expect(topMoves.map((f) => f.to)).toEqual(['2']);
    expect(topMoves[0]).toMatchObject({ from: '3', bandFrom: 'very-high', bandTo: 'high' });
    // sensitive (4) − 3 clamps to DPC 1 → SE 1.25 low. The only in-range move is −2 → DPC 2 → SE 2.25 medium.
    const sensitive = { ...b.dataScope[0]!, id: 'ds-x', category: 'Health note (synthetic)', dataClass: 'sensitive' as const };
    const bottom = severitySensitivity({ ...b, dataScope: [...b.dataScope, sensitive], circumstances: { ...b.circumstances, dpcAdjustment: -3 } });
    const bottomMoves = bottom.filter((f) => f.field === 'dpcAdjustment');
    expect(bottomMoves.map((f) => f.to)).toEqual(['-2']);
    expect(bottomMoves[0]).toMatchObject({ from: '-3', bandFrom: 'low', bandTo: 'medium' });
    // In the demo (adjustment −1) both single steps flip: −2 → DPC 1 (low), 0 → DPC 3 (high).
    const demoMoves = severitySensitivity(b).filter((f) => f.field === 'dpcAdjustment').map((f) => `${f.to}:${f.bandTo}`).sort();
    expect(demoMoves).toEqual(['-2:low', '0:high']);
  });

  it('returns no flips when every single change keeps the band (a deep-low bundle and a clamp-saturated medium bundle)', () => {
    const b = load();
    const deepLow: IncidentBundle = { ...b, dataScope: b.dataScope.filter((d) => d.dataClass === 'simple'), circumstances: { ...b.circumstances, dpcAdjustment: 0, easeOfIdentification: 'negligible', confidentialityLoss: 'none', integrityLoss: 'none', availabilityLoss: 'none', maliciousIntent: false } };
    expect(severity(deepLow).band).toBe('low');
    expect(severitySensitivity(deepLow)).toEqual([]);
    // Highest class financial (3) with adjustment −3 clamps DPC to 1 under every single move; EI 0.75 + CB 1.75 = 2.5 stays medium.
    const mid: IncidentBundle = { ...b, circumstances: { ...b.circumstances, dpcAdjustment: -3, easeOfIdentification: 'significant', confidentialityLoss: 'unknown-recipients', integrityLoss: 'unrecoverable', availabilityLoss: 'temporary', maliciousIntent: true } };
    expect(severity(mid).se).toBeCloseTo(2.5, 5);
    expect(severity(mid).band).toBe('medium');
    expect(severitySensitivity(mid)).toEqual([]);
  });

  it('is deterministic and sorted by |seDelta| descending, then field', () => {
    const b = load();
    const first = severitySensitivity(b);
    expect(severitySensitivity(b)).toEqual(first);
    for (let i = 1; i < first.length; i += 1) {
      const p = first[i - 1]!;
      const q = first[i]!;
      const dp = Math.abs(p.seDelta);
      const dq = Math.abs(q.seDelta);
      expect(dp > dq || (Math.abs(dp - dq) < 1e-9 && p.field <= q.field), `${p.field}(${dp}) before ${q.field}(${dq})`).toBe(true);
    }
  });
});

describe('readiness', () => {
  it('lists the Art. 33(3) facts and derived checks, and scores completeness over required items', () => {
    const b = load();
    const r = readiness(b);
    const keys = r.items.map((i) => i.key);
    for (const k of ['nature', 'approxSubjects', 'approxRecords', 'contactPoint', 'likelyConsequences', 'measuresTaken', 'timelineEstablished', 'severityAssessed']) expect(keys).toContain(k);
    expect(r.completeness).toBeGreaterThan(0);
    expect(r.completeness).toBeLessThan(1); // the demo bundle is deliberately incomplete
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('completeness rises when a missing fact is supplied', () => {
    const b = load();
    const before = readiness(b).completeness;
    const after = readiness({ ...b, facts: { ...b.facts, likelyConsequences: 'Possible phishing against affected customers.' } }).completeness;
    expect(after).toBeGreaterThan(before);
  });

  it('the timeline check fails when awareness is missing', () => {
    const b = load();
    const noAware = { ...b, events: b.events.filter((e) => e.kind !== 'aware') };
    expect(readiness(noAware).items.find((i) => i.key === 'timelineEstablished')?.present).toBe(false);
  });

  it('containment is complete only when every applicable task is done with evidence', () => {
    const b = load();
    expect(readiness(b).items.find((i) => i.key === 'containmentComplete')?.present).toBe(false);
    let done = b;
    for (const t of b.containment) if (t.status !== 'not-applicable') done = completeTask(done, t.id, 'ticket-ref (synthetic)');
    expect(readiness(done).items.find((i) => i.key === 'containmentComplete')?.present).toBe(true);
  });

  it('completeTask refuses to mark a task done without an evidence reference', () => {
    const b = load();
    expect(() => completeTask(b, b.containment[0]!.id, '   ')).toThrow(/evidence/i);
    expect(() => completeTask(b, 'nope', 'x')).toThrow(/not found/i);
  });
});

describe('redaction and packet', () => {
  it('masks every personal token case-insensitively and masks email-shaped strings', () => {
    const out = redactText('Sent to Priya Oduya <priya.oduya@people.example> and PRIYA ODUYA again', ['Priya Oduya']);
    expect(out).not.toMatch(/Priya/i);
    expect(out).not.toMatch(/@/);
    expect(out).toMatch(/\[REDACTED\]/);
  });

  it('builds a packet whose redacted view contains no personal tokens while the full view does', () => {
    const b = load();
    const full = buildPacket(b, '2026-09-22T12:00:00Z', false);
    const red = buildPacket(b, '2026-09-22T12:00:00Z', true);
    const fullText = JSON.stringify(full);
    const redText = JSON.stringify(red);
    expect(b.personalTokens.some((t) => fullText.includes(t))).toBe(true);
    expect(b.personalTokens.some((t) => redText.toLowerCase().includes(t.toLowerCase()))).toBe(false);
    expect(red.redacted).toBe(true);
    expect(red.severity.band).toBe(full.severity.band);
    expect(red.disclaimer).toMatch(/not a notification/i);
  });
});

describe('bundle import', () => {
  it('round-trips the demo bundle', () => {
    const b = load();
    expect(parseBundle(serializeBundle(b)).ok).toBe(true);
    expect(b.events.length).toBeGreaterThanOrEqual(8);
  });

  it('rejects bad enums, timestamps, negative counts and duplicate ids', () => {
    expect(parseBundle(JSON.stringify({ ...demo, incidentType: 'alien' })).ok).toBe(false);
    expect(parseBundle(JSON.stringify({ ...demo, events: [{ ...demo.events[0], at: 'yesterday' }] })).ok).toBe(false);
    expect(parseBundle(JSON.stringify({ ...demo, dataScope: [{ ...demo.dataScope[0], subjects: -1 }] })).ok).toBe(false);
    const dup = parseBundle(JSON.stringify({ ...demo, containment: [demo.containment[0], demo.containment[0]] }));
    expect(dup.ok).toBe(false);
  });

  it('rejects oversized input and hostile nesting without throwing', () => {
    expect(parseBundle('x'.repeat(20), { maxBytes: 10 }).ok).toBe(false);
    const deep = '['.repeat(20_000) + ']'.repeat(20_000);
    let result: ReturnType<typeof parseBundle> | undefined;
    expect(() => { result = parseBundle(`{"schema":"firstlight.incident","version":1,"extra":${deep}}`); }).not.toThrow();
    expect(result?.ok).toBe(false);
  });

  it('drops unknown keys', () => {
    const r = parseBundle(JSON.stringify({ ...demo, mystery: 1, facts: { ...demo.facts, mystery: 'x' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect('mystery' in r.bundle.facts).toBe(false);
  });
});

describe('import strictness (review findings)', () => {
  const base = () => JSON.parse(JSON.stringify(demo)) as Record<string, unknown> & { events: Array<Record<string, unknown>> };
  it('rejects timestamps that match the pattern but are not real instants', () => {
    for (const at of ['2026-02-30T10:00:00Z', '2026-99-99T10:00:00Z', '2026-09-20T24:00:00Z', '2026-09-20T10:60:00Z']) {
      const b = base(); b.events[0]!['at'] = at;
      const r = parseBundle(JSON.stringify(b));
      expect(r.ok, at).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/events\[0\]\.at/);
    }
  });

  it('rejects malformed or oversized personalTokens instead of silently dropping redaction terms', () => {
    const b1 = base(); b1['personalTokens'] = ['Priya Oduya', 42];
    expect(parseBundle(JSON.stringify(b1)).ok).toBe(false);
    const b2 = base(); b2['personalTokens'] = Array.from({ length: 201 }, (_, i) => `name-${i}`);
    expect(parseBundle(JSON.stringify(b2)).ok).toBe(false);
    const b3 = base(); b3['personalTokens'] = ['x'.repeat(201)];
    expect(parseBundle(JSON.stringify(b3)).ok).toBe(false);
    const b4 = base(); b4['personalTokens'] = ['   '];
    expect(parseBundle(JSON.stringify(b4)).ok).toBe(false);
  });
});
