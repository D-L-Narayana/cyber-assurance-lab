// Parsers for Vitest results: the JSON reporter file (preferred) and the default reporter's summary lines
// (fallback), plus the npm audit JSON shape.

/** From a parsed Vitest JSON-reporter document. Returns { total, passed, failed, skipped, files, source } or null. */
export function parseVitestJson(doc) {
  if (!doc || typeof doc !== 'object' || typeof doc.numTotalTests !== 'number') return null;
  const files = Array.isArray(doc.testResults) ? doc.testResults.length : typeof doc.numTotalTestSuites === 'number' ? doc.numTotalTestSuites : null;
  return {
    total: doc.numTotalTests,
    passed: doc.numPassedTests ?? 0,
    failed: doc.numFailedTests ?? 0,
    skipped: (doc.numPendingTests ?? 0) + (doc.numTodoTests ?? 0),
    files,
    source: 'json',
  };
}

/**
 * From the default reporter's stdout, e.g.
 *   ` Test Files  2 passed (2)` / `      Tests  3 failed | 45 passed | 1 skipped (49)`.
 * Returns { total, passed, failed, skipped, files, source } or null when no summary line is present.
 */
export function parseVitestStdout(text) {
  const t = String(text ?? '');
  const tests = /^\s*Tests\s+([^\n]*?)\s+\((\d+)\)\s*$/m.exec(t);
  if (!tests) return null;
  const parts = parseCounts(tests[1]);
  const files = /^\s*Test Files\s+([^\n]*?)\s+\((\d+)\)\s*$/m.exec(t);
  return {
    total: Number(tests[2]),
    passed: parts.passed ?? 0,
    failed: parts.failed ?? 0,
    skipped: (parts.skipped ?? 0) + (parts.todo ?? 0),
    files: files ? Number(files[2]) : null,
    source: 'stdout',
  };
}

function parseCounts(segment) {
  const out = {};
  for (const piece of segment.split('|')) {
    const m = /(\d+)\s+(failed|passed|skipped|todo)/.exec(piece);
    if (m) out[m[2]] = Number(m[1]);
  }
  return out;
}

/** From `npm audit --json` output: { high, critical, total } or null when the shape is unknown. */
export function parseNpmAuditJson(doc) {
  const v = doc && doc.metadata && doc.metadata.vulnerabilities;
  if (!v || typeof v !== 'object') return null;
  return { high: v.high ?? 0, critical: v.critical ?? 0, total: v.total ?? 0 };
}

/** From `npm audit` human output: number of vulnerabilities or null. */
export function parseNpmAuditText(text) {
  const m = /found (\d+) vulnerabilit/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}
