import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_RULES, classifyField, checkValue, effectiveLabels, policyFor, validateFixture, exportCatalog, validateException, addKeywordRule,
} from './classify';
import type { Field, Fixture, Rule } from './types';

const f = (over: Partial<Field>): Field => ({ id: 'f1', system: 'crm.example', table: 'contacts', name: 'col', type: 'string', samples: [], ...over });

describe('value checks', () => {
  it('luhn accepts valid card-like numbers and rejects invalid ones', () => {
    expect(checkValue('luhn', '4539 1488 0343 6467')).toBe(true); // synthetic test number
    expect(checkValue('luhn', '4539148803436468')).toBe(false);
    expect(checkValue('luhn', '12345')).toBe(false);
  });
  it('phone shape rejects 16-digit strings (E.164 allows at most 15 digits) so random references are not mislabelled', () => {
    expect(checkValue('phone', '+44 7700 900123')).toBe(true);
    expect(checkValue('phone', '4539148803436468')).toBe(false);
    expect(checkValue('phone', '1234567')).toBe(false);
  });
  it('email, ipv4, jwt, iban, apikey, dob, icd10, password-hash shapes', () => {
    expect(checkValue('email', 'ada@example.test')).toBe(true);
    expect(checkValue('email', 'not-an-email')).toBe(false);
    expect(checkValue('ipv4', '10.0.0.7')).toBe(true);
    expect(checkValue('ipv4', '999.0.0.1')).toBe(false);
    expect(checkValue('jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln')).toBe(true);
    expect(checkValue('iban', 'GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(checkValue('iban', 'GB82 WEST 1234 5698 7654 33')).toBe(false);
    expect(checkValue('apikey', 'DEMO_ONLY_NOT_A_SECRET_A1b2C3d4E5f6')).toBe(true);
    expect(checkValue('apikey', 'hello world')).toBe(false);
    expect(checkValue('dob', '1988-04-12', '2026-10-01')).toBe(true);
    expect(checkValue('dob', '2031-01-01', '2026-10-01')).toBe(false);
    expect(checkValue('icd10', 'E11.9')).toBe(true);
    expect(checkValue('icd10', 'hello')).toBe(false);
    expect(checkValue('password-hash', '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456')).toBe(true);
  });
});

describe('classifyField precedence and explainability', () => {
  it('labels a credential column secret-credential even when it also looks like PII', () => {
    const r = classifyField(f({ name: 'user_email_api_token', samples: ['DEMO_ONLY_NOT_A_SECRET_A1b2C3d4E5f6'] }), BUILT_IN_RULES, '2026-10-01');
    expect(r.computedClass).toBe('secret-credential');
    expect(r.trace.filter((t) => t.outcome === 'matched').map((t) => t.class)).toContain('restricted-pii');
  });
  it('does not label as card data when the Luhn check fails for most samples', () => {
    const r = classifyField(f({ name: 'reference_number', samples: ['4539148803436468', '1234567812345670', '9999999999999999'] }), BUILT_IN_RULES, '2026-10-01');
    expect(r.computedClass).not.toBe('restricted-financial');
    const luhnTrace = r.trace.find((t) => t.ruleId === 'val-card-luhn');
    expect(luhnTrace?.outcome).toBe('not-matched');
    expect(luhnTrace?.reason).toMatch(/1\/3|33%/);
  });
  it('puts unmatched fields in the unknown bucket and asks for review', () => {
    const r = classifyField(f({ name: 'zzq', samples: ['a', 'b'] }), BUILT_IN_RULES, '2026-10-01');
    expect(r.computedClass).toBe('unknown');
    expect(r.needsReview).toBe(true);
    expect(r.confidence).toBe(0);
  });
  it('falls back to the declared class when nothing matches, but flags it for review', () => {
    const r = classifyField(f({ name: 'zzq', declaredClass: 'internal', samples: [] }), BUILT_IN_RULES, '2026-10-01');
    expect(r.computedClass).toBe('internal');
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons.join(' ')).toMatch(/declared/i);
  });
  it('flags a declared class that is lower than the computed one', () => {
    const r = classifyField(f({ name: 'customer_email', declaredClass: 'internal', samples: ['a@example.test', 'b@example.test'] }), BUILT_IN_RULES, '2026-10-01');
    expect(r.computedClass).toBe('restricted-pii');
    expect(r.declaredMismatch).toEqual({ declared: 'internal', computed: 'restricted-pii' });
    expect(r.needsReview).toBe(true);
  });
  it('produces a trace entry for every rule in precedence order', () => {
    const r = classifyField(f({ name: 'created_at', type: 'date', samples: ['2026-01-01'] }), BUILT_IN_RULES, '2026-10-01');
    expect(r.trace).toHaveLength(BUILT_IN_RULES.length);
    expect(r.trace.map((t) => t.ruleId)).toEqual(BUILT_IN_RULES.map((x) => x.id));
    expect(r.trace.some((t) => t.outcome === 'skipped' && /no samples|type/.test(t.reason))).toBe(true);
  });
  it('combines evidence: name and value agreement gives higher confidence than name alone', () => {
    const nameOnly = classifyField(f({ name: 'email_address', samples: [] }), BUILT_IN_RULES, '2026-10-01');
    const both = classifyField(f({ name: 'email_address', samples: ['x@example.test', 'y@example.test'] }), BUILT_IN_RULES, '2026-10-01');
    expect(both.confidence).toBeGreaterThan(nameOnly.confidence);
    expect(both.confidence).toBeLessThanOrEqual(1);
  });
  it('is deterministic', () => {
    const field = f({ name: 'salary_amount', type: 'number', samples: ['52000', '61000.50'] });
    expect(classifyField(field, BUILT_IN_RULES, '2026-10-01')).toEqual(classifyField(field, BUILT_IN_RULES, '2026-10-01'));
  });
});

describe('custom keyword rules', () => {
  it('adds a safe substring rule that participates in classification', () => {
    const r = addKeywordRule(BUILT_IN_RULES, { id: 'kw-1', name: 'Project codename', tokens: ['codename'], class: 'confidential', weight: 0.7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = classifyField(f({ name: 'project_codename', samples: ['Falcon'] }), r.rules, '2026-10-01');
    expect(c.computedClass).toBe('confidential');
  });
  it('rejects empty tokens, regex metacharacters, duplicate ids and bad weights', () => {
    expect(addKeywordRule(BUILT_IN_RULES, { id: 'kw-2', name: 'x', tokens: [], class: 'internal', weight: 0.5 }).ok).toBe(false);
    expect(addKeywordRule(BUILT_IN_RULES, { id: 'kw-3', name: 'x', tokens: ['(a+)+'], class: 'internal', weight: 0.5 }).ok).toBe(false);
    expect(addKeywordRule(BUILT_IN_RULES, { id: BUILT_IN_RULES[0]!.id, name: 'x', tokens: ['abc'], class: 'internal', weight: 0.5 }).ok).toBe(false);
    expect(addKeywordRule(BUILT_IN_RULES, { id: 'kw-4', name: 'x', tokens: ['abc'], class: 'internal', weight: 1.5 }).ok).toBe(false);
  });
});

describe('handling policy and exceptions', () => {
  const fx: Fixture = {
    schemaVersion: 1, label: 'unit', asOf: '2026-10-01',
    fields: [
      f({ id: 'f-card', name: 'card_number', samples: ['4539148803436467'] }),
      f({ id: 'f-wiki', name: 'page_title', samples: ['Welcome'] , declaredClass: 'internal'}),
    ],
    exceptions: [
      { id: 'x1', fieldId: 'f-card', fromClass: 'restricted-financial', toClass: 'confidential', justification: 'Tokenised by the payment provider; only last four digits stored.', approvedBy: 'dpo.example', grantedOn: '2026-01-01', expiresOn: '2026-12-31' },
    ],
  };
  it('every class has a policy and stricter classes have stricter handling', () => {
    expect(policyFor('secret-credential').externalSharing).toBe('prohibited');
    expect(policyFor('public').encryptionAtRest).toBe('not-required');
    expect(policyFor('restricted-pii').maskInLogs).toBe(true);
    expect(policyFor('unknown').summary).toMatch(/review/i);
  });
  it('applies an active exception to the effective class and keeps the computed class visible', () => {
    const out = effectiveLabels(fx, BUILT_IN_RULES);
    const card = out.find((e) => e.fieldId === 'f-card')!;
    expect(card.computedClass).toBe('restricted-financial');
    expect(card.effectiveClass).toBe('confidential');
    expect(card.exception?.status).toBe('active');
    expect(card.policy.class).toBe('confidential');
  });
  it('reverts an expired exception', () => {
    const out = effectiveLabels({ ...fx, asOf: '2027-02-01' }, BUILT_IN_RULES);
    const card = out.find((e) => e.fieldId === 'f-card')!;
    expect(card.effectiveClass).toBe('restricted-financial');
    expect(card.exception?.status).toBe('expired');
  });
  it('validates new exceptions: downgrade only, justification length, expiry window, matching fromClass', () => {
    const base = { id: 'x2', fieldId: 'f-card', fromClass: 'restricted-financial' as const, toClass: 'confidential' as const, justification: 'Tokenised; provider holds the PAN, we keep last four only', approvedBy: 'dpo', grantedOn: '2026-10-01', expiresOn: '2027-03-01' };
    expect(validateException(base, 'restricted-financial', '2026-10-01').ok).toBe(true);
    expect(validateException({ ...base, toClass: 'secret-credential' }, 'restricted-financial', '2026-10-01').ok).toBe(false);
    expect(validateException({ ...base, justification: 'short' }, 'restricted-financial', '2026-10-01').ok).toBe(false);
    expect(validateException({ ...base, expiresOn: '2028-01-01' }, 'restricted-financial', '2026-10-01').ok).toBe(false);
    expect(validateException({ ...base, fromClass: 'public' }, 'restricted-financial', '2026-10-01').ok).toBe(false);
    expect(validateException({ ...base, toClass: 'unknown' }, 'restricted-financial', '2026-10-01').ok).toBe(false);
  });
});

describe('fixture validation and export', () => {
  it('rejects malformed fields and oversize fixtures without throwing', () => {
    for (const bad of [null, [], { schemaVersion: 2 }, { schemaVersion: 1, asOf: '2026-02-30', fields: [] }, { schemaVersion: 1, label: 'x', asOf: '2026-10-01', fields: [null] }, { schemaVersion: 1, label: 'x', asOf: '2026-10-01', fields: [{ id: 'a', samples: 'x' }] }]) {
      let r: ReturnType<typeof validateFixture> | undefined;
      expect(() => { r = validateFixture(bad); }).not.toThrow();
      expect(r!.ok).toBe(false);
    }
    const many = { schemaVersion: 1, label: 'x', asOf: '2026-10-01', fields: Array.from({ length: 2001 }, (_, i) => f({ id: `f${i}` })) };
    expect(validateFixture(many).ok).toBe(false);
    const longSamples = { schemaVersion: 1, label: 'x', asOf: '2026-10-01', fields: [f({ samples: Array.from({ length: 51 }, () => 'x') })] };
    expect(validateFixture(longSamples).ok).toBe(false);
  });
  it('exports a stable catalog schema with formula-safe CSV', () => {
    const fx: Fixture = { schemaVersion: 1, label: 'unit', asOf: '2026-10-01', fields: [f({ id: 'f1', name: '=cmd', samples: ['=1+1'] })] };
    const out = exportCatalog(fx, effectiveLabels(fx, BUILT_IN_RULES), BUILT_IN_RULES);
    expect(out.json.schema).toBe('labelsmith.catalog/v1');
    expect(out.json.fields[0]!.effectiveClass).toBeDefined();
    expect(out.csv).toContain("'=cmd");
    expect(out.json.summary.byClass.unknown).toBe(1);
  });
});

describe('built-in rule set', () => {
  it('has at least 20 rules with unique ids covering all eight classes except unknown', () => {
    expect(BUILT_IN_RULES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BUILT_IN_RULES.map((r) => r.id)).size).toBe(BUILT_IN_RULES.length);
    const classes = new Set(BUILT_IN_RULES.map((r: Rule) => r.class));
    for (const c of ['public', 'internal', 'confidential', 'restricted-pii', 'restricted-financial', 'restricted-health', 'secret-credential']) expect(classes.has(c as never)).toBe(true);
  });
});

describe('sixth-Fable review follow-ups', () => {
  it('keeps a stricter declared class as the effective class (conservative) and says so, pending review', () => {
    const fx: Fixture = { schemaVersion: 1, label: 't', asOf: '2026-10-01', fields: [f({ id: 'st', name: 'status', samples: ['open', 'closed'], declaredClass: 'restricted-pii' })], exceptions: [] };
    const eff = effectiveLabels(fx, BUILT_IN_RULES)[0]!;
    expect(eff.computedClass).toBe('internal');
    expect(eff.effectiveClass).toBe('restricted-pii');
    expect(eff.policy.class).toBe('restricted-pii');
    expect(eff.classification.needsReview).toBe(true);
    expect(eff.classification.reviewReasons.join(' ')).toMatch(/kept as the effective class/);
  });
  it('a weaker declared class never lowers the effective class', () => {
    const fx: Fixture = { schemaVersion: 1, label: 't', asOf: '2026-10-01', fields: [f({ id: 'em', name: 'customer_email', samples: ['a@example.test'], declaredClass: 'internal' })], exceptions: [] };
    const eff = effectiveLabels(fx, BUILT_IN_RULES)[0]!;
    expect(eff.effectiveClass).toBe('restricted-pii');
  });
  it('documents known substring false positives so the behaviour is pinned, not hidden', () => {
    // These are heuristic name hits that a human must clear; they are listed in README "Known false positives".
    const c1 = classifyField(f({ name: 'tokenizer_version', samples: ['v2'] }), BUILT_IN_RULES, '2026-10-01');
    expect(c1.computedClass).toBe('secret-credential');
    const c2 = classifyField(f({ name: 'healthcheck_status', samples: ['ok'] }), BUILT_IN_RULES, '2026-10-01');
    expect(c2.computedClass).toBe('restricted-health');
    expect(exportCatalog({ schemaVersion: 1, label: 't', asOf: '2026-10-01', fields: [f({ name: 'tokenizer_version', samples: ['v2'] })] }, effectiveLabels({ schemaVersion: 1, label: 't', asOf: '2026-10-01', fields: [f({ name: 'tokenizer_version', samples: ['v2'] })] }, BUILT_IN_RULES), BUILT_IN_RULES).json.disclaimer).toMatch(/proposal/i);
  });
});
