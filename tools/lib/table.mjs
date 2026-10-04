// Fixed-width table rendering for terminal output.

/**
 * rows: array of objects; columns: [{ key, label, align: 'left'|'right' }].
 * Returns the rendered table as a string (no trailing newline).
 */
export function formatTable(rows, columns) {
  const cells = rows.map((r) => columns.map((c) => (r[c.key] === undefined || r[c.key] === null ? '-' : String(r[c.key]))));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((row) => row[i].length)));
  const line = (vals) =>
    vals
      .map((v, i) => (columns[i].align === 'right' ? v.padStart(widths[i]) : v.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  const out = [line(columns.map((c) => c.label)), line(widths.map((w) => '-'.repeat(w)))];
  for (const row of cells) out.push(line(row));
  return out.join('\n');
}
