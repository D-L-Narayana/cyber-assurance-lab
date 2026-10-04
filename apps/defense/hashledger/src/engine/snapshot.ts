import { sha256Hex } from './hash';

export interface FileEntry { path: string; content: string; mode: string; owner: string }
export interface SnapshotEntry { path: string; hash: string; size: number; mode: string; owner: string }
export interface Snapshot { id: string; takenAt: string; entries: SnapshotEntry[]; prevChainHash: string | null; chainHash: string }

export const LIMITS = { maxFiles: 200, maxContentChars: 65_536, maxPathChars: 200, maxOwnerChars: 64, maxErrors: 20 };

/** Path characters after the segment checks: letters, digits, ".", "_", "-" and "/" only (no spaces, no non-ASCII, no shell metacharacters). */
export const PATH_CHARS = /^[A-Za-z0-9._/-]+$/;
/** Printable: no control (Cc), format (Cf), surrogate, private-use or unassigned code points, no line/paragraph separators. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;

export type Validation = { ok: true } | { ok: false; errors: string[] };
/**
 * Validate a manifest of `{ path, content, mode, owner }` rows. Accepts `unknown` and never throws: non-array input and
 * non-object rows are reported as errors. Errors are path-addressed (`files[3].owner: …`) and capped at `LIMITS.maxErrors`.
 */
export function validateManifest(files: unknown): Validation {
  if (!Array.isArray(files)) return { ok: false, errors: ['Manifest must be an array of { path, content, mode, owner } objects.'] };
  const errors: string[] = [];
  if (files.length > LIMITS.maxFiles) errors.push(`Too many files: ${files.length} (limit ${LIMITS.maxFiles}).`);
  const seen = new Set<string>();
  files.forEach((raw: unknown, i: number) => {
    const p = `files[${i}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { errors.push(`${p}: must be an object { path, content, mode, owner }.`); return; }
    const f = raw as Record<string, unknown>;
    const shown = typeof f.path === 'string' ? JSON.stringify(f.path.slice(0, 40)) : String(f.path);
    if (typeof f.path !== 'string' || !f.path || f.path.length > LIMITS.maxPathChars) errors.push(`${p}.path: must be a string of 1–${LIMITS.maxPathChars} characters (got ${shown}).`);
    else if (f.path.startsWith('/') || /\\/.test(f.path) || f.path.split('/').some(seg => seg === '..' || seg === '.' || seg === '')) errors.push(`${p}.path: ${shown} must be relative, use "/" separators and contain no "." or ".." segments.`);
    else if (!PATH_CHARS.test(f.path)) errors.push(`${p}.path: ${shown} may only contain letters, digits, ".", "_", "-" and "/".`);
    else if (seen.has(f.path)) errors.push(`${p}.path: duplicate path ${shown}.`);
    else seen.add(f.path);
    if (typeof f.content !== 'string' || f.content.length > LIMITS.maxContentChars) errors.push(`${p}.content: must be a string of at most ${LIMITS.maxContentChars.toLocaleString()} characters.`);
    if (typeof f.mode !== 'string' || !/^0[0-7]{3}$/.test(f.mode)) errors.push(`${p}.mode: must be four octal digits like 0644.`);
    if (typeof f.owner !== 'string' || f.owner.length < 1 || f.owner.length > LIMITS.maxOwnerChars || !PRINTABLE.test(f.owner)) errors.push(`${p}.owner: must be a printable string of 1–${LIMITS.maxOwnerChars} characters.`);
  });
  return errors.length ? { ok: false, errors: errors.slice(0, LIMITS.maxErrors) } : { ok: true };
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
