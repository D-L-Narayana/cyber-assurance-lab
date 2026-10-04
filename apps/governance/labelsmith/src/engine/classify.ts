/**
 * Labelsmith core engine: rule-based data classification with an explicit precedence model,
 * an explainable per-rule trace, an "unknown" bucket, handling policies per class and
 * time-boxed downgrade exceptions. Deterministic, side-effect free, no network.
 *
 * Classification is a *proposal*. It never claims legal or regulatory classification.
 *
 * October 2026 round — token-boundary matching:
 *  - field names are tokenised (`_` separators, camelCase humps, acronym runs, letter→digit boundaries);
 *  - keyword rules match whole tokens or contiguous token sequences by default (`match: 'token'`);
 *    `match: 'substring'` keeps the legacy containment behaviour and is used by exactly one built-in;
 *  - `ALLOW_TOKENS` (metadata modifiers such as `version`, `count`, `verified`) discount name evidence of
 *    Confidential-and-above rules: `token_count` is a number about tokens, not a token;
 *  - per-rule `exceptTokens` veto a rule for a field name in either mode (`ip_address` is not a postal address);
 *  - bare hex digests are Confidential (`val-hex-digest`, weight 0.5) unless the name says credential.
 */
import { CLASS_RANK } from './types';
import type {
  Classification, DataClass, EffectiveLabel, Exception, Field, Fixture, HandlingPolicy, NameMatchMode, Rule, RuleTrace, ValueCheck,
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
  // high-variety token: at least 24 chars, mixes digit + letter, no spaces.
  // Pure hex strings are digests (md5, SHA, commit ids), not keys: they belong to the 'hex-digest' check.
  if (s.length < 24 || /\s/.test(s)) return false;
  if (/^[A-Fa-f0-9]+$/.test(s)) return false;
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
    case 'phone': {
      // A dotted quad (10.0.0.7) is an IP address, never a phone number, even though it has 8+ digits and dots.
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v)) return false;
      const d = v.replace(/\D/g, '').length;
      return /^\+?[0-9][0-9 ().-]{6,18}[0-9]$/.test(v) && d >= 8 && d <= 15;
    }
    case 'ipv4': return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((o) => Number(o) <= 255);
    case 'jwt': return /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/.test(v);
    case 'apikey': return /^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}$/.test(v) || /^(?:AKIA|ghp_|gho_|xoxb-|glpat-)[A-Za-z0-9_-]{8,}$/.test(v) || entropyish(v);
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
    // 32–64 hex characters: md5 (32), SHA-1 / git commit (40), SHA-256 (64). Dashed UUIDs do not match.
    case 'hex-digest': return /^[A-Fa-f0-9]{32,64}$/.test(v);
  }
}

/* ----------------------------- field-name tokens ----------------------------- */

/**
 * Normalise a field name for matching: split camelCase humps (`customerEmail` → `customer_Email`), acronym runs
 * (`HTTPServerIP` → `HTTP_Server_IP`) and letter→digit boundaries (`last4` → `last_4`), lower-case, then collapse
 * every non-alphanumeric run into one underscore and trim. Linear patterns on names of at most 200 characters.
 */
export function normaliseName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([A-Za-z])([0-9])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Underscore tokens of a normalised name (`card_number_last_4` → `card`, `number`, `last`, `4`). */
export function tokensOf(norm: string): string[] { return norm.split('_').filter(Boolean); }

/**
 * Field-name tokens that describe *metadata about* a thing rather than the thing itself. A token-mode name match of a
 * Confidential-or-higher rule is discounted when any of these appears anywhere in the name: `token_count` counts
 * tokens, `email_verified` is a boolean, `card_number_status` is a lifecycle state. Deliberately absent:
 * `type` (blood_type), `date`/`name`/`number`/`id` (birth_date, first_name, card_number, email_id), `last`
 * (card_number_last4), `hash`/`reset`/`token` (password_hash, password_reset_token), `total`/`pct`/`score`/`max`/`at`
 * (invoice_total, margin_pct, credit_score, salary_max, salary_at_hire are the data, not metadata about it),
 * `state` (address_state). The list is position-agnostic, so it only holds words that practically never qualify
 * *which* instance of a sensitive thing a column holds. Restricted-health rules are exempt: an allergy count is
 * still health data. Sample values are never discounted — a value check still counts when the name was.
 */
