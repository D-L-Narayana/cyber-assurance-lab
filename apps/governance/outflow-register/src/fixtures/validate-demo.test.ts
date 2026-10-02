import { describe, expect, it } from 'vitest';
import demo from './demo.json';
import { findIssues, renewalQueue, validateRegister } from '../engine/register';

describe('demo register', () => {
  it('validates and exhibits every issue kind the engine knows', () => {
    const v = validateRegister(demo);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const issues = findIssues(v.register, v.register.asOf);
    const kinds = new Set(issues.map((i) => i.kind));
    for (const k of ['missing_owner', 'expired_but_active', 'renewal_window_open', 'flow_without_agreement', 'flow_category_not_covered', 'flow_after_end', 'flow_under_draft', 'deletion_obligation_unmet', 'obligation_no_evidence', 'contradictory_breach_window', 'stale_flow']) expect(kinds.has(k as never), k).toBe(true);
    const q = renewalQueue(v.register, v.register.asOf);
    expect(q[0]!.agreementId).toBe('ag-07'); // expired backup agreement with four categories and an active flow
  });
});
