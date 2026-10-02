// Bounded, path-addressed validation for bundles and manifests.
import { ARTIFACT_KINDS, type Artifact, type Assertion, type Bundle, type Link, type Manifest, type Signoff, type ValidationIssue, type ValidationResult } from './types';

export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
export const MAX_ARTIFACTS = 300;
export const MAX_ASSERTIONS = 200;
export const MAX_LINKS = 2000;
export const MAX_CONTENT = 50_000;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 200;

type Issues = ValidationIssue[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const HEX64 = /^[0-9a-f]{64}$/i;

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
function list<T>(v: unknown, path: string, issues: Issues, max: number, fn: (raw: unknown, p: string) => T): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    issues.push({ path, message: 'must be an array' });
    return [];
  }
  if (v.length > max) {
    issues.push({ path, message: `at most ${max} entries are accepted` });
    return [];
  }
  return v.map((raw, i) => fn(raw, `${path}[${i}]`));
}
function unique(items: { id: string }[], path: string, issues: Issues) {
  const seen = new Set<string>();
  items.forEach((x, i) => {
    if (seen.has(x.id)) issues.push({ path: `${path}[${i}].id`, message: `duplicate id ${x.id}` });
    seen.add(x.id);
  });
}

export function validateBundleObject(raw: unknown): ValidationResult<Bundle> {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '', message: 'bundle must be a JSON object' }] };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'weft.bundle/1') issues.push({ path: 'schema', message: "schema must be 'weft.bundle/1'" });
  const name = str(o.name, 'name', issues);
  const asOf = date(o.asOf, 'asOf', issues);

  const assertions: Assertion[] = list(o.assertions, 'assertions', issues, MAX_ASSERTIONS, (r, p) => {
    const a = obj(r);
    const periodStart = date(a.periodStart, p + '.periodStart', issues);
    const periodEnd = date(a.periodEnd, p + '.periodEnd', issues);
    if (periodEnd < periodStart) issues.push({ path: p + '.periodEnd', message: 'period must end on or after it starts' });
    return {
      id: str(a.id, p + '.id', issues, 64),
      controlRef: str(a.controlRef, p + '.controlRef', issues),
      statement: str(a.statement, p + '.statement', issues, MAX_TEXT),
      owner: str(a.owner ?? '', p + '.owner', issues, 80, 0),
      periodStart,
      periodEnd,
    };
  });
  unique(assertions, 'assertions', issues);

  const artifacts: Artifact[] = list(o.artifacts, 'artifacts', issues, MAX_ARTIFACTS, (r, p) => {
    const a = obj(r);
    const kind = typeof a.kind === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(a.kind) ? (a.kind as Artifact['kind']) : (issues.push({ path: p + '.kind', message: `must be one of ${ARTIFACT_KINDS.join(', ')}` }), 'note' as const);
    const art: Artifact = {
      id: str(a.id, p + '.id', issues, 64),
      name: str(a.name, p + '.name', issues),
      kind,
      capturedOn: date(a.capturedOn, p + '.capturedOn', issues),
      content: str(a.content, p + '.content', issues, MAX_CONTENT, 0),
    };
    if (a.declaredSha256 !== undefined) {
      const d = str(a.declaredSha256, p + '.declaredSha256', issues, 64, 0);
      if (!HEX64.test(d)) issues.push({ path: p + '.declaredSha256', message: 'must be 64 hex characters' });
      art.declaredSha256 = d.toLowerCase();
    }
    return art;
  });
  unique(artifacts, 'artifacts', issues);

  const links: Link[] = list(o.links, 'links', issues, MAX_LINKS, (r, p) => {
    const l = obj(r);
    const link: Link = { assertionId: str(l.assertionId, p + '.assertionId', issues, 64), artifactId: str(l.artifactId, p + '.artifactId', issues, 64) };
    if (l.note !== undefined) link.note = str(l.note, p + '.note', issues, MAX_TEXT, 0);
    return link;
  });

  const signoffs: Signoff[] = list(o.signoffs, 'signoffs', issues, MAX_ASSERTIONS, (r, p) => {
    const s = obj(r);
    const bh = str(s.bindingHash, p + '.bindingHash', issues, 64);
    if (bh && !HEX64.test(bh)) issues.push({ path: p + '.bindingHash', message: 'must be 64 hex characters' });
    return { assertionId: str(s.assertionId, p + '.assertionId', issues, 64), reviewer: str(s.reviewer, p + '.reviewer', issues, 80), signedOn: date(s.signedOn, p + '.signedOn', issues), bindingHash: bh.toLowerCase() };
  });

  if (issues.length) return { ok: false, issues: issues.slice(0, 60) };
  return { ok: true, value: { schema: 'weft.bundle/1', name, asOf, assertions, artifacts, links, signoffs } };
}

