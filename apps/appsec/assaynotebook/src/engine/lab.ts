/**
 * "Ledgerly" — a tiny, deterministic, in-memory web application used as the assessment target.
 * It is a pure function of (build, request). It performs no I/O and cannot be pointed at anything else.
 * Builds: v1 = all five seeded flaws; v2 = reflection and IDOR fixed; v3 = everything fixed (including the
 * baseline security headers on HTML responses, which v1 and v2 omit).
 */
export type Build = 'v1' | 'v2' | 'v3';
export const BUILDS: { id: Build; label: string }[] = [
  { id: 'v1', label: 'v1 — initial (5 seeded flaws)' },
  { id: 'v2', label: 'v2 — partial fix (reflection, IDOR)' },
  { id: 'v3', label: 'v3 — remediated' },
];
export type Session = 'alice' | 'bob';
export interface LabRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  session?: Session | null;
}
export interface LabResponse { status: number; headers: Record<string, string>; body: string }

export const LAB_ROUTES = [
  { method: 'GET', path: '/search', params: ['q'], description: 'Full-text search; echoes the query in the results heading.' },
  { method: 'GET', path: '/receipts/{id}', params: ['id'], description: 'Returns one expense receipt as JSON. Requires a session.' },
  { method: 'POST', path: '/login', params: ['user'], description: 'Starts a session and sets the sid cookie.' },
  { method: 'GET', path: '/account', params: [], description: 'Shows the current user. Requires a session.' },
] as const;

const RECEIPTS: Record<string, { owner: Session; merchant: string; total: string }> = {
  'r-100': { owner: 'alice', merchant: 'Northwind Stationery', total: '42.10' },
  'r-101': { owner: 'alice', merchant: 'Metro Transit', total: '3.50' },
  'r-200': { owner: 'bob', merchant: 'Blue Fern Catering', total: '318.00' },
};

export const LIMITS = { maxParamLength: 512, maxParams: 8, maxPathLength: 200 } as const;
const PATH = /^\/[a-z0-9][a-z0-9\-/]{0,199}$/i;
const SAFE_PARAM = /^[\x20-\x7e]*$/;

export function validateLabRequest(req: LabRequest): { ok: true } | { ok: false; error: string } {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(req.path) || req.path.startsWith('//')) return { ok: false, error: `External target refused: "${req.path}". The lab accepts only relative paths of the in-browser application.` };
  if (req.path.length > LIMITS.maxPathLength || !PATH.test(req.path) || req.path.includes('..')) return { ok: false, error: 'Path must be a relative lab path such as /search or /receipts/r-100.' };
  for (const bag of [req.query ?? {}, req.body ?? {}]) {
    const entries = Object.entries(bag);
    if (entries.length > LIMITS.maxParams) return { ok: false, error: `At most ${LIMITS.maxParams} parameters.` };
    for (const [k, v] of entries) {
      if (!/^[a-z][a-z0-9_]{0,31}$/i.test(k)) return { ok: false, error: `Parameter name "${k}" is not allowed.` };
      if (typeof v !== 'string' || v.length > LIMITS.maxParamLength || !SAFE_PARAM.test(v)) return { ok: false, error: `Parameter "${k}" must be printable ASCII up to ${LIMITS.maxParamLength} characters.` };
    }
  }
  if (req.session !== undefined && req.session !== null && req.session !== 'alice' && req.session !== 'bob') return { ok: false, error: 'Session must be alice, bob or none.' };
  return { ok: true };
}

/** A harmless, recognisable probe: angle brackets around a short hex tag. Never a script or event handler. */
export function makeMarker(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `<assay-${h.toString(16).padStart(8, '0').slice(-6)}>`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseHeaders = (build: Build): Record<string, string> => ({
  'content-type': 'text/html; charset=utf-8',
  'x-lab-build': build,
  ...(build === 'v3' ? { 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'", 'referrer-policy': 'no-referrer' } : {}),
});
const sessionToken = (user: Session) => `sid=${user === 'alice' ? 'a7c2e9f14b3d0c5e' : 'b91f3e0a6d2c8e47'}`;

export function labRequest(build: Build, req: LabRequest): LabResponse {
  const valid = validateLabRequest(req);
  if (!valid.ok) return { status: 400, headers: baseHeaders(build), body: `<p>Bad request: ${escapeHtml(valid.error)}</p>` };
  const headers = baseHeaders(build);
  const user = req.session ?? null;

  if (req.method === 'GET' && req.path === '/search') {
    const q = req.query?.q ?? '';
    const shown = build === 'v1' ? q : escapeHtml(q);
    const hits = q && 'northwind stationery'.includes(q.toLowerCase()) ? '<li>Northwind Stationery — r-100</li>' : '';
    return { status: 200, headers, body: `<!doctype html><html><body><h1>Results for: ${shown}</h1><ul>${hits}</ul></body></html>` };
  }

  if (req.method === 'POST' && req.path === '/login') {
    const who = req.body?.user;
    if (who !== 'alice' && who !== 'bob') return { status: 401, headers, body: '<p>Unknown user.</p>' };
    const cookie = build === 'v3' ? `${sessionToken(who)}; Path=/; HttpOnly; Secure; SameSite=Lax` : `${sessionToken(who)}; Path=/`;
    return { status: 302, headers: { ...headers, 'set-cookie': cookie, location: '/account' }, body: '' };
  }

  if (req.method === 'GET' && req.path === '/account') {
    if (!user) return { status: 401, headers, body: '<p>Please log in.</p>' };
    return { status: 200, headers, body: `<!doctype html><html><body><h1>Account</h1><p>Signed in as ${user}</p></body></html>` };
  }

  const receipt = req.path.match(/^\/receipts\/([a-z0-9-]+)$/i);
  if (req.method === 'GET' && receipt) {
    const id = receipt[1];
    const json = { ...headers, 'content-type': 'application/json' };
    if (!user) return { status: 401, headers: json, body: '{"error":"login required"}' };
    if (!/^r-\d{3}$/.test(id)) {
      if (build === 'v3') return { status: 400, headers: json, body: '{"error":"invalid receipt id"}' };
      return {
        status: 500, headers: { ...json, 'content-type': 'text/plain' },
        body: `TypeError: Cannot read properties of undefined (reading 'owner')\n    at ReceiptRepo.find (receipts.ts:42)\n    at ReceiptController.show (controllers/receipt.ts:17)\n    at Router.dispatch (router.ts:88)\n  db=postgres://ledgerly-app@db.internal.example:5432/ledgerly`,
      };
    }
    const row = RECEIPTS[id];
    if (!row) return { status: 404, headers: json, body: '{"error":"not found"}' };
    if (build !== 'v1' && row.owner !== user) return { status: 403, headers: json, body: '{"error":"forbidden"}' };
    return { status: 200, headers: json, body: JSON.stringify({ id, owner: row.owner, merchant: row.merchant, total: row.total }) };
  }

  return { status: 404, headers, body: '<p>Not found.</p>' };
}
