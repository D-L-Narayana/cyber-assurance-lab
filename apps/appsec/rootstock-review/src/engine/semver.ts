/**
 * A small, dependency-free semver subset: versions `MAJOR.MINOR.PATCH[-prerelease]`, and ranges made of
 * comparators (`<`, `<=`, `>`, `>=`, `=`), caret, tilde, x-ranges, hyphen ranges and `||` unions.
 * Build metadata is ignored. Anything unparsable never satisfies.
 */
export interface Version { major: number; minor: number; patch: number; prerelease: (string | number)[] }

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text.trim());
  if (!m) return null;
  const prerelease = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

function cmpPre(a: (string | number)[], b: (string | number)[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // release > prerelease
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a: string | Version, b: string | Version): number {
  const va = typeof a === 'string' ? parseVersion(a) : a;
  const vb = typeof b === 'string' ? parseVersion(b) : b;
  if (!va || !vb) return Number.NaN;
  return va.major - vb.major || va.minor - vb.minor || va.patch - vb.patch || cmpPre(va.prerelease, vb.prerelease);
}

type Op = '<' | '<=' | '>' | '>=' | '=';
interface Comparator { op: Op; version: Version }

const PARTIAL = /^(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/;
const isX = (s: string | undefined) => s === undefined || s === 'x' || s === 'X' || s === '*';
const v = (major: number, minor = 0, patch = 0, prerelease: (string | number)[] = []): Version => ({ major, minor, patch, prerelease });

/** Expands one range token into comparators; returns null if it cannot be understood. */
function expand(token: string): Comparator[] | null {
  if (token === '' || token === '*' || token.toLowerCase() === 'x') return [{ op: '>=', version: v(0) }];
  const opMatch = /^(<=|>=|<|>|=|\^|~)?\s*(.+)$/.exec(token);
  if (!opMatch) return null;
  const op = opMatch[1] ?? '';
  const pm = PARTIAL.exec(opMatch[2]);
  if (!pm) return null;
  const [, M, m, p, pre] = pm;
  const major = isX(M) ? null : Number(M);
  const minor = isX(m) ? null : Number(m);
  const patch = isX(p) ? null : Number(p);
  const prerelease = pre ? pre.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [];
  if (major === null) return [{ op: '>=', version: v(0) }];

  if (op === '^') {
    const lo = v(major, minor ?? 0, patch ?? 0, prerelease);
    let hi: Version;
    if (major > 0 || minor === null) hi = v(major + 1);
    else if (minor > 0 || patch === null) hi = v(0, minor + 1);
    else hi = v(0, minor, patch + 1);
    return [{ op: '>=', version: lo }, { op: '<', version: hi }];
  }
  if (op === '~') {
    const lo = v(major, minor ?? 0, patch ?? 0, prerelease);
    const hi = minor === null ? v(major + 1) : v(major, minor + 1);
    return [{ op: '>=', version: lo }, { op: '<', version: hi }];
  }
  if (op === '' || op === '=') {
    if (minor === null) return [{ op: '>=', version: v(major) }, { op: '<', version: v(major + 1) }];
    if (patch === null) return [{ op: '>=', version: v(major, minor) }, { op: '<', version: v(major, minor + 1) }];
    return [{ op: '=', version: v(major, minor, patch, prerelease) }];
  }
  // Plain comparators with partial versions: round sensibly.
  if (op === '>') {
    if (minor === null) return [{ op: '>=', version: v(major + 1) }];
    if (patch === null) return [{ op: '>=', version: v(major, minor + 1) }];
    return [{ op: '>', version: v(major, minor, patch, prerelease) }];
  }
  if (op === '<=') {
    if (minor === null) return [{ op: '<', version: v(major + 1) }];
    if (patch === null) return [{ op: '<', version: v(major, minor + 1) }];
    return [{ op: '<=', version: v(major, minor, patch, prerelease) }];
  }
  return [{ op: op as Op, version: v(major, minor ?? 0, patch ?? 0, prerelease) }];
}

function parseSet(set: string): Comparator[] | null {
  const trimmed = set.trim();
  if (trimmed === '') return null;
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
  if (hyphen) {
    const lo = expand(`>=${hyphen[1]}`);
    const hi = expand(`<=${hyphen[2]}`);
    return lo && hi ? [...lo, ...hi] : null;
  }
  const out: Comparator[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const c = expand(token);
    if (!c) return null;
    out.push(...c);
  }
  return out;
}

function test(c: Comparator, ver: Version): boolean {
  const d = compareVersions(ver, c.version);
  switch (c.op) {
    case '<': return d < 0;
    case '<=': return d <= 0;
    case '>': return d > 0;
    case '>=': return d >= 0;
    case '=': return d === 0;
  }
}

/** Returns true when `version` is inside `range`. Unparsable ranges or versions return false. Empty range never matches. */
export function satisfies(version: string, range: string): boolean {
  const ver = parseVersion(version);
  if (!ver) return false;
  if (range.trim() === '') return false;
  const sets = range.split('||').map(parseSet);
  if (sets.some((s) => s === null)) return false;
  return sets.some((set) => set!.every((c) => test(c, ver)));
}

export function isValidRange(range: string): boolean {
  if (range.trim() === '') return false;
  return range.split('||').every((s) => parseSet(s) !== null);
}

export function maxSatisfying(versions: string[], range: string): string | null {
  const ok = versions.filter((x) => satisfies(x, range)).sort(compareVersions);
  return ok.length ? ok[ok.length - 1] : null;
}
export function minSatisfying(versions: string[], range: string): string | null {
  const ok = versions.filter((x) => satisfies(x, range)).sort(compareVersions);
  return ok.length ? ok[0] : null;
}
