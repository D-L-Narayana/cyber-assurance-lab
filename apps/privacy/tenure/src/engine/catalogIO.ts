import type { Catalog, DataElement, ExceptionSubject, ExceptionSubjectKind, Finding, Flow, Owner, RetentionException, RetentionSchedule, System } from './types';
import { canonicalCategory, canonicalMechanism, canonicalRegion, normaliseCatalog } from './normalise';

export interface ImportLimits {
  maxBytes: number;
  maxDepth: number;
  maxOwners: number;
  maxSystems: number;
  maxSchedules: number;
  maxElements: number;
  maxFlows: number;
  maxExceptions: number;
  maxString: number;
}

export const DEFAULT_LIMITS: ImportLimits = {
  maxBytes: 2_000_000,
  maxDepth: 6,
  maxOwners: 500,
  maxSystems: 200,
  maxSchedules: 100,
  maxElements: 2_000,
  maxFlows: 2_000,
  maxExceptions: 500,
  maxString: 1_000,
};

export type ParseResult = { ok: true; catalog: Catalog; notes: ReturnType<typeof normaliseCatalog>['notes']; warnings: string[] } | { ok: false; errors: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** True only for a real calendar date in YYYY-MM-DD form (2026-02-30 is rejected). */
export function isStrictDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const HOSTING = new Set(['internal', 'vendor']);
const TRIGGERS = new Set(['collection', 'last-activity', 'contract-end', 'employment-end']);
const EXC_STATUS = new Set(['proposed', 'approved', 'expired', 'rejected']);
const SUBJECT_KINDS = new Set(['element', 'flow']);
const FINDING_CODES = new Set(['ORPHAN_ELEMENT', 'MISSING_OWNER', 'INACTIVE_OWNER', 'MISSING_SCHEDULE', 'SPECIAL_CATEGORY_UNSCHEDULED', 'RETENTION_INFLATION', 'PURPOSE_DRIFT', 'UNMAPPED_TRANSFER', 'FLOW_CYCLE', 'DANGLING_FLOW', 'EXCEPTION_EXPIRED', 'EXCEPTION_APPROVER_INACTIVE', 'EXCEPTION_OUT_OF_POLICY', 'REVIEW_OVERDUE']);

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

class V {
  errors: string[] = [];
  warnings: string[] = [];
  constructor(private readonly limits: ImportLimits) {}
  obj(v: unknown, path: string): Record<string, unknown> | undefined {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) { this.errors.push(`${path} must be an object`); return undefined; }
    return v as Record<string, unknown>;
  }
  str(o: Record<string, unknown>, k: string, path: string, opt: { optional?: boolean; pattern?: RegExp; allowEmpty?: boolean; enumSet?: Set<string> } = {}): string | undefined {
    const v = o[k];
    if (v === undefined) { if (!opt.optional) this.errors.push(`${path}.${k} is required`); return undefined; }
    if (typeof v !== 'string') { this.errors.push(`${path}.${k} must be a string`); return undefined; }
    if (v.length > this.limits.maxString) { this.errors.push(`${path}.${k} is longer than ${this.limits.maxString} characters`); return undefined; }
    if (!v.trim() && !opt.allowEmpty) this.errors.push(`${path}.${k} must not be empty`);
    if (opt.pattern && !isStrictDate(v)) this.errors.push(`${path}.${k} "${v.slice(0, 30)}" is not a real calendar date (YYYY-MM-DD)`);
    if (opt.enumSet && !opt.enumSet.has(v)) this.errors.push(`${path}.${k} "${v.slice(0, 30)}" is not an allowed value`);
    return v;
  }
  int(o: Record<string, unknown>, k: string, path: string, min: number, max: number, optional = false): number | undefined {
    const v = o[k];
    if (v === undefined) { if (!optional) this.errors.push(`${path}.${k} is required`); return undefined; }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) { this.errors.push(`${path}.${k} must be an integer between ${min} and ${max}`); return undefined; }
    return v;
  }
  bool(o: Record<string, unknown>, k: string, path: string): boolean | undefined {
    const v = o[k];
    if (typeof v !== 'boolean') { this.errors.push(`${path}.${k} must be true or false`); return undefined; }
    return v;
  }
  arr(o: Record<string, unknown>, k: string, path: string, max: number): unknown[] {
    const v = o[k];
    if (v === undefined) { this.errors.push(`${path}.${k} is required`); return []; }
    if (!Array.isArray(v)) { this.errors.push(`${path}.${k} must be an array`); return []; }
    if (v.length > max) { this.errors.push(`${path}.${k} has ${v.length} items; the limit is ${max}`); return []; }
    return v;
  }
  strArr(o: Record<string, unknown>, k: string, path: string, max = 30): string[] {
    const v = o[k];
    if (v === undefined) { this.errors.push(`${path}.${k} is required`); return []; }
    if (!Array.isArray(v) || v.length > max) { this.errors.push(`${path}.${k} must be an array of at most ${max} strings`); return []; }
    return v.map((x, i) => { if (typeof x !== 'string' || x.length > this.limits.maxString) { this.errors.push(`${path}.${k}[${i}] must be a short string`); return ''; } return x; });
  }
}

