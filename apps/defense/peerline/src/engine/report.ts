import type { Config, ScoredDay } from './ueba';
import type { Metrics } from './evaluate';
export type Disposition = 'true_positive' | 'false_positive' | 'benign_explained';
export interface ReportInput { scored: ScoredDay[]; config: Config; dispositions: Record<string, { disposition: Disposition; note: string }>; evaluation?: Metrics; generatedAt: string }
export function buildReport({ scored, config, dispositions, evaluation, generatedAt }: ReportInput) {
  const alerts = scored.filter(s => s.state === 'alert');
  const byCode: Record<string, number> = {};
  for (const a of alerts) for (const r of a.reasons) byCode[r.code] = (byCode[r.code] ?? 0) + 1;
  return {
    schema: 'peerline.report/1', generatedAt, tool: 'Peerline educational UEBA prototype',
    dataNotice: 'Synthetic users and activity counts generated in the browser; no employee monitoring, no real identities.',
    config,
    summary: { scoredDays: scored.length, alerts: alerts.length, unscored: scored.filter(s => s.state === 'unscored').length, byCode },
    evaluation: evaluation ?? null,
    alerts: alerts.map(a => ({ user: a.user, dept: a.dept, day: a.day, dayType: a.dayType, score: a.score, reasons: a.reasons.map(r => ({ code: r.code, feature: r.feature, value: r.value, z: +r.z.toFixed(2), baseline: r.baseline, text: r.text })), suppressed: a.suppressed, disposition: dispositions[`${a.user}|${a.day}`] ?? null })),
  };
}
