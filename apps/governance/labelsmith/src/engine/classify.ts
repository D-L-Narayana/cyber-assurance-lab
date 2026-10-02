/**
 * Labelsmith core engine: rule-based data classification with an explicit precedence model,
 * an explainable per-rule trace, an "unknown" bucket, handling policies per class and
 * time-boxed downgrade exceptions. Deterministic, side-effect free, no network.
 *
 * Classification is a *proposal*. It never claims legal or regulatory classification.
 */
import { CLASS_RANK } from './types';
import type {
  Classification, DataClass, EffectiveLabel, Exception, Field, Fixture, HandlingPolicy, Rule, RuleTrace, ValueCheck,
} from './types';
import { isIsoDate, toCsv } from './safe';

export const LIMITS = { fields: 2000, samplesPerField: 50, sampleLength: 200, exceptions: 500 };
export const REVIEW_THRESHOLD = 0.6;

export const ALL_CLASSES: DataClass[] = ['public', 'internal', 'confidential', 'restricted-pii', 'restricted-financial', 'restricted-health', 'secret-credential', 'unknown'];

/* ----------------------------- value checks ----------------------------- */

function luhn(s: string): boolean {
  const d = s.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function iban(s: string): boolean {
  const t = s.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t)) return false;
  const r = t.slice(4) + t.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const dch of v) rem = (rem * 10 + Number(dch)) % 97;
  }
  return rem === 1;
}

function entropyish(s: string): boolean {
  // high-variety token: at least 24 chars, mixes digit + letter, no spaces
  if (s.length < 24 || /\s/.test(s)) return false;
  return /\d/.test(s) && /[a-zA-Z]/.test(s) && new Set(s).size >= 12;
}

/** All patterns are anchored and linear-time (no nested quantifiers) to avoid catastrophic backtracking. */
export function checkValue(check: ValueCheck, raw: string, asOf = '2026-10-01'): boolean {
  const v = raw.trim();
  if (v.length === 0 || v.length > LIMITS.sampleLength) return false;
  switch (check) {
    case 'luhn': return luhn(v);
    case 'iban': return iban(v);
    case 'email': return /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}$/.test(v);
    case 'phone': { const d = v.replace(/\D/g, '').length; return /^\+?[0-9][0-9 ().-]{6,18}[0-9]$/.test(v) && d >= 8 && d <= 15; }
    case 'ipv4': return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((o) => Number(o) <= 255);
    case 'jwt': return /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/.test(v);
    case 'apikey': return /^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}$/.test(v) || /^(?:AKIA|ghp_|gho_|xoxb-|glpat-)[A-Za-z0-9_-]{8,}$/.test(v) || (/^[A-Fa-f0-9]{32,64}$/.test(v)) || entropyish(v);
    case 'password-hash': return /^\$(?:2[aby]|argon2(?:id|i|d)|5|6)\$[^\s]{20,}$/.test(v);
    case 'dob': {
      if (!isIsoDate(v)) return false;
      const years = (Date.parse(asOf) - Date.parse(v)) / (365.25 * 86_400_000);
      return years >= 0 && years <= 120;
    }
    case 'icd10': return /^[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/.test(v);
    case 'national-id': return /^\d{3}-\d{2}-\d{4}$/.test(v) || /^[A-Z]{2}\d{6}[A-Z]$/.test(v) || /^\d{4} \d{4} \d{4}$/.test(v);
    case 'geo': {
      const m = /^(-?\d{1,2}(?:\.\d{1,8})?),\s?(-?\d{1,3}(?:\.\d{1,8})?)$/.exec(v);
      return !!m && Math.abs(Number(m[1])) <= 90 && Math.abs(Number(m[2])) <= 180;
    }
    case 'money': return /^-?(?:[A-Z]{3} ?|[$€£₹])?\d{1,12}(?:[.,]\d{1,2})?$/.test(v);
  }
}

/* ----------------------------- built-in rules ----------------------------- */

const rule = (r: Omit<Rule, 'builtIn'>): Rule => ({ ...r, builtIn: true });

