import type { Alert, NormalizedEvent, Protocol } from '../engine/types';

const LANES: Protocol[] = ['dns', 'http', 'smtp'];
const LABEL: Record<Protocol, string> = { dns: 'DNS', http: 'HTTP', smtp: 'SMTP' };

interface Props {
  events: NormalizedEvent[];
  alerts: Alert[];
  selectedAlertId: string | null;
  pivotSrc: string | null;
  onSelectAlert: (id: string) => void;
}

/** Three protocol swim-lanes. Event ticks are thin; alerts are brackets spanning their window. */
export function Timeline({ events, alerts, selectedAlertId, pivotSrc, onSelectAlert }: Props) {
  if (!events.length) return <div className="timeline-empty">Generate a scenario or paste logs to draw the timeline.</div>;
  const t0 = Math.min(...events.map(e => e.ts));
  const t1 = Math.max(...events.map(e => e.ts), t0 + 60_000);
  const W = 1000, LANE_H = 44, PAD_L = 56, PAD_T = 22;
  const x = (ts: number) => PAD_L + ((ts - t0) / (t1 - t0)) * (W - PAD_L - 12);
  const ticks = 6;
  return (
    <figure className="timeline" aria-labelledby="timeline-caption" tabIndex={0}>
      <figcaption id="timeline-caption" className="visually-hidden">
        Timeline of {events.length} synthetic events across DNS, HTTP and SMTP lanes from {new Date(t0).toISOString()} to {new Date(t1).toISOString()}. {alerts.length} alerts drawn as brackets. Use the alert queue list for a keyboard-accessible equivalent.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${PAD_T + LANE_H * 3 + 8}`} role="img" aria-hidden="true" preserveAspectRatio="none">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const ts = t0 + ((t1 - t0) * i) / ticks;
          return (
            <g key={i}>
              <line x1={x(ts)} x2={x(ts)} y1={PAD_T - 4} y2={PAD_T + LANE_H * 3} className="tl-grid" />
              <text x={x(ts)} y={12} textAnchor="middle" className="tl-axis">{new Date(ts).toISOString().slice(11, 16)}</text>
            </g>
          );
        })}
        {LANES.map((lane, li) => {
          const y = PAD_T + li * LANE_H;
          return (
            <g key={lane}>
              <rect x={0} y={y} width={W} height={LANE_H} className={`tl-lane tl-lane-${lane}`} />
              <text x={10} y={y + LANE_H / 2 + 4} className={`tl-lane-label lane-${lane}`}>{LABEL[lane]}</text>
              {events.filter(e => e.proto === lane).map(e => (
                <line key={e.id} x1={x(e.ts)} x2={x(e.ts)} y1={y + 14} y2={y + LANE_H - 14}
                  className={`tl-tick ${pivotSrc && e.src === pivotSrc ? 'tl-tick-pivot' : ''}`} />
              ))}
              {alerts.filter(a => a.proto === lane).map(a => {
                const x0 = x(a.firstTs), x1 = Math.max(x(a.lastTs), x0 + 6);
                const sel = a.id === selectedAlertId;
                return (
                  <g key={a.id} className={`tl-alert sev-${a.severity} ${sel ? 'is-selected' : ''}`} onClick={() => onSelectAlert(a.id)}>
                    <rect x={x0 - 3} y={y + 6} width={x1 - x0 + 6} height={LANE_H - 12} rx={3} />
                    <path d={`M${x0 - 3},${y + 6} v${LANE_H - 12} M${x1 + 3},${y + 6} v${LANE_H - 12}`} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
