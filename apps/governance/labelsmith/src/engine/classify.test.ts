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

describe('sixth-review follow-ups', () => {
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
  it('the substring false positives pinned in the sixth review are resolved by token-boundary matching (October 2026); the export keeps the proposal disclaimer', () => {
    // Formerly asserted secret-credential / restricted-health; see the "token-boundary matching" block below for the full table.
    const c1 = classifyField(f({ name: 'tokenizer_version', samples: ['v2'] }), BUILT_IN_RULES, '2026-10-01');
    expect(c1.computedClass).not.toBe('secret-credential');
    const c2 = classifyField(f({ name: 'healthcheck_status', samples: ['ok'] }), BUILT_IN_RULES, '2026-10-01');
    expect(c2.computedClass).not.toBe('restricted-health');
    expect(exportCatalog({ schemaVersion: 1, label: 't', asOf: '2026-10-01', fields: [f({ name: 'tokenizer_version', samples: ['v2'] })] }, effectiveLabels({ schemaVersion: 1, label: 't', asOf: '2026-10-01', fields: [f({ name: 'tokenizer_version', samples: ['v2'] })] }, BUILT_IN_RULES), BUILT_IN_RULES).json.disclaimer).toMatch(/proposal/i);
  });
});

describe('token-boundary matching and allow-lists (October 2026 upgrade round)', () => {
  const cls = (over: Partial<Field>) => classifyField(f(over), BUILT_IN_RULES, '2026-10-01');
  const matchedIds = (c: ReturnType<typeof classifyField>) => c.trace.filter((t) => t.outcome === 'matched').map((t) => t.ruleId);
  const outcomeOf = (c: ReturnType<typeof classifyField>, ruleId: string) => c.trace.find((t) => t.ruleId === ruleId)?.outcome;

  it('README false-positive table: tokenizer_version is operational metadata, not a credential', () => {
    const c = cls({ name: 'tokenizer_version', samples: ['v2', 'v3'] });
    expect(c.computedClass).not.toBe('secret-credential');
    expect(c.computedClass).toBe('internal');
  });
  it('README false-positive table: healthcheck_status (one token) and health_check_status (allow-listed check/status) are not health data', () => {
    expect(cls({ name: 'healthcheck_status', samples: ['ok'] }).computedClass).toBe('internal');
    const c = cls({ name: 'health_check_status', samples: ['ok', 'degraded'] });
    expect(c.computedClass).toBe('internal');
    expect(outcomeOf(c, 'name-health')).toBe('suppressed');
  });
  it('README false-positive table: expiry_warning_days is a setting, while expiry alone is still card data', () => {
    const c = cls({ name: 'expiry_warning_days', type: 'number', samples: ['30', '14'] });
    expect(c.computedClass).not.toBe('restricted-financial');
    expect(c.computedClass).toBe('unknown');
    expect(cls({ name: 'expiry', samples: ['03/28'] }).computedClass).toBe('restricted-financial');
  });
  it('README false-positive table: velocity and electricity_tariff do not contain the token city', () => {
    expect(cls({ name: 'velocity', type: 'number', samples: ['12.5'] }).computedClass).not.toBe('restricted-pii');
    expect(cls({ name: 'electricity_tariff', samples: ['E7'] }).computedClass).not.toBe('restricted-pii');
    expect(cls({ name: 'city', samples: ['Exampleton'] }).computedClass).toBe('restricted-pii');
  });
  it('README false-positive table: an md5 / git-SHA column under a non-credential name is Confidential via the hex-digest rule (and flagged for review), not a credential', () => {
    const md5 = cls({ name: 'content_md5', samples: ['d41d8cd98f00b204e9800998ecf8427e', '9e107d9d372bb6826bd81d3542a419d6'] });
    expect(md5.computedClass).toBe('confidential');
    expect(matchedIds(md5)).toEqual(['val-hex-digest']);
    expect(md5.needsReview).toBe(true);
    const sha = cls({ name: 'commit_sha', samples: ['2fd4e1c67a2d28fced849ee1bb76e7391b93eb12', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'] });
    expect(sha.computedClass).toBe('confidential');
    expect(sha.computedClass).not.toBe('secret-credential');
  });
  it('a hex digest under a credential name stays secret-credential with value corroboration; the digest rule steps aside', () => {
    const c = cls({ name: 'api_key', samples: ['2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'] });
    expect(c.computedClass).toBe('secret-credential');
    expect(matchedIds(c)).toContain('name-secret');
    expect(matchedIds(c)).toContain('val-hex-credential');
    expect(outcomeOf(c, 'val-hex-digest')).toBe('suppressed');
    expect(c.confidence).toBeGreaterThan(0.85);
  });
  it('matches multi-token rule tokens as a contiguous token sequence (card_number ⊂ card_number_last4) and splits camelCase', () => {
    expect(cls({ name: 'card_number_last4', samples: ['6467'] }).computedClass).toBe('restricted-financial');
    expect(cls({ name: 'cardNumberLast4', samples: ['6467'] }).computedClass).toBe('restricted-financial');
    expect(cls({ name: 'customerEmail', samples: [] }).computedClass).toBe('restricted-pii');
    expect(cls({ name: 'number_card', samples: [] }).computedClass).toBe('unknown'); // order matters: not a sequence match
  });
  it('whole-token matching: pan matches pan but not span or expand', () => {
    expect(cls({ name: 'pan', samples: [] }).computedClass).toBe('restricted-financial');
    expect(cls({ name: 'span', samples: [] }).computedClass).toBe('unknown');
    expect(cls({ name: 'expand_count', samples: [] }).computedClass).toBe('unknown');
  });
  it('allow-list tokens mark metadata about a sensitive thing: sensitive name evidence is discounted, Internal/Public evidence is not', () => {
    expect(cls({ name: 'token_count', type: 'number', samples: ['3'] }).computedClass).not.toBe('secret-credential');
    expect(cls({ name: 'email_verified', type: 'boolean', samples: ['true'] }).computedClass).not.toBe('restricted-pii');
    expect(cls({ name: 'card_number_status', samples: ['active'] }).computedClass).toBe('internal');
    expect(cls({ name: 'status', samples: ['open'] }).computedClass).toBe('internal');
    expect(cls({ name: 'invoice_total', type: 'number', samples: ['12.50'] }).computedClass).toBe('confidential');
  });
  it('per-rule exceptTokens veto the rule: ip_address is a network identifier (Confidential), not a postal address', () => {
    const c = cls({ name: 'ip_address', samples: ['10.0.0.7', '10.0.0.8'] });
    expect(c.computedClass).toBe('confidential');
    expect(outcomeOf(c, 'name-address')).toBe('suppressed');
    expect(cls({ name: 'home_address', samples: ['1 Fixture Street'] }).computedClass).toBe('restricted-pii');
  });
  it('timestamp columns are not birth dates: val-dob is vetoed by created/updated tokens, real birth dates still match', () => {
    const c = cls({ name: 'created_at', type: 'date', samples: ['2024-05-01', '2026-01-01'] });
    expect(c.computedClass).toBe('internal');
    expect(outcomeOf(c, 'val-dob')).toBe('suppressed');
    expect(cls({ name: 'date_of_birth', type: 'date', samples: ['1988-04-12'] }).computedClass).toBe('restricted-pii');
  });
  it('the password stem rule is the one justified substring built-in: glued names are caught, metadata about passwords is not', () => {
    expect(cls({ name: 'userpassword', samples: [] }).computedClass).toBe('secret-credential');
    expect(cls({ name: 'password_hash', samples: [] }).computedClass).toBe('secret-credential');
    expect(cls({ name: 'password_policy', samples: ['strong'] }).computedClass).not.toBe('secret-credential');
    expect(BUILT_IN_RULES.filter((r) => r.match === 'substring').map((r) => r.id)).toEqual(['name-password']);
  });
  it('addKeywordRule defaults to whole-token matching and can opt into substring matching; other modes are rejected', () => {
    const tok = addKeywordRule(BUILT_IN_RULES, { id: 'kw-t', name: 'Codename', tokens: ['codename'], class: 'confidential', weight: 0.7 });
    const sub = addKeywordRule(BUILT_IN_RULES, { id: 'kw-s', name: 'Codename', tokens: ['codename'], class: 'confidential', weight: 0.7, match: 'substring' });
    expect(tok.ok && sub.ok).toBe(true);
    if (!tok.ok || !sub.ok) return;
    expect(tok.rules.at(-1)!.match).toBe('token');
    expect(classifyField(f({ name: 'projectcodename', samples: [] }), tok.rules, '2026-10-01').computedClass).toBe('unknown');
    expect(classifyField(f({ name: 'projectcodename', samples: [] }), sub.rules, '2026-10-01').computedClass).toBe('confidential');
    expect(classifyField(f({ name: 'project_codename', samples: [] }), tok.rules, '2026-10-01').computedClass).toBe('confidential');
    expect(addKeywordRule(BUILT_IN_RULES, { id: 'kw-x', name: 'x', tokens: ['abc'], class: 'internal', weight: 0.5, match: 'regex' as never }).ok).toBe(false);
  });
  it('export records the match mode per rule (additive field, schema id unchanged)', () => {
    const fx: Fixture = { schemaVersion: 1, label: 'unit', asOf: '2026-10-01', fields: [f({ id: 'f1', name: 'tokenizer_version', samples: ['v2'] })] };
    const out = exportCatalog(fx, effectiveLabels(fx, BUILT_IN_RULES), BUILT_IN_RULES);
    expect(out.json.schema).toBe('labelsmith.catalog/v1');
    expect(out.json.ruleSet.find((r) => r.id === 'name-secret')?.match).toBe('token');
    expect(out.json.ruleSet.find((r) => r.id === 'name-password')?.match).toBe('substring');
    expect(out.json.fields[0]!.computedClass).toBe('internal');
  });
  it('is deterministic across the new matcher (suppression traces included)', () => {
    const field = f({ name: 'health_check_status', samples: ['ok', 'degraded'] });
    expect(classifyField(field, BUILT_IN_RULES, '2026-10-01')).toEqual(classifyField(field, BUILT_IN_RULES, '2026-10-01'));
    const fx = (): Fixture => ({ schemaVersion: 1, label: 'd', asOf: '2026-10-01', fields: [field, f({ id: 'f2', name: 'content_md5', samples: ['d41d8cd98f00b204e9800998ecf8427e'] })] });
    expect(effectiveLabels(fx(), BUILT_IN_RULES)).toEqual(effectiveLabels(fx(), BUILT_IN_RULES));
  });
});
