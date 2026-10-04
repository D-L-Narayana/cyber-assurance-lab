// Inlined `data:` URLs in built assets versus the Content-Security-Policy the app ships in its vercel.json.
//
// Vite inlines imported assets smaller than `build.assetsInlineLimit` (default 4096 bytes) as data: URLs — in CSS
// as `url(data:font/woff2;base64,…)` for small font subsets, in JS as string literals for imported images/fonts.
// The lab's canonical CSP has `font-src 'self'` (no `data:`) and `img-src 'self' data: blob:`, so an inlined font is
// blocked by the browser ("Refused to load the font 'data:font/woff2;base64,…' because it violates the following
// Content Security Policy directive: font-src 'self'") while an inlined image is not. The fix is to emit the assets
// as files (vite.config.ts: `build: { assetsInlineLimit: 0 }`), not to widen the CSP.
//
// Rule: collect data: URLs per built CSS/JS file; map the mime type to a CSP directive (font/*, application/font*,
// application/x-font*, application/vnd.ms-fontobject → font-src; image/* → img-src; anything else → default-src);
// the governing directive is the mapped one when the CSP lists it, otherwise default-src (CSP fallback semantics),
// otherwise nothing governs it; the URL is allowed only when the governing directive contains the `data:` token.
import { parseCsp } from './contracts.mjs';

const CSS_URL_RE = /url\(\s*(?:"(data:[^"]*)"|'(data:[^']*)'|(data:[^)\s]*))\s*\)/gi;
const JS_STRING_RE = /["'`](data:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,][^"'`]*)["'`]/gi;
const MIME_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)/i;

export function directiveForMime(mime) {
  const m = String(mime).toLowerCase();
  if (m.startsWith('font/') || m.startsWith('application/font') || m.startsWith('application/x-font') || m === 'application/vnd.ms-fontobject') return 'font-src';
  if (m.startsWith('image/')) return 'img-src';
  return 'default-src';
}

/** data: URLs in a CSS (`url(...)`) or JS (string literal) file: [{ mime, index, encodedLength, decodedBytes, base64 }]. */
export function collectDataUrls(text, fileName) {
  const isCss = /\.css$/i.test(fileName);
  const re = new RegExp((isCss ? CSS_URL_RE : JS_STRING_RE).source, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const url = m[1] ?? m[2] ?? m[3];
    const mm = MIME_RE.exec(url);
    if (!mm) continue;
    const comma = url.indexOf(',');
    const payload = comma === -1 ? '' : url.slice(comma + 1);
    const base64 = /;base64,/i.test(url);
    out.push({ mime: mm[1].toLowerCase(), index: m.index, encodedLength: url.length, decodedBytes: base64 ? Math.floor((payload.replace(/[^A-Za-z0-9+/]/g, '').length * 3) / 4) : percentDecodedBytes(payload), base64 });
  }
  return out;
}

function percentDecodedBytes(payload) {
  try {
    return Buffer.byteLength(decodeURIComponent(payload), 'utf8');
  } catch {
    return payload.length;
  }
}

/** The directive that governs `directive` under a parsed CSP (Map): itself, else default-src, else null. */
export function governingDirective(cspMap, directive) {
  if (cspMap.has(directive)) return { name: directive, value: cspMap.get(directive), fallback: false };
  if (cspMap.has('default-src')) return { name: 'default-src', value: cspMap.get('default-src'), fallback: true };
  return null;
}

export function allowsDataScheme(value) {
  return String(value)
    .split(/\s+/)
    .some((t) => t.toLowerCase() === 'data:');
}

/**
 * Evaluate every data: URL of a file against a CSP string (null = no policy).
 * Returns [{ mime, directive, governing, governingValue, allowed, unrestricted, index, encodedLength, decodedBytes, base64 }].
 */
export function evaluateDataUrls(text, fileName, csp) {
  const cspMap = csp ? parseCsp(csp) : null;
  return collectDataUrls(text, fileName).map((d) => {
    const directive = directiveForMime(d.mime);
    const gov = cspMap ? governingDirective(cspMap, directive) : null;
    const allowed = !gov || allowsDataScheme(gov.value);
    return { ...d, directive, governing: gov ? gov.name : null, governingValue: gov ? gov.value : null, allowed, unrestricted: !gov };
  });
}

export function describeDataUrl(d) {
  return `data:${d.mime}${d.base64 ? ';base64' : ''} — ${d.encodedLength.toLocaleString('en-US')} chars encoded ≈ ${d.decodedBytes.toLocaleString('en-US')} bytes decoded (offset ${d.index})`;
}

/**
 * Self-test cases: [{ name, file, text, csp, expect: [{ mime, directive, blocked }] }] (order-insensitive).
 */
export function runDataUrlSelfTest(cases) {
  const key = (x) => `${x.mime}|${x.directive}|${x.blocked}`;
  const results = [];
  for (const c of cases) {
    const got = evaluateDataUrls(c.text, c.file, c.csp)
      .map((i) => ({ mime: i.mime, directive: i.directive, blocked: !i.allowed }))
      .sort((a, b) => key(a).localeCompare(key(b)));
    const expect = [...c.expect].sort((a, b) => key(a).localeCompare(key(b)));
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    results.push({ name: c.name, ok, got, expect });
  }
  return { ok: results.every((r) => r.ok), results };
}
