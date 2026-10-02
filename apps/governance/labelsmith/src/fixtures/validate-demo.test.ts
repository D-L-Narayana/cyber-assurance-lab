import { describe, expect, it } from 'vitest';
import demo from './demo.json';
import { BUILT_IN_RULES, effectiveLabels, validateFixture } from '../engine/classify';

describe('demo fixture', () => {
  it('validates and exhibits every designed scenario', () => {
    const v = validateFixture(demo);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const labels = effectiveLabels(v.fixture, BUILT_IN_RULES);
    const by = (name: string) => labels.find((l) => v.fixture.fields.find((f) => f.id === l.fieldId)!.name === name)!;
    expect(by('card_number').computedClass).toBe('restricted-financial');
    expect(by('card_number').exception?.status).toBe('active');
    expect(by('card_number').effectiveClass).toBe('confidential');
    expect(by('cardholder_reference').computedClass).not.toBe('restricted-financial');
    expect(by('email').classification.declaredMismatch).toEqual({ declared: 'internal', computed: 'restricted-pii' });
    expect(by('vendor_api_key').computedClass).toBe('secret-credential');
    const keySamples = v.fixture.fields.find((field) => field.name === 'vendor_api_key')!.samples;
    expect(keySamples.every((sample) => sample.startsWith('DEMO_ONLY_NOT_A_SECRET_'))).toBe(true);
    expect(by('vendor_api_key').classification.trace.find((item) => item.ruleId === 'val-apikey')!.outcome).toBe('matched');
    expect(by('password_hash').computedClass).toBe('secret-credential');
    expect(by('diagnosis_code').computedClass).toBe('restricted-health');
    expect(by('iban').computedClass).toBe('restricted-financial');
    expect(by('preferred_locale').computedClass).toBe('unknown');
    expect(by('national_id').exception?.status).toBe('expired');
    expect(by('national_id').effectiveClass).toBe('restricted-pii');
    expect(by('product_name').computedClass).toBe('public');
    expect(labels.filter((l) => l.computedClass === 'unknown').length).toBeGreaterThanOrEqual(2);
  });
});
