import { isValidRange, parseVersion } from './semver';
import { SEVERITIES } from './types';
import type { Advisory, Lockgraph, PackageRecord, Policy, Severity } from './types';

export const LIMITS = { maxBytes: 256 * 1024, maxPackages: 400, maxDepsPerPackage: 60, maxAdvisories: 200, maxRegistryVersions: 60, maxImports: 200, maxStringLength: 200, maxDepth: 6, maxListLength: 1000 } as const;

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,80}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.maxStringLength;
export const byteLength = (t: string) => new TextEncoder().encode(t).length;

function structuralProblem(root: unknown): string | null {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++visited > 200_000) return 'Document has too many values.';
    if (depth > LIMITS.maxDepth) return `Nesting exceeds ${LIMITS.maxDepth}.`;
    if (Array.isArray(value)) { if (value.length > LIMITS.maxListLength) return `A list exceeds ${LIMITS.maxListLength}.`; for (const x of value) stack.push({ value: x, depth: depth + 1 }); }
    else if (value && typeof value === 'object') { const keys = Object.keys(value as object); if (keys.length > LIMITS.maxListLength) return 'An object has too many keys.'; for (const k of keys) stack.push({ value: (value as Record<string, unknown>)[k], depth: depth + 1 }); }
    else if (typeof value === 'number' && !Number.isFinite(value)) return 'Numbers must be finite.';
  }
  return null;
}

export type LockResult = { ok: true; lockgraph: Lockgraph } | { ok: false; errors: string[] };

export function parseLockgraph(text: string): LockResult {
  if (byteLength(text) > LIMITS.maxBytes) return { ok: false, errors: [`Document exceeds ${LIMITS.maxBytes} bytes (UTF-8).`] };
  try { return validateLockgraph(JSON.parse(text)); } catch { return { ok: false, errors: ['Document is not valid JSON.'] }; }
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
      if (!isObj(p.dependencies) || Object.keys(p.dependencies).length > LIMITS.maxDepsPerPackage) errors.push(`package ${id} dependencies must be a small object.`);
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
    if (!isObj(a) || !str(a.id) || !/^[A-Z0-9-]{4,40}$/.test(a.id) || !str(a.package) || !NAME.test(a.package) || !str(a.vulnerable) || !isValidRange(a.vulnerable) || typeof a.patched !== 'string' || (a.patched !== '' && !isValidRange(a.patched)) || !SEVERITIES.includes(a.severity as Severity) || !str(a.title)) { errors.push(`advisory ${isObj(a) ? String(a.id) : ''} is malformed (needs id, package, vulnerable range, patched range or "", known severity, title).`); continue; }
    if (advIds.has(a.id)) errors.push(`duplicate advisory ${a.id}.`);
    advIds.add(a.id);
    advisories.push({ id: a.id, package: a.package, vulnerable: a.vulnerable, patched: a.patched, severity: a.severity as Severity, title: a.title, ...(str(a.cwe) && /^CWE-\d{1,5}$/.test(a.cwe) ? { cwe: a.cwe } : {}) });
  }

  const pol = isObj(input.policy) ? input.policy : {};
  const lic = isObj(pol.licenses) ? pol.licenses : {};
  const list = (v: unknown, key: string): string[] => { if (!Array.isArray(v) || !v.every(str)) { errors.push(`policy.licenses.${key} must be a list of SPDX identifiers.`); return []; } return [...(v as string[])]; };
  const policy: Policy = {
    licenses: { allow: list(lic.allow, 'allow'), review: list(lic.review, 'review'), deny: list(lic.deny, 'deny') },
    blockSeverity: SEVERITIES.includes(pol.blockSeverity as Severity) ? (pol.blockSeverity as Severity) : (errors.push('policy.blockSeverity must be a known severity.'), 'high'),
    flagInstallScripts: pol.flagInstallScripts !== false,
    flagDeprecated: pol.flagDeprecated !== false,
  };

  if (errors.length) return { ok: false, errors };
  return { ok: true, lockgraph: { schema: 'rootstock.lockgraph/1', name: input.name as string, root: { name: root.name as string, version: root.version as string }, direct, imports, packages, registry, advisories, policy } };
}