/** Precedence = array order for trace display; the winner is the highest CLASS_RANK among matched rules, then highest weight. */
export const BUILT_IN_RULES: Rule[] = [
  rule({ id: 'name-secret', name: 'Secret / credential field name', nameTokens: ['password', 'passwd', 'secret', 'api_key', 'apikey', 'token', 'private_key', 'client_secret'], class: 'secret-credential', weight: 0.85, explanation: 'Field names that conventionally hold authentication material.' }),
  rule({ id: 'val-apikey', name: 'API key / access token shape', valueCheck: 'apikey', class: 'secret-credential', weight: 0.8, explanation: 'Samples look like vendor-prefixed keys or long high-variety tokens.' }),
  rule({ id: 'val-jwt', name: 'JSON Web Token shape', valueCheck: 'jwt', class: 'secret-credential', weight: 0.9, explanation: 'Three base64url segments separated by dots.' }),
  rule({ id: 'val-password-hash', name: 'Password hash shape', valueCheck: 'password-hash', class: 'secret-credential', weight: 0.9, explanation: 'bcrypt / argon2 / SHA-crypt style hash prefix.' }),
  rule({ id: 'name-health', name: 'Health field name', nameTokens: ['diagnosis', 'icd', 'medical', 'prescription', 'allergy', 'blood', 'health'], class: 'restricted-health', weight: 0.8, explanation: 'Names that indicate health or medical content.' }),
  rule({ id: 'val-icd10', name: 'ICD-10-like code', valueCheck: 'icd10', minSampleRatio: 0.7, class: 'restricted-health', weight: 0.75, explanation: 'Samples match the letter-digit-digit(.suffix) diagnosis code shape.' }),
  rule({ id: 'name-card', name: 'Payment card field name', nameTokens: ['card_number', 'cardnumber', 'card_no', 'pan', 'cvv', 'cvc', 'expiry'], class: 'restricted-financial', weight: 0.8, explanation: 'Names used for primary account numbers and card security data.' }),
  rule({ id: 'val-card-luhn', name: 'Card number passes Luhn', valueCheck: 'luhn', minSampleRatio: 0.6, class: 'restricted-financial', weight: 0.85, explanation: '13–19 digit samples with a valid Luhn check digit.' }),
  rule({ id: 'name-bank', name: 'Bank account field name', nameTokens: ['iban', 'account_number', 'account_no', 'routing', 'sort_code', 'swift', 'bic'], class: 'restricted-financial', weight: 0.75, explanation: 'Bank account identifiers.' }),
  rule({ id: 'val-iban', name: 'IBAN passes mod-97', valueCheck: 'iban', minSampleRatio: 0.6, class: 'restricted-financial', weight: 0.9, explanation: 'Samples are valid IBANs.' }),
  rule({ id: 'name-pay', name: 'Compensation field name', nameTokens: ['salary', 'compensation', 'wage', 'bonus', 'payroll'], class: 'restricted-financial', weight: 0.7, explanation: 'Individual compensation data.' }),
  rule({ id: 'name-national-id', name: 'Government identifier name', nameTokens: ['ssn', 'national_id', 'nationalid', 'passport', 'aadhaar', 'tax_id', 'nino', 'pan_number'], class: 'restricted-pii', weight: 0.85, explanation: 'Government-issued identifiers.' }),
  rule({ id: 'val-national-id', name: 'Government identifier shape', valueCheck: 'national-id', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.7, explanation: 'Samples match common national-id formats (synthetic patterns).' }),
  rule({ id: 'name-dob', name: 'Date of birth name', nameTokens: ['dob', 'birth', 'birthdate'], class: 'restricted-pii', weight: 0.8, explanation: 'Birth dates are direct identifiers when combined with name.' }),
  rule({ id: 'val-dob', name: 'Plausible birth date values', valueCheck: 'dob', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.35, explanation: 'ISO dates 0–120 years before the as-of date (weak evidence alone).' }),
  rule({ id: 'name-email', name: 'Email field name', nameTokens: ['email', 'e_mail', 'mail_address'], class: 'restricted-pii', weight: 0.7, explanation: 'Email addresses identify a person.' }),
  rule({ id: 'val-email', name: 'Email address shape', valueCheck: 'email', class: 'restricted-pii', weight: 0.75, explanation: 'Samples look like email addresses.' }),
  rule({ id: 'name-person', name: 'Person name field', nameTokens: ['first_name', 'last_name', 'full_name', 'surname', 'given_name', 'firstname', 'lastname'], class: 'restricted-pii', weight: 0.7, explanation: 'Personal names.' }),
  rule({ id: 'name-phone', name: 'Phone field name', nameTokens: ['phone', 'mobile', 'msisdn', 'telephone'], class: 'restricted-pii', weight: 0.65, explanation: 'Phone numbers.' }),
  rule({ id: 'val-phone', name: 'Phone number shape', valueCheck: 'phone', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.5, explanation: 'Samples look like dialable numbers.' }),
  rule({ id: 'name-address', name: 'Postal address field', nameTokens: ['address', 'street', 'postcode', 'zip', 'city'], class: 'restricted-pii', weight: 0.55, explanation: 'Postal address components.' }),
  rule({ id: 'val-geo', name: 'Geo coordinate pair', valueCheck: 'geo', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.6, explanation: 'Latitude/longitude pairs can locate a person.' }),
  rule({ id: 'name-ip', name: 'IP address field', nameTokens: ['ip_address', 'ipaddr', 'client_ip', 'remote_addr'], class: 'confidential', weight: 0.6, explanation: 'Network identifiers; treated as confidential, PII in some jurisdictions.' }),
  rule({ id: 'val-ipv4', name: 'IPv4 shape', valueCheck: 'ipv4', minSampleRatio: 0.7, class: 'confidential', weight: 0.6, explanation: 'Samples are dotted-quad addresses.' }),
  rule({ id: 'name-finance-agg', name: 'Business financial field', nameTokens: ['revenue', 'invoice_total', 'margin', 'forecast', 'budget'], class: 'confidential', weight: 0.6, explanation: 'Non-public business financials.' }),
  rule({ id: 'name-internal', name: 'Operational metadata', nameTokens: ['created_at', 'updated_at', 'status', 'version', 'notes', 'owner_team'], class: 'internal', weight: 0.5, explanation: 'Internal operational fields.' }),
  rule({ id: 'name-public', name: 'Catalogue / marketing field', nameTokens: ['product_name', 'sku', 'category', 'public_description', 'press_release'], class: 'public', weight: 0.6, explanation: 'Information already published or intended for publication.' }),
];

