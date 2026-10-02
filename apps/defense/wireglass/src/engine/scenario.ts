/** Seeded synthetic log generator. mulberry32 PRNG keeps output reproducible for a seed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENARIOS = {
  'mixed-day': 'Mixed day: normal office traffic with one DNS tunnelling host, one credential-guessing host, one scripted upload and a rogue mailer. Includes CDN hash hostnames under the allowlisted .cdn.example suffix (suppressed — clear the allowlist to see the false positive) and a typo storm (below the NXDOMAIN threshold).',
  'quiet-baseline': 'Quiet baseline: only benign traffic. Useful for checking that rules stay silent.',
  'cdn-noise': 'CDN noise: 25 long content-hash hostnames (44 characters) under edge.media.example, which is not allowlisted, so DNS-001 fires on every seed. Add ".edge.media.example" to the allowlist to practise tuning instead of raising the entropy threshold.',
} as const;
export type ScenarioId = keyof typeof SCENARIOS;

const BASE = Date.UTC(2026, 8, 14, 8, 0, 0);
const ts = (sec: number) => new Date(BASE + sec * 1000).toISOString().replace('.000Z', 'Z');
const pick = <T,>(r: () => number, arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
const WORKSTATIONS = Array.from({ length: 12 }, (_, i) => `10.0.4.${20 + i}`);
const SITES = ['intranet.example', 'wiki.corp.example', 'mail.corp.example', 'portal.partner.example', 'updates.vendor.example'];
const UAS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0', 'Mozilla/5.0 (Macintosh) Safari/17.0'];
const PATHS = ['/index.html', '/api/status', '/docs/handbook.pdf', '/login', '/assets/app.js'];

export function generateScenario(id: ScenarioId, seed: number): string {
  const r = mulberry32(seed);
  const lines: string[] = [];
  const add = (s: string) => lines.push(s);
  // Benign background traffic over ~2 hours.
  for (let i = 0; i < 260; i++) {
    const sec = Math.floor(r() * 7200);
    const src = pick(r, WORKSTATIONS);
    const roll = r();
    if (roll < 0.5) add(`${ts(sec)} DNS ${src} query ${pick(r, ['A', 'AAAA'])} ${pick(r, SITES)} NOERROR`);
    else if (roll < 0.9) add(`${ts(sec)} HTTP ${src} 10.0.9.5 GET ${pick(r, PATHS)} ${pick(r, [200, 200, 200, 304, 404])} ${Math.floor(r() * 50_000)} "${pick(r, UAS)}"`);
    else add(`${ts(sec)} SMTP ${src} mail.corp.example from=<user${Math.floor(r() * 40)}@corp.example> to=<peer${Math.floor(r() * 40)}@corp.example> status=sent`);
  }
  // Approved relay fan-out (allowlisted => silent) and typo storm below threshold.
  for (let i = 0; i < 14; i++) add(`${ts(600 + i * 20)} SMTP 10.0.9.25 mail.corp.example from=<notify@corp.example> to=<c${i}@customer${i}.example> status=sent`);
  for (let i = 0; i < 5; i++) add(`${ts(900 + i * 200)} DNS 10.0.4.23 query A wiki.corp.exmaple${i} NXDOMAIN`);
  if (id === 'quiet-baseline') return lines.sort().join('\n');
  // Expected false positive: CDN content-hash hostnames.
  // Content-hash hostnames: mixed-day uses 32-hex (sha-like) labels under an allowlisted suffix; cdn-noise uses 44-char
  // base64url-style labels (over the 40-char long-label threshold) under a suffix that is NOT allowlisted, so the
  // false positive fires deterministically regardless of the seed's entropy draw.
  const hex = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
  const b64 = () => Array.from({ length: 44 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(r() * 36)]).join('');
  const cdnSuffix = id === 'cdn-noise' ? 'edge.media.example' : 'assets.cdn.example';
  for (let i = 0; i < (id === 'cdn-noise' ? 25 : 6); i++) add(`${ts(1200 + i * 90)} DNS ${pick(r, WORKSTATIONS)} query A ${id === 'cdn-noise' ? b64() : hex()}.${cdnSuffix} NOERROR`);
  if (id === 'cdn-noise') return lines.sort().join('\n');
  // Attack-like synthetic scenarios (no real payloads).
  const b32 = () => Array.from({ length: 48 }, () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(r() * 32)]).join('');
  for (let i = 0; i < 6; i++) add(`${ts(1800 + i * 30)} DNS 10.0.4.31 query TXT ${b32()}.t.exfil-lab.example NOERROR`);
  for (let i = 0; i < 12; i++) add(`${ts(2400 + i * 4)} DNS 10.0.4.27 query A ${['qzv', 'xkp', 'wrt', 'plm'][i % 4]}${i}gen.example NXDOMAIN`);
  for (let i = 0; i < 14; i++) add(`${ts(3000 + i * 6)} HTTP 10.0.4.29 10.0.9.5 POST /login 401 180 "python-requests/2.31"`);
  add(`${ts(3300)} HTTP 10.0.4.29 10.0.9.5 POST /login 200 180 "python-requests/2.31"`);
  add(`${ts(3400)} HTTP 10.0.4.27 198.51.100.77 POST /api/upload 200 7340032 "curl/8.4.0"`);
  for (let i = 0; i < 12; i++) add(`${ts(4000 + i * 25)} SMTP 10.0.4.24 mail.corp.example from=<deals@corp.example> to=<p${i}@shop${i}.example> status=sent`);
  return lines.sort().join('\n');
}
