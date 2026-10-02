// Weft lineage engine: hashes, link graph analysis, binding sign-offs, manifest build/verify, diff. Pure.
import { sha256Hex } from './sha256';
import type { Analysis, ArtifactInfo, AssertionInfo, Bundle, BundleDiff, Issue, Manifest, Signoff, VerifyResult } from './types';

export class SignoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignoffError';
  }
}

/** Canonical JSON: sorted object keys, arrays in given order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength;

function artifactHashes(bundle: Bundle): Map<string, string> {
  return new Map(bundle.artifacts.map((a) => [a.id, sha256Hex(a.content)]));
}

/**
 * Hash binding an assertion's text and period to the evidence linked to it. Each evidence entry binds the
 * artifact id, its capturedOn date and its content hash, so renaming, re-dating or editing any linked artifact —
 * or changing the set of links — changes the binding. Entries are sorted, so link order is irrelevant.
 */
export function bindingHash(bundle: Bundle, assertionId: string, hashes = artifactHashes(bundle)): string {
  const s = bundle.assertions.find((x) => x.id === assertionId);
  if (!s) throw new SignoffError(`unknown assertion ${assertionId}`);
  const byId = new Map(bundle.artifacts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const evidence: { id: string; capturedOn: string; sha256: string }[] = [];
  for (const l of bundle.links) {
    if (l.assertionId !== assertionId || seen.has(l.artifactId)) continue;
    const art = byId.get(l.artifactId);
    if (!art) continue; // broken links are reported by analyze(); they carry no evidence
    seen.add(l.artifactId);
    evidence.push({ id: art.id, capturedOn: art.capturedOn, sha256: hashes.get(art.id)! });
  }
  evidence.sort((a, b) => a.id.localeCompare(b.id) || a.sha256.localeCompare(b.sha256));
  return sha256Hex(canonical({ v: 2, assertionId: s.id, controlRef: s.controlRef, statement: s.statement, periodStart: s.periodStart, periodEnd: s.periodEnd, evidence }));
}

export function analyze(bundle: Bundle): Analysis {
  const issues: Issue[] = [];
  const hashes = artifactHashes(bundle);
  const assertionIds = new Set(bundle.assertions.map((a) => a.id));
  const artifactIds = new Set(bundle.artifacts.map((a) => a.id));
  const cells: Analysis['cells'] = {};

  // Artifacts: hashes, declared mismatch, duplicates
  const byHash = new Map<string, string[]>();
  for (const a of bundle.artifacts) byHash.set(hashes.get(a.id)!, [...(byHash.get(hashes.get(a.id)!) ?? []), a.id]);
  const mismatched = new Set<string>();
  const artifacts: ArtifactInfo[] = bundle.artifacts.map((a) => {
    const sha = hashes.get(a.id)!;
    const declaredMatches = a.declaredSha256 ? a.declaredSha256.toLowerCase() === sha : null;
    if (declaredMatches === false) {
      mismatched.add(a.id);
      issues.push({ kind: 'hash-mismatch', severity: 'high', refs: [a.id], message: `${a.id} (${a.name}): computed SHA-256 differs from the declared hash — content changed after collection or the declared hash is wrong.` });
    }
    return {
      id: a.id,
      sha256: sha,
      bytes: bytesOf(a.content),
      declaredMatches,
      duplicateOf: (byHash.get(sha) ?? []).filter((id) => id !== a.id),
      linkedAssertions: [...new Set(bundle.links.filter((l) => l.artifactId === a.id && assertionIds.has(l.assertionId)).map((l) => l.assertionId))],
    };
  });
  for (const [sha, ids] of byHash) {
    if (ids.length > 1) issues.push({ kind: 'duplicate-content', severity: 'medium', refs: ids, message: `${ids.join(', ')} have identical content (${sha.slice(0, 12)}…) under different ids/names.` });
  }

  // Links: broken, duplicate
  const seenLinks = new Set<string>();
  for (const l of bundle.links) {
    const key = `${l.assertionId}|${l.artifactId}`;
    if (!assertionIds.has(l.assertionId) || !artifactIds.has(l.artifactId)) {
      issues.push({ kind: 'broken-link', severity: 'high', refs: [l.assertionId, l.artifactId], message: `Link ${key} references ${!assertionIds.has(l.assertionId) ? `unknown assertion ${l.assertionId}` : `unknown artifact ${l.artifactId}`}.` });
      cells[key] = 'broken';
      continue;
    }
    if (seenLinks.has(key)) {
      issues.push({ kind: 'duplicate-link', severity: 'low', refs: [l.assertionId, l.artifactId], message: `Link ${key} is recorded more than once.` });
    }
    seenLinks.add(key);
  }

  // Orphans
  for (const a of artifacts) {
    if (a.linkedAssertions.length === 0) issues.push({ kind: 'orphan-artifact', severity: 'medium', refs: [a.id], message: `${a.id} is not linked to any assertion — unexplained evidence in the bundle.` });
  }

  // Assertions
  const assertions: AssertionInfo[] = bundle.assertions.map((s) => {
    const linked = [...new Set(bundle.links.filter((l) => l.assertionId === s.id && artifactIds.has(l.artifactId)).map((l) => l.artifactId))];
    const inPeriod: string[] = [];
    const outOfPeriod: string[] = [];
    const tainted: string[] = [];
    for (const id of linked) {
      const art = bundle.artifacts.find((a) => a.id === id)!;
      const key = `${s.id}|${id}`;
      if (mismatched.has(id)) {
        tainted.push(id);
        cells[key] = 'tainted';
      } else if (art.capturedOn >= s.periodStart && art.capturedOn <= s.periodEnd) {
        inPeriod.push(id);
        cells[key] = 'in-period';
      } else {
        outOfPeriod.push(id);
        cells[key] = 'out-of-period';
        issues.push({ kind: 'out-of-period', severity: 'medium', refs: [s.id, id], message: `${id} was captured ${art.capturedOn}, outside ${s.id}'s period ${s.periodStart}..${s.periodEnd}.` });
      }
    }
    let status: AssertionInfo['status'] = inPeriod.length ? 'supported' : outOfPeriod.length ? 'weak' : 'unsupported';
    if (status === 'unsupported') issues.push({ kind: 'unsupported-assertion', severity: 'high', refs: [s.id], message: `${s.id} (${s.controlRef}) has no usable evidence${tainted.length ? ` — its only evidence is tainted (${tainted.join(', ')})` : ''}.` });
    if (status === 'weak') issues.push({ kind: 'weak-assertion', severity: 'medium', refs: [s.id], message: `${s.id} is supported only by evidence captured outside its period.` });
    const binding = bindingHash(bundle, s.id, hashes);
    const so = bundle.signoffs.find((x) => x.assertionId === s.id);
    let signoff: AssertionInfo['signoff'] = null;
    if (so) {
      const valid = so.bindingHash.toLowerCase() === binding;
      signoff = { reviewer: so.reviewer, signedOn: so.signedOn, valid };
      if (!valid) issues.push({ kind: 'invalid-signoff', severity: 'high', refs: [s.id], message: `${s.id} was signed by ${so.reviewer} on ${so.signedOn}, but the assertion text or its linked evidence changed since — the sign-off no longer binds.` });
    }
    return { id: s.id, status, inPeriod, outOfPeriod, tainted, bindingHash: binding, signoff };
  });

  const order: Record<Issue['severity'], number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || a.refs.join().localeCompare(b.refs.join()));
  return { artifacts, assertions, issues, cells };
}

