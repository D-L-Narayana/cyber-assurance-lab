import type { NormalizedEvent, ParseResult, Protocol } from './types';

export const DEFAULT_LIMITS = { maxBytes: 200_000, maxLines: 5_000 };

/** Shannon entropy in bits per symbol. */
export function shannonEntropy(s: string): number {
  if (!s.length) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIPv4(s: string): boolean {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every(o => Number(o) <= 255);
}

/** RFC 1918 private ranges are treated as internal. Everything else is external. */
export function isInternal(ip: string): boolean {
  const m = IPV4.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function parseTs(tok: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(tok)) return null;
  const n = Date.parse(tok);
  return Number.isNaN(n) ? null : n;
}

/* Synthetic line grammar (documented in README):
 *  <iso-ts> DNS  <src-ip> query <qtype> <qname> <rcode>
 *  <iso-ts> HTTP <src-ip> <dst-ip> <method> <path> <status> <bytes> "<user-agent>"
 *  <iso-ts> SMTP <src-ip> <server-name> from=<addr> to=<addr> status=<status>
 */
export function parseLogs(text: string, limits: Partial<typeof DEFAULT_LIMITS> = {}): ParseResult {
  const { maxBytes, maxLines } = { ...DEFAULT_LIMITS, ...limits };
  const result: ParseResult = { events: [], errors: [], truncated: false, bytesRead: 0, linesRead: 0 };
  let bytes = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (result.linesRead >= maxLines) { result.truncated = true; break; }
    bytes += raw.length + 1;
    if (bytes > maxBytes) { result.truncated = true; break; }
    result.linesRead++;
    result.bytesRead = bytes;
    const line = i + 1;
    if (!raw.trim()) continue;
    const ev = parseLine(raw, line);
    if (typeof ev === 'string') result.errors.push({ line, reason: ev, raw: raw.slice(0, 200) });
    else result.events.push(ev);
  }
  result.events.sort((a, b) => a.ts - b.ts || a.line - b.line);
  return result;
}

function parseLine(raw: string, line: number): NormalizedEvent | string {
  const m = /^(\S+)\s+(DNS|HTTP|SMTP)\s+(\S+)\s+(.*)$/.exec(raw.trim());
  if (!m) return 'unrecognised line format';
  const [, tsTok, protoTok, src, rest] = m;
  const ts = parseTs(tsTok);
  if (ts === null) return 'timestamp must be ISO-8601 UTC (e.g. 2026-09-14T08:00:01Z)';
  if (!isIPv4(src)) return 'source must be an IPv4 address';
  const proto = protoTok.toLowerCase() as Protocol;
  const id = `e${line}`;
  if (proto === 'dns') {
    const d = /^query\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(rest);
    if (!d) return 'DNS line must be: query <qtype> <qname> <rcode>';
    const [, qtype, qname, rcode] = d;
    if (qname.length > 253) return 'qname longer than 253 characters';
    return { id, line, ts, proto, src, dst: null, summary: `${qtype} ${qname} → ${rcode}`, fields: { qtype, qname: qname.toLowerCase(), rcode: rcode.toUpperCase() }, raw };
  }
  if (proto === 'http') {
    const h = /^(\S+)\s+(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+(\S+)\s+(\d{3})\s+(\d+)\s+"([^"]{0,300})"$/.exec(rest);
    if (!h) return 'HTTP line must be: <dst-ip> <method> <path> <status> <bytes> "<user-agent>"';
    if (h[5].length > 13) return 'HTTP bytes must be at most 13 digits (≤ 9,999,999,999,999)';
    const [, dst, method, path, status, bytes, ua] = h;
    if (!isIPv4(dst)) return 'HTTP destination must be an IPv4 address';
    return { id, line, ts, proto, src, dst, summary: `${method} ${path} ${status} (${bytes} B)`, fields: { method, path, status: Number(status), bytes: Number(bytes), ua }, raw };
  }
  const s = /^(\S+)\s+from=<([^>]*)>\s+to=<([^>]*)>\s+status=(\S+)$/.exec(rest);
  if (!s) return 'SMTP line must be: <server> from=<addr> to=<addr> status=<status>';
  const [, server, from, to, status] = s;
  const toDomain = to.includes('@') ? to.split('@')[1].toLowerCase() : '';
  return { id, line, ts, proto, src, dst: server, summary: `${from} → ${to} (${status})`, fields: { server, from, to, status, toDomain }, raw };
}
