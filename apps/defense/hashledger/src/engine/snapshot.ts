import { sha256Hex } from './hash';

export interface FileEntry { path: string; content: string; mode: string; owner: string }
export interface SnapshotEntry { path: string; hash: string; size: number; mode: string; owner: string }
export interface Snapshot { id: string; takenAt: string; entries: SnapshotEntry[]; prevChainHash: string | null; chainHash: string }

export const LIMITS = { maxFiles: 200, maxContentChars: 65_536, maxPathChars: 200 };

export type Validation = { ok: true } | { ok: false; errors: string[] };
export function validateManifest(files: FileEntry[]): Validation {
  const errors: string[] = [];
  if (!Array.isArray(files)) return { ok: false, errors: ['Manifest must be an array.'] };
  if (files.length > LIMITS.maxFiles) errors.push(`Too many files: ${files.length} (limit ${LIMITS.maxFiles}).`);
  const seen = new Set<string>();
  for (const f of files) {
    if (typeof f.path !== 'string' || !f.path || f.path.length > LIMITS.maxPathChars) errors.push(`Invalid path length for "${String(f.path).slice(0, 40)}".`);
    else if (f.path.startsWith('/') || /\\/.test(f.path) || f.path.split('/').some(seg => seg === '..' || seg === '.' || seg === '')) errors.push(`Path "${f.path}" must be relative, use "/" separators and contain no "." or ".." segments.`);
    if (seen.has(f.path)) errors.push(`Duplicate path "${f.path}".`);
    seen.add(f.path);
    if (typeof f.content !== 'string' || f.content.length > LIMITS.maxContentChars) errors.push(`Content of "${f.path}" exceeds ${LIMITS.maxContentChars.toLocaleString()} characters.`);
    if (!/^0[0-7]{3}$/.test(f.mode)) errors.push(`Mode for "${f.path}" must be four octal digits like 0644.`);
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true };
}

/**
 * Hash each file, sort by path, then chain:
 *   chainHash = sha256(prevChainHash | takenAt | canonical entries)   and   id = 'snap-' + chainHash[0..12).
 * The capture time is part of the digest and the id is derived from it, so neither can be edited without detection.
 * This is an INTEGRITY check (was anything changed?), not AUTHENTICITY (who captured it?) — there is no signature.
 */
export async function takeSnapshot(files: FileEntry[], prev: Snapshot | null, takenAt: string): Promise<Snapshot> {
  const entries: SnapshotEntry[] = [];
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    entries.push({ path: f.path, hash: await sha256Hex(f.content), size: new TextEncoder().encode(f.content).length, mode: f.mode, owner: f.owner });
  }
  const prevChainHash = prev ? prev.chainHash : null;
  const chainHash = await chainHashOf(prevChainHash, takenAt, entries);
  return { id: idFor(chainHash), takenAt, entries, prevChainHash, chainHash };
}

export const idFor = (chainHash: string) => `snap-${chainHash.slice(0, 12)}`;

export function canonical(entries: SnapshotEntry[]): string {
  return entries.map(e => `${e.path}\u0000${e.hash}\u0000${e.size}\u0000${e.mode}\u0000${e.owner}`).join('\n');
}
export async function chainHashOf(prevChainHash: string | null, takenAt: string, entries: SnapshotEntry[]): Promise<string> {
  return sha256Hex(`${prevChainHash ?? 'genesis'}\n${takenAt}\n${canonical(entries)}`);
}

export interface Diff { added: SnapshotEntry[]; removed: SnapshotEntry[]; modified: { path: string; before: SnapshotEntry; after: SnapshotEntry }[]; permissionChanged: { path: string; before: SnapshotEntry; after: SnapshotEntry }[]; unchanged: number }
export function diffSnapshots(a: Snapshot, b: Snapshot): Diff {
  const am = new Map(a.entries.map(e => [e.path, e])); const bm = new Map(b.entries.map(e => [e.path, e]));
  const d: Diff = { added: [], removed: [], modified: [], permissionChanged: [], unchanged: 0 };
  for (const [p, e] of bm) {
    const prev = am.get(p);
    if (!prev) d.added.push(e);
    else if (prev.hash !== e.hash) d.modified.push({ path: p, before: prev, after: e });
    else if (prev.mode !== e.mode || prev.owner !== e.owner) d.permissionChanged.push({ path: p, before: prev, after: e });
    else d.unchanged++;
  }
  for (const [p, e] of am) if (!bm.has(p)) d.removed.push(e);
  return d;
}

/** Recompute every chain hash from (prev, takenAt, entries) and re-derive ids; report the first index that disagrees. */
export async function verifyChain(snaps: Snapshot[]): Promise<{ ok: true } | { ok: false; brokenAt: number; reason: string }> {
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const expectedPrev = i === 0 ? null : snaps[i - 1].chainHash;
    if (s.prevChainHash !== expectedPrev) return { ok: false, brokenAt: i, reason: 'previous-link mismatch' };
    const recomputed = await chainHashOf(s.prevChainHash, s.takenAt, s.entries);
    if (recomputed !== s.chainHash) return { ok: false, brokenAt: i, reason: 'entries or takenAt do not match stored chain hash' };
    if (s.id !== idFor(s.chainHash)) return { ok: false, brokenAt: i, reason: 'snapshot id does not match its chain hash' };
  }
  return { ok: true };
}
