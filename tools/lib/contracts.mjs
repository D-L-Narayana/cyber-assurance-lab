// Lab-wide contracts enforced by the checkers (values must stay in sync with the documented contract in
// tools/README.md). Keeping them in one module lets several tools share them.

/** Canonical `vercel.json` header set, applied to every app. Order is not significant. */
export const CANONICAL_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** `source` the single header block must use. */
export const CANONICAL_SOURCE = '/(.*)';

/** Top-level `vercel.json` keys that may appear besides `headers`. */
export const ALLOWED_TOP_LEVEL_KEYS = new Set(['$schema', 'buildCommand', 'outputDirectory', 'framework', 'cleanUrls', 'headers']);

/** Required `engines.node` value. */
export const ENGINES_NODE = '>=20.19';

/** Per-app production bundle budget (bytes): 2.0 MB = 2 * 1024 * 1024. */
export const DIST_BUDGET_BYTES = 2 * 1024 * 1024;

/** Identifiers that must not appear in shipped JS (browser-local contract). */
export const DIST_FORBIDDEN_TOKENS = ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'localStorage', 'sessionStorage', 'indexedDB'];

/** Additional identifiers reported as warnings (cookies/analytics are also out of contract, but these are noisier). */
export const DIST_WARN_TOKENS = ['document.cookie', 'sendBeacon'];

/** Parse a CSP string into an ordered Map directive -> value string. */
export function parseCsp(value) {
  const map = new Map();
  for (const part of String(value).split(';')) {
    const t = part.trim();
    if (!t) continue;
    const [directive, ...rest] = t.split(/\s+/);
    map.set(directive.toLowerCase(), rest.join(' '));
  }
  return map;
}

/** Human-readable directive-level difference between two CSP strings. */
export function diffCsp(expected, actual) {
  const e = parseCsp(expected);
  const a = parseCsp(actual);
  const lines = [];
  for (const [d, v] of e) {
    if (!a.has(d)) lines.push(`missing directive: ${d} ${v}`.trimEnd());
    else if (normaliseTokens(a.get(d)) !== normaliseTokens(v)) lines.push(`directive ${d}: expected "${v}" actual "${a.get(d)}"`);
  }
  for (const [d, v] of a) if (!e.has(d)) lines.push(`extra directive: ${d} ${v}`.trimEnd());
  return lines;
}

function normaliseTokens(v) {
  return v.split(/\s+/).filter(Boolean).sort().join(' ');
}
