import { describe, it, expect } from 'vitest';
import { validateScenario, parseScenario, LIMITS, type Scenario } from './scenario';
import { RANSOMWARE_TABLETOP } from './fixtures';

const base: Scenario = {
  id: 'mini', title: 'Mini', version: 1, startAt: '2026-10-01T09:00:00Z',
  roles: [{ id: 'ic', name: 'Incident commander' }, { id: 'comms', name: 'Communications' }],
  injects: [
    { id: 'i1', atMinute: 0, role: 'ic', title: 'Alert', body: 'EDR alert on FS-01.', decision: { id: 'd1', prompt: 'Isolate FS-01?', slaMinutes: 15, options: [
      { id: 'yes', label: 'Isolate now', score: 10, note: 'Contained early', tasks: [{ id: 't-iso', role: 'ic', title: 'Confirm isolation', dueInMinutes: 10 }], unlocks: [{ injectId: 'i3', afterMinutes: 5 }] },
      { id: 'wait', label: 'Wait for more data', score: 0, note: 'Spread risk' },
    ] } },
    { id: 'i2', atMinute: 10, role: 'comms', title: 'Press call', body: 'Reporter asks about outage.' },
    { id: 'i3', atMinute: null, role: 'ic', title: 'Isolation confirmed', body: 'Host offline.' },
  ],
};

// Hostile inputs are built by mutating a deep copy of `base` without type safety on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const clone = (x: unknown): Loose => JSON.parse(JSON.stringify(x));

/** Mutate a deep copy of `base`, validate it and assert the rejection names the offending path. */
function rejects(mutate: (s: Loose) => void, path: RegExp) {
  const s = clone(base); mutate(s);
  const v = validateScenario(s);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.errors.join('\n')).toMatch(path);
  return v;
}
function accepts(mutate: (s: Loose) => void) {
  const s = clone(base); mutate(s);
  const v = validateScenario(s);
  if (!v.ok) throw new Error(`expected acceptance, got: ${v.errors.join(' | ')}`);
  expect(v.ok).toBe(true);
}

