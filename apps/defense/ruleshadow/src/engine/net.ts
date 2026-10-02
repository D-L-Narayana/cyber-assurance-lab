export interface Interval { lo: number; hi: number }
export const ANY_V4: Interval = { lo: 0, hi: 4294967295 };
export const ANY_PORT: Interval = { lo: 0, hi: 65535 };

export function parseCidr(s: string): Interval | null {
  const t = s.trim().toLowerCase();
  if (t === 'any' || t === '0.0.0.0/0') return { ...ANY_V4 };
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some(o => o > 255)) return null;
  const prefix = m[5] === undefined ? 32 : Number(m[5]);
  if (prefix > 32) return null;
  const ip = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const size = 2 ** (32 - prefix);
  const lo = Math.floor(ip / size) * size;
  return { lo, hi: lo + size - 1 };
}

export function parsePorts(s: string): Interval[] | null {
  const t = s.trim().toLowerCase();
  if (t === 'any' || t === '*') return [{ ...ANY_PORT }];
  const out: Interval[] = [];
  for (const part of t.split(',')) {
    const m = /^\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*$/.exec(part);
    if (!m) return null;
    const lo = Number(m[1]); const hi = m[2] === undefined ? lo : Number(m[2]);
    if (lo > 65535 || hi > 65535 || lo > hi) return null;
    out.push({ lo, hi });
  }
  return mergeIntervals(out);
}

export function mergeIntervals(iv: Interval[]): Interval[] {
  const s = [...iv].sort((a, b) => a.lo - b.lo);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.lo <= last.hi + 1) last.hi = Math.max(last.hi, x.hi); else out.push({ ...x });
  }
  return out;
}

export const contains = (outer: Interval, inner: Interval) => outer.lo <= inner.lo && outer.hi >= inner.hi;
export const overlaps = (a: Interval, b: Interval) => a.lo <= b.hi && b.lo <= a.hi;
export const addressCount = (iv: Interval) => iv.hi - iv.lo + 1;

/** Remove every part of `covers` from `targets`; returns the uncovered remainder as merged intervals. */
export function subtractIntervals(targets: Interval[], covers: Interval[]): Interval[] {
  let remaining = mergeIntervals(targets);
  for (const c of mergeIntervals(covers)) {
    const next: Interval[] = [];
    for (const t of remaining) {
      if (!overlaps(t, c)) { next.push(t); continue; }
      if (c.lo > t.lo) next.push({ lo: t.lo, hi: c.lo - 1 });
      if (c.hi < t.hi) next.push({ lo: c.hi + 1, hi: t.hi });
    }
    remaining = next;
  }
  return remaining;
}

export function ipToString(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
