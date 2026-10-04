import { describe, it, expect } from 'vitest';
import { parseLogs } from './parse';
import { runRules, DEFAULT_RULE_CONFIG, type RuleConfig } from './rules';
import { generateScenario, type ScenarioId } from './scenario';
import { diffAlerts, recordTuning } from './diff';
import type { Alert } from './types';

const events = (id: ScenarioId, seed = 7) => parseLogs(generateScenario(id, seed)).events;
const ids = (alerts: Alert[]) => alerts.map(a => a.id);
const ALLOW_EDGE: RuleConfig = { ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [...DEFAULT_RULE_CONFIG.dnsSuffixAllowlist, '.edge.media.example'] };

describe('diffAlerts (tuning what-if)', () => {
  it('identical configs produce an empty diff and keep every alert', () => {
    const ev = events('mixed-day');
    const before = runRules(ev, DEFAULT_RULE_CONFIG);
    const after = runRules(ev, { ...DEFAULT_RULE_CONFIG });
    expect(before.length).toBeGreaterThan(0);
    const d = diffAlerts(before, after);
    expect(d.removed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(ids(d.kept)).toEqual(ids(before));
  });
  it('adding .edge.media.example to the allowlist on cdn-noise removes exactly the DNS-001 alerts and adds none', () => {
    const ev = events('cdn-noise');
    const before = runRules(ev, DEFAULT_RULE_CONFIG);
    const dns1 = before.filter(a => a.ruleId === 'DNS-001');
    expect(dns1.length).toBeGreaterThan(0);
    const d = diffAlerts(before, runRules(ev, ALLOW_EDGE));
    expect(ids(d.removed)).toEqual(ids(dns1));
    expect(d.added).toEqual([]);
    expect(ids(d.kept)).toEqual(ids(before.filter(a => a.ruleId !== 'DNS-001')));
    // The mirror image: clearing the allowlist on mixed-day *adds* the suppressed CDN alerts and removes nothing.
    const mixed = events('mixed-day');
    const base = runRules(mixed, DEFAULT_RULE_CONFIG);
    const loosened = diffAlerts(base, runRules(mixed, { ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [] }));
    expect(loosened.removed).toEqual([]);
    expect(loosened.added.length).toBeGreaterThan(0);
    expect(loosened.added.every(a => a.ruleId === 'DNS-001' && a.explanation.includes('assets.cdn.example'))).toBe(true);
    expect(ids(loosened.kept)).toEqual(ids(base));
  });
  it('raising authFailBurst above the burst size removes HTTP-001 on mixed-day and nothing else', () => {
    const ev = events('mixed-day');
    const before = runRules(ev, DEFAULT_RULE_CONFIG);
    const http1 = before.filter(a => a.ruleId === 'HTTP-001');
    expect(http1).toHaveLength(1);
    const d = diffAlerts(before, runRules(ev, { ...DEFAULT_RULE_CONFIG, authFailBurst: 20 }));
    expect(ids(d.removed)).toEqual(ids(http1));
    expect(d.added).toEqual([]);
    expect(d.kept).toHaveLength(before.length - 1);
    expect(d.kept.some(a => a.ruleId === 'HTTP-001')).toBe(false);
  });
  it('alert ids are stable across identical configs and across threshold changes that do not alter the evidence', () => {
    const ev = events('mixed-day');
    const a = runRules(ev, DEFAULT_RULE_CONFIG);
    const b = runRules(ev, { ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [...DEFAULT_RULE_CONFIG.dnsSuffixAllowlist] });
    expect(ids(a)).toEqual(ids(b));
    // NXDOMAIN window 60 → 61 s selects the same first qualifying window and a 21-char entropy gate changes no label
    // decision in this scenario, so the same evidence yields the same content-derived ids and the diff is empty even
    // though the config object differs.
    const c = runRules(ev, { ...DEFAULT_RULE_CONFIG, nxdomainWindowSec: 61, dnsLabelMinLength: 21 });
    expect(ids(c)).toEqual(ids(a));
    expect(diffAlerts(a, c)).toEqual({ removed: [], added: [], kept: c });
  });
  it('orders removed, added and kept by first timestamp then id regardless of input order', () => {
    const ev = events('mixed-day');
    const before = runRules(ev, DEFAULT_RULE_CONFIG);
    const after = runRules(ev, { ...DEFAULT_RULE_CONFIG, dnsSuffixAllowlist: [], authFailBurst: 20 });
    const shuffle = (xs: Alert[]) => [...xs].reverse();
    const d = diffAlerts(shuffle(before), shuffle(after));
    const sorted = (xs: Alert[]) => [...xs].sort((x, y) => x.firstTs - y.firstTs || x.id.localeCompare(y.id));
    expect(d.removed).toEqual(sorted(d.removed));
    expect(d.added).toEqual(sorted(d.added));
    expect(d.kept).toEqual(sorted(d.kept));
    expect(d.removed.map(a => a.ruleId)).toEqual(['HTTP-001']);
    expect(d.added.every(a => a.ruleId === 'DNS-001')).toBe(true);
    expect(diffAlerts(before, after)).toEqual(d);
  });
  it('recordTuning captures from/to configs and the removed/added ids for the current events', () => {
    const ev = events('cdn-noise');
    const before = runRules(ev, DEFAULT_RULE_CONFIG);
    const rec = recordTuning(ev, DEFAULT_RULE_CONFIG, ALLOW_EDGE);
    expect(rec).toEqual({ from: DEFAULT_RULE_CONFIG, to: ALLOW_EDGE, removed: ids(before), added: [] });
    expect(recordTuning(ev, DEFAULT_RULE_CONFIG, DEFAULT_RULE_CONFIG)).toEqual({ from: DEFAULT_RULE_CONFIG, to: DEFAULT_RULE_CONFIG, removed: [], added: [] });
  });
});
