// Bounded, path-addressed register validation. Rebuilds a clean object with known keys only.
import { QUESTIONS, QUESTION_IDS } from './model';
import { EVIDENCE_TYPES, type EvidenceItem, type Exception, type Tier, type ValidationIssue, type ValidationResult, type Vendor } from './types';

export const MAX_REGISTER_BYTES = 1024 * 1024;
export const MAX_VENDORS = 200;
export const MAX_EVIDENCE_PER_VENDOR = 40;
export const MAX_EXCEPTIONS_PER_VENDOR = 20;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 160;

type Issues = ValidationIssue[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function str(v: unknown, path: string, issues: Issues, max = MAX_SHORT, min = 1): string {
  if (typeof v !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return '';
  }
  if (v.length < min) issues.push({ path, message: `must be at least ${min} character(s)` });
  if (v.length > max) issues.push({ path, message: `must be at most ${max} characters` });
  return v;
}
function date(v: unknown, path: string, issues: Issues): string {
  if (!isIsoDate(v)) {
    issues.push({ path, message: 'must be an ISO date (YYYY-MM-DD)' });
    return '2000-01-01';
  }
  return v;
}
function evidenceType(v: unknown, path: string, issues: Issues): EvidenceItem['type'] {
  if (typeof v !== 'string' || !(EVIDENCE_TYPES as readonly string[]).includes(v)) {
    issues.push({ path, message: `must be one of ${EVIDENCE_TYPES.join(', ')}` });
    return 'questionnaire';
  }
  return v as EvidenceItem['type'];
}

function vendor(raw: unknown, path: string, issues: Issues): Vendor {
  const o = obj(raw);
  if (!raw || typeof raw !== 'object') issues.push({ path, message: 'must be an object' });
  const answers: Record<string, string> = {};
  const a = obj(o.answers);
  if (o.answers !== undefined && (!o.answers || typeof o.answers !== 'object')) issues.push({ path: path + '.answers', message: 'must be an object' });
  for (const [qid, oid] of Object.entries(a)) {
    if (!QUESTION_IDS.has(qid)) {
      issues.push({ path: `${path}.answers.${qid.slice(0, 12)}`, message: 'unknown question id' });
      continue;
    }
    const q = QUESTIONS.find((x) => x.id === qid)!;
    if (typeof oid !== 'string' || !q.options.some((op) => op.id === oid)) {
      issues.push({ path: `${path}.answers.${qid}`, message: `unknown option for ${qid}` });
      continue;
    }
    answers[qid] = oid;
  }
  const evidence: EvidenceItem[] = [];
  if (o.evidence !== undefined) {
    if (!Array.isArray(o.evidence)) issues.push({ path: path + '.evidence', message: 'must be an array' });
    else if (o.evidence.length > MAX_EVIDENCE_PER_VENDOR) issues.push({ path: path + '.evidence', message: `at most ${MAX_EVIDENCE_PER_VENDOR} evidence items per vendor` });
    else {
      const seen = new Set<string>();
      o.evidence.forEach((raw, i) => {
        const e = obj(raw);
        const p = `${path}.evidence[${i}]`;
        const validMonths = typeof e.validMonths === 'number' && Number.isInteger(e.validMonths) ? e.validMonths : NaN;
        if (!(validMonths >= 1 && validMonths <= 60)) issues.push({ path: p + '.validMonths', message: 'validMonths must be an integer from 1 to 60' });
        const item: EvidenceItem = {
          id: str(e.id, p + '.id', issues, 64),
          type: evidenceType(e.type, p + '.type', issues),
          title: str(e.title, p + '.title', issues),
          issuedOn: date(e.issuedOn, p + '.issuedOn', issues),
          validMonths: Number.isFinite(validMonths) ? validMonths : 12,
        };
        if (e.note !== undefined) item.note = str(e.note, p + '.note', issues, MAX_TEXT, 0);
        if (seen.has(item.id)) issues.push({ path: p + '.id', message: `duplicate evidence id ${item.id}` });
        seen.add(item.id);
        evidence.push(item);
      });
    }
  }
  const exceptions: Exception[] = [];
  if (o.exceptions !== undefined) {
    if (!Array.isArray(o.exceptions)) issues.push({ path: path + '.exceptions', message: 'must be an array' });
    else if (o.exceptions.length > MAX_EXCEPTIONS_PER_VENDOR) issues.push({ path: path + '.exceptions', message: `at most ${MAX_EXCEPTIONS_PER_VENDOR} exceptions per vendor` });
    else {
      o.exceptions.forEach((raw, i) => {
        const x = obj(raw);
        const p = `${path}.exceptions[${i}]`;
        exceptions.push({
          id: str(x.id, p + '.id', issues, 64),
          evidenceType: evidenceType(x.evidenceType, p + '.evidenceType', issues),
          approvedBy: str(x.approvedBy, p + '.approvedBy', issues, 80),
          rationale: str(x.rationale, p + '.rationale', issues, MAX_TEXT),
          expiresOn: date(x.expiresOn, p + '.expiresOn', issues),
        });
      });
    }
  }
  const v: Vendor = {
    id: str(o.id, path + '.id', issues, 64),
    name: str(o.name, path + '.name', issues),
    service: str(o.service, path + '.service', issues, MAX_SHORT, 0),
    owner: str(o.owner, path + '.owner', issues, 80, 0),
    answers,
    evidence,
    exceptions,
  };
  if (o.lastReviewOn !== undefined) v.lastReviewOn = date(o.lastReviewOn, path + '.lastReviewOn', issues);
  if (o.recordedTier !== undefined) {
    if (o.recordedTier === 1 || o.recordedTier === 2 || o.recordedTier === 3) v.recordedTier = o.recordedTier as Tier;
    else issues.push({ path: path + '.recordedTier', message: 'recordedTier must be 1, 2 or 3' });
  }
  return v;
}

export function validateRegisterObject(raw: unknown): ValidationResult {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '', message: 'register must be a JSON object' }] };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'tierline.register/1') issues.push({ path: 'schema', message: "schema must be 'tierline.register/1'" });
  const asOf = date(o.asOf, 'asOf', issues);
  const vendors: Vendor[] = [];
  if (!Array.isArray(o.vendors)) issues.push({ path: 'vendors', message: 'must be an array' });
  else if (o.vendors.length > MAX_VENDORS) issues.push({ path: 'vendors', message: `at most ${MAX_VENDORS} vendors are accepted` });
  else {
    const seen = new Set<string>();
    o.vendors.forEach((raw, i) => {
      const v = vendor(raw, `vendors[${i}]`, issues);
      if (seen.has(v.id)) issues.push({ path: `vendors[${i}].id`, message: `duplicate vendor id ${v.id}` });
      seen.add(v.id);
      vendors.push(v);
    });
  }
  if (issues.length) return { ok: false, issues: issues.slice(0, 60) };
  return { ok: true, register: { schema: 'tierline.register/1', asOf, vendors } };
}

export function validateRegister(text: string): ValidationResult {
  if (text.length > MAX_REGISTER_BYTES || new TextEncoder().encode(text).byteLength > MAX_REGISTER_BYTES) {
    return { ok: false, issues: [{ path: '', message: `register too large: limit is ${MAX_REGISTER_BYTES} bytes` }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  }
  return validateRegisterObject(raw);
}
