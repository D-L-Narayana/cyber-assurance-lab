import { makeMarker } from './lab';
import type { LabRequest } from './lab';
import type { OracleSpec } from './oracles';

export interface CatalogEntry { id: string; title: string; request: LabRequest; oracle: OracleSpec; steps: string[] }

const marker = makeMarker('assay-catalog');

/** The five authorised lab test cases. Every request is relative to the in-browser application. */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'TC-01', title: 'Search reflects the query heading',
    request: { method: 'GET', path: '/search', query: { q: marker } }, oracle: { kind: 'reflects-unencoded', marker },
    steps: ['Submit a harmless angle-bracket probe as the search term.', 'Inspect the results heading for the verbatim probe.'],
  },
  {
    id: 'TC-02', title: 'Receipt lookup across users',
    request: { method: 'GET', path: '/receipts/r-200', session: 'alice' }, oracle: { kind: 'cross-user-object' },
    steps: ['Sign in as alice.', 'Request receipt r-200, which belongs to bob.', 'Check whether the body is returned instead of 403.'],
  },
  {
    id: 'TC-03', title: 'Login cookie attributes',
    request: { method: 'POST', path: '/login', body: { user: 'alice' } }, oracle: { kind: 'cookie-missing-flags' },
    steps: ['Post the login form.', 'Read the Set-Cookie header for HttpOnly, Secure and SameSite.'],
  },
  {
    id: 'TC-04', title: 'Malformed receipt id error handling',
    request: { method: 'GET', path: '/receipts/not-a-receipt', session: 'alice' }, oracle: { kind: 'stack-trace-disclosed' },
    steps: ['Sign in as alice.', 'Request a receipt id that does not match the expected pattern.', 'Check the status and body for stack frames or connection strings.'],
  },
  {
    id: 'TC-05', title: 'Account page security headers',
    request: { method: 'GET', path: '/account', session: 'alice' }, oracle: { kind: 'security-headers-missing' },
    steps: ['Sign in as alice.', 'Request the account page (an HTML response).', 'Read the response headers, case-insensitively, for Content-Security-Policy and X-Content-Type-Options.'],
  },
];
