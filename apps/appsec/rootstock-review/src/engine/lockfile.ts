import demo from '../fixtures/ledgerly-lockgraph.json';
import { LIMITS, NAME, byteLength, isObj, parseAdvisory, parsePolicy, scanStructure, validateLockgraph } from './schema';
import { compareVersions, describeUnsupportedRange, isValidRange, parseVersion } from './semver';
import type { Advisory, Lockgraph, PackageRecord, Policy, UnparsableEdge } from './types';

/**
 * Offline importer for npm `package-lock.json` (lockfileVersion 2 and 3) into `rootstock.lockgraph/1`.
 * Only the `packages` map is read (the legacy v2 `dependencies` tree is ignored). Nothing is fetched: advisories and
 * import evidence are whatever the caller supplies, and the notes say so. Every bound is checked before work is done.
 */
export interface ConvertOptions { imports?: string[]; includeDev?: boolean; advisories?: Advisory[]; policy?: Policy }
export type ConvertResult = { ok: true; lockgraph: Lockgraph; notes: string[] } | { ok: false; errors: string[] };

/** Structural bounds for the `packages` map itself (the lockgraph bounds in LIMITS apply to the converted result). */
export const LOCKFILE_LIMITS = { maxDepth: 10, maxValues: 400_000 } as const;
export const NO_ADVISORIES_NOTE = 'No advisory data supplied — nothing was fetched from any registry or advisory database.';
export const NO_IMPORTS_NOTE = 'No import evidence supplied — reachability is unknown for every package until the names of the direct dependencies the application imports are provided.';
/** The demo snapshot's policy is the default for converted lockfiles. */
export const DEFAULT_POLICY: Policy = parsePolicy(demo.policy, []);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listSome = (items: string[], max = 6) => items.slice(0, max).join(', ') + (items.length > max ? `, … (${items.length - max} more)` : '');
const clip = (s: string, max: number = LIMITS.maxStringLength) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const sortKeys = (o: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => byCodeUnit(a, b)));

interface Ranges { deps: Record<string, string>; bad: UnparsableEdge[]; count: number; peers: number; invalid: number }
/** Dependency ranges of one entry, later fields overriding earlier ones (npm: optionalDependencies override dependencies). */
function collectRanges(from: string, entry: Record<string, unknown>, fields: readonly string[]): Ranges {
  const deps: Record<string, string> = {};
  const badByName = new Map<string, string>();
  let invalid = 0;
  for (const field of fields) {
    const raw = entry[field];
    if (raw === undefined) continue;
    if (!isObj(raw)) { invalid++; continue; }
    for (const [name, range] of Object.entries(raw)) {
      if (!NAME.test(name) || typeof range !== 'string') { invalid++; continue; }
      if (isValidRange(range)) { deps[name] = range; badByName.delete(name); }
      else { delete deps[name]; badByName.set(name, clip(range)); }
    }
  }
  const bad = [...badByName].map(([name, range]) => ({ from, name, range }));
  return { deps, bad, count: Object.keys(deps).length + bad.length, peers: isObj(entry.peerDependencies) ? Object.keys(entry.peerDependencies).length : 0, invalid };
}

function validateImports(raw: unknown, errors: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { errors.push('options.imports must be a list of package names.'); return []; }
  if (raw.length > LIMITS.maxImports) { errors.push(`options.imports has ${raw.length} entries; the limit is ${LIMITS.maxImports}.`); return []; }
  const out = new Set<string>();
  raw.forEach((v, i) => { if (typeof v !== 'string' || !NAME.test(v)) errors.push(`options.imports[${i}] ${JSON.stringify(typeof v === 'string' ? clip(v, 60) : v)} is not a valid package name.`); else out.add(v); });
  return [...out].sort(byCodeUnit);
}

