import { describe, expect, it } from 'vitest';
import { ALLOW_TOKENS, BUILT_IN_RULES, checkValue, classifyField, normaliseName, tokensOf } from './classify';
import type { Field, Rule } from './types';

const f = (over: Partial<Field>): Field => ({ id: 'f1', system: 's', table: 't', name: 'col', type: 'string', samples: [], ...over });
const AS_OF = '2026-10-01';

describe('field-name tokenisation', () => {
  it('lower-cases, splits camelCase humps, acronym runs and letter→digit boundaries, and collapses separators', () => {
    expect(normaliseName('customerEmail')).toBe('customer_email');
    expect(normaliseName('Customer-Email')).toBe('customer_email');
    expect(normaliseName('cardNumberLast4')).toBe('card_number_last_4');
    expect(normaliseName('HTTPServerIP')).toBe('http_server_ip');
    expect(normaliseName('  SSN  ')).toBe('ssn');
    expect(normaliseName('content_md5')).toBe('content_md_5');
    expect(normaliseName('__weird__name__')).toBe('weird_name');
    expect(tokensOf(normaliseName('card_number_last4'))).toEqual(['card', 'number', 'last', '4']);
    expect(tokensOf('')).toEqual([]);
  });
  it('ALLOW_TOKENS holds only metadata modifiers, never nouns that carry sensitivity themselves', () => {
    for (const t of ['version', 'status', 'count', 'days', 'warning', 'check', 'verified', 'enabled', 'policy']) expect(ALLOW_TOKENS.has(t)).toBe(true);
    // Deliberately absent: `at` (salary_at_hire would lose its evidence), `type` (blood_type), `last` (card_number_last4),
    // `pct`/`score`/`max` (margin_pct, credit_score, salary_max are the data, not metadata about it).
    for (const t of ['type', 'date', 'name', 'hash', 'id', 'number', 'notes', 'last', 'reset', 'token', 'email', 'total', 'at', 'pct', 'score', 'max']) expect(ALLOW_TOKENS.has(t)).toBe(false);
  });
});

describe('exceptTokens and match modes on hand-built rules', () => {
  const base: Omit<Rule, 'nameTokens'> = { id: 'r', name: 'r', class: 'confidential', weight: 0.7, explanation: '' };
  const outcome = (r: Rule, name: string) => classifyField(f({ name }), [r], AS_OF).trace[0]!;

  it('exceptTokens veto the whole rule when the token or token sequence appears anywhere in the name', () => {
    const r: Rule = { ...base, nameTokens: ['health'], exceptTokens: ['health_check'] };
    expect(outcome(r, 'health_check_status').outcome).toBe('suppressed');
    expect(outcome(r, 'health_check_status').reason).toMatch(/health_check/);
    expect(outcome(r, 'health_record').outcome).toBe('matched');
    expect(outcome(r, 'healthcheck').outcome).toBe('not-matched');
  });
  it('token mode needs whole tokens or a contiguous sequence; substring mode keeps the legacy behaviour including the ≤3-char whole-token guard', () => {
    const tok: Rule = { ...base, nameTokens: ['card_number', 'pan'] };
    const sub: Rule = { ...base, nameTokens: ['card_number', 'pan'], match: 'substring' };
    expect(outcome(tok, 'card_number_last4').outcome).toBe('matched');
    expect(outcome(tok, 'card_number_last4').reason).toMatch(/card_number/);
    expect(outcome(tok, 'cardnumber').outcome).toBe('not-matched');
    expect(outcome(sub, 'cardnumber').outcome).toBe('not-matched'); // 'card_number' is not a substring of 'cardnumber'
    expect(outcome(sub, 'xcard_numberx').outcome).toBe('matched');
    expect(outcome(tok, 'xcard_numberx').outcome).toBe('not-matched');
    expect(outcome(sub, 'span').outcome).toBe('not-matched');
    expect(outcome(tok, 'span').outcome).toBe('not-matched');
    expect(outcome(tok, 'pan').outcome).toBe('matched');
  });
  it('allow-list discounting applies only to token-mode matches of Confidential-and-above rules, never to restricted-health', () => {
    const tok: Rule = { ...base, nameTokens: ['codename'] };
    const sub: Rule = { ...base, nameTokens: ['codename'], match: 'substring' };
    const low: Rule = { ...base, class: 'internal', nameTokens: ['codename'] };
    const health: Rule = { ...base, class: 'restricted-health', nameTokens: ['codename'] };
    expect(outcome(tok, 'codename_version').outcome).toBe('suppressed');
    expect(outcome(tok, 'codename_version').reason).toMatch(/version/);
    expect(outcome(sub, 'codename_version').outcome).toBe('matched');
    expect(outcome(low, 'codename_version').outcome).toBe('matched');
    expect(outcome(health, 'codename_version').outcome).toBe('matched'); // allergy_count / diagnosis_verified are still health data
    expect(outcome(tok, 'codename').outcome).toBe('matched');
  });
  it('a value check still counts when the name evidence was discounted (values are evidence regardless of the name)', () => {
    const r: Rule = { ...base, nameTokens: ['email'], valueCheck: 'email' };
    const c = classifyField(f({ name: 'email_verified', samples: ['a@example.test', 'b@example.test'] }), [r], AS_OF);
    expect(c.trace[0]!.outcome).toBe('matched');
    expect(c.trace[0]!.reason).toMatch(/discounted/);
  });
});

describe('hex digest value check', () => {
  it('accepts 32–64 hex characters only, and the api-key shape no longer accepts bare hex', () => {
    expect(checkValue('hex-digest', 'd41d8cd98f00b204e9800998ecf8427e')).toBe(true);
    expect(checkValue('hex-digest', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12')).toBe(true);
    expect(checkValue('hex-digest', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true);
    expect(checkValue('hex-digest', 'd41d8cd98f00b204e9800998ecf8427')).toBe(false); // 31 chars
    expect(checkValue('hex-digest', '550e8400-e29b-41d4-a716-446655440000')).toBe(false); // dashed UUID
    expect(checkValue('apikey', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12')).toBe(false);
    expect(checkValue('apikey', 'DEMO_ONLY_NOT_A_SECRET_A1b2C3d4E5f6')).toBe(true);
  });
  it('a dotted-quad IP is not a phone number (the demo IP columns were PII-ranked through the phone shape before this round)', () => {
    expect(checkValue('phone', '10.0.0.7')).toBe(false);
    expect(checkValue('phone', '192.168.200.254')).toBe(false);
    expect(checkValue('phone', '555.123.4567')).toBe(true); // dotted phone notation still counts: it is not four octets
    const c = classifyField(f({ name: 'remote_addr', samples: ['192.168.4.20', '192.168.9.7'] }), BUILT_IN_RULES, AS_OF);
    expect(c.computedClass).toBe('confidential');
    expect(c.trace.find((t) => t.ruleId === 'val-phone')!.outcome).toBe('not-matched');
  });
  it('val-hex-digest is Confidential at weight 0.5, so on its own it always lands below the review threshold', () => {
    const r = BUILT_IN_RULES.find((x) => x.id === 'val-hex-digest')!;
    expect(r.class).toBe('confidential');
    expect(r.weight).toBe(0.5);
    expect(r.valueCheck).toBe('hex-digest');
    expect(r.exceptTokens).toContain('api_key');
  });
});
