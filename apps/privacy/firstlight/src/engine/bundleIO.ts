import type { ContainmentTask, DataScopeItem, FactKey, IncidentBundle, IncidentEvent } from './types';

export interface ImportLimits { maxBytes: number; maxDepth: number; maxEvents: number; maxItems: number; maxString: number }
export const DEFAULT_LIMITS: ImportLimits = { maxBytes: 1_000_000, maxDepth: 5, maxEvents: 2_000, maxItems: 200, maxString: 4_000 };

export type ParseResult = { ok: true; bundle: IncidentBundle; warnings: string[] } | { ok: false; errors: string[] };

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** A timestamp is accepted only if it matches the ISO shape AND round-trips through Date as the same instant (rejects Feb 30, month 99, 24:00, minute 60). */
function isStrictTimestamp(v: string): boolean {
  if (!TS.test(v)) return false;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v)!;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}
const JURISDICTIONS = new Set(['EU-GDPR', 'UK-GDPR', 'US-CA']);
const TYPES = new Set(['misdirected-email', 'lost-device', 'unauthorised-access', 'misconfiguration', 'ransomware', 'insider']);
const KINDS = new Set(['occurred', 'detected', 'aware', 'contained', 'evidence', 'escalated', 'note']);
const CLASSES = new Set(['simple', 'behavioural', 'financial', 'sensitive']);
const EXPOSURES = new Set(['confidentiality', 'integrity', 'availability']);
const TASK_STATUS = new Set(['open', 'in-progress', 'done', 'not-applicable']);
const CONF = new Set(['none', 'known-recipients', 'unknown-recipients']);
const INT = new Set(['none', 'recoverable', 'unrecoverable']);
const AVAIL = new Set(['none', 'temporary', 'permanent']);
const EI = new Set(['negligible', 'limited', 'significant', 'maximum']);
const FACT_KEYS = new Set<FactKey>(['nature', 'categoriesOfSubjects', 'approxSubjects', 'categoriesOfRecords', 'approxRecords', 'contactPoint', 'likelyConsequences', 'measuresTaken', 'measuresProposed', 'awarenessBasis', 'crossBorderElements']);

/** Iterative, bounded nesting check; never recurses, so hostile nesting cannot overflow the stack. */
function exceedsDepth(root: unknown, max: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    if (depth + 1 > max) return true;
    for (const child of Object.values(value as Record<string, unknown>)) if (child !== null && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
  }
  return false;
}

