import type { Alert, Chain, NormalizedEvent, Protocol, Severity } from './types';
import { isInternal, shannonEntropy } from './parse';

export interface RuleConfig {
  dnsLabelMinLength: number;      // DNS-001: label length at which entropy is evaluated
  dnsEntropyThreshold: number;    // DNS-001: bits/symbol
  dnsLongLabel: number;           // DNS-001: any label longer than this is suspicious regardless of entropy
  dnsSuffixAllowlist: string[];   // DNS-001: known content-hash hostnames (CDNs) – false-positive control
  nxdomainBurst: number;          // DNS-002
  nxdomainWindowSec: number;      // DNS-002
  authFailBurst: number;          // HTTP-001
  authFailWindowSec: number;      // HTTP-001
  uploadBytes: number;            // HTTP-002
  scriptedUaPatterns: string[];   // HTTP-002
  smtpDistinctDomains: number;    // SMTP-001
  smtpWindowSec: number;          // SMTP-001
  smtpRelayAllowlist: string[];   // SMTP-001
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  dnsLabelMinLength: 20,
  dnsEntropyThreshold: 3.8,
  dnsLongLabel: 40,
  dnsSuffixAllowlist: ['.cdn.example', '.static.example'],
  nxdomainBurst: 8,
  nxdomainWindowSec: 60,
  authFailBurst: 10,
  authFailWindowSec: 120,
  uploadBytes: 5_000_000,
  scriptedUaPatterns: ['python-requests', 'curl/', 'wget/', 'go-http-client', 'powershell'],
  smtpDistinctDomains: 10,
  smtpWindowSec: 600,
  smtpRelayAllowlist: ['10.0.9.25'],
};

export const RULE_CATALOG: { id: string; name: string; proto: Protocol; severity: Severity; what: string; falsePositives: string }[] = [
  { id: 'DNS-001', name: 'High-entropy or very long DNS label', proto: 'dns', severity: 'medium', what: 'A subdomain label is unusually long or random-looking, a classic sign of data hidden in DNS queries (tunnelling).', falsePositives: 'CDNs and asset pipelines use content-hash hostnames. Add their suffix to the allowlist instead of raising the threshold.' },
  { id: 'DNS-002', name: 'NXDOMAIN burst', proto: 'dns', severity: 'medium', what: 'One host receives many "no such domain" answers in a short window, consistent with domain-generation algorithms or misconfigured software.', falsePositives: 'Search-suffix misconfiguration and typo storms. Check whether the names share a pattern before closing.' },
  { id: 'HTTP-001', name: 'Authentication failure burst', proto: 'http', severity: 'high', what: 'Many 401/403 responses from one source to one destination in a short window, consistent with credential guessing.', falsePositives: 'Expired tokens in a retry loop. Look at the cadence: scripts are regular, users are not.' },
  { id: 'HTTP-002', name: 'Large scripted upload to external host', proto: 'http', severity: 'high', what: 'A POST/PUT above the size threshold with a non-browser user agent to a non-RFC1918 destination.', falsePositives: 'Sanctioned backup or CI agents. Record the destination as approved rather than disabling the rule.' },
  { id: 'SMTP-001', name: 'Mail fan-out from non-relay host', proto: 'smtp', severity: 'medium', what: 'A host that is not an approved relay sends mail to many distinct external domains within the window.', falsePositives: 'Newsletter or notification services. Add the host to the relay allowlist with an owner.' },
];

