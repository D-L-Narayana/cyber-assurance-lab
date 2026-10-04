// Weft CSV export. Pure; no DOM.
// RFC 4180-style output (every cell double-quoted, embedded quotes doubled, rows joined with CRLF) with the same
// spreadsheet formula-injection neutralisation as Tessera: a cell that begins with = + - @ — even behind leading
// whitespace or control characters — or that begins with a tab or carriage return is prefixed with an apostrophe.
import type { Analysis, Bundle, Issue } from './types';

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    let s = String(v);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export const FINDINGS_CSV_HEADER: readonly string[] = ['kind', 'severity', 'refs', 'message'];
export const ARTIFACTS_CSV_HEADER: readonly string[] = ['id', 'name', 'kind', 'capturedOn', 'sha256', 'bytes', 'declaredMatches', 'duplicateOf', 'linkedAssertions'];

/** Findings ledger rows in ledger order (severity, then kind, then refs — exactly as `analyze()` sorts them). */
export function findingsToCsvRows(issues: Issue[]): (string | number)[][] {
  return [[...FINDINGS_CSV_HEADER], ...issues.map((i): (string | number)[] => [i.kind, i.severity, i.refs.join('; '), i.message])];
}

/** Artifact table rows sorted by id (the manifest order), joining each artifact's fields with its analysis. */
export function artifactsToCsvRows(bundle: Bundle, analysis: Analysis): (string | number)[][] {
  const info = new Map(analysis.artifacts.map((a) => [a.id, a]));
  const rows = [...bundle.artifacts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a): (string | number)[] => {
      const i = info.get(a.id);
      const declared = i === undefined ? '' : i.declaredMatches === null ? 'none declared' : i.declaredMatches ? 'yes' : 'no';
      return [a.id, a.name, a.kind, a.capturedOn, i?.sha256 ?? '', i?.bytes ?? 0, declared, i?.duplicateOf.join('; ') ?? '', i?.linkedAssertions.join('; ') ?? ''];
    });
  return [[...ARTIFACTS_CSV_HEADER], ...rows];
}
