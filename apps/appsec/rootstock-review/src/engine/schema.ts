import { isValidRange, parseVersion } from './semver';
import { SEVERITIES } from './types';
import type { Advisory, LockSource, Lockgraph, PackageRecord, Policy, Severity, UnparsableEdge } from './types';

export const LIMITS = {
  maxBytes: 2 * 1024 * 1024, maxPackages: 2500, maxDepsPerPackage: 250, maxAdvisories: 200, maxRegistryVersions: 300, maxImports: 200,
  maxStringLength: 200, maxDepth: 6, maxListLength: 3000, maxValues: 200_000, maxNotes: 60, maxNoteLength: 400,
} as const;

export const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,80}$/;
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.maxStringLength;
export const byteLength = (t: string) => new TextEncoder().encode(t).length;

export interface ScanLimits { maxDepth: number; maxListLength: number; maxValues: number }

/** Iterative (non-recursive) structural scan: nesting depth, list and key counts, total values, finite numbers. */
export function scanStructure(root: unknown, limits: ScanLimits, label = 'Document'): string | null {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++visited > limits.maxValues) return `${label} has too many values (limit ${limits.maxValues}).`;
    if (depth > limits.maxDepth) return `${label}: nesting exceeds ${limits.maxDepth}.`;
    if (Array.isArray(value)) { if (value.length > limits.maxListLength) return `${label}: a list exceeds ${limits.maxListLength} entries.`; for (const x of value) stack.push({ value: x, depth: depth + 1 }); }
    else if (value && typeof value === 'object') { const keys = Object.keys(value as object); if (keys.length > limits.maxListLength) return `${label}: an object has more than ${limits.maxListLength} keys.`; for (const k of keys) stack.push({ value: (value as Record<string, unknown>)[k], depth: depth + 1 }); }
    else if (typeof value === 'number' && !Number.isFinite(value)) return `${label}: numbers must be finite.`;
  }
  return null;
}
const structuralProblem = (root: unknown) => scanStructure(root, { maxDepth: LIMITS.maxDepth, maxListLength: LIMITS.maxListLength, maxValues: LIMITS.maxValues });

export type LockResult = { ok: true; lockgraph: Lockgraph } | { ok: false; errors: string[] };

export function parseLockgraph(text: string): LockResult {
  if (byteLength(text) > LIMITS.maxBytes) return { ok: false, errors: [`Document exceeds ${LIMITS.maxBytes} bytes (UTF-8).`] };
  try { return validateLockgraph(JSON.parse(text)); } catch { return { ok: false, errors: ['Document is not valid JSON.'] }; }
}

/**
 * Inverse of parseLockgraph: canonical `rootstock.lockgraph/1` JSON with a fixed key order, optional fields only when
 * present, two-space indent and a trailing newline — so an exported snapshot (e.g. a converted package-lock.json) can be
 * edited offline (typically to add an advisory list) and re-imported through the same validator.
 */