function hashId(parts: (string | number)[]): string {
  // FNV-1a 32-bit over the joined parts: deterministic, dependency-free alert ids.
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function mk(ruleId: string, events: NormalizedEvent[], evidence: string[], explanation: string, dst: string | null = null): Alert {
  const cat = RULE_CATALOG.find(r => r.id === ruleId)!;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  return {
    id: `${ruleId}-${hashId([ruleId, sorted[0].src, ...sorted.map(e => e.id)])}`,
    ruleId, ruleName: cat.name, proto: cat.proto, severity: cat.severity,
    src: sorted[0].src, dst, firstTs: sorted[0].ts, lastTs: sorted[sorted.length - 1].ts,
    eventIds: sorted.map(e => e.id), evidence, explanation,
  };
}

/** Sliding window: returns the first window of >= n events (sorted by ts) within windowMs, else null. */
function firstBurst(events: NormalizedEvent[], n: number, windowMs: number): NormalizedEvent[] | null {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi].ts - sorted[lo].ts > windowMs) lo++;
    if (hi - lo + 1 >= n) return sorted.slice(lo, hi + 1);
  }
  return null;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = key(it); (m.get(k) ?? m.set(k, []).get(k)!).push(it); }
  return m;
}

export function runRules(events: NormalizedEvent[], cfg: RuleConfig): Alert[] {
  const alerts: Alert[] = [];
  const dns = events.filter(e => e.proto === 'dns');
  const http = events.filter(e => e.proto === 'http');
  const smtp = events.filter(e => e.proto === 'smtp');

  // DNS-001: one alert per source + parent zone, so a tunnelling host yields a single case with all its queries.
  const dns1 = new Map<string, { events: NormalizedEvent[]; labels: string[]; ent: number[] }>();
  for (const e of dns) {
    const qname = String(e.fields.qname);
    if (cfg.dnsSuffixAllowlist.some(suf => qname.endsWith(suf.toLowerCase()))) continue;
    const labels = qname.split('.');
    for (const label of labels) {
      const ent = shannonEntropy(label);
      const long = label.length > cfg.dnsLongLabel;
      const random = label.length >= cfg.dnsLabelMinLength && ent >= cfg.dnsEntropyThreshold;
      if (long || random) {
        const zone = labels.slice(-3).join('.');
        const key = `${e.src}|${zone}`;
        const g = dns1.get(key) ?? { events: [], labels: [], ent: [] };
        g.events.push(e); g.labels.push(label); g.ent.push(ent);
        dns1.set(key, g);
        break;
      }
    }
  }
  for (const [key, g] of dns1) {
    const zone = key.split('|')[1];
    const maxLen = Math.max(...g.labels.map(l => l.length));
    const maxEnt = Math.max(...g.ent);
    alerts.push(mk('DNS-001', g.events, [
      `${g.events.length} quer${g.events.length === 1 ? 'y' : 'ies'} under ${zone} with encoded-looking labels`,
      `longest label ${maxLen} chars (long-label threshold ${cfg.dnsLongLabel})`,
      `highest entropy ${maxEnt.toFixed(2)} bits/char (threshold ${cfg.dnsEntropyThreshold} at length ≥ ${cfg.dnsLabelMinLength})`,
      `example label "${g.labels[0].slice(0, 48)}"`,
      `suffix not in allowlist [${cfg.dnsSuffixAllowlist.join(', ')}]`,
    ], `${g.events[0].src} queried labels under ${zone} that look encoded rather than human-chosen.`));
  }
  // DNS-002 per src
  for (const [src, evs] of groupBy(dns.filter(e => e.fields.rcode === 'NXDOMAIN'), e => e.src)) {
    const burst = firstBurst(evs, cfg.nxdomainBurst, cfg.nxdomainWindowSec * 1000);
    if (burst) alerts.push(mk('DNS-002', burst, [
      `${burst.length} NXDOMAIN answers within ${((burst[burst.length - 1].ts - burst[0].ts) / 1000).toFixed(0)}s (threshold ${cfg.nxdomainBurst} in ${cfg.nxdomainWindowSec}s)`,
      `names: ${burst.slice(0, 5).map(b => b.fields.qname).join(', ')}${burst.length > 5 ? ', …' : ''}`,
    ], `${src} asked for many names that do not exist in quick succession.`));
  }
  // HTTP-001 per src+dst
  for (const [key, evs] of groupBy(http.filter(e => e.fields.status === 401 || e.fields.status === 403), e => `${e.src}>${e.dst}`)) {
    const burst = firstBurst(evs, cfg.authFailBurst, cfg.authFailWindowSec * 1000);
    if (burst) {
      const [, dst] = key.split('>');
      alerts.push(mk('HTTP-001', burst, [
        `${burst.length} responses with status 401/403 within ${((burst[burst.length - 1].ts - burst[0].ts) / 1000).toFixed(0)}s (threshold ${cfg.authFailBurst} in ${cfg.authFailWindowSec}s)`,
        `paths: ${[...new Set(burst.map(b => b.fields.path))].slice(0, 4).join(', ')}`,
      ], `${burst[0].src} repeatedly failed authentication against ${dst}.`, dst));
    }
  }
  // HTTP-002 per event
  for (const e of http) {
    const method = String(e.fields.method);
    const ua = String(e.fields.ua).toLowerCase();
    const scripted = cfg.scriptedUaPatterns.some(p => ua.includes(p.toLowerCase()));
    if ((method === 'POST' || method === 'PUT') && Number(e.fields.bytes) >= cfg.uploadBytes && e.dst && !isInternal(e.dst) && isInternal(e.src) && scripted) {
      alerts.push(mk('HTTP-002', [e], [
        `${method} of ${Number(e.fields.bytes).toLocaleString('en-US')} bytes (threshold ${cfg.uploadBytes.toLocaleString('en-US')})`,
        `destination ${e.dst} is outside RFC 1918 space`,
        `user agent "${e.fields.ua}" matches scripted-client pattern`,
      ], `${e.src} pushed a large payload to an external host with a scripted client.`, e.dst));
    }
  }
  // SMTP-001 per src
  for (const [src, evs] of groupBy(smtp, e => e.src)) {
    if (cfg.smtpRelayAllowlist.includes(src)) continue;
    const sorted = [...evs].sort((a, b) => a.ts - b.ts);
    let lo = 0; let found: NormalizedEvent[] | null = null;
    for (let hi = 0; hi < sorted.length && !found; hi++) {
      while (sorted[hi].ts - sorted[lo].ts > cfg.smtpWindowSec * 1000) lo++;
      const win = sorted.slice(lo, hi + 1);
      const domains = new Set(win.map(w => String(w.fields.toDomain)).filter(Boolean));
      if (domains.size >= cfg.smtpDistinctDomains) found = win;
    }
    if (found) {
      const domains = new Set(found.map(w => String(w.fields.toDomain)));
      alerts.push(mk('SMTP-001', found, [
        `${domains.size} distinct recipient domains within ${cfg.smtpWindowSec / 60} min (threshold ${cfg.smtpDistinctDomains})`,
        `host ${src} is not in relay allowlist [${cfg.smtpRelayAllowlist.join(', ')}]`,
      ], `${src} behaves like a mail relay but is not registered as one.`, String(found[0].fields.server)));
    }
  }
  return alerts.sort((a, b) => a.firstTs - b.firstTs || a.id.localeCompare(b.id));
}

/** Group alerts by source; a chain exists when one source has alerts in >= 2 protocols within windowMs. */
export function correlateAlerts(alerts: Alert[], windowMs: number): Chain[] {
  const chains: Chain[] = [];
  for (const [src, group] of groupBy(alerts, a => a.src)) {
    const sorted = [...group].sort((a, b) => a.firstTs - b.firstTs);
    for (let i = 0; i < sorted.length; i++) {
      const win = sorted.filter(a => a.firstTs >= sorted[i].firstTs && a.firstTs - sorted[i].firstTs <= windowMs);
      const protos = [...new Set(win.map(a => a.proto))];
      if (protos.length >= 2) {
        chains.push({ id: `chain-${hashId([src, ...win.map(w => w.id)])}`, src, protocols: protos, alertIds: win.map(w => w.id), firstTs: win[0].firstTs, lastTs: Math.max(...win.map(w => w.lastTs)) });
        break;
      }
    }
  }
  return chains;
}