export const ALLOW_TOKENS: ReadonlySet<string> = new Set<string>([
  'version', 'versions', 'status', 'count', 'counts', 'days', 'hours', 'minutes', 'seconds',
  'warning', 'warnings', 'warn', 'threshold', 'thresholds', 'check', 'checks', 'checked',
  'verified', 'verify', 'verification', 'validated', 'validation', 'enabled', 'disabled', 'required', 'optional', 'allowed',
  'flag', 'flags', 'policy', 'policies', 'format', 'length', 'size', 'exists', 'present', 'missing',
  'attempts', 'retries', 'expires', 'expired', 'has', 'is', 'opt', 'optin', 'optout', 'preferences',
]);

/** Rule tokens are normalised like field names, so `card_number`, `Card Number` and `cardNumber` all mean the sequence `card`,`number`. */
const ruleTokens = (t: string): string[] => tokensOf(normaliseName(t));

/** Whole-token equality with a tolerated English plural on tokens longer than three characters (`emails`, `addresses`, `allergies`; never `pans`). */
function tokEq(fieldTok: string, ruleTok: string): boolean {
  if (fieldTok === ruleTok) return true;
  if (ruleTok.length <= 3) return false;
  return fieldTok === `${ruleTok}s` || fieldTok === `${ruleTok}es` || (ruleTok.endsWith('y') && fieldTok === `${ruleTok.slice(0, -1)}ies`);
}

/** True when the rule tokens occur as a contiguous sequence of the field tokens (order matters: `number_card` ≠ `card_number`). */
function hasSequence(fieldTokens: string[], rule: string[]): boolean {
  if (rule.length === 0 || rule.length > fieldTokens.length) return false;
  outer: for (let i = 0; i + rule.length <= fieldTokens.length; i++) {
    for (let j = 0; j < rule.length; j++) if (!tokEq(fieldTokens[i + j]!, rule[j]!)) continue outer;
    return true;
  }
  return false;
}

function firstTokenHit(fieldTokens: string[], tokens: string[]): string | null {
  for (const t of tokens) if (hasSequence(fieldTokens, ruleTokens(t))) return t;
  return null;
}

function nameMatches(norm: string, fieldTokens: string[], tokens: string[], mode: NameMatchMode): string | null {
  if (mode === 'substring') {
    // Legacy containment: ≤ 3-char tokens still have to be a whole underscore-delimited token so `span` never hits `pan`.
    const padded = `_${norm}_`;
    for (const t of tokens) {
      const tn = t.replace(/[^a-z0-9]+/g, '_');
      if (tn.length <= 3 ? padded.includes(`_${tn}_`) : norm.includes(tn)) return t;
    }
    return null;
  }
  return firstTokenHit(fieldTokens, tokens);
}

/** Allow-list discounting applies to name matches at Confidential rank or above, except restricted-health. */
function allowListApplies(c: DataClass): boolean { return CLASS_RANK[c] >= CLASS_RANK.confidential && c !== 'restricted-health'; }

/* ----------------------------- built-in rules ----------------------------- */

const rule = (r: Omit<Rule, 'builtIn'>): Rule => ({ ...r, builtIn: true });

/**
 * Field-name tokens that conventionally hold authentication material. Shared by `name-secret` (minus the password
 * stems, which `name-password` covers), by `val-hex-credential` (hex under such a name is a secret) and as the veto
 * list of `val-hex-digest` (hex under such a name is not merely a digest).
 */
export const CREDENTIAL_NAME_TOKENS: readonly string[] = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'apikey', 'private_key', 'privatekey', 'secret_key', 'secretkey',
  'client_secret', 'encryption_key', 'signing_key', 'hmac_key', 'master_key', 'credential', 'credentials', 'bearer', 'otp',
];

/**
 * Precedence = array order for trace display; the winner is the highest CLASS_RANK among matched rules, then highest weight.
 * Match mode review (October 2026): every name rule is whole-token unless a comment says otherwise.
 */
