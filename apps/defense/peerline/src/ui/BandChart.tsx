import type { ActivityRecord, Feature } from '../engine/ueba';
import { FEATURE_LABEL } from '../engine/ueba';
import type { RobustStats } from '../engine/stats';

interface Props { records: ActivityRecord[]; feature: Feature; stats: RobustStats | null; madFloor: number; zThreshold: number; splitDay: string; highlightDay: string }

/** 28-day series with the robust baseline band (median ± zThreshold·max(MAD, floor)/0.6745). */
export function BandChart({ records, feature, stats, madFloor, zThreshold, splitDay, highlightDay }: Props) {
  const W = 320, H = 86, PL = 34, PR = 6, PT = 8, PB = 16;
  const sorted = [...records].sort((a, b) => a.day.localeCompare(b.day));
  const vals = sorted.map(r => r[feature]);
  const scale = stats ? Math.max(stats.mad, madFloor) : 0;
  const bandHi = stats ? stats.median + (zThreshold * scale) / 0.6745 : 0;
  const bandLo = stats ? Math.max(0, stats.median - (zThreshold * scale) / 0.6745) : 0;
  const max = Math.max(...vals, bandHi, feature === 'afterHoursPct' ? 1 : 1) * 1.08;
  const x = (i: number) => PL + (i / Math.max(1, sorted.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const splitIdx = sorted.findIndex(r => r.day >= splitDay);
  const fmt = (v: number) => feature === 'afterHoursPct' ? `${Math.round(v * 100)}%` : v.toFixed(0);
  const title = `${FEATURE_LABEL[feature]}: ${sorted.length} days, baseline median ${stats ? fmt(stats.median) : 'n/a'}, band up to ${fmt(bandHi)}.`;
  return (
    <figure className="band">
      <figcaption>{FEATURE_LABEL[feature]} <span className="mono muted">median {stats ? fmt(stats.median) : '—'} · band ≤ {fmt(bandHi)}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {stats && <rect x={PL} y={y(bandHi)} width={W - PL - PR} height={Math.max(0, y(bandLo) - y(bandHi))} className="band-fill" />}
        {stats && <line x1={PL} x2={W - PR} y1={y(stats.median)} y2={y(stats.median)} className="band-median" />}
        {splitIdx > 0 && <line x1={x(splitIdx) - 2} x2={x(splitIdx) - 2} y1={PT} y2={H - PB} className="band-split" />}
        <polyline points={sorted.map((r, i) => `${x(i)},${y(r[feature])}`).join(' ')} className="band-line" />
        {sorted.map((r, i) => {
          const out = stats && r[feature] > bandHi;
          return <circle key={r.day} cx={x(i)} cy={y(r[feature])} r={r.day === highlightDay ? 4.5 : out ? 3 : 1.6} className={`band-dot ${out ? 'is-out' : ''} ${r.day === highlightDay ? 'is-focus' : ''}`} />;
        })}
        <text x={PL - 4} y={y(max / 1.08) + 4} textAnchor="end" className="band-axis">{fmt(max / 1.08)}</text>
        <text x={PL - 4} y={y(0)} textAnchor="end" className="band-axis">0</text>
        <text x={x(0)} y={H - 3} className="band-axis">{sorted[0]?.day.slice(5)}</text>
        <text x={W - PR} y={H - 3} textAnchor="end" className="band-axis">{sorted[sorted.length - 1]?.day.slice(5)}</text>
      </svg>
    </figure>
  );
}
