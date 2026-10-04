import type { AppliedMitigation, Assessment, DataFlow, RiskAcceptance, Signature, Version } from './types';
import { THEMES } from './types';
import { MITIGATIONS, QUESTIONS } from './rubric';
import { fromCanonical, MAX_VERSION_CONTENT_BYTES } from './approval';

export interface ImportLimits { maxBytes: number; maxDepth: number; maxItems: number; maxString: number }
export const DEFAULT_LIMITS: ImportLimits = { maxBytes: 500_000, maxDepth: 6, maxItems: 200, maxString: 4_000 };

export type ParseResult = { ok: true; assessment: Assessment } | { ok: false; errors: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in YYYY-MM-DD form (2026-02-30 and 2026-99-99 are rejected). */
export function isStrictDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const STATUSES = new Set(['planned', 'implemented', 'verified']);
const ROLES = new Set(['product-owner', 'data-protection-lead']);
const MECHANISMS = new Set(['adequacy', 'standard-contractual-clauses', 'binding-corporate-rules', 'none', 'not-applicable']);
const THEME_SET = new Set<string>(THEMES);

/**
 * Iterative, bounded nesting check. Stops as soon as `max` is exceeded and never recurses, so a
 * hostile document with tens of thousands of nested arrays cannot overflow the call stack.
 */
function exceedsDepth(root: unknown, max: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    if (depth + 1 > max) return true;
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (child !== null && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
    }
  }
  return false;
}