export function parseBundle(text: string, overrides: Partial<ImportLimits> = {}): ParseResult {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const errors: string[] = [];
  const warnings: string[] = [];
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > limits.maxBytes) return { ok: false, errors: [`File is ${bytes.toLocaleString('en-US')} bytes; the limit is ${limits.maxBytes.toLocaleString('en-US')} bytes.`] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] }; }
  if (exceedsDepth(raw, limits.maxDepth)) return { ok: false, errors: [`Nesting deeper than ${limits.maxDepth} levels is not accepted.`] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Bundle must be a JSON object.'] };
  const o = raw as Record<string, unknown>;

  const str = (src: Record<string, unknown>, k: string, path: string, opt: { optional?: boolean; pattern?: RegExp; enumSet?: Set<string>; allowEmpty?: boolean } = {}): string | undefined => {
    const v = src[k];
    if (v === undefined) { if (!opt.optional) errors.push(`${path}.${k} is required`); return undefined; }
    if (typeof v !== 'string') { errors.push(`${path}.${k} must be a string`); return undefined; }
    if (v.length > limits.maxString) { errors.push(`${path}.${k} is too long`); return undefined; }
    if (!v.trim() && !opt.allowEmpty) errors.push(`${path}.${k} must not be empty`);
    if (opt.pattern && !isStrictTimestamp(v)) errors.push(`${path}.${k} "${v.slice(0, 30)}" is not a valid ISO 8601 UTC/offset timestamp for a real instant`);
    if (opt.enumSet && !opt.enumSet.has(v)) errors.push(`${path}.${k} "${v.slice(0, 30)}" is not an allowed value`);
    return v;
  };
  const num = (src: Record<string, unknown>, k: string, path: string, min: number, max: number): number | undefined => {
    const v = src[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { errors.push(`${path}.${k} must be a number between ${min} and ${max}`); return undefined; }
    return v;
  };
  const bool = (src: Record<string, unknown>, k: string, path: string, optional = false): boolean | undefined => {
    const v = src[k];
    if (v === undefined && optional) return undefined;
    if (typeof v !== 'boolean') { errors.push(`${path}.${k} must be true or false`); return undefined; }
    return v;
  };
  const arr = (k: string, max: number): unknown[] => {
    const v = o[k];
    if (v === undefined) { errors.push(`bundle.${k} is required`); return []; }
    if (!Array.isArray(v)) { errors.push(`bundle.${k} must be an array`); return []; }
    if (v.length > max) { errors.push(`bundle.${k} has ${v.length} items; the limit is ${max}`); return []; }
    return v;
  };
  const obj = (v: unknown, path: string): Record<string, unknown> | undefined => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) { errors.push(`${path} must be an object`); return undefined; }
    return v as Record<string, unknown>;
  };

  if (o['schema'] !== 'firstlight.incident') errors.push('bundle.schema must be "firstlight.incident"');
  if (o['version'] !== 1) errors.push('bundle.version must be 1');
  const id = str(o, 'id', 'bundle'); const title = str(o, 'title', 'bundle');
  const incidentType = str(o, 'incidentType', 'bundle', { enumSet: TYPES });
  const controllerRole = str(o, 'controllerRole', 'bundle', { enumSet: new Set(['controller', 'processor']) });
  const jurisdictions = arr('jurisdictions', 10).map((j, i) => { if (typeof j !== 'string' || !JURISDICTIONS.has(j)) { errors.push(`bundle.jurisdictions[${i}] is not an allowed value`); return ''; } return j; }).filter(Boolean) as IncidentBundle['jurisdictions'];
  if (jurisdictions.length === 0) errors.push('bundle.jurisdictions must list at least one jurisdiction');

  const events = arr('events', limits.maxEvents).map((x, i): IncidentEvent | undefined => {
    const path = `bundle.events[${i}]`; const e = obj(x, path); if (!e) return undefined;
    const eid = str(e, 'id', path); const at = str(e, 'at', path, { pattern: TS }); const kind = str(e, 'kind', path, { enumSet: KINDS });
    const source = str(e, 'source', path, { allowEmpty: true }) ?? ''; const summary = str(e, 'summary', path, { allowEmpty: true }) ?? '';
    const personal = bool(e, 'personal', path, true);
    if (!eid || !at || !kind) return undefined;
    return { id: eid, at, kind: kind as IncidentEvent['kind'], source, summary, ...(personal !== undefined ? { personal } : {}) };
  }).filter((x): x is IncidentEvent => Boolean(x));

  const dataScope = arr('dataScope', limits.maxItems).map((x, i): DataScopeItem | undefined => {
    const path = `bundle.dataScope[${i}]`; const d = obj(x, path); if (!d) return undefined;
    const did = str(d, 'id', path); const category = str(d, 'category', path); const dataClass = str(d, 'dataClass', path, { enumSet: CLASSES });
    const subjects = num(d, 'subjects', path, 0, 10_000_000_000); const records = num(d, 'records', path, 0, 10_000_000_000);
    const encrypted = bool(d, 'encrypted', path); const estimate = bool(d, 'estimate', path);
    const exposure = Array.isArray(d['exposure']) ? (d['exposure'] as unknown[]).filter((v): v is DataScopeItem['exposure'][number] => typeof v === 'string' && EXPOSURES.has(v)) : [];
    if (!Array.isArray(d['exposure']) || exposure.length !== (d['exposure'] as unknown[]).length) errors.push(`${path}.exposure must list confidentiality, integrity and/or availability`);
    if (!did || !category || !dataClass || subjects === undefined || records === undefined || encrypted === undefined || estimate === undefined) return undefined;
    return { id: did, category, dataClass: dataClass as DataScopeItem['dataClass'], subjects, records, encrypted, exposure, estimate };
  }).filter((x): x is DataScopeItem => Boolean(x));

  const cRaw = obj(o['circumstances'], 'bundle.circumstances');
  const circumstances = cRaw ? {
    confidentialityLoss: (str(cRaw, 'confidentialityLoss', 'bundle.circumstances', { enumSet: CONF }) ?? 'none') as IncidentBundle['circumstances']['confidentialityLoss'],
    integrityLoss: (str(cRaw, 'integrityLoss', 'bundle.circumstances', { enumSet: INT }) ?? 'none') as IncidentBundle['circumstances']['integrityLoss'],
    availabilityLoss: (str(cRaw, 'availabilityLoss', 'bundle.circumstances', { enumSet: AVAIL }) ?? 'none') as IncidentBundle['circumstances']['availabilityLoss'],
    maliciousIntent: bool(cRaw, 'maliciousIntent', 'bundle.circumstances') ?? false,
    dpcAdjustment: num(cRaw, 'dpcAdjustment', 'bundle.circumstances', -3, 3) ?? 0,
    dpcJustification: str(cRaw, 'dpcJustification', 'bundle.circumstances', { allowEmpty: true }) ?? '',
    easeOfIdentification: (str(cRaw, 'easeOfIdentification', 'bundle.circumstances', { enumSet: EI }) ?? 'maximum') as IncidentBundle['circumstances']['easeOfIdentification'],
  } : undefined;

  const containment = arr('containment', limits.maxItems).map((x, i): ContainmentTask | undefined => {
    const path = `bundle.containment[${i}]`; const c = obj(x, path); if (!c) return undefined;
    const cid = str(c, 'id', path); const ctitle = str(c, 'title', path); const status = str(c, 'status', path, { enumSet: TASK_STATUS });
    const evidenceRef = str(c, 'evidenceRef', path, { optional: true, allowEmpty: true }); const owner = str(c, 'owner', path, { optional: true, allowEmpty: true });
    if (!cid || !ctitle || !status) return undefined;
    return { id: cid, title: ctitle, status: status as ContainmentTask['status'], ...(evidenceRef ? { evidenceRef } : {}), ...(owner ? { owner } : {}) };
  }).filter((x): x is ContainmentTask => Boolean(x));

  const facts: IncidentBundle['facts'] = {};
  const fRaw = obj(o['facts'] ?? {}, 'bundle.facts');
  if (fRaw) for (const [k, v] of Object.entries(fRaw)) {
    if (!FACT_KEYS.has(k as FactKey)) { warnings.push(`bundle.facts.${k.slice(0, 30)} is not a known fact and was dropped`); continue; }
    if (typeof v !== 'string' || v.length > limits.maxString) { errors.push(`bundle.facts.${k} must be a short string`); continue; }
    facts[k as FactKey] = v;
  }

  // Redaction terms are rejected, never silently dropped: a bundle that claims redaction must carry every token it relies on.
  const personalTokens: string[] = [];
  const pt = o['personalTokens'];
  if (!Array.isArray(pt)) errors.push('bundle.personalTokens must be an array of strings');
  else if (pt.length > limits.maxItems) errors.push(`bundle.personalTokens has ${pt.length} items; the limit is ${limits.maxItems}`);
  else pt.forEach((t, i) => { if (typeof t !== 'string' || !t.trim() || t.length > 200) errors.push(`bundle.personalTokens[${i}] must be a non-empty string of at most 200 characters`); else personalTokens.push(t); });

  for (const [label, list] of [['events', events], ['dataScope', dataScope], ['containment', containment]] as const) {
    const seen = new Set<string>();
    for (const item of list) { if (seen.has(item.id)) errors.push(`Duplicate ${label} id "${item.id}"`); seen.add(item.id); }
  }

  if (errors.length || !id || !title || !incidentType || !controllerRole || !circumstances) return { ok: false, errors: errors.slice(0, 50) };
  return { ok: true, bundle: { schema: 'firstlight.incident', version: 1, id, title, incidentType: incidentType as IncidentBundle['incidentType'], jurisdictions, controllerRole: controllerRole as IncidentBundle['controllerRole'], events, dataScope, circumstances, containment, facts, personalTokens }, warnings };
}

export function serializeBundle(b: IncidentBundle): string {
  return JSON.stringify(b, null, 2);
}

/** Marks a containment task done; evidence is mandatory so "done" always points at something checkable. */
export function completeTask(b: IncidentBundle, taskId: string, evidenceRef: string): IncidentBundle {
  const task = b.containment.find((c) => c.id === taskId);
  if (!task) throw new Error(`Containment task "${taskId}" not found.`);
  if (!evidenceRef.trim()) throw new Error('An evidence reference is required to mark a task done.');
  return { ...b, containment: b.containment.map((c) => (c.id === taskId ? { ...c, status: 'done', evidenceRef: evidenceRef.trim() } : c)) };
}