export const BUILT_IN_RULES: Rule[] = [
  // token: `token` must be a whole token (or tolerated plural), so `tokenizer_version` no longer matches; `design_tokens` still does (README).
  rule({ id: 'name-secret', name: 'Secret / credential field name', nameTokens: CREDENTIAL_NAME_TOKENS.filter((t) => t !== 'password' && t !== 'passwd'), class: 'secret-credential', weight: 0.85, explanation: 'Field names that conventionally hold authentication material (whole-token match).' }),
  // substring (the only built-in): legacy schemas glue the stem (`userpassword`, `dbpasswd`, `passwordhash`) and no
  // ordinary English word contains "password", so containment is safe here. Metadata about passwords is vetoed by name.
  rule({ id: 'name-password', name: 'Password field name (stem)', nameTokens: ['password', 'passwd'], match: 'substring', exceptTokens: ['policy', 'policies', 'rules', 'complexity', 'strength', 'length', 'min_length', 'max_length', 'format', 'expiry', 'expires', 'expired', 'rotation', 'attempts', 'changed', 'change', 'updated', 'created', 'required', 'enabled', 'disabled', 'status', 'version', 'count', 'check', 'has', 'is'], class: 'secret-credential', weight: 0.85, explanation: 'Names containing the password stem, including glued legacy spellings; names that only describe password settings are vetoed.' }),
  rule({ id: 'val-apikey', name: 'API key / access token shape', valueCheck: 'apikey', class: 'secret-credential', weight: 0.8, explanation: 'Samples look like vendor-prefixed keys or long high-variety tokens (bare hex is a digest, see below).' }),
  rule({ id: 'val-jwt', name: 'JSON Web Token shape', valueCheck: 'jwt', class: 'secret-credential', weight: 0.9, explanation: 'Three base64url segments separated by dots.' }),
  rule({ id: 'val-password-hash', name: 'Password hash shape', valueCheck: 'password-hash', class: 'secret-credential', weight: 0.9, explanation: 'bcrypt / argon2 / SHA-crypt style hash prefix.' }),
  // value + name, both required: hex material under a credential-like name is a secret (unsalted md5 password, hex API key).
  rule({ id: 'val-hex-credential', name: 'Hex secret under a credential name', nameTokens: [...CREDENTIAL_NAME_TOKENS], valueCheck: 'hex-digest', combine: 'all', minSampleRatio: 0.7, class: 'secret-credential', weight: 0.6, explanation: '32–64 hex characters stored under a credential-like field name.' }),
  // token; `health_check`-style operational names are vetoed. Health rules are exempt from allow-list discounting.
  rule({ id: 'name-health', name: 'Health field name', nameTokens: ['diagnosis', 'icd', 'medical', 'prescription', 'allergy', 'blood', 'health', 'patient', 'clinical', 'symptom'], exceptTokens: ['health_check', 'healthcheck', 'health_checks', 'healthchecks', 'system_health', 'service_health', 'cluster_health', 'node_health', 'db_health', 'api_health', 'app_health', 'health_endpoint'], class: 'restricted-health', weight: 0.8, explanation: 'Names that indicate health or medical content.' }),
  rule({ id: 'val-icd10', name: 'ICD-10-like code', valueCheck: 'icd10', minSampleRatio: 0.7, class: 'restricted-health', weight: 0.75, explanation: 'Samples match the letter-digit-digit(.suffix) diagnosis code shape.' }),
  // token; `card_number` is a token sequence, so `card_number_last4` matches and `number_card` does not.
  rule({ id: 'name-card', name: 'Payment card field name', nameTokens: ['card_number', 'cardnumber', 'card_no', 'card_num', 'pan', 'cvv', 'cvc', 'cvv2', 'cvc2', 'card_expiry', 'card_exp', 'exp_month', 'exp_year'], class: 'restricted-financial', weight: 0.8, explanation: 'Names used for primary account numbers and card security data.' }),
  // token, deliberately weak alone (0.55 < review threshold): `expiry` without card context is ambiguous, and non-card expiries are vetoed.
  rule({ id: 'name-card-expiry', name: 'Expiry field name (weak alone)', nameTokens: ['expiry', 'expiration', 'expiry_date', 'expiration_date', 'exp_date', 'valid_thru'], exceptTokens: ['token', 'tokens', 'session', 'certificate', 'cert', 'password', 'passwd', 'contract', 'licence', 'license', 'domain', 'offer', 'exception', 'cache', 'cookie', 'link', 'otp', 'code', 'warranty', 'subscription', 'trial', 'key', 'secret', 'consent', 'quote', 'coupon', 'voucher', 'promo', 'promotion', 'access', 'grant', 'lease', 'ttl', 'retention', 'hold'], class: 'restricted-financial', weight: 0.55, explanation: 'Expiry dates usually belong to payment cards in a payments schema; alone they are weak evidence and stay flagged for review.' }),
  rule({ id: 'val-card-luhn', name: 'Card number passes Luhn', valueCheck: 'luhn', minSampleRatio: 0.6, class: 'restricted-financial', weight: 0.85, explanation: '13–19 digit samples with a valid Luhn check digit.' }),
  // token; `routing` alone was dropped (message routing, routing rules) in favour of `routing_number`.
  rule({ id: 'name-bank', name: 'Bank account field name', nameTokens: ['iban', 'account_number', 'account_no', 'account_num', 'acct_number', 'acct_no', 'routing_number', 'routing_no', 'aba', 'sort_code', 'sortcode', 'swift', 'swift_code', 'bic', 'bank_account'], class: 'restricted-financial', weight: 0.75, explanation: 'Bank account identifiers.' }),
  rule({ id: 'val-iban', name: 'IBAN passes mod-97', valueCheck: 'iban', minSampleRatio: 0.6, class: 'restricted-financial', weight: 0.9, explanation: 'Samples are valid IBANs.' }),
  // token; loyalty/marketing "bonus" names are vetoed.
  rule({ id: 'name-pay', name: 'Compensation field name', nameTokens: ['salary', 'compensation', 'wage', 'wages', 'bonus', 'payroll', 'base_pay', 'gross_pay', 'net_pay', 'pay_rate', 'hourly_rate', 'remuneration', 'stipend'], exceptTokens: ['points', 'point', 'code', 'promo', 'promotion', 'referral', 'signup', 'welcome', 'loyalty', 'reward', 'rewards'], class: 'restricted-financial', weight: 0.7, explanation: 'Individual compensation data.' }),
  // token; `license_number` alone was dropped (software licences) in favour of driver-licence spellings.
  rule({ id: 'name-national-id', name: 'Government identifier name', nameTokens: ['ssn', 'social_security', 'social_security_number', 'national_id', 'nationalid', 'national_insurance', 'nino', 'passport', 'passport_number', 'passport_no', 'aadhaar', 'aadhar', 'tax_id', 'taxid', 'tin', 'pan_number', 'pan_no', 'pan_card', 'drivers_licence', 'drivers_license', 'driver_licence', 'driver_license', 'driving_licence', 'driving_license', 'dl_number', 'voter_id'], class: 'restricted-pii', weight: 0.85, explanation: 'Government-issued identifiers.' }),
  rule({ id: 'val-national-id', name: 'Government identifier shape', valueCheck: 'national-id', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.7, explanation: 'Samples match common national-id formats (synthetic patterns).' }),
  rule({ id: 'name-dob', name: 'Date of birth name', nameTokens: ['dob', 'date_of_birth', 'birth_date', 'birthdate', 'birthday', 'birth', 'born', 'born_on'], class: 'restricted-pii', weight: 0.8, explanation: 'Birth dates are direct identifiers when combined with name.' }),
  // value only, weak (0.35); vetoed for timestamp-ish names so `created_at` is not a birth date.
  rule({ id: 'val-dob', name: 'Plausible birth date values', valueCheck: 'dob', minSampleRatio: 0.7, exceptTokens: ['created', 'updated', 'modified', 'deleted', 'archived', 'start', 'started', 'end', 'ended', 'due', 'expires', 'expiry', 'expired', 'issued', 'signed', 'hired', 'hire', 'joined', 'left', 'order', 'ordered', 'invoice', 'invoiced', 'payment', 'paid', 'shipped', 'delivered', 'published', 'posted', 'logged', 'login', 'last', 'seen', 'timestamp', 'ts', 'at', 'effective', 'valid', 'renewal', 'review', 'reviewed', 'approved', 'granted', 'completed', 'closed', 'opened', 'sent', 'received', 'scheduled', 'booked', 'appointment', 'visit', 'admission', 'discharge', 'event', 'transaction', 'period', 'snapshot', 'as_of', 'cutoff', 'deadline'], class: 'restricted-pii', weight: 0.35, explanation: 'ISO dates 0–120 years before the as-of date (weak evidence alone; timestamp-named columns are vetoed).' }),
  rule({ id: 'name-email', name: 'Email field name', nameTokens: ['email', 'e_mail', 'email_address', 'emailaddress', 'mail_address'], class: 'restricted-pii', weight: 0.7, explanation: 'Email addresses identify a person.' }),
  rule({ id: 'val-email', name: 'Email address shape', valueCheck: 'email', class: 'restricted-pii', weight: 0.75, explanation: 'Samples look like email addresses.' }),
  rule({ id: 'name-person', name: 'Person name field', nameTokens: ['first_name', 'last_name', 'full_name', 'surname', 'given_name', 'family_name', 'middle_name', 'maiden_name', 'firstname', 'lastname', 'fullname', 'customer_name', 'employee_name', 'contact_name', 'legal_name', 'preferred_name', 'person_name', 'nickname'], class: 'restricted-pii', weight: 0.7, explanation: 'Personal names.' }),
  // token; device/platform names (`mobile_os`, `phone_model`) are vetoed.
  rule({ id: 'name-phone', name: 'Phone field name', nameTokens: ['phone', 'phone_number', 'mobile', 'msisdn', 'telephone', 'tel', 'cell', 'cellphone', 'fax'], exceptTokens: ['app', 'os', 'platform', 'device', 'browser', 'carrier', 'model', 'brand', 'type', 'format', 'country_code'], class: 'restricted-pii', weight: 0.65, explanation: 'Phone numbers.' }),
  rule({ id: 'val-phone', name: 'Phone number shape', valueCheck: 'phone', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.5, explanation: 'Samples look like dialable numbers.' }),
  // token; network/web/file "addresses" are vetoed so `ip_address` and `email_address` go to their own rules.
  rule({ id: 'name-address', name: 'Postal address field', nameTokens: ['address', 'street', 'address_line', 'postcode', 'post_code', 'postal_code', 'zip', 'zipcode', 'zip_code', 'city', 'town'], exceptTokens: ['ip', 'ipv4', 'ipv6', 'mac', 'email', 'e_mail', 'wallet', 'contract', 'url', 'server', 'host', 'hostname', 'remote', 'memory', 'bus', 'file', 'archive', 'compressed', 'web', 'site', 'endpoint'], class: 'restricted-pii', weight: 0.55, explanation: 'Postal address components.' }),
  rule({ id: 'val-geo', name: 'Geo coordinate pair', valueCheck: 'geo', minSampleRatio: 0.7, class: 'restricted-pii', weight: 0.6, explanation: 'Latitude/longitude pairs can locate a person.' }),
  rule({ id: 'name-ip', name: 'IP address field', nameTokens: ['ip_address', 'ipaddress', 'ip_addr', 'ipaddr', 'client_ip', 'remote_addr', 'remote_ip', 'source_ip', 'src_ip', 'dest_ip', 'dst_ip', 'server_ip', 'ip', 'ipv4', 'ipv6'], class: 'confidential', weight: 0.6, explanation: 'Network identifiers; treated as confidential, PII in some jurisdictions.' }),
  rule({ id: 'val-ipv4', name: 'IPv4 shape', valueCheck: 'ipv4', minSampleRatio: 0.7, class: 'confidential', weight: 0.6, explanation: 'Samples are dotted-quad addresses.' }),
  // value only; vetoed when the name says credential (then val-hex-credential and the name rules speak instead).
  rule({ id: 'val-hex-digest', name: 'Hex digest shape (md5 / SHA / commit id)', valueCheck: 'hex-digest', minSampleRatio: 0.7, exceptTokens: [...CREDENTIAL_NAME_TOKENS], class: 'confidential', weight: 0.5, explanation: '32–64 hex characters look like a content digest or commit id: confidential business data, not a credential, unless the name says otherwise. Weak alone, so always flagged for review.' }),
  rule({ id: 'name-finance-agg', name: 'Business financial field', nameTokens: ['revenue', 'invoice_total', 'invoice_amount', 'margin', 'forecast', 'budget', 'profit', 'ebitda', 'cogs', 'net_income', 'turnover'], class: 'confidential', weight: 0.6, explanation: 'Non-public business financials.' }),
  rule({ id: 'name-internal', name: 'Operational metadata', nameTokens: ['created_at', 'updated_at', 'modified_at', 'deleted_at', 'created', 'updated', 'last_modified', 'status', 'version', 'notes', 'comment', 'comments', 'owner_team', 'ticket_id'], class: 'internal', weight: 0.5, explanation: 'Internal operational fields.' }),
  rule({ id: 'name-public', name: 'Catalogue / marketing field', nameTokens: ['product_name', 'sku', 'category', 'public_description', 'press_release'], class: 'public', weight: 0.6, explanation: 'Information already published or intended for publication.' }),
];