export function serialiseLockgraph(lock: Lockgraph): string {
  const doc = {
    schema: 'rootstock.lockgraph/1' as const,
    name: lock.name,
    root: { name: lock.root.name, version: lock.root.version },
    direct: { ...lock.direct },
    imports: [...lock.imports],
    packages: lock.packages.map((p) => ({ name: p.name, version: p.version, license: p.license, dependencies: { ...p.dependencies }, ...(p.deprecated ? { deprecated: true } : {}), ...(p.hasInstallScript ? { hasInstallScript: true } : {}) })),
    registry: Object.fromEntries(Object.entries(lock.registry).map(([k, v]) => [k, [...v]])),
    advisories: lock.advisories.map((a) => ({ id: a.id, package: a.package, vulnerable: a.vulnerable, patched: a.patched, severity: a.severity, title: a.title, ...(a.cwe ? { cwe: a.cwe } : {}) })),
    policy: { licenses: { allow: [...lock.policy.licenses.allow], review: [...lock.policy.licenses.review], deny: [...lock.policy.licenses.deny] }, blockSeverity: lock.policy.blockSeverity, flagInstallScripts: lock.policy.flagInstallScripts, flagDeprecated: lock.policy.flagDeprecated },
    ...(lock.unparsable ? { unparsable: lock.unparsable.map((u) => ({ from: u.from, name: u.name, range: u.range })) } : {}),
    ...(lock.source ? { source: { kind: lock.source.kind, lockfileVersion: lock.source.lockfileVersion, includeDev: lock.source.includeDev, notes: [...lock.source.notes] } } : {}),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/** One advisory record, or null when malformed (id, package, vulnerable range, patched range or "", known severity, title). */
export function parseAdvisory(a: unknown): Advisory | null {
  if (!isObj(a) || !str(a.id) || !/^[A-Z0-9-]{4,40}$/.test(a.id) || !str(a.package) || !NAME.test(a.package) || !str(a.vulnerable) || !isValidRange(a.vulnerable)) return null;
  if (!str(a.patched) || (a.patched !== '' && !isValidRange(a.patched)) || !SEVERITIES.includes(a.severity as Severity) || !str(a.title)) return null;
  return { id: a.id, package: a.package, vulnerable: a.vulnerable, patched: a.patched, severity: a.severity as Severity, title: a.title, ...(str(a.cwe) && /^CWE-\d{1,5}$/.test(a.cwe) ? { cwe: a.cwe } : {}) };
}

/** Policy with defaults for the boolean flags; problems are appended to `errors` as `policy.<path> …`. */
export function parsePolicy(input: unknown, errors: string[]): Policy {
  const pol = isObj(input) ? input : {};
  const lic = isObj(pol.licenses) ? pol.licenses : {};
  const list = (v: unknown, key: string): string[] => { if (!Array.isArray(v) || v.length > LIMITS.maxListLength || !v.every(str)) { errors.push(`policy.licenses.${key} must be a list of SPDX identifiers.`); return []; } return [...(v as string[])]; };
  return {
    licenses: { allow: list(lic.allow, 'allow'), review: list(lic.review, 'review'), deny: list(lic.deny, 'deny') },
    blockSeverity: SEVERITIES.includes(pol.blockSeverity as Severity) ? (pol.blockSeverity as Severity) : (errors.push('policy.blockSeverity must be a known severity.'), 'high'),
    flagInstallScripts: pol.flagInstallScripts !== false,
    flagDeprecated: pol.flagDeprecated !== false,
  };
}

export function validateLockgraph(input: unknown): LockResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['Lock snapshot must be a JSON object.'] };
  const structural = structuralProblem(input);
  if (structural) return { ok: false, errors: [structural] };
  if (input.schema !== 'rootstock.lockgraph/1') errors.push('schema must be "rootstock.lockgraph/1".');
  if (!str(input.name) || !input.name) errors.push('name is required.');
  const root = isObj(input.root) ? input.root : {};
  if (!str(root.name) || !NAME.test(root.name) || !str(root.version) || !parseVersion(root.version)) errors.push('root needs a valid name and semver version.');

  const direct: Record<string, string> = {};
  if (!isObj(input.direct)) errors.push('direct must map package names to ranges.');
  else if (Object.keys(input.direct).length > LIMITS.maxDepsPerPackage) errors.push(`direct lists more than ${LIMITS.maxDepsPerPackage} dependencies.`);
  else for (const [k, r] of Object.entries(input.direct)) { if (!NAME.test(k) || !str(r) || !isValidRange(r)) errors.push(`direct dependency ${k} has an invalid name or range.`); else direct[k] = r; }

  const imports: string[] = [];
  if (!Array.isArray(input.imports) || input.imports.length > LIMITS.maxImports) errors.push('imports must be a list of imported package names.');
  else for (const i of input.imports) { if (!str(i) || !NAME.test(i)) errors.push(`import ${String(i)} is not a valid package name.`); else imports.push(i); }

  const packages: PackageRecord[] = [];
  const seen = new Set<string>();
  const rawPkgs = Array.isArray(input.packages) ? input.packages : [];
  if (rawPkgs.length === 0 || rawPkgs.length > LIMITS.maxPackages) errors.push(`packages must contain 1–${LIMITS.maxPackages} entries.`);
  for (const p of rawPkgs.slice(0, LIMITS.maxPackages)) {
    if (!isObj(p) || !str(p.name) || !NAME.test(p.name) || !str(p.version) || !parseVersion(p.version)) { errors.push(`package entry ${isObj(p) ? String(p.name) : ''} needs a valid name and semver version.`); continue; }
    const id = `${p.name}@${p.version}`;
    if (seen.has(id)) errors.push(`duplicate package ${id}.`);
    seen.add(id);
    if (typeof p.license !== 'string' || p.license.length > LIMITS.maxStringLength) errors.push(`package ${id} license must be a string (may be empty).`);
    const deps: Record<string, string> = {};
    if (p.dependencies !== undefined) {
      if (!isObj(p.dependencies) || Object.keys(p.dependencies).length > LIMITS.maxDepsPerPackage) errors.push(`package ${id} dependencies must be an object with at most ${LIMITS.maxDepsPerPackage} entries.`);
      else for (const [k, r] of Object.entries(p.dependencies)) { if (!NAME.test(k) || !str(r) || !isValidRange(r)) errors.push(`package ${id} dependency ${k} has an invalid name or range.`); else deps[k] = r; }
    }
    packages.push({ name: p.name, version: p.version, license: typeof p.license === 'string' ? p.license : '', dependencies: deps, ...(p.deprecated === true ? { deprecated: true } : {}), ...(p.hasInstallScript === true ? { hasInstallScript: true } : {}) });
  }

  const registry: Record<string, string[]> = {};
  if (input.registry !== undefined) {
    if (!isObj(input.registry)) errors.push('registry must map names to version lists.');
    else for (const [k, list] of Object.entries(input.registry)) {
      if (!NAME.test(k) || !Array.isArray(list) || list.length > LIMITS.maxRegistryVersions || !list.every((x) => str(x) && parseVersion(x))) { errors.push(`registry entry ${k} is invalid.`); continue; }
      registry[k] = [...(list as string[])];
    }
  }

  const advisories: Advisory[] = [];
  const advIds = new Set<string>();
  const rawAdv = Array.isArray(input.advisories) ? input.advisories : [];
  if (rawAdv.length > LIMITS.maxAdvisories) errors.push(`advisories exceeds ${LIMITS.maxAdvisories}.`);
  for (const a of rawAdv.slice(0, LIMITS.maxAdvisories)) {
    const parsed = parseAdvisory(a);
    if (!parsed) { errors.push(`advisory ${isObj(a) ? String(a.id) : ''} is malformed (needs id, package, vulnerable range, patched range or "", known severity, title).`); continue; }
    if (advIds.has(parsed.id)) errors.push(`duplicate advisory ${parsed.id}.`);
    advIds.add(parsed.id);
    advisories.push(parsed);
  }

  const policy = parsePolicy(input.policy, errors);

  // Optional, additive fields written by the package-lock.json converter (schema id unchanged).
  let unparsable: UnparsableEdge[] | undefined;
  if (input.unparsable !== undefined) {
    if (!Array.isArray(input.unparsable) || input.unparsable.length > LIMITS.maxListLength) errors.push('unparsable must be a list of {from, name, range} edges.');
    else {
      unparsable = [];
      input.unparsable.forEach((u, i) => {
        if (!isObj(u) || !str(u.from) || !u.from || !str(u.name) || !NAME.test(u.name) || !str(u.range)) { errors.push(`unparsable[${i}] needs from, a valid package name and a range string.`); return; }
        unparsable!.push({ from: u.from, name: u.name, range: u.range });
      });
    }
  }
  let source: LockSource | undefined;
  if (input.source !== undefined) {
    const s = isObj(input.source) ? input.source : {};
    const notesOk = Array.isArray(s.notes) && s.notes.length <= LIMITS.maxNotes && s.notes.every((n) => typeof n === 'string' && n.length <= LIMITS.maxNoteLength);
    if (s.kind !== 'package-lock.json' || (s.lockfileVersion !== 2 && s.lockfileVersion !== 3) || typeof s.includeDev !== 'boolean' || !notesOk) errors.push('source must describe a package-lock.json conversion (kind, lockfileVersion 2 or 3, includeDev, notes).');
    else source = { kind: 'package-lock.json', lockfileVersion: s.lockfileVersion, includeDev: s.includeDev, notes: [...(s.notes as string[])] };
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, lockgraph: { schema: 'rootstock.lockgraph/1', name: input.name as string, root: { name: root.name as string, version: root.version as string }, direct, imports, packages, registry, advisories, policy, ...(unparsable ? { unparsable } : {}), ...(source ? { source } : {}) } };
}
