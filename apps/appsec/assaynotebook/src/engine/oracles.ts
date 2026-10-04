import type { LabRequest, LabResponse } from './lab';

export type OracleKind = 'reflects-unencoded' | 'cross-user-object' | 'cookie-missing-flags' | 'stack-trace-disclosed' | 'security-headers-missing';
export interface OracleSpec { kind: OracleKind; marker?: string }
export interface OracleVerdict { vulnerable: boolean; evidence: string }

export interface OracleDefinition {
  kind: OracleKind;
  title: string;
  cwe: string;
  cweName: string;
  owasp2021: string;
  defaultImpact: 'high' | 'medium' | 'low';
  defaultLikelihood: 'high' | 'medium' | 'low';
  remediation: string;
  evaluate(spec: OracleSpec, req: LabRequest, res: LabResponse): OracleVerdict;
}

const REQUIRED_FLAGS = ['HttpOnly', 'Secure', 'SameSite'];
/** Baseline headers every rendered HTML page should carry (lower-case; lookups are case-insensitive). */
const REQUIRED_HTML_HEADERS = ['content-security-policy', 'x-content-type-options'];

/** Case-insensitive header lookup: HTTP header names are case-insensitive, and recorded exchanges may use any casing. */
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === wanted) return v;
  return undefined;
}

/** A response a browser would render as a page: HTML content type, a body, and not a redirect. */
export function isRenderedHtml(res: LabResponse): boolean {
  const type = headerValue(res.headers, 'content-type') ?? '';
  if (!/^\s*text\/html\s*(;|$)/i.test(type)) return false;
  if (res.status >= 300 && res.status < 400) return false;
  return res.body.length > 0;
}