const RESERVED_TOKEN_CHARS = /[\\^$.*+?()[\]{}|/]/;

export type AddRuleResult = { ok: true; rules: Rule[] } | { ok: false; error: string };

/** Add a user-defined substring rule. Tokens are plain lower-case substrings — never compiled into a RegExp. */
export function addKeywordRule(rules: Rule[], input: { id: string; name: string; tokens: string[]; class: DataClass; weight: number }): AddRuleResult {
  const tokens = input.tokens.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!input.id.trim() || input.id.length > 40) return { ok: false, error: 'Rule id is required (max 40 chars).' };
  if (rules.some((r) => r.id === input.id)) return { ok: false, error: `Rule id ${input.id} already exists.` };
  if (tokens.length === 0) return { ok: false, error: 'Add at least one keyword.' };
  if (tokens.some((t) => t.length < 2 || t.length > 40)) return { ok: false, error: 'Keywords must be 2–40 characters.' };
  if (tokens.some((t) => RESERVED_TOKEN_CHARS.test(t))) return { ok: false, error: 'Keywords are plain text; regex characters are not allowed.' };
  if (!ALL_CLASSES.includes(input.class) || input.class === 'unknown') return { ok: false, error: 'Choose a concrete class (not unknown).' };
  if (!(input.weight > 0 && input.weight <= 1)) return { ok: false, error: 'Weight must be between 0 and 1.' };
  return { ok: true, rules: [...rules, { id: input.id.trim(), name: input.name.trim() || input.id, nameTokens: tokens, class: input.class, weight: input.weight, explanation: 'User-defined keyword rule.' }] };
}

/* ----------------------------- classification ----------------------------- */