const RESERVED_TOKEN_CHARS = /[\\^$.*+?()[\]{}|/]/;

export type AddRuleResult = { ok: true; rules: Rule[] } | { ok: false; error: string };

/**
 * Add a user-defined keyword rule. Keywords are plain lower-case text — never compiled into a RegExp.
 * `match` defaults to whole-token matching; `substring` opts into the broader legacy containment.
 */
export function addKeywordRule(rules: Rule[], input: { id: string; name: string; tokens: string[]; class: DataClass; weight: number; match?: NameMatchMode }): AddRuleResult {
  const tokens = input.tokens.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!input.id.trim() || input.id.length > 40) return { ok: false, error: 'Rule id is required (max 40 chars).' };
  if (rules.some((r) => r.id === input.id)) return { ok: false, error: `Rule id ${input.id} already exists.` };
  if (tokens.length === 0) return { ok: false, error: 'Add at least one keyword.' };
  if (tokens.some((t) => t.length < 2 || t.length > 40)) return { ok: false, error: 'Keywords must be 2–40 characters.' };
  if (tokens.some((t) => RESERVED_TOKEN_CHARS.test(t))) return { ok: false, error: 'Keywords are plain text; regex characters are not allowed.' };
  if (!ALL_CLASSES.includes(input.class) || input.class === 'unknown') return { ok: false, error: 'Choose a concrete class (not unknown).' };
  if (!(input.weight > 0 && input.weight <= 1)) return { ok: false, error: 'Weight must be between 0 and 1.' };
  if (input.match !== undefined && input.match !== 'token' && input.match !== 'substring') return { ok: false, error: 'Match mode must be “token” or “substring”.' };
  const match: NameMatchMode = input.match ?? 'token';
  return { ok: true, rules: [...rules, { id: input.id.trim(), name: input.name.trim() || input.id, nameTokens: tokens, match, class: input.class, weight: input.weight, explanation: match === 'substring' ? 'User-defined keyword rule (substring match).' : 'User-defined keyword rule (whole-token match).' }] };
}