export const ORACLES: Record<OracleKind, OracleDefinition> = {
  'reflects-unencoded': {
    kind: 'reflects-unencoded',
    title: 'User input reflected into HTML without encoding',
    cwe: 'CWE-79', cweName: "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')",
    owasp2021: 'A03:2021 Injection',
    defaultImpact: 'high', defaultLikelihood: 'medium',
    remediation: 'Contextually encode all untrusted data at output (HTML entity encoding here); add a Content-Security-Policy as defence in depth.',
    evaluate(spec, _req, res) {
      const marker = spec.marker ?? '';
      const raw = marker.length > 0 && res.body.includes(marker);
      return { vulnerable: raw, evidence: raw ? `Response body contains the probe "${marker}" with angle brackets intact.` : `Probe not present verbatim${marker ? ` (encoded form ${res.body.includes(marker.replace('<', '&lt;').replace('>', '&gt;')) ? 'is' : 'is not'} present)` : ''}.` };
    },
  },
  'cross-user-object': {
    kind: 'cross-user-object',
    title: 'Direct object reference returns another user’s record',
    cwe: 'CWE-639', cweName: 'Authorization Bypass Through User-Controlled Key',
    owasp2021: 'A01:2021 Broken Access Control',
    defaultImpact: 'high', defaultLikelihood: 'high',
    remediation: 'Load the record, then compare its owner to the session user before returning it; apply the check in one shared data-access layer.',
    evaluate(_spec, req, res) {
      if (res.status !== 200) return { vulnerable: false, evidence: `Status ${res.status}; no record returned.` };
      const owner = res.body.match(/"owner":"([a-z]+)"/)?.[1];
      const cross = !!owner && !!req.session && owner !== req.session;
      return { vulnerable: cross, evidence: cross ? `Session "${req.session}" received a record owned by "${owner}".` : `Record owner matches the session (${owner ?? 'n/a'}).` };
    },
  },
  'cookie-missing-flags': {
    kind: 'cookie-missing-flags',
    title: 'Session cookie set without protective attributes',
    cwe: 'CWE-1004', cweName: "Sensitive Cookie Without 'HttpOnly' Flag",
    owasp2021: 'A05:2021 Security Misconfiguration',
    defaultImpact: 'medium', defaultLikelihood: 'medium',
    remediation: 'Set HttpOnly, Secure and SameSite (Lax or Strict) on the session cookie; rotate the session id on login.',
    evaluate(_spec, _req, res) {
      const cookie = res.headers['set-cookie'];
      if (!cookie) return { vulnerable: false, evidence: 'No Set-Cookie header in this response.' };
      const missing = REQUIRED_FLAGS.filter((f) => !new RegExp(`;\\s*${f}`, 'i').test(cookie));
      return { vulnerable: missing.length > 0, evidence: missing.length ? `Set-Cookie lacks ${missing.join(', ')}.` : 'Set-Cookie carries HttpOnly, Secure and SameSite.' };
    },
  },
  'stack-trace-disclosed': {
    kind: 'stack-trace-disclosed',
    title: 'Verbose error discloses stack trace and internal details',
    cwe: 'CWE-209', cweName: 'Generation of Error Message Containing Sensitive Information',
    owasp2021: 'A05:2021 Security Misconfiguration',
    defaultImpact: 'low', defaultLikelihood: 'high',
    remediation: 'Validate ids before lookup; return a generic error to clients and log details server-side only.',
    evaluate(_spec, _req, res) {
      const trace = res.status >= 500 && /\n\s+at\s+[\w.]+ \([\w/.-]+:\d+(?::\d+)?\)/.test(res.body);
      const internal = /db=\w+:\/\//.test(res.body);
      return { vulnerable: trace, evidence: trace ? `HTTP ${res.status} body contains a stack trace${internal ? ' and an internal connection string' : ''}.` : `HTTP ${res.status} without stack-trace patterns.` };
    },
  },
  'security-headers-missing': {
    kind: 'security-headers-missing',
    title: 'HTML response served without baseline security headers',
    cwe: 'CWE-693', cweName: 'Protection Mechanism Failure',
    owasp2021: 'A05:2021 Security Misconfiguration',
    defaultImpact: 'low', defaultLikelihood: 'high',
    remediation: "Send Content-Security-Policy (start from default-src 'self' and tighten) and X-Content-Type-Options: nosniff on every HTML response; set them once in the web server or framework middleware so no route can omit them.",
    evaluate(_spec, _req, res) {
      if (!isRenderedHtml(res)) {
        const type = headerValue(res.headers, 'content-type');
        return { vulnerable: false, evidence: `Not a rendered HTML page (HTTP ${res.status}, content-type ${type ?? 'absent'}); the header oracle does not apply.` };
      }
      const missing = REQUIRED_HTML_HEADERS.filter((h) => headerValue(res.headers, h) === undefined);
      return {
        vulnerable: missing.length > 0,
        evidence: missing.length ? `HTML response lacks ${missing.join(' and ')}.` : 'HTML response carries Content-Security-Policy and X-Content-Type-Options.',
      };
    },
  },
};

export function evaluateOracle(spec: OracleSpec, req: LabRequest, res: LabResponse): OracleVerdict {
  return ORACLES[spec.kind].evaluate(spec, req, res);
}

/** Which oracles plausibly apply to a given exchange, for suggesting a finding after a manual probe. */
export function suggestOracles(req: LabRequest, res: LabResponse): OracleSpec[] {
  const out: OracleSpec[] = [];
  const q = req.query?.q;
  if (q && /<assay-[0-9a-f]{6}>/.test(q)) out.push({ kind: 'reflects-unencoded', marker: q.match(/<assay-[0-9a-f]{6}>/)![0] });
  if (/^\/receipts\//.test(req.path)) { out.push({ kind: 'cross-user-object' }); out.push({ kind: 'stack-trace-disclosed' }); }
  if (res.headers['set-cookie']) out.push({ kind: 'cookie-missing-flags' });
  if (isRenderedHtml(res)) out.push({ kind: 'security-headers-missing' });
  return out;
}
