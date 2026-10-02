import type { ActivityRecord } from './ueba';
export const LIMITS = { maxRecords: 5000, maxBytes: 2_000_000 };
export type ValidateResult = { ok: true; records: ActivityRecord[] } | { ok: false; errors: string[] };

export function validateRecords(input: unknown): ValidateResult {
  if (!Array.isArray(input)) return { ok: false, errors: ['Input must be a JSON array of activity records.'] };
  if (input.length > LIMITS.maxRecords) return { ok: false, errors: [`Too many records: ${input.length} (limit ${LIMITS.maxRecords}).`] };
  const errors: string[] = []; const out: ActivityRecord[] = [];
  input.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) { errors.push(`#${i}: not an object`); return; }
    const r = raw as Record<string, unknown>;
    const str = (k: string, max: number) => typeof r[k] === 'string' && (r[k] as string).length > 0 && (r[k] as string).length <= max;
    if (!str('user', 64)) errors.push(`#${i}: user must be a 1–64 char string`);
    if (!str('dept', 64)) errors.push(`#${i}: dept must be a 1–64 char string`);
    if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || Number.isNaN(Date.parse(r.day + 'T00:00:00Z'))) errors.push(`#${i}: day must be YYYY-MM-DD`);
    for (const k of ['logins', 'uploadMB', 'distinctHosts'] as const) if (typeof r[k] !== 'number' || !Number.isFinite(r[k] as number) || (r[k] as number) < 0 || (r[k] as number) > 1e9) errors.push(`#${i}: ${k} must be a number ≥ 0`);
    if (typeof r.afterHoursPct !== 'number' || (r.afterHoursPct as number) < 0 || (r.afterHoursPct as number) > 1) errors.push(`#${i}: afterHoursPct must be between 0 and 1`);
    if (errors.length === 0) out.push({ user: r.user as string, dept: r.dept as string, day: r.day as string, logins: r.logins as number, uploadMB: r.uploadMB as number, distinctHosts: r.distinctHosts as number, afterHoursPct: r.afterHoursPct as number });
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, records: out };
}