/* ----------------------------- classification ----------------------------- */

/** Which value checks can apply to each declared field type; others are skipped (and say so in the trace). */
const APPLICABLE: Record<Field['type'], Set<ValueCheck>> = {
  string: new Set<ValueCheck>(['luhn', 'email', 'iban', 'phone', 'dob', 'apikey', 'jwt', 'ipv4', 'national-id', 'icd10', 'password-hash', 'geo', 'money', 'hex-digest']),
  number: new Set<ValueCheck>(['luhn', 'phone', 'money', 'national-id']),
  date: new Set<ValueCheck>(['dob']),
  boolean: new Set<ValueCheck>(),
};

export function classifyField(field: Field, rules: Rule[], asOf: string): Classification {
  const norm = normaliseName(field.name);
  const fieldTokens = tokensOf(norm);
  const samples = field.samples.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, LIMITS.samplesPerField);
  const trace: RuleTrace[] = [];
  for (const r of rules) {
    const push = (outcome: RuleTrace['outcome'], reason: string) => trace.push({ ruleId: r.id, name: r.name, class: r.class, weight: r.weight, outcome, reason });
    const mode: NameMatchMode = r.match ?? 'token';
    // 1. Exception tokens veto the whole rule for this field name, in either match mode, with or without name tokens.
    const veto = r.exceptTokens ? firstTokenHit(fieldTokens, r.exceptTokens) : null;
    if (veto) { push('suppressed', `exception token “${veto}” in the field name vetoes this rule`); continue; }
    // 2. Name evidence; allow-listed metadata tokens discount token-mode matches of sensitive rules.
    const nameHit = r.nameTokens ? nameMatches(norm, fieldTokens, r.nameTokens, mode) : null;
    const discounted = nameHit && mode === 'token' && allowListApplies(r.class) ? [...new Set(fieldTokens.filter((t) => ALLOW_TOKENS.has(t)))] : [];
    const nameEvidence = !!nameHit && discounted.length === 0;
    // 3. Value evidence (samples are never discounted by the name).
    let valueRatio: number | null = null;
    if (r.valueCheck) {
      if (samples.length === 0) {
        if (!r.nameTokens) { push('skipped', 'no samples to test'); continue; }
      } else if (!APPLICABLE[field.type].has(r.valueCheck)) {
        push('skipped', `value check does not apply to ${field.type} type`); continue;
      } else {
        const hits = samples.filter((s) => checkValue(r.valueCheck!, s, asOf)).length;
        valueRatio = hits / samples.length;
      }
    }
    const needRatio = r.minSampleRatio ?? 0.6;
    const valueHit = valueRatio !== null && valueRatio >= needRatio;
    let matched: boolean;
    if (r.nameTokens && r.valueCheck) matched = (r.combine ?? 'any') === 'all' ? nameEvidence && valueHit : nameEvidence || valueHit;
    else if (r.nameTokens) matched = nameEvidence;
    else matched = valueHit;
    const parts: string[] = [];
    if (r.nameTokens) {
      if (!nameHit) parts.push('name has none of the keywords');
      else if (discounted.length) parts.push(`name token “${nameHit}” discounted: allow-listed “${discounted.join('”, “')}” marks metadata about the thing, not the thing itself`);
      else parts.push(mode === 'token' ? `name token “${nameHit}”` : `name contains “${nameHit}”`);
    }
    if (r.valueCheck && valueRatio !== null) {
      const hits = Math.round(valueRatio * samples.length);
      parts.push(`${hits}/${samples.length} samples (${Math.round(valueRatio * 100)}%) match; need ${Math.round(needRatio * 100)}%`);
    }
    push(matched ? 'matched' : nameHit && discounted.length ? 'suppressed' : 'not-matched', parts.join('; '));
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
  /** `match` (additive, October 2026) is present for keyword rules: `token` or `substring`. */
  ruleSet: { id: string; class: DataClass; weight: number; builtIn: boolean; match?: NameMatchMode }[];
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
    ruleSet: rules.map((r) => ({ id: r.id, class: r.class, weight: r.weight, builtIn: !!r.builtIn, ...(r.nameTokens ? { match: r.match ?? 'token' } : {}) })),
    summary: { total: labels.length, needsReview: labels.filter((l) => l.classification.needsReview).length, activeExceptions: labels.filter((l) => l.exception?.status === 'active').length, expiredExceptions: labels.filter((l) => l.exception?.status === 'expired').length, byClass },
    fields,
    disclaimer: 'Rule-based proposal from synthetic metadata. Not a legal or regulatory classification.',
  };
  const csv = toCsv(['field_id', 'system', 'table', 'name', 'computed_class', 'effective_class', 'confidence', 'needs_review', 'matched_rules', 'exception', 'review_reasons'],
    fields.map((x) => [x.fieldId, x.system, x.table, x.name, x.computedClass, x.effectiveClass, x.confidence, x.needsReview, x.matchedRules.join('|'), x.exception ?? '', x.reviewReasons.join(' ')]));
  return { json, csv };
}