/** Which value checks can apply to each declared field type; others are skipped (and say so in the trace). */
const APPLICABLE: Record<Field['type'], Set<ValueCheck>> = {
  string: new Set<ValueCheck>(['luhn', 'email', 'iban', 'phone', 'dob', 'apikey', 'jwt', 'ipv4', 'national-id', 'icd10', 'password-hash', 'geo', 'money']),
  number: new Set<ValueCheck>(['luhn', 'phone', 'money', 'national-id']),
  date: new Set<ValueCheck>(['dob']),
  boolean: new Set<ValueCheck>(),
};

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function nameMatches(norm: string, tokens: string[]): string | null {
  const padded = `_${norm}_`;
  for (const t of tokens) {
    const tn = t.replace(/[^a-z0-9]+/g, '_');
    // whole-token match on short tokens (<=3 chars like 'pan', 'dob', 'ip') to avoid 'span' hitting 'pan'
    if (tn.length <= 3 ? padded.includes(`_${tn}_`) : norm.includes(tn)) return t;
  }
  return null;
}

export function classifyField(field: Field, rules: Rule[], asOf: string): Classification {
  const norm = normaliseName(field.name);
  const samples = field.samples.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, LIMITS.samplesPerField);
  const trace: RuleTrace[] = [];
  for (const r of rules) {
    let nameHit: string | null = null;
    let valueRatio: number | null = null;
    if (r.nameTokens) nameHit = nameMatches(norm, r.nameTokens);
    if (r.valueCheck) {
      if (samples.length === 0) {
        if (!r.nameTokens) { trace.push({ ruleId: r.id, name: r.name, class: r.class, weight: r.weight, outcome: 'skipped', reason: 'no samples to test' }); continue; }
      } else if (!APPLICABLE[field.type].has(r.valueCheck)) {
        trace.push({ ruleId: r.id, name: r.name, class: r.class, weight: r.weight, outcome: 'skipped', reason: `value check does not apply to ${field.type} type` }); continue;
      } else {
        const hits = samples.filter((s) => checkValue(r.valueCheck!, s, asOf)).length;
        valueRatio = hits / samples.length;
      }
    }
    const needRatio = r.minSampleRatio ?? 0.6;
    const valueHit = valueRatio !== null && valueRatio >= needRatio;
    let matched: boolean;
    if (r.nameTokens && r.valueCheck) matched = (r.combine ?? 'any') === 'all' ? !!nameHit && valueHit : !!nameHit || valueHit;
    else if (r.nameTokens) matched = !!nameHit;
    else matched = valueHit;
    const parts: string[] = [];
    if (r.nameTokens) parts.push(nameHit ? `name contains “${nameHit}”` : 'name has none of the keywords');
    if (r.valueCheck && valueRatio !== null) {
      const hits = Math.round(valueRatio * samples.length);
      parts.push(`${hits}/${samples.length} samples (${Math.round(valueRatio * 100)}%) match; need ${Math.round(needRatio * 100)}%`);
    }
    trace.push({ ruleId: r.id, name: r.name, class: r.class, weight: r.weight, outcome: matched ? 'matched' : 'not-matched', reason: parts.join('; ') });
  }
  const matched = trace.filter((t) => t.outcome === 'matched');
  const reviewReasons: string[] = [];
  let computedClass: DataClass;
  let confidence: number;
  if (matched.length === 0) {
    if (field.declaredClass && field.declaredClass !== 'unknown') {
      computedClass = field.declaredClass; confidence = 0.5;
      reviewReasons.push(`No rule matched; using the declared class “${field.declaredClass}” provisionally.`);
    } else {
      computedClass = 'unknown'; confidence = 0;
      reviewReasons.push('No rule matched and no declared class; a human must label this field.');
    }
  } else {
    const top = Math.max(...matched.map((m) => CLASS_RANK[m.class]));
    const winners = matched.filter((m) => CLASS_RANK[m.class] === top).sort((a, b) => b.weight - a.weight);
    // When several classes share the top rank (e.g. PII vs financial), the heaviest rule decides.
    computedClass = winners[0]!.class;
    const supporting = matched.filter((m) => m.class === computedClass);
    confidence = Math.round((1 - supporting.reduce((p, m) => p * (1 - m.weight), 1)) * 100) / 100;
    if (confidence < REVIEW_THRESHOLD) reviewReasons.push(`Confidence ${confidence} is below the ${REVIEW_THRESHOLD} review threshold.`);
    const distinctTop = new Set(winners.map((w) => w.class));
    if (distinctTop.size > 1) reviewReasons.push(`Rules disagree at the same sensitivity rank (${[...distinctTop].join(', ')}); heaviest rule chosen.`);
  }
  let declaredMismatch: Classification['declaredMismatch'] = null;
  if (field.declaredClass && field.declaredClass !== computedClass && matched.length > 0) {
    declaredMismatch = { declared: field.declaredClass, computed: computedClass };
    if (CLASS_RANK[field.declaredClass] < CLASS_RANK[computedClass]) reviewReasons.push(`Declared “${field.declaredClass}” is less strict than computed “${computedClass}”.`);
    else reviewReasons.push(`Declared “${field.declaredClass}” is stricter than computed “${computedClass}”; the declared class is kept as the effective class and drives the handling policy until a reviewer confirms the downgrade.`);
  }
  return { fieldId: field.id, computedClass, confidence, trace, needsReview: reviewReasons.length > 0, reviewReasons, declaredMismatch };
}