export function signOff(bundle: Bundle, assertionId: string, reviewer: string, signedOn: string): Bundle {
  const an = analyze(bundle);
  const info = an.assertions.find((a) => a.id === assertionId);
  if (!info) throw new SignoffError(`unknown assertion ${assertionId}`);
  if (info.signoff?.valid) throw new SignoffError(`${assertionId} is already signed by ${info.signoff.reviewer}; withdraw that sign-off first.`);
  if (info.status !== 'supported') throw new SignoffError(`${assertionId} is ${info.status}; only supported assertions (in-period, hash-valid evidence) can be signed.`);
  if (!reviewer.trim()) throw new SignoffError('A reviewer is required.');
  const entry: Signoff = { assertionId, reviewer: reviewer.trim(), signedOn, bindingHash: info.bindingHash };
  return { ...bundle, signoffs: [...bundle.signoffs.filter((s) => s.assertionId !== assertionId), entry] };
}

export function buildManifest(bundle: Bundle, generatedOn: string): Manifest {
  const hashes = artifactHashes(bundle);
  const entries = [...bundle.artifacts].sort((a, b) => a.id.localeCompare(b.id)).map((a) => ({ id: a.id, name: a.name, sha256: hashes.get(a.id)!, bytes: bytesOf(a.content) }));
  const bindings = [...bundle.assertions].sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ assertionId: s.id, bindingHash: bindingHash(bundle, s.id, hashes) }));
  const signoffs = sortedSignoffs(bundle.signoffs);
  const m: Omit<Manifest, 'root'> = { schema: 'weft.manifest/2', bundleName: bundle.name, generatedOn, entries, bindings, signoffs };
  return { ...m, root: manifestRoot(m) };
}