export function parseAssessment(text: string, overrides: Partial<ImportLimits> = {}): ParseResult {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const errors: string[] = [];
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > limits.maxBytes) return { ok: false, errors: [`File is ${bytes.toLocaleString('en-US')} bytes; the limit is ${limits.maxBytes.toLocaleString('en-US')} bytes.`] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] }; }
  if (exceedsDepth(raw, limits.maxDepth)) return { ok: false, errors: [`Nesting deeper than ${limits.maxDepth} levels is not accepted.`] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Assessment must be a JSON object.'] };
  const o = raw as Record<string, unknown>;

  const str = (k: string, opt: { optional?: boolean; pattern?: RegExp; allowEmpty?: boolean } = {}, src: Record<string, unknown> = o, path = 'assessment'): string | undefined => {
    const v = src[k];
    if (v === undefined) { if (!opt.optional) errors.push(`${path}.${k} is required`); return undefined; }
    if (typeof v !== 'string') { errors.push(`${path}.${k} must be a string`); return undefined; }
    if (v.length > limits.maxString) { errors.push(`${path}.${k} is too long`); return undefined; }
    if (!v.trim() && !opt.allowEmpty) errors.push(`${path}.${k} must not be empty`);
    if (opt.pattern === ISO_DATE && !isStrictDate(v)) errors.push(`${path}.${k} "${v.slice(0, 20)}" is not a real calendar date (YYYY-MM-DD)`);
    else if (opt.pattern && opt.pattern !== ISO_DATE && !opt.pattern.test(v)) errors.push(`${path}.${k} must match ${opt.pattern}`);
    return v;
  };
  const strList = (src: Record<string, unknown>, k: string, path: string, max: number): string[] => {
    const v = src[k];
    if (!Array.isArray(v)) { errors.push(`${path}.${k} must be an array of strings`); return []; }
    if (v.length > max) { errors.push(`${path}.${k} has ${v.length} items; the limit is ${max}`); return []; }
    return v.map((x, i) => { if (typeof x !== 'string' || x.length > limits.maxString) { errors.push(`${path}.${k}[${i}] must be a string of at most ${limits.maxString} characters`); return ''; } return x; });
  };
  const arr = (k: string): unknown[] => {
    const v = o[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { errors.push(`assessment.${k} must be an array`); return []; }
    if (v.length > limits.maxItems) { errors.push(`assessment.${k} has more than ${limits.maxItems} items`); return []; }
    return v;
  };

  if (o['schema'] !== 'forethought.assessment') errors.push('assessment.schema must be "forethought.assessment"');
  if (o['version'] !== 1) errors.push('assessment.version must be 1');
  const id = str('id'); const title = str('title'); const owner = str('owner'); const description = str('description', { allowEmpty: true }) ?? '';
  const asOf = str('asOf', { pattern: ISO_DATE }) ?? '';

  const answers: Record<string, string> = {};
  const rawAnswers = o['answers'];
  if (typeof rawAnswers !== 'object' || rawAnswers === null || Array.isArray(rawAnswers)) errors.push('assessment.answers must be an object');
  else {
    for (const [qid, oid] of Object.entries(rawAnswers as Record<string, unknown>)) {
      const q = QUESTIONS.find((x) => x.id === qid);
      if (!q) { errors.push(`assessment.answers has unknown question "${qid.slice(0, 40)}"`); continue; }
      if (typeof oid !== 'string' || !q.options.some((x) => x.id === oid)) { errors.push(`assessment.answers.${qid} "${String(oid).slice(0, 40)}" is not an option of that question`); continue; }
      answers[qid] = oid;
    }
  }

  const mitigations = arr('mitigations').map((x, i): AppliedMitigation | undefined => {
    const path = `assessment.mitigations[${i}]`;
    if (typeof x !== 'object' || x === null) { errors.push(`${path} must be an object`); return undefined; }
    const m = x as Record<string, unknown>;
    const mitigationId = str('mitigationId', {}, m, path);
    const status = str('status', {}, m, path);
    const evidenceRef = str('evidenceRef', { optional: true, allowEmpty: true }, m, path);
    const ownerName = str('owner', { optional: true, allowEmpty: true }, m, path);
    if (mitigationId && !MITIGATIONS.some((d) => d.id === mitigationId)) errors.push(`${path}.mitigationId "${mitigationId.slice(0, 40)}" is not in the mitigation catalogue`);
    if (status && !STATUSES.has(status)) errors.push(`${path}.status must be planned, implemented or verified`);
    if (!mitigationId || !status) return undefined;
    return { mitigationId, status: status as AppliedMitigation['status'], ...(evidenceRef ? { evidenceRef } : {}), ...(ownerName ? { owner: ownerName } : {}) };
  }).filter((x): x is AppliedMitigation => Boolean(x));

  const flows = arr('flows').map((x, i): DataFlow | undefined => {
    const path = `assessment.flows[${i}]`;
    if (typeof x !== 'object' || x === null) { errors.push(`${path} must be an object`); return undefined; }
    const f = x as Record<string, unknown>;
    const fid = str('id', {}, f, path); const from = str('from', {}, f, path); const to = str('to', {}, f, path);
    const mechanism = str('mechanism', {}, f, path);
    if (mechanism && !MECHANISMS.has(mechanism)) errors.push(`${path}.mechanism is not an allowed value`);
    const outside = f['outsideOriginRegion'];
    if (typeof outside !== 'boolean') errors.push(`${path}.outsideOriginRegion must be true or false`);
    const cats = strList(f, 'dataCategories', path, 50);
    if (!fid || !from || !to || !mechanism || typeof outside !== 'boolean') return undefined;
    return { id: fid, from, to, dataCategories: cats, outsideOriginRegion: outside, mechanism: mechanism as DataFlow['mechanism'] };
  }).filter((x): x is DataFlow => Boolean(x));

  const acceptances = arr('acceptances').map((x, i): RiskAcceptance | undefined => {
    const path = `assessment.acceptances[${i}]`;
    if (typeof x !== 'object' || x === null) { errors.push(`${path} must be an object`); return undefined; }
    const r = x as Record<string, unknown>;
    const theme = str('theme', {}, r, path); const acceptedBy = str('acceptedBy', {}, r, path); const acceptedByName = str('acceptedByName', {}, r, path);
    const rationale = str('rationale', {}, r, path); const acceptedOn = str('acceptedOn', { pattern: ISO_DATE }, r, path);
    if (theme && !THEME_SET.has(theme)) errors.push(`${path}.theme is not a known theme`);
    if (acceptedBy && !ROLES.has(acceptedBy)) errors.push(`${path}.acceptedBy must be product-owner or data-protection-lead`);
    if (!theme || !acceptedBy || !acceptedByName || !rationale || !acceptedOn) return undefined;
    return { theme: theme as RiskAcceptance['theme'], acceptedBy: acceptedBy as RiskAcceptance['acceptedBy'], acceptedByName, rationale, acceptedOn };
  }).filter((x): x is RiskAcceptance => Boolean(x));

  const signatures = arr('signatures').map((x, i): Signature | undefined => {
    const path = `assessment.signatures[${i}]`;
    if (typeof x !== 'object' || x === null) { errors.push(`${path} must be an object`); return undefined; }
    const s = x as Record<string, unknown>;
    const role = str('role', {}, s, path); const name = str('name', {}, s, path); const signedAt = str('signedAt', {}, s, path); const contentHash = str('contentHash', {}, s, path);
    if (role && !ROLES.has(role)) errors.push(`${path}.role is not an allowed role`);
    if (!role || !name || !signedAt || !contentHash) return undefined;
    return { role: role as Signature['role'], name, signedAt, contentHash };
  }).filter((x): x is Signature => Boolean(x));

  const versions = arr('versions').map((x, i): Version | undefined => {
    const path = `assessment.versions[${i}]`;
    if (typeof x !== 'object' || x === null) { errors.push(`${path} must be an object`); return undefined; }
    const v = x as Record<string, unknown>;
    const number = v['number']; const at = str('at', {}, v, path); const contentHash = str('contentHash', {}, v, path);
    const changeSummary = strList(v, 'changeSummary', path, 100);
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) errors.push(`${path}.number must be a positive integer`);
    // Optional retained canonical content (October 2026): absent in legacy files; when present it must be a string
    // within the retention cap that reconstructs as canonical content, otherwise the file is rejected (not silently stripped).
    let content: string | undefined;
    const rawContent = v['content'];
    if (rawContent !== undefined) {
      if (typeof rawContent !== 'string') errors.push(`${path}.content must be a string`);
      else if (new TextEncoder().encode(rawContent).length > MAX_VERSION_CONTENT_BYTES) errors.push(`${path}.content exceeds ${MAX_VERSION_CONTENT_BYTES.toLocaleString('en-US')} bytes`);
      else if (!fromCanonical(rawContent)) errors.push(`${path}.content is not canonical assessment content`);
      else content = rawContent;
    }
    if (typeof number !== 'number' || !at || !contentHash) return undefined;
    return { number, at, contentHash, changeSummary, ...(content !== undefined ? { content } : {}) };
  }).filter((x): x is Version => Boolean(x));

  const dupCheck = <T,>(label: string, list: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    for (const item of list) { const k = key(item); if (seen.has(k)) errors.push(`assessment.${label} contains a duplicate "${k}"`); seen.add(k); }
  };
  dupCheck('mitigations', mitigations, (m) => m.mitigationId);
  dupCheck('flows', flows, (f) => f.id);
  dupCheck('acceptances', acceptances, (x) => x.theme);
  dupCheck('signatures', signatures, (x) => x.role);
  dupCheck('versions', versions, (x) => String(x.number));

  const dpoConsulted = o['dpoConsulted'];
  if (typeof dpoConsulted !== 'boolean') errors.push('assessment.dpoConsulted must be true or false');

  if (errors.length || !id || !title || !owner) return { ok: false, errors: errors.slice(0, 50) };
  return { ok: true, assessment: { schema: 'forethought.assessment', version: 1, id, title, owner, description, asOf, answers, mitigations, flows, acceptances, dpoConsulted: dpoConsulted as boolean, signatures, versions } };
}

export function serializeAssessment(a: Assessment): string {
  return JSON.stringify(a, null, 2);
}