/* ----------------------------- handling policy ----------------------------- */

const POLICIES: Record<DataClass, HandlingPolicy> = {
  public: { class: 'public', summary: 'May be published. Integrity matters more than confidentiality.', encryptionAtRest: 'not-required', maskInLogs: false, maskInUi: false, externalSharing: 'allowed', retentionMaxMonths: null, accessReviewDays: null, approvedStores: ['any approved store'] },
  internal: { class: 'internal', summary: 'For staff and contractors. Do not post publicly.', encryptionAtRest: 'recommended', maskInLogs: false, maskInUi: false, externalSharing: 'with-agreement', retentionMaxMonths: 84, accessReviewDays: 365, approvedStores: ['warehouse', 'wiki', 'ticketing'] },
  confidential: { class: 'confidential', summary: 'Need-to-know business data. Share outside only under an agreement.', encryptionAtRest: 'required', maskInLogs: true, maskInUi: false, externalSharing: 'with-agreement', retentionMaxMonths: 84, accessReviewDays: 180, approvedStores: ['warehouse', 'erp'] },
  'restricted-pii': { class: 'restricted-pii', summary: 'Identifies a person. Minimise, mask, encrypt, review access quarterly.', encryptionAtRest: 'required', maskInLogs: true, maskInUi: true, externalSharing: 'with-agreement', retentionMaxMonths: 36, accessReviewDays: 90, approvedStores: ['crm', 'hris', 'warehouse (pseudonymised)'] },
  'restricted-financial': { class: 'restricted-financial', summary: 'Payment and account data. Tokenise where possible; never in logs.', encryptionAtRest: 'required', maskInLogs: true, maskInUi: true, externalSharing: 'with-agreement', retentionMaxMonths: 24, accessReviewDays: 90, approvedStores: ['payments vault', 'erp'] },
  'restricted-health': { class: 'restricted-health', summary: 'Health data. Strictest access; explicit purpose required.', encryptionAtRest: 'required', maskInLogs: true, maskInUi: true, externalSharing: 'prohibited', retentionMaxMonths: 24, accessReviewDays: 90, approvedStores: ['health records system'] },
  'secret-credential': { class: 'secret-credential', summary: 'Authentication material. Belongs in a secrets manager, never in a data table.', encryptionAtRest: 'required', maskInLogs: true, maskInUi: true, externalSharing: 'prohibited', retentionMaxMonths: 12, accessReviewDays: 30, approvedStores: ['secrets manager only'] },
  unknown: { class: 'unknown', summary: 'Unclassified: treat as confidential until a human review assigns a class.', encryptionAtRest: 'required', maskInLogs: true, maskInUi: false, externalSharing: 'prohibited', retentionMaxMonths: null, accessReviewDays: null, approvedStores: [] },
};

export function policyFor(c: DataClass): HandlingPolicy { return POLICIES[c]; }