const sortedSignoffs = (xs: Signoff[]): Signoff[] =>
  [...xs].map((s) => ({ assertionId: s.assertionId, reviewer: s.reviewer, signedOn: s.signedOn, bindingHash: s.bindingHash.toLowerCase() })).sort((a, b) => a.assertionId.localeCompare(b.assertionId));

/** Root digest over everything the manifest attests: artifact entries (incl. names), assertion bindings, sign-offs and the bundle name. generatedOn is metadata and is not bound. */
export function manifestRoot(m: Pick<Manifest, 'bundleName' | 'entries' | 'bindings' | 'signoffs'>): string {
  return sha256Hex(canonical({ v: 2, bundleName: m.bundleName, entries: m.entries, bindings: m.bindings, signoffs: m.signoffs }));
}

export function verifyManifest(bundle: Bundle, manifest: Manifest): VerifyResult {
  const rootMatches = manifestRoot(manifest) === manifest.root.toLowerCase();
  const hashes = artifactHashes(bundle);
  const modified: string[] = [];
  const missing: string[] = [];
  const renamed: string[] = [];
  for (const e of manifest.entries) {
    const h = hashes.get(e.id);
    if (h === undefined) missing.push(e.id);
    else if (h !== e.sha256.toLowerCase()) modified.push(e.id);
    else if (bundle.artifacts.find((a) => a.id === e.id)!.name !== e.name) renamed.push(e.id);
  }
  const manifestIds = new Set(manifest.entries.map((e) => e.id));
  const added = bundle.artifacts.map((a) => a.id).filter((id) => !manifestIds.has(id)).sort();
  const bindingChanged: string[] = [];
  const missingAssertions: string[] = [];
  for (const b of manifest.bindings) {
    const s = bundle.assertions.find((x) => x.id === b.assertionId);
    if (!s) missingAssertions.push(b.assertionId);
    else if (bindingHash(bundle, s.id, hashes) !== b.bindingHash.toLowerCase()) bindingChanged.push(b.assertionId);
  }
  const boundIds = new Set(manifest.bindings.map((b) => b.assertionId));
  const addedAssertions = bundle.assertions.map((a) => a.id).filter((id) => !boundIds.has(id)).sort();
  // Sign-offs: compare the full canonical record per assertion (reviewer, date and binding), both directions.
  const now = new Map(sortedSignoffs(bundle.signoffs).map((s) => [s.assertionId, canonical(s)]));
  const then = new Map(sortedSignoffs(manifest.signoffs).map((s) => [s.assertionId, canonical(s)]));
  const signoffsChanged = [...new Set([...now.keys(), ...then.keys()])].filter((id) => now.get(id) !== then.get(id)).sort();
  const bundleNameChanged = bundle.name !== manifest.bundleName;
  const intact = rootMatches && !modified.length && !missing.length && !added.length && !renamed.length && !bindingChanged.length && !missingAssertions.length && !addedAssertions.length && !signoffsChanged.length && !bundleNameChanged;
  return { rootMatches, intact, modified: modified.sort(), missing: missing.sort(), added, bindingChanged: bindingChanged.sort(), missingAssertions: missingAssertions.sort(), addedAssertions, renamed: renamed.sort(), signoffsChanged, bundleNameChanged };
}

export function diffBundles(a: Bundle, b: Bundle): BundleDiff {
  const ha = artifactHashes(a);
  const hb = artifactHashes(b);
  const ids = (m: Map<string, string>) => new Set(m.keys());
  const aIds = ids(ha);
  const bIds = ids(hb);
  const sa = new Map(a.assertions.map((s) => [s.id, canonical(s)]));
  const sb = new Map(b.assertions.map((s) => [s.id, canonical(s)]));
  const la = new Set(a.links.map((l) => `${l.assertionId}|${l.artifactId}`));
  const lb = new Set(b.links.map((l) => `${l.assertionId}|${l.artifactId}`));
  const sorted = (xs: Iterable<string>) => [...xs].sort();
  return {
    addedArtifacts: sorted([...bIds].filter((id) => !aIds.has(id))),
    removedArtifacts: sorted([...aIds].filter((id) => !bIds.has(id))),
    changedArtifacts: sorted([...aIds].filter((id) => bIds.has(id) && ha.get(id) !== hb.get(id))),
    addedAssertions: sorted([...sb.keys()].filter((id) => !sa.has(id))),
    removedAssertions: sorted([...sa.keys()].filter((id) => !sb.has(id))),
    changedAssertions: sorted([...sa.keys()].filter((id) => sb.has(id) && sa.get(id) !== sb.get(id))),
    addedLinks: sorted([...lb].filter((k) => !la.has(k))),
    removedLinks: sorted([...la].filter((k) => !lb.has(k))),
  };
}