function validateAdvisories(raw: unknown, errors: string[]): Advisory[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { errors.push('options.advisories must be a list of advisory records.'); return []; }
  if (raw.length > LIMITS.maxAdvisories) { errors.push(`options.advisories has ${raw.length} entries; the limit is ${LIMITS.maxAdvisories}.`); return []; }
  const out: Advisory[] = [];
  const ids = new Set<string>();
  raw.forEach((a, i) => {
    const parsed = parseAdvisory(a);
    if (!parsed) { errors.push(`options.advisories[${i}] is malformed (needs id, package, vulnerable range, patched range or "", known severity, title).`); return; }
    if (ids.has(parsed.id)) { errors.push(`options.advisories[${i}] repeats id ${parsed.id}.`); return; }
    ids.add(parsed.id); out.push(parsed);
  });
  return out.sort((a, b) => byCodeUnit(a.id, b.id));
}

export function convertPackageLock(text: string, opts: ConvertOptions = {}): ConvertResult {
  if (typeof text !== 'string') return { ok: false, errors: ['package-lock.json text is required.'] };
  const bytes = byteLength(text);
  if (bytes > LIMITS.maxBytes) return { ok: false, errors: [`package-lock.json is ${bytes} bytes; the limit is ${LIMITS.maxBytes} bytes (2 MiB, UTF-8).`] };
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { ok: false, errors: ['package-lock.json is not valid JSON.'] }; }
  if (!isObj(doc)) return { ok: false, errors: ['package-lock.json must be a JSON object.'] };
  const lfv = doc.lockfileVersion;
  if (lfv === 1) return { ok: false, errors: ['lockfileVersion 1 is not supported: npm 6 lockfiles have no "packages" map. Regenerate the lockfile with npm 7 or later (lockfileVersion 2 or 3).'] };
  if (lfv !== 2 && lfv !== 3) return { ok: false, errors: [`lockfileVersion must be 2 or 3 (found ${typeof lfv === 'number' || typeof lfv === 'string' ? String(lfv) : 'none'}).`] };
  const lockfileVersion: 2 | 3 = lfv;
  const packages = doc.packages;
  if (!isObj(packages)) return { ok: false, errors: ['"packages" must be an object mapping install paths to package entries (present in lockfileVersion 2 and 3).'] };
  const keys = Object.keys(packages).filter((k) => k !== '').sort(byCodeUnit);
  if (keys.length > LIMITS.maxPackages) return { ok: false, errors: [`"packages" contains ${keys.length} entries; the limit is ${LIMITS.maxPackages}.`] };
  const structural = scanStructure(packages, { maxDepth: LOCKFILE_LIMITS.maxDepth, maxListLength: LIMITS.maxListLength, maxValues: LOCKFILE_LIMITS.maxValues }, '"packages"');
  if (structural) return { ok: false, errors: [structural] };

  // Caller-supplied options are validated up front with path-addressed messages.
  const errors: string[] = [];
  const includeDev = opts.includeDev === true;
  const imports = validateImports(opts.imports, errors);
  const advisories = validateAdvisories(opts.advisories, errors);
  const policyErrors: string[] = [];
  const policy = opts.policy === undefined ? DEFAULT_POLICY : parsePolicy(opts.policy, policyErrors);
  errors.push(...policyErrors.map((e) => `options.${e}`));
  if (errors.length) return { ok: false, errors };

  const rootRaw = packages[''];
  if (!isObj(rootRaw)) return { ok: false, errors: ['packages[""] (the root project entry) is missing or not an object.'] };
  const rootNotes: string[] = [];
  let rootName = typeof rootRaw.name === 'string' ? rootRaw.name : typeof doc.name === 'string' ? doc.name : '';
  if (!NAME.test(rootName) || rootName.length > 100) { rootNotes.push(rootName ? `Root name "${clip(rootName, 60)}" is not a valid npm package name for this tool; recorded as "root".` : 'Root entry has no name; recorded as "root".'); rootName = 'root'; }
  let rootVersion = typeof rootRaw.version === 'string' && parseVersion(rootRaw.version) ? rootRaw.version : '';
  if (!rootVersion) { rootNotes.push('Root entry packages[""] has no semver version; recorded as 0.0.0.'); rootVersion = '0.0.0'; }
  const rootId = `${rootName}@${rootVersion}`;

  interface Rec { name: string; version: string; license: string; dependencies: Record<string, string>; deprecated: boolean; hasInstallScript: boolean }
  const records = new Map<string, Rec>();
  const unparsable: UnparsableEdge[] = [];
  const skipped: string[] = [];
  const aliases: string[] = [];
  let devExcluded = 0, devIncluded = 0, peerRanges = 0, duplicates = 0, conflictingRanges = 0, unusableLicenses = 0, invalidDeps = 0;

  const rootRanges = collectRanges(rootId, rootRaw, includeDev ? ['devDependencies', 'dependencies', 'optionalDependencies'] : ['dependencies', 'optionalDependencies']);
  if (rootRanges.count > LIMITS.maxDepsPerPackage) errors.push(`packages[""] declares ${rootRanges.count} direct dependencies; the limit is ${LIMITS.maxDepsPerPackage}.`);
  peerRanges += rootRanges.peers; invalidDeps += rootRanges.invalid;
  unparsable.push(...rootRanges.bad);

  for (const key of keys) {
    const entry = packages[key];
    if (!isObj(entry)) { skipped.push(`${key} (entry is not an object)`); continue; }
    if (entry.link === true) { skipped.push(`${key} (symlink entry)`); continue; }
    const idx = key.lastIndexOf('node_modules/');
    if (idx < 0) { skipped.push(`${key} (workspace path without node_modules/)`); continue; }
    const name = key.slice(idx + 'node_modules/'.length);
    if (!NAME.test(name)) { skipped.push(`${key} (name is not valid for this tool)`); continue; }
    if (entry.dev === true) { if (!includeDev) { devExcluded++; continue; } devIncluded++; }
    if (typeof entry.version !== 'string' || !parseVersion(entry.version)) { skipped.push(`${key} (no semver version)`); continue; }
    const version = entry.version;
    const id = `${name}@${version}`;
    if (typeof entry.name === 'string' && entry.name !== name) aliases.push(`${key} contains ${clip(entry.name, 60)}@${version}, recorded under the install name ${name}`);
    const ranges = collectRanges(id, entry, ['dependencies', 'optionalDependencies']);
    if (ranges.count > LIMITS.maxDepsPerPackage) { errors.push(`packages["${key}"].dependencies has ${ranges.count} entries; the limit is ${LIMITS.maxDepsPerPackage}.`); continue; }
    peerRanges += ranges.peers; invalidDeps += ranges.invalid;
    let license = '';
    if (typeof entry.license === 'string') { if (entry.license.length <= LIMITS.maxStringLength) license = entry.license; else unusableLicenses++; }
    else if (entry.license !== undefined) unusableLicenses++;
    const deprecated = entry.deprecated === true || (typeof entry.deprecated === 'string' && entry.deprecated.trim() !== '');
    const hasInstallScript = entry.hasInstallScript === true;
    const existing = records.get(id);
    if (existing) {
      duplicates++;
      for (const [k, r] of Object.entries(ranges.deps)) { if (existing.dependencies[k] === undefined) existing.dependencies[k] = r; else if (existing.dependencies[k] !== r) conflictingRanges++; }
      existing.deprecated ||= deprecated; existing.hasInstallScript ||= hasInstallScript;
      if (!existing.license) existing.license = license;
      for (const b of ranges.bad) if (!unparsable.some((u) => u.from === b.from && u.name === b.name && u.range === b.range)) unparsable.push(b);
      continue;
    }
    records.set(id, { name, version, license, dependencies: ranges.deps, deprecated, hasInstallScript });
    unparsable.push(...ranges.bad);
  }
  if (records.size === 0) errors.push(`No package entries could be recorded${skipped.length ? ` (${listSome(skipped)})` : ''}${devExcluded ? `; ${devExcluded} dev-only entries were excluded — include devDependencies to review them` : ''}.`);
  if (errors.length) return { ok: false, errors };

  const packagesOut: PackageRecord[] = [...records.values()]
    .sort((a, b) => byCodeUnit(a.name, b.name) || compareVersions(a.version, b.version))
    .map((r) => ({ name: r.name, version: r.version, license: r.license, dependencies: sortKeys(r.dependencies), ...(r.deprecated ? { deprecated: true } : {}), ...(r.hasInstallScript ? { hasInstallScript: true } : {}) }));
  const registry: Record<string, string[]> = {};
  for (const p of packagesOut) (registry[p.name] ??= []).push(p.version);
  for (const [n, vs] of Object.entries(registry)) if (vs.length > LIMITS.maxRegistryVersions) errors.push(`${n} is present in ${vs.length} versions; the limit is ${LIMITS.maxRegistryVersions}.`);
  if (errors.length) return { ok: false, errors };
  unparsable.sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.name, b.name) || byCodeUnit(a.range, b.range));
  const direct = sortKeys(rootRanges.deps);

  const notes: string[] = [];
  notes.push(`Converted offline from package-lock.json (lockfileVersion ${lockfileVersion}): only the "packages" map was read${lockfileVersion === 2 ? '; the legacy "dependencies" tree was ignored' : ''}. ${plural(keys.length, 'entry', 'entries')} read, ${plural(packagesOut.length, 'package record')} kept.`);
  notes.push(...rootNotes);
  notes.push(includeDev ? `devDependencies included: ${plural(devIncluded, 'dev-only package entry', 'dev-only package entries')} added to the snapshot.` : `${plural(devExcluded, 'dev-only package entry', 'dev-only package entries')} excluded (devDependencies are left out unless "include devDependencies" is ticked).`);
  if (duplicates) notes.push(`${plural(duplicates, 'duplicate name@version entry', 'duplicate name@version entries')} (same package installed at several paths) merged into one record with the union of dependency ranges${conflictingRanges ? ` (${conflictingRanges} conflicting range(s) kept from the first path)` : ''}.`);
  if (skipped.length) notes.push(clip(`${plural(skipped.length, 'entry', 'entries')} skipped: ${listSome(skipped)}.`, LIMITS.maxNoteLength));
  if (aliases.length) notes.push(clip(`${plural(aliases.length, 'alias install')}: ${listSome(aliases, 4)} — advisories for the real package name would not match the alias.`, LIMITS.maxNoteLength));
  notes.push(`${plural(peerRanges, 'peer-dependency range')} excluded: peers are supplied by the host project, not by the package that declares them.`);
  if (unparsable.length) notes.push(clip(`${plural(unparsable.length, 'dependency range')} outside the supported semver subset recorded as unresolved edges (never matched, never widened): ${listSome(unparsable.map((u) => `${u.name} "${u.range}" (${describeUnsupportedRange(u.range)})`))}.`, LIMITS.maxNoteLength));
  if (unusableLicenses) notes.push(`${plural(unusableLicenses, 'licence field')} not a usable string (object, or over ${LIMITS.maxStringLength} characters) and treated as undeclared.`);
  if (invalidDeps) notes.push(`${plural(invalidDeps, 'dependency entry', 'dependency entries')} with an invalid name, non-string range or malformed map ignored.`);
  notes.push(advisories.length ? `${plural(advisories.length, 'advisory record')} supplied by the user — nothing was fetched from any registry or advisory database.` : NO_ADVISORIES_NOTE);
  if (imports.length) {
    const notDirect = imports.filter((i) => !(i in direct));
    notes.push(`${plural(imports.length, 'import-evidence name')} supplied by the user${notDirect.length ? `; not direct dependencies of the root, so they cannot mark anything as known: ${listSome(notDirect)}` : ''}.`);
  } else notes.push(NO_IMPORTS_NOTE);
  notes.push(opts.policy === undefined
    ? `Policy: the demo policy applied by default (block at ${policy.blockSeverity}; allow ${policy.licenses.allow.join(', ')}; review ${policy.licenses.review.join(', ')}; deny ${policy.licenses.deny.join(', ')}).`
    : `Policy: supplied by the user (block at ${policy.blockSeverity}).`);

  const lockgraph: Lockgraph = {
    schema: 'rootstock.lockgraph/1',
    name: `${rootName} (converted from package-lock.json v${lockfileVersion})`,
    root: { name: rootName, version: rootVersion },
    direct, imports, packages: packagesOut, registry, advisories, policy,
    unparsable, source: { kind: 'package-lock.json', lockfileVersion, includeDev, notes: [...notes] },
  };
  // The converted snapshot goes through the same validator as a pasted one, so it is valid by construction or rejected.
  const validated = validateLockgraph(lockgraph);
  if (!validated.ok) return { ok: false, errors: validated.errors.map((e) => `converted snapshot failed validation: ${e}`) };
  return { ok: true, lockgraph: validated.lockgraph, notes };
}