/* ----------------------------- exceptions ----------------------------- */

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validateException(x: Exception, computedClass: DataClass, asOf: string): Validation<Exception> {
  const errors: string[] = [];
  if (!x.id?.trim()) errors.push('Exception id is required.');
  if (!ALL_CLASSES.includes(x.fromClass) || !ALL_CLASSES.includes(x.toClass)) errors.push('Classes must be known classes.');
  else {
    if (x.toClass === 'unknown') errors.push('Cannot downgrade to unknown.');
    if (x.fromClass !== computedClass) errors.push(`fromClass must equal the computed class (${computedClass}).`);
    if (CLASS_RANK[x.toClass] >= CLASS_RANK[x.fromClass]) errors.push('Exceptions may only downgrade; to upgrade, change the declared class instead.');
  }
  if ((x.justification ?? '').trim().length < 20) errors.push('Justification must be at least 20 characters.');
  if (!x.approvedBy?.trim()) errors.push('approvedBy is required.');
  if (!isIsoDate(x.grantedOn) || !isIsoDate(x.expiresOn)) errors.push('grantedOn and expiresOn must be ISO dates.');
  else {
    const span = (Date.parse(x.expiresOn) - Date.parse(asOf)) / 86_400_000;
    if (span <= 0) errors.push('expiresOn must be after the as-of date.');
    if (span > 365) errors.push('Exceptions may last at most 365 days from the as-of date.');
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: x };
}

export function effectiveLabels(fixture: Fixture, rules: Rule[]): EffectiveLabel[] {
  return fixture.fields.map((field) => {
    const classification = classifyField(field, rules, fixture.asOf);
    const computedClass = classification.computedClass;
    // Conservative rule: a declared class stricter than the computed one wins until reviewed (never the other way round).
    const declaredStricter = !!field.declaredClass && field.declaredClass !== 'unknown' && CLASS_RANK[field.declaredClass] > CLASS_RANK[computedClass];
    const baseClass: DataClass = declaredStricter ? field.declaredClass! : computedClass;
    const x = (fixture.exceptions ?? []).find((e) => e.fieldId === field.id && e.fromClass === baseClass) ?? null;
    let exception: EffectiveLabel['exception'] = null;
    let effectiveClass = baseClass;
    if (x) {
      const expired = Date.parse(x.expiresOn) < Date.parse(fixture.asOf);
      exception = { ...x, status: expired ? 'expired' : 'active' };
      if (!expired) effectiveClass = x.toClass;
    }
    return { fieldId: field.id, computedClass, effectiveClass, exception, policy: POLICIES[effectiveClass], classification };
  });
}

/* ----------------------------- fixture validation ----------------------------- */

export type FixtureValidation = { ok: true; fixture: Fixture } | { ok: false; errors: string[] };

