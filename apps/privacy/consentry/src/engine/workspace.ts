import type { ConsentRecord, Policy, ProcessingEvent, Purpose, Subject, Workspace } from './types';

export interface ImportLimits {
  maxBytes: number;
  maxDepth: number;
  maxPurposes: number;
  maxSubjects: number;
  maxRecords: number;
  maxEvents: number;
  maxString: number;
}

export const DEFAULT_LIMITS: ImportLimits = {
  maxBytes: 2_000_000,
  maxDepth: 8,
  maxPurposes: 200,
  maxSubjects: 1_000,
  maxRecords: 5_000,
  maxEvents: 5_000,
  maxString: 2_000,
};

export type ParseResult = { ok: true; workspace: Workspace; warnings: string[] } | { ok: false; errors: string[] };

const REGIMES = new Set(['EU-GDPR', 'UK-GDPR', 'US-CA-CCPA', 'unknown']);
const PROTECTIVE_RULES = new Map<string, string>([
  ['R05-child-consent', 'child consent threshold'],
  ['R06-gpc-signal', 'Global Privacy Control opt-out'],
  ['R07-opt-out-on-record', 'recorded opt-out / withdrawal'],
  ['R08-objection', 'recorded objection'],
]);
const BASES = new Set(['consent', 'legitimate-interest', 'contract', 'notice-and-opt-out']);
const CATEGORIES = new Set(['essential', 'operations', 'analytics', 'personalisation', 'marketing', 'sale-or-share', 'research']);
const AGE_BANDS = new Set(['under-13', '13-15', '16-17', 'adult', 'unknown']);
const STATUSES = new Set(['granted', 'withdrawn', 'objected', 'opted-out']);
const MECHANISMS = new Set(['banner', 'preference-centre', 'account-settings', 'imported', 'opt-out-signal']);
const OUTCOMES = new Set(['allow', 'deny', 'review']);
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.errors.push(`${path} must be an object`);
      return undefined;
    }
    return v as Record<string, unknown>;
  }
  str(o: Record<string, unknown>, k: string, path: string, opt: { optional?: boolean; enumSet?: Set<string>; pattern?: RegExp; allowEmpty?: boolean } = {}): string | undefined {
    const v = o[k];
    if (v === undefined) {
      if (!opt.optional) this.errors.push(`${path}.${k} is required`);
      return undefined;
    }
    if (typeof v !== 'string') {
      this.errors.push(`${path}.${k} must be a string`);
      return undefined;
    }
    if (v.length > this.limits.maxString) {
      this.errors.push(`${path}.${k} is longer than ${this.limits.maxString} characters`);
      return undefined;
    }
    if (!v && !opt.allowEmpty) this.errors.push(`${path}.${k} must not be empty`);
    if (opt.enumSet && !opt.enumSet.has(v)) this.errors.push(`${path}.${k} "${v.slice(0, 30)}" is not an allowed value`);
    if (opt.pattern && !opt.pattern.test(v)) this.errors.push(`${path}.${k} "${v.slice(0, 30)}" is not a valid ISO timestamp`);
    return v;
  }
  bool(o: Record<string, unknown>, k: string, path: string, optional = false): boolean | undefined {
    const v = o[k];
    if (v === undefined) {
      if (!optional) this.errors.push(`${path}.${k} is required`);
      return undefined;
    }
    if (typeof v !== 'boolean') {
      this.errors.push(`${path}.${k} must be a boolean`);
      return undefined;
    }
    return v;
  }
  int(o: Record<string, unknown>, k: string, path: string, min: number, max: number): number {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      this.errors.push(`${path}.${k} must be an integer between ${min} and ${max}`);
      return min;
    }
    return v;
  }
  arr(o: Record<string, unknown>, k: string, path: string, max: number, required = true): unknown[] {
    const v = o[k];
    if (v === undefined) {
      if (required) this.errors.push(`${path}.${k} is required`);
      return [];
    }
    if (!Array.isArray(v)) {
      this.errors.push(`${path}.${k} must be an array`);
      return [];
    }
    if (v.length > max) {
      this.errors.push(`${path}.${k} has ${v.length} items; the limit is ${max}`);
      return [];
    }
    return v;
  }
  strArr(o: Record<string, unknown>, k: string, path: string, max: number): string[] {
    return this.arr(o, k, path, max).map((x, i) => {
      if (typeof x !== 'string' || x.length > this.limits.maxString) {
        this.errors.push(`${path}.${k}[${i}] must be a short string`);
        return '';
      }
      return x;
    });
  }
}