export function validateManifestObject(raw: unknown): ValidationResult<Manifest> {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '', message: 'manifest must be a JSON object' }] };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'weft.manifest/2') issues.push({ path: 'schema', message: "schema must be 'weft.manifest/2' (v1 manifests did not bind sign-offs or names; regenerate the manifest)" });
  const entries = list(o.entries, 'entries', issues, MAX_ARTIFACTS, (r, p) => {
    const e = obj(r);
    const sha = str(e.sha256, p + '.sha256', issues, 64);
    if (sha && !HEX64.test(sha)) issues.push({ path: p + '.sha256', message: 'must be 64 hex characters' });
    const bytes = typeof e.bytes === 'number' && Number.isInteger(e.bytes) && e.bytes >= 0 ? e.bytes : (issues.push({ path: p + '.bytes', message: 'must be a non-negative integer' }), 0);
    return { id: str(e.id, p + '.id', issues, 64), name: str(e.name, p + '.name', issues), sha256: sha.toLowerCase(), bytes };
  });
  const bindings = list(o.bindings, 'bindings', issues, MAX_ASSERTIONS, (r, p) => {
    const b = obj(r);
    const bh = str(b.bindingHash, p + '.bindingHash', issues, 64);
    if (bh && !HEX64.test(bh)) issues.push({ path: p + '.bindingHash', message: 'must be 64 hex characters' });
    return { assertionId: str(b.assertionId, p + '.assertionId', issues, 64), bindingHash: bh.toLowerCase() };
  });
  const signoffs = list(o.signoffs, 'signoffs', issues, MAX_ASSERTIONS, (r, p) => {
    const g = obj(r);
    const bh = str(g.bindingHash, p + '.bindingHash', issues, 64);
    if (bh && !HEX64.test(bh)) issues.push({ path: p + '.bindingHash', message: 'must be 64 hex characters' });
    return { assertionId: str(g.assertionId, p + '.assertionId', issues, 64), reviewer: str(g.reviewer, p + '.reviewer', issues, MAX_SHORT), signedOn: date(g.signedOn, p + '.signedOn', issues), bindingHash: bh.toLowerCase() };
  });
  const root = str(o.root, 'root', issues, 64);
  if (root && !HEX64.test(root)) issues.push({ path: 'root', message: 'must be 64 hex characters' });
  const m: Manifest = { schema: 'weft.manifest/2', bundleName: str(o.bundleName ?? '', 'bundleName', issues, MAX_SHORT, 0), generatedOn: date(o.generatedOn, 'generatedOn', issues), entries, bindings, signoffs, root: root.toLowerCase() };
  if (issues.length) return { ok: false, issues: issues.slice(0, 60) };
  return { ok: true, value: m };
}

function parse(text: string, label: string): { ok: true; raw: unknown } | { ok: false; issues: Issues } {
  if (text.length > MAX_BUNDLE_BYTES || new TextEncoder().encode(text).byteLength > MAX_BUNDLE_BYTES) return { ok: false, issues: [{ path: '', message: `${label} too large: limit is ${MAX_BUNDLE_BYTES} bytes` }] };
  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  }
}

export function validateBundle(text: string): ValidationResult<Bundle> {
  const p = parse(text, 'bundle');
  return p.ok ? validateBundleObject(p.raw) : p;
}

export function validateManifest(text: string): ValidationResult<Manifest> {
  const p = parse(text, 'manifest');
  return p.ok ? validateManifestObject(p.raw) : p;
}
