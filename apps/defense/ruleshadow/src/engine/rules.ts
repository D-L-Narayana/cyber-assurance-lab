import { parseCidr, parsePorts } from './net';

export type Action = 'allow' | 'deny';
export type Proto = 'tcp' | 'udp' | 'icmp' | 'any';
export interface Rule {
  id: string; seq: number; action: Action; src: string; dst: string; proto: Proto; ports: string;
  zoneFrom: string; zoneTo: string; enabled: boolean; owner: string; expires: string; lastHit: string; comment: string;
}
export const LIMITS = { maxRules: 500, maxBytes: 500_000 };
export const CSV_HEADER = ['seq', 'id', 'action', 'src', 'dst', 'proto', 'ports', 'zoneFrom', 'zoneTo', 'enabled', 'owner', 'expires', 'lastHit', 'comment'] as const;

export interface CsvError { line: number; reason: string }

/** Minimal CSV: comma-separated, optional double quotes with "" escapes, header required. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** Strict calendar date: YYYY-MM-DD that round-trips through Date.UTC (rejects 2026-02-30, 2026-99-99). */
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseRuleCsv(text: string): { rules: Rule[]; errors: CsvError[] } {
  const errors: CsvError[] = []; const rules: Rule[] = [];
  if (text.length > LIMITS.maxBytes) return { rules, errors: [{ line: 0, reason: `Input exceeds ${LIMITS.maxBytes.toLocaleString()} characters.` }] };
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return { rules, errors: [{ line: 0, reason: 'Empty input.' }] };
  const header = splitCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, ''));
  const idx = (k: string) => header.indexOf(k);
  for (const k of CSV_HEADER) if (idx(k) < 0 && !['comment', 'expires', 'lastHit', 'zoneFrom', 'zoneTo', 'owner'].includes(k)) return { rules, errors: [{ line: 1, reason: `Missing required column "${k}".` }] };
  if (lines.length - 1 > LIMITS.maxRules) return { rules, errors: [{ line: 0, reason: `Too many rules: ${lines.length - 1} (limit ${LIMITS.maxRules}).` }] };
  const ids = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]); const get = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? '' : '');
    const line = i + 1; const problems: string[] = [];
    const seq = Number(get('seq')); if (!Number.isInteger(seq) || seq < 0) problems.push('seq must be a non-negative integer');
    const id = get('id'); if (!id || id.length > 40) problems.push('id required (≤ 40 chars)'); else if (ids.has(id)) problems.push(`duplicate id "${id}"`);
    const action = get('action').toLowerCase(); if (action !== 'allow' && action !== 'deny') problems.push(`action must be allow|deny (got "${get('action')}")`);
    if (!parseCidr(get('src'))) problems.push(`src "${get('src')}" is not a valid IPv4 CIDR or "any"`);
    if (!parseCidr(get('dst'))) problems.push(`dst "${get('dst')}" is not a valid IPv4 CIDR or "any"`);
    const proto = get('proto').toLowerCase(); if (!['tcp', 'udp', 'icmp', 'any'].includes(proto)) problems.push(`proto must be tcp|udp|icmp|any`);
    if (!parsePorts(get('ports') || 'any')) problems.push(`ports "${get('ports')}" invalid (e.g. 443, 80-443, 22,80, any)`);
    const enabledRaw = get('enabled').toLowerCase(); if (!['true', 'false', '1', '0', 'yes', 'no', ''].includes(enabledRaw)) problems.push('enabled must be true/false');
    for (const k of ['expires', 'lastHit'] as const) if (get(k) && !isValidDate(get(k))) problems.push(`${k} must be a valid calendar date YYYY-MM-DD or empty (got "${get(k)}")`);
    if (problems.length) { errors.push({ line, reason: problems.join('; ') }); continue; }
    ids.add(id);
    rules.push({ id, seq, action: action as Rule['action'], src: get('src').toLowerCase(), dst: get('dst').toLowerCase(), proto: proto as Rule['proto'], ports: (get('ports') || 'any').toLowerCase().replace(/\s+/g, ''), zoneFrom: get('zoneFrom') || 'any', zoneTo: get('zoneTo') || 'any', enabled: !['false', '0', 'no'].includes(enabledRaw), owner: get('owner').slice(0, 60), expires: get('expires'), lastHit: get('lastHit'), comment: get('comment').slice(0, 200) });
  }
  rules.sort((a, b) => a.seq - b.seq);
  return { rules, errors };
}