export function parseCatalog(text: string, overrides: Partial<ImportLimits> = {}): ParseResult {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > limits.maxBytes) return { ok: false, errors: [`File is ${bytes.toLocaleString('en-US')} bytes; the limit is ${limits.maxBytes.toLocaleString('en-US')} bytes.`] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] }; }
  if (exceedsDepth(raw, limits.maxDepth)) return { ok: false, errors: [`Nesting deeper than ${limits.maxDepth} levels is not accepted.`] };
  const v = new V(limits);
  const root = v.obj(raw, 'catalog');
  if (!root) return { ok: false, errors: v.errors };
  v.str(root, 'schema', 'catalog', { enumSet: new Set(['tenure.catalog']) });
  v.int(root, 'version', 'catalog', 1, 1);
  const asOf = v.str(root, 'asOf', 'catalog', { pattern: ISO_DATE }) ?? '';

  const owners = v.arr(root, 'owners', 'catalog', limits.maxOwners).map((x, i): Owner | undefined => {
    const path = `catalog.owners[${i}]`; const o = v.obj(x, path); if (!o) return undefined;
    const id = v.str(o, 'id', path); const name = v.str(o, 'name', path); const team = v.str(o, 'team', path, { allowEmpty: true }) ?? '';
    const active = v.bool(o, 'active', path); const leftOn = v.str(o, 'leftOn', path, { optional: true, pattern: ISO_DATE });
    if (!id || !name || active === undefined) return undefined;
    return { id, name, team, active, ...(leftOn ? { leftOn } : {}) };
  }).filter((x): x is Owner => Boolean(x));

  const systems = v.arr(root, 'systems', 'catalog', limits.maxSystems).map((x, i): System | undefined => {
    const path = `catalog.systems[${i}]`; const o = v.obj(x, path); if (!o) return undefined;
    const id = v.str(o, 'id', path); const name = v.str(o, 'name', path);
    const ownerId = v.str(o, 'ownerId', path, { optional: true });
    const regionRaw = v.str(o, 'region', path); const region = regionRaw ? canonicalRegion(regionRaw) : undefined;
    if (regionRaw && !region) v.errors.push(`${path}.region "${regionRaw.slice(0, 30)}" is not a known region or synonym`);
    const hosting = v.str(o, 'hosting', path, { enumSet: HOSTING }); const vendor = v.str(o, 'vendor', path, { optional: true });
    const purposes = v.strArr(o, 'purposes', path);
    if (!id || !name || !region || !hosting) return undefined;
    return { id, name, region: regionRaw as System['region'], hosting: hosting as System['hosting'], purposes, ...(ownerId ? { ownerId } : {}), ...(vendor ? { vendor } : {}) };
  }).filter((x): x is System => Boolean(x));

  const schedules = v.arr(root, 'schedules', 'catalog', limits.maxSchedules).map((x, i): RetentionSchedule | undefined => {
    const path = `catalog.schedules[${i}]`; const o = v.obj(x, path); if (!o) return undefined;
    const id = v.str(o, 'id', path); const name = v.str(o, 'name', path);
    const days = v.int(o, 'days', path, 0, 36_500); const trigger = v.str(o, 'trigger', path, { enumSet: TRIGGERS });
    const reviewEveryDays = v.int(o, 'reviewEveryDays', path, 1, 3_650); const reference = v.str(o, 'reference', path, { optional: true });
    if (!id || !name || days === undefined || !trigger || reviewEveryDays === undefined) return undefined;
    return { id, name, days, trigger: trigger as RetentionSchedule['trigger'], reviewEveryDays, ...(reference ? { reference } : {}) };
  }).filter((x): x is RetentionSchedule => Boolean(x));

  const elements = v.arr(root, 'elements', 'catalog', limits.maxElements).map((x, i): DataElement | undefined => {
    const path = `catalog.elements[${i}]`; const o = v.obj(x, path); if (!o) return undefined;
    const id = v.str(o, 'id', path); const name = v.str(o, 'name', path);
    const catRaw = v.str(o, 'category', path); const category = catRaw ? canonicalCategory(catRaw) : undefined;
    if (catRaw && !category) v.errors.push(`${path}.category "${catRaw.slice(0, 30)}" is not a known category or synonym`);
    const systemId = v.str(o, 'systemId', path); const purposes = v.strArr(o, 'purposes', path);
    const scheduleId = v.str(o, 'scheduleId', path, { optional: true });
    const override = v.int(o, 'retentionDaysOverride', path, 0, 36_500, true);
    const sensitivity = v.int(o, 'sensitivity', path, 1, 4);
    const lastReviewedOn = v.str(o, 'lastReviewedOn', path, { optional: true, pattern: ISO_DATE });
    const subjectCount = v.int(o, 'subjectCount', path, 0, 1_000_000_000, true);
    if (!id || !name || !category || !systemId || sensitivity === undefined) return undefined;
    return { id, name, category: catRaw as DataElement['category'], systemId, purposes, sensitivity: sensitivity as DataElement['sensitivity'], ...(scheduleId ? { scheduleId } : {}), ...(override !== undefined ? { retentionDaysOverride: override } : {}), ...(lastReviewedOn ? { lastReviewedOn } : {}), ...(subjectCount !== undefined ? { subjectCount } : {}) };
  }).filter((x): x is DataElement => Boolean(x));

  const flows = v.arr(root, 'flows', 'catalog', limits.maxFlows).map((x, i): Flow | undefined => {
    const path = `catalog.flows[${i}]`; const o = v.obj(x, path); if (!o) return undefined;
    const id = v.str(o, 'id', path); const fromSystemId = v.str(o, 'fromSystemId', path); const toSystemId = v.str(o, 'toSystemId', path);
    const elementIds = v.strArr(o, 'elementIds', path, 200);
    const mechRaw = v.str(o, 'mechanism', path, { allowEmpty: true }); const mechanism = mechRaw !== undefined ? canonicalMechanism(mechRaw) : undefined;
    if (mechRaw !== undefined && !mechanism) v.errors.push(`${path}.mechanism "${mechRaw.slice(0, 30)}" is not a known mechanism or synonym`);
    const description = v.str(o, 'description', path, { optional: true });
    if (!id || !fromSystemId || !toSystemId || !mechanism) return undefined;
    return { id, fromSystemId, toSystemId, elementIds, mechanism: mechRaw as Flow['mechanism'], ...(description ? { description } : {}) };
  }).filter((x): x is Flow => Boolean(x));

  const exceptions = v.arr(root, 'exceptions', 'catalog', limits.maxExceptions).map((x, i): RetentionException | undefined => {
    const path = `catalog.exceptions[${i}]`; const o = v.obj(x, path); if (!o) return undefined;
    const id = v.str(o, 'id', path);
    // Subject (October 2026, additive): `{ kind: 'element' | 'flow', id }`; the legacy `elementId` is still accepted
    // and at least one of the two is required. Unknown keys inside `subject` are dropped by rebuilding it.
    const elementId = v.str(o, 'elementId', path, { optional: true });
    let subject: ExceptionSubject | undefined;
    if (o.subject !== undefined) {
      const so = v.obj(o.subject, `${path}.subject`);
      if (so) {
        const kind = v.str(so, 'kind', `${path}.subject`, { enumSet: SUBJECT_KINDS });
        const sid = v.str(so, 'id', `${path}.subject`);
        if (kind && sid) subject = { kind: kind as ExceptionSubjectKind, id: sid };
      }
    } else if (elementId === undefined) v.errors.push(`${path} needs a subject ({ kind, id }) or a legacy elementId`);
    const acceptsFinding = v.str(o, 'acceptsFinding', path, { enumSet: FINDING_CODES });
    const rationale = v.str(o, 'rationale', path, { allowEmpty: true }) ?? '';
    const approvedBy = v.str(o, 'approvedBy', path, { optional: true }); const approvedOn = v.str(o, 'approvedOn', path, { optional: true, pattern: ISO_DATE });
    const expiresOn = v.str(o, 'expiresOn', path, { pattern: ISO_DATE }); const status = v.str(o, 'status', path, { enumSet: EXC_STATUS });
    if (!id || !acceptsFinding || !expiresOn || !status) return undefined;
    return { id, acceptsFinding: acceptsFinding as RetentionException['acceptsFinding'], rationale, expiresOn, status: status as RetentionException['status'], ...(elementId ? { elementId } : {}), ...(subject ? { subject } : {}), ...(approvedBy ? { approvedBy } : {}), ...(approvedOn ? { approvedOn } : {}) };
  }).filter((x): x is RetentionException => Boolean(x));

  if (v.errors.length > 0) return { ok: false, errors: v.errors.slice(0, 50) };

  const { catalog, notes } = normaliseCatalog({ schema: 'tenure.catalog', version: 1, asOf, owners, systems, schedules, elements, flows, exceptions });

  for (const [label, list] of [['owners', catalog.owners], ['systems', catalog.systems], ['schedules', catalog.schedules], ['elements', catalog.elements], ['flows', catalog.flows], ['exceptions', catalog.exceptions]] as const) {
    const seen = new Set<string>();
    for (const item of list) { if (seen.has(item.id)) v.errors.push(`Duplicate ${label} id "${item.id}" (after normalisation)`); seen.add(item.id); }
  }
  if (catalog.systems.length === 0) v.errors.push('catalog.systems must contain at least one system');
  // Exception subjects must name a known id of their kind (checked after normalisation so synonyms/case do not matter).
  // Flow subjects are `flow-id` or `flow-id/element-id`. A legacy elementId that names no element is a warning, not an
  // error, so older files keep importing exactly as before.
  const elementIds = new Set(catalog.elements.map((e) => e.id));
  const flowIds = new Set(catalog.flows.map((f) => f.id));
  catalog.exceptions.forEach((x, i) => {
    const path = `catalog.exceptions[${i}]`;
    if (x.subject) {
      const shown = x.subject.id.slice(0, 60);
      if (x.subject.kind === 'element') {
        if (!elementIds.has(x.subject.id)) v.errors.push(`${path}.subject.id "${shown}" is not a known element`);
      } else {
        const slash = x.subject.id.indexOf('/');
        const flowId = slash === -1 ? x.subject.id : x.subject.id.slice(0, slash);
        const elId = slash === -1 ? undefined : x.subject.id.slice(slash + 1);
        if (!flowIds.has(flowId)) v.errors.push(`${path}.subject.id "${shown}" does not name a known flow`);
        else if (elId !== undefined && !elementIds.has(elId)) v.errors.push(`${path}.subject.id "${shown}" names a known flow but an unknown element after the slash`);
      }
    } else if (x.elementId !== undefined && !elementIds.has(x.elementId)) {
      v.warnings.push(`${path}.elementId "${x.elementId.slice(0, 60)}" is not a known element; this exception cannot accept any finding`);
    }
  });
  if (v.errors.length > 0) return { ok: false, errors: v.errors.slice(0, 50) };
  return { ok: true, catalog, notes, warnings: v.warnings };
}

export function serializeCatalog(catalog: Catalog): string {
  return JSON.stringify(catalog, null, 2);
}

/** Escapes a CSV cell; prefixes formula-triggering characters with a quote so spreadsheets treat them as text. */
export function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function findingsToCsv(findings: Finding[]): string {
  const header = ['id', 'code', 'severity', 'subjectKind', 'subjectId', 'systemId', 'accepted', 'exceptionId', 'message', 'why'];
  const rows = findings.map((f) => [f.id, f.code, f.severity, f.subject.kind, f.subject.id, f.systemId, f.accepted, f.exceptionId, f.message, f.why].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n');
}