export function validateFixture(input: unknown): FixtureValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Fixture must be a JSON object.'] };
  const f = input as Record<string, unknown>;
  if (f.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof f.label !== 'string') errors.push('label must be a string.');
  if (!isIsoDate(f.asOf)) errors.push('asOf must be a valid ISO date.');
  const isRow = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!Array.isArray(f.fields)) errors.push('fields must be an array.');
  else if (f.fields.length > LIMITS.fields) errors.push(`fields has ${f.fields.length} rows; limit is ${LIMITS.fields}.`);
  else {
    const ids = new Set<string>();
    f.fields.forEach((row, i) => {
      if (!isRow(row)) { errors.push(`fields[${i}] is not an object.`); return; }
      if (!str(row.id)) { errors.push(`fields[${i}] needs a string id.`); return; }
      if (ids.has(row.id)) errors.push(`duplicate field id ${row.id}`); else ids.add(row.id);
      for (const k of ['system', 'table', 'name'] as const) if (!str(row[k])) errors.push(`field ${row.id}: ${k} required`);
      if (!['string', 'number', 'date', 'boolean'].includes(row.type as string)) errors.push(`field ${row.id}: bad type`);
      if (row.declaredClass !== undefined && !ALL_CLASSES.includes(row.declaredClass as DataClass)) errors.push(`field ${row.id}: unknown declaredClass`);
      if (!Array.isArray(row.samples)) errors.push(`field ${row.id}: samples must be an array`);
      else if (row.samples.length > LIMITS.samplesPerField) errors.push(`field ${row.id}: more than ${LIMITS.samplesPerField} samples`);
      else if (!row.samples.every((s) => typeof s === 'string' && s.length <= LIMITS.sampleLength)) errors.push(`field ${row.id}: samples must be strings up to ${LIMITS.sampleLength} chars`);
    });
  }
  if (f.exceptions !== undefined) {
    if (!Array.isArray(f.exceptions)) errors.push('exceptions must be an array.');
    else if (f.exceptions.length > LIMITS.exceptions) errors.push('too many exceptions.');
    else f.exceptions.forEach((x, i) => {
      if (!isRow(x)) { errors.push(`exceptions[${i}] is not an object.`); return; }
      for (const k of ['id', 'fieldId', 'fromClass', 'toClass', 'justification', 'approvedBy'] as const) if (!str(x[k], 2000)) errors.push(`exceptions[${i}]: ${k} required`);
      if (!isIsoDate(x.grantedOn) || !isIsoDate(x.expiresOn)) errors.push(`exceptions[${i}]: dates must be ISO`);
    });
  }
  if (errors.length > 25) errors.splice(25, errors.length - 25, `… ${errors.length - 25} more`);
  return errors.length ? { ok: false, errors } : { ok: true, fixture: f as unknown as Fixture };
}

/* ----------------------------- export ----------------------------- */

export interface CatalogExport {
  schema: 'labelsmith.catalog/v1';
  label: string;
  asOf: string;
  ruleSet: { id: string; class: DataClass; weight: number; builtIn: boolean }[];
  summary: { total: number; needsReview: number; activeExceptions: number; expiredExceptions: number; byClass: Record<DataClass, number> };
  fields: { fieldId: string; system: string; table: string; name: string; computedClass: DataClass; effectiveClass: DataClass; confidence: number; needsReview: boolean; reviewReasons: string[]; matchedRules: string[]; exception: string | null; policySummary: string }[];
  disclaimer: string;
}

export function exportCatalog(fixture: Fixture, labels: EffectiveLabel[], rules: Rule[]): { json: CatalogExport; csv: string } {
  const byClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<DataClass, number>;
  for (const l of labels) byClass[l.effectiveClass]++;
  const fields = labels.map((l) => {
    const field = fixture.fields.find((x) => x.id === l.fieldId)!;
    return {
      fieldId: l.fieldId, system: field.system, table: field.table, name: field.name,
      computedClass: l.computedClass, effectiveClass: l.effectiveClass, confidence: l.classification.confidence,
      needsReview: l.classification.needsReview, reviewReasons: l.classification.reviewReasons,
      matchedRules: l.classification.trace.filter((t) => t.outcome === 'matched').map((t) => t.ruleId),
      exception: l.exception ? `${l.exception.id} (${l.exception.status})` : null,
      policySummary: l.policy.summary,
    };
  });
  const json: CatalogExport = {
    schema: 'labelsmith.catalog/v1', label: fixture.label, asOf: fixture.asOf,
    ruleSet: rules.map((r) => ({ id: r.id, class: r.class, weight: r.weight, builtIn: !!r.builtIn })),
    summary: { total: labels.length, needsReview: labels.filter((l) => l.classification.needsReview).length, activeExceptions: labels.filter((l) => l.exception?.status === 'active').length, expiredExceptions: labels.filter((l) => l.exception?.status === 'expired').length, byClass },
    fields,
    disclaimer: 'Rule-based proposal from synthetic metadata. Not a legal or regulatory classification.',
  };
  const csv = toCsv(['field_id', 'system', 'table', 'name', 'computed_class', 'effective_class', 'confidence', 'needs_review', 'matched_rules', 'exception', 'review_reasons'],
    fields.map((x) => [x.fieldId, x.system, x.table, x.name, x.computedClass, x.effectiveClass, x.confidence, x.needsReview, x.matchedRules.join('|'), x.exception ?? '', x.reviewReasons.join(' ')]));
  return { json, csv };
}