describe('scenario validation — shape and bounds', () => {
  it('accepts the shipped fixture and the mini scenario and returns a copy without unknown keys', () => {
    expect(validateScenario(RANSOMWARE_TABLETOP).ok).toBe(true);
    const withExtras = clone(base);
    withExtras.extra = 1; withExtras.injects[0].extraInject = true; withExtras.injects[0].decision.options[0].extraOption = 'x';
    const v = validateScenario(withExtras);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.scenario).toEqual(base);
      expect('extra' in v.scenario).toBe(false);
      expect('extraInject' in v.scenario.injects[0]).toBe(false);
      expect('extraOption' in v.scenario.injects[0].decision!.options[0]).toBe(false);
    }
  });

  it('parseScenario rejects invalid JSON and anything over the 512 KiB byte cap before parsing', () => {
    expect(LIMITS.maxBytes).toBe(512 * 1024);
    const bad = parseScenario('{');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatch(/JSON/);
    const multibyte = '"' + 'é'.repeat(LIMITS.maxBytes / 2 + 16) + '"'; // fewer characters than the cap, more bytes
    expect(multibyte.length).toBeLessThan(LIMITS.maxBytes);
    const big = parseScenario(multibyte);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.errors[0]).toMatch(/bytes/);
    const ok = parseScenario(JSON.stringify(base));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.scenario).toEqual(base);
    expect(validateScenario(JSON.stringify(RANSOMWARE_TABLETOP)).ok).toBe(true);
    // Text is decoded exactly once: a JSON string literal that itself contains a scenario document is rejected,
    // not parsed a second time.
    const wrapped = parseScenario(JSON.stringify(JSON.stringify(base)));
    expect(wrapped.ok).toBe(false);
    if (!wrapped.ok) expect(wrapped.errors[0]).toMatch(/object/);
  });

  it('bounds nesting depth (≤ 8 containers) and total value count with an iterative scan', () => {
    const v = parseScenario('['.repeat(5000) + ']'.repeat(5000));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toMatch(/depth/i);
    let nested: unknown = {}; for (let i = 0; i < 9; i++) nested = { nested };
    rejects(s => { s.deep = nested; }, /depth/i);
    rejects(s => { s.blob = Array.from({ length: LIMITS.maxValues + 1 }, () => 0); }, /values/i);
    expect(LIMITS.maxDepth).toBe(8);
    expect(validateScenario(RANSOMWARE_TABLETOP).ok).toBe(true); // the fixture is exactly 8 containers deep
  });

  it('validates top-level fields with path-addressed errors', () => {
    rejects(s => { s.id = 'x'.repeat(81); }, /^id:/m);
    rejects(s => { s.id = ''; }, /^id:/m);
    rejects(s => { s.title = 'x'.repeat(201); }, /^title:/m);
    rejects(s => { s.version = 0; }, /^version:/m);
    rejects(s => { s.version = 1.5; }, /^version:/m);
    rejects(s => { s.version = '1'; }, /^version:/m);
    rejects(s => { s.startAt = '2026-02-30T09:00:00Z'; }, /^startAt:/m);
    rejects(s => { s.startAt = '2026-10-01 09:00'; }, /^startAt:/m);
    rejects(s => { s.startAt = 'yesterday'; }, /^startAt:/m);
    rejects(s => { s.startAt = '2026-10-01T24:00:00Z'; }, /^startAt:/m);
    accepts(s => { s.startAt = '2026-10-01T09:00:00.000Z'; });
    accepts(s => { s.startAt = '2026-10-01T09:00:00+02:00'; });
    rejects(s => { s.description = 'x'.repeat(2001); }, /^description:/m);
    accepts(s => { delete s.description; });
    rejects(s => { s.roles = []; }, /^roles:/m);
    rejects(s => { s.roles = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, name: `Role ${i}` })); }, /^roles:/m);
    rejects(s => { s.roles[0] = 'ic'; }, /^roles\[0\]/m);
    rejects(s => { s.roles[0].id = ''; }, /^roles\[0\]\.id/m);
    rejects(s => { s.roles[0].id = 'x'.repeat(41); }, /^roles\[0\]\.id/m);
    rejects(s => { s.roles[0].name = 'x'.repeat(121); }, /^roles\[0\]\.name/m);
    rejects(s => { s.roles[1].id = 'ic'; }, /^roles\[1\]\.id: duplicate/m);
  });

  it('validates injects, decisions, options, tasks and unlocks with exact paths', () => {
    rejects(s => { s.injects[1].title = 'x'.repeat(201); }, /^injects\[1\]\.title/m);
    rejects(s => { s.injects[1].body = 'x'.repeat(LIMITS.maxText + 1); }, /^injects\[1\]\.body/m);
    rejects(s => { s.injects[1].atMinute = 'now'; }, /^injects\[1\]\.atMinute/m);
    rejects(s => { s.injects[1].atMinute = 1.5; }, /^injects\[1\]\.atMinute/m);
    rejects(s => { s.injects[1].atMinute = LIMITS.maxMinute + 1; }, /^injects\[1\]\.atMinute/m);
    rejects(s => { s.injects[1].role = 'ghost'; }, /^injects\[1\]\.role/m);
    rejects(s => { s.injects[1] = 42; }, /^injects\[1\]:/m);
    rejects(s => { s.injects[0].decision = 'd1'; }, /^injects\[0\]\.decision:/m);
    rejects(s => { s.injects[0].decision.id = 7; }, /^injects\[0\]\.decision\.id/m);
    rejects(s => { s.injects[0].decision.prompt = 'x'.repeat(501); }, /^injects\[0\]\.decision\.prompt/m);
    rejects(s => { s.injects[0].decision.slaMinutes = 0; }, /^injects\[0\]\.decision\.slaMinutes/m);
    rejects(s => { s.injects[0].decision.slaMinutes = 1441; }, /^injects\[0\]\.decision\.slaMinutes/m);
    rejects(s => { s.injects[0].decision.slaMinutes = 2.5; }, /^injects\[0\]\.decision\.slaMinutes/m);
    rejects(s => { s.injects[0].decision.options.pop(); }, /^injects\[0\]\.decision\.options:/m);
    rejects(s => { s.injects[0].decision.options[1].id = 'yes'; }, /^injects\[0\]\.decision\.options\[1\]\.id: duplicate/m);
    rejects(s => { s.injects[0].decision.options[0].label = 'x'.repeat(201); }, /^injects\[0\]\.decision\.options\[0\]\.label/m);
    rejects(s => { s.injects[0].decision.options[1].score = 250; }, /^injects\[0\]\.decision\.options\[1\]\.score/m);
    rejects(s => { s.injects[0].decision.options[1].score = -1; }, /^injects\[0\]\.decision\.options\[1\]\.score/m);
    rejects(s => { s.injects[0].decision.options[1].score = '5'; }, /^injects\[0\]\.decision\.options\[1\]\.score/m);
    rejects(s => { s.injects[0].decision.options[1].score = Number.POSITIVE_INFINITY; }, /^injects\[0\]\.decision\.options\[1\]\.score/m);
    rejects(s => { s.injects[0].decision.options[0].note = 'x'.repeat(1001); }, /^injects\[0\]\.decision\.options\[0\]\.note/m);
    rejects(s => { s.injects[0].decision.options[0].tasks[0].role = 'ghost'; }, /^injects\[0\]\.decision\.options\[0\]\.tasks\[0\]\.role/m);
    rejects(s => { s.injects[0].decision.options[0].tasks[0].title = 'x'.repeat(201); }, /^injects\[0\]\.decision\.options\[0\]\.tasks\[0\]\.title/m);
    rejects(s => { s.injects[0].decision.options[0].tasks[0].dueInMinutes = -1; }, /tasks\[0\]\.dueInMinutes/m);
    rejects(s => { s.injects[0].decision.options[0].tasks[0].dueInMinutes = 1441; }, /tasks\[0\]\.dueInMinutes/m);
    rejects(s => { s.injects[0].decision.options[0].tasks[0].dueInMinutes = 2.5; }, /tasks\[0\]\.dueInMinutes/m);
    rejects(s => { s.injects[0].decision.options[1].tasks = [{ id: 't-iso', role: 'ic', title: 'Dup', dueInMinutes: 5 }]; }, /^injects\[0\]\.decision\.options\[1\]\.tasks\[0\]\.id: duplicate/m);
    rejects(s => { s.injects[0].decision.options[0].unlocks[0].injectId = 'nope'; }, /^injects\[0\]\.decision\.options\[0\]\.unlocks\[0\]\.injectId/m);
    rejects(s => { s.injects[0].decision.options[0].unlocks[0].afterMinutes = 1441; }, /unlocks\[0\]\.afterMinutes/m);
    rejects(s => { s.injects[0].decision.options[0].unlocks[0].afterMinutes = 0.5; }, /unlocks\[0\]\.afterMinutes/m);
    // An unlock target must be an unlock-only inject (atMinute: null); a scheduled inject cannot also be unlocked.
    rejects(s => { s.injects[2].atMinute = 50; }, /^injects\[0\]\.decision\.options\[0\]\.unlocks\[0\]\.injectId: .*atMinute/m);
    rejects(s => { s.injects[2].id = 'i1'; }, /^injects\[2\]\.id: duplicate/m);
    rejects(s => { s.injects[1].decision = { id: 'd1', prompt: 'again', slaMinutes: 5, options: [{ id: 'a', label: 'A', score: 1, note: '' }, { id: 'b', label: 'B', score: 0, note: '' }] }; }, /^injects\[1\]\.decision\.id: duplicate/m);
    expect(validateScenario(RANSOMWARE_TABLETOP).ok).toBe(true);
  });

  it('caps the error list at 25 entries', () => {
    const v = rejects(s => { s.injects = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, atMinute: 0, role: 'ghost', title: 't', body: 'b' })); }, /^injects\[0\]\.role/m);
    if (!v.ok) expect(v.errors).toHaveLength(25);
    expect(LIMITS.maxErrors).toBe(25);
  });
});
