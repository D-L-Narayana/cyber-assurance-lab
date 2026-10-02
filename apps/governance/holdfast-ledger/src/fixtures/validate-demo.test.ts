import { describe, expect, it } from 'vitest';
import demo from './demo.json';
import { computeDue, planDisposal, validateFixture } from '../engine/ledger';

describe('demo fixture', () => {
  it('validates and exercises every due state and hold scope', async () => {
    const v = validateFixture(demo);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const due = computeDue(v.fixture, v.fixture.asOf);
    const states = new Set(due.map((d) => d.state));
    for (const s of ['retained', 'due', 'overdue', 'held', 'disposed', 'unscheduled']) expect(states.has(s as never)).toBe(true);
    const plan = await planDisposal(v.fixture, v.fixture.asOf);
    expect(plan.counts.dispose).toBeGreaterThan(5);
    expect(plan.counts.skip).toBeGreaterThan(3);
    expect(due.some((d) => d.holdIds.includes('hold-tickets-sample'))).toBe(true);
    expect(due.some((d) => d.holdIds.includes('hold-mkt-2025'))).toBe(false); // released
  });
});