export function parseWorkspace(text: string, overrides: Partial<ImportLimits> = {}): ParseResult {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > limits.maxBytes) return { ok: false, errors: [`File is ${bytes.toLocaleString('en-US')} bytes; the limit is ${limits.maxBytes.toLocaleString('en-US')} bytes.`] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (exceedsDepth(raw, limits.maxDepth)) return { ok: false, errors: [`Nesting deeper than ${limits.maxDepth} levels is not accepted.`] };
  const v = new V(limits);
  const root = v.obj(raw, 'workspace');
  if (!root) return { ok: false, errors: v.errors };
  v.str(root, 'schema', 'workspace', { enumSet: new Set(['consentry.workspace']) });
  v.int(root, 'version', 'workspace', 1, 1);

  const p = v.obj(root['policy'], 'workspace.policy');
  let policy: Policy | undefined;
  if (p) {
    const th = v.obj(p['childAgeThreshold'], 'workspace.policy.childAgeThreshold');
    const thresholds = { 'EU-GDPR': 16, 'UK-GDPR': 13, 'US-CA-CCPA': 16 } as Policy['childAgeThreshold'];
    if (th) {
      for (const key of ['EU-GDPR', 'UK-GDPR', 'US-CA-CCPA'] as const) {
        const n = th[key];
        if (n !== 13 && n !== 16) v.errors.push(`workspace.policy.childAgeThreshold.${key} must be 13 or 16`);
        else thresholds[key] = n;
      }
    }
    policy = {
      id: v.str(p, 'id', 'workspace.policy') ?? 'policy',
      version: v.int(p, 'version', 'workspace.policy', 1, 10_000),
      childAgeThreshold: thresholds,
      consentMaxAgeDays: v.int(p, 'consentMaxAgeDays', 'workspace.policy', 1, 3_650),
      disabledRules: v.strArr(p, 'disabledRules', 'workspace.policy', 50),
    };
    // Disabling a rule is an intentional teaching facility (rule-ablation coverage), but switching off a
    // protective rule must be called out at import, not discovered later in a trace.
    for (const id of policy.disabledRules) {
      if (PROTECTIVE_RULES.has(id)) v.warnings.push(`workspace.policy.disabledRules: "${id}" is a protective rule (${PROTECTIVE_RULES.get(id)}); it is switched off as an educational override and every affected evaluation will show it as skipped`);
    }
  }

  const purposes = v.arr(root, 'purposes', 'workspace', limits.maxPurposes).map((x, i): Purpose | undefined => {
    const path = `workspace.purposes[${i}]`;
    const o = v.obj(x, path);
    if (!o) return undefined;
    const id = v.str(o, 'id', path);
    const name = v.str(o, 'name', path);
    const category = v.str(o, 'category', path, { enumSet: CATEGORIES });
    const description = v.str(o, 'description', path, { allowEmpty: true }) ?? '';
    const dataCategories = v.strArr(o, 'dataCategories', path, 30);
    const basisRaw = v.obj(o['basisByRegime'], `${path}.basisByRegime`);
    const basisByRegime: Purpose['basisByRegime'] = {};
    if (basisRaw) {
      for (const [k, val] of Object.entries(basisRaw)) {
        if (!REGIMES.has(k) || k === 'unknown') v.errors.push(`${path}.basisByRegime has unknown regime "${k.slice(0, 20)}"`);
        else if (typeof val !== 'string' || !BASES.has(val)) v.errors.push(`${path}.basisByRegime.${k} is not an allowed basis`);
        else basisByRegime[k as keyof Purpose['basisByRegime']] = val as Purpose['basisByRegime'][keyof Purpose['basisByRegime']];
      }
    }
    const policyVersion = v.int(o, 'policyVersion', path, 1, 10_000);
    const reconsent = v.bool(o, 'reconsentOnVersionChange', path);
    const lia = v.bool(o, 'liaDocumented', path, true);
    if (!id || !name || !category || reconsent === undefined) return undefined;
    return { id, name, category: category as Purpose['category'], description, dataCategories, basisByRegime, policyVersion, reconsentOnVersionChange: reconsent, ...(lia !== undefined ? { liaDocumented: lia } : {}) };
  }).filter((x): x is Purpose => Boolean(x));

  const subjects = v.arr(root, 'subjects', 'workspace', limits.maxSubjects).map((x, i): Subject | undefined => {
    const path = `workspace.subjects[${i}]`;
    const o = v.obj(x, path);
    if (!o) return undefined;
    const id = v.str(o, 'id', path);
    const label = v.str(o, 'label', path);
    const regime = v.str(o, 'regime', path, { enumSet: REGIMES });
    const ageBand = v.str(o, 'ageBand', path, { enumSet: AGE_BANDS });
    const gpc = v.bool(o, 'gpcSignal', path);
    if (!id || !label || !regime || !ageBand || gpc === undefined) return undefined;
    return { id, label, regime: regime as Subject['regime'], ageBand: ageBand as Subject['ageBand'], gpcSignal: gpc };
  }).filter((x): x is Subject => Boolean(x));

  const subjectIds = new Set(subjects.map((s) => s.id));
  const purposeIds = new Set(purposes.map((p) => p.id));

  const records = v.arr(root, 'records', 'workspace', limits.maxRecords).map((x, i): ConsentRecord | undefined => {
    const path = `workspace.records[${i}]`;
    const o = v.obj(x, path);
    if (!o) return undefined;
    const id = v.str(o, 'id', path);
    const subjectId = v.str(o, 'subjectId', path);
    const purposeId = v.str(o, 'purposeId', path);
    const status = v.str(o, 'status', path, { enumSet: STATUSES });
    const at = v.str(o, 'at', path, { pattern: TS });
    const policyVersion = v.int(o, 'policyVersion', path, 1, 10_000);
    const mechanism = v.str(o, 'mechanism', path, { enumSet: MECHANISMS });
    const regime = v.str(o, 'regime', path, { enumSet: REGIMES });
    const proofRef = v.str(o, 'proofRef', path, { allowEmpty: true }) ?? '';
    const expiresAt = v.str(o, 'expiresAt', path, { optional: true, pattern: TS });
    if (subjectId && !subjectIds.has(subjectId)) v.errors.push(`${path} references unknown subject "${subjectId.slice(0, 30)}"`);
    if (purposeId && !purposeIds.has(purposeId)) v.errors.push(`${path} references unknown purpose "${purposeId.slice(0, 30)}"`);
    if (!id || !subjectId || !purposeId || !status || !at || !mechanism || !regime) return undefined;
    return { id, subjectId, purposeId, status: status as ConsentRecord['status'], at, policyVersion, mechanism: mechanism as ConsentRecord['mechanism'], regime: regime as ConsentRecord['regime'], proofRef, ...(expiresAt ? { expiresAt } : {}) };
  }).filter((x): x is ConsentRecord => Boolean(x));

  const events = v.arr(root, 'events', 'workspace', limits.maxEvents).map((x, i): ProcessingEvent | undefined => {
    const path = `workspace.events[${i}]`;
    const o = v.obj(x, path);
    if (!o) return undefined;
    const id = v.str(o, 'id', path);
    const subjectId = v.str(o, 'subjectId', path);
    const purposeId = v.str(o, 'purposeId', path);
    const occurredAt = v.str(o, 'occurredAt', path, { pattern: TS });
    const channel = v.str(o, 'channel', path, { allowEmpty: true }) ?? '';
    if (subjectId && !subjectIds.has(subjectId)) v.errors.push(`${path} references unknown subject "${subjectId.slice(0, 30)}"`);
    if (purposeId && !purposeIds.has(purposeId)) v.warnings.push(`${id ?? path}: purpose "${purposeId.slice(0, 30)}" is not registered (will be routed to review)`);
    if (!id || !subjectId || !purposeId || !occurredAt) return undefined;
    return { id, subjectId, purposeId, occurredAt, channel };
  }).filter((x): x is ProcessingEvent => Boolean(x));

  const expectations = v.arr(root, 'expectations', 'workspace', limits.maxEvents, false).map((x, i): Workspace['expectations'][number] | undefined => {
    const path = `workspace.expectations[${i}]`;
    const o = v.obj(x, path);
    if (!o) return undefined;
    const eventId = v.str(o, 'eventId', path);
    const expect = v.str(o, 'expect', path, { enumSet: OUTCOMES });
    const reasonCode = v.str(o, 'reasonCode', path, { optional: true });
    if (!eventId || !expect) return undefined;
    return { eventId, expect: expect as 'allow' | 'deny' | 'review', ...(reasonCode ? { reasonCode: reasonCode as Workspace['expectations'][number]['reasonCode'] } : {}) };
  }).filter((x): x is Workspace['expectations'][number] => Boolean(x));

  for (const [label, list] of [['purposes', purposes], ['subjects', subjects], ['records', records], ['events', events]] as const) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) v.errors.push(`Duplicate ${label} id "${item.id}"`);
      seen.add(item.id);
    }
  }

  if (!policy || v.errors.length > 0) return { ok: false, errors: v.errors.slice(0, 50) };
  return { ok: true, workspace: { schema: 'consentry.workspace', version: 1, policy, purposes, subjects, records, events, expectations }, warnings: v.warnings };
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(ws, null, 2);
}
