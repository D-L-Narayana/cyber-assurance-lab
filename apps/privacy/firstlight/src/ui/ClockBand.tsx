import type { ClockState, Timeline } from '../engine/types';

interface Props {
  timeline: Timeline;
  clocks: ClockState[];
  now: string;
}

const HOUR = 3_600_000;

function fmt(iso: string): string {
  return iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, 'Z');
}

/**
 * The evidence clock band. The horizontal axis spans from the earliest anchor to the latest of
 * (now, deadline) plus padding; the 72-hour window from awareness is shaded, elapsed time is filled,
 * and anchors (occurred, detected, aware, contained), now and the deadline are pinned.
 */
export function ClockBand({ timeline, clocks, now }: Props) {
  // The band is drawn against the shortest window present (72 h when any GDPR jurisdiction is selected); longer windows are shown as chips.
  const fixed = [...clocks].filter((c) => c.phase !== 'clock-not-started').sort((a, b) => a.windowHours - b.windowHours)[0] ?? clocks[0];
  const anchors: Array<{ key: string; label: string; at?: string }> = [
    { key: 'occurred', label: 'occurred', at: timeline.occurredAt },
    { key: 'detected', label: 'detected', at: timeline.detectedAt },
    { key: 'aware', label: 'aware', at: timeline.awareAt },
    { key: 'contained', label: 'contained', at: timeline.containedAt },
  ];
  const times = [...anchors.map((a) => a.at), now, fixed?.deadlineAt].filter((t): t is string => Boolean(t)).map((t) => Date.parse(t));
  const min = Math.min(...times) - 6 * HOUR;
  const max = Math.max(...times) + 6 * HOUR;
  const pct = (iso: string) => `${(((Date.parse(iso) - min) / (max - min)) * 100).toFixed(2)}%`;
  const awareT = timeline.awareAt ? Date.parse(timeline.awareAt) : undefined;
  const deadlineT = fixed?.deadlineAt ? Date.parse(fixed.deadlineAt) : undefined;
  const nowT = Date.parse(now);

  const description = fixed
    ? fixed.phase === 'clock-not-started' ? 'Clock not started: no awareness event.' : `${fixed.jurisdiction}: ${fixed.phase === 'within-window' ? `${fixed.remainingHours} hours remain` : `${-(fixed.remainingHours ?? 0)} hours past the ${fixed.windowLabel} window`}; awareness ${fixed.awareAt}, deadline ${fixed.deadlineAt}.`
    : 'No jurisdiction selected.';

  return (
    <section className="clock" aria-labelledby="clock-h">
      <div className="clock-head">
        <h2 id="clock-h">Evidence clock · now {fmt(now)}</h2>
        <div className="clock-chips" role="list" aria-label="Jurisdiction clocks">
          {clocks.map((c) => (
            <span key={c.jurisdiction} role="listitem" className={`chip ${c.phase === 'within-window' ? 'within' : c.phase === 'window-exceeded' ? 'exceeded' : 'nostart'}`}>
              {c.jurisdiction}: {c.phase === 'within-window' ? `${c.remainingHours} h left of ${c.windowLabel}` : c.phase === 'window-exceeded' ? `${c.windowLabel} exceeded by ${-(c.remainingHours ?? 0)} h` : 'clock not started'}
            </span>
          ))}
        </div>
      </div>
      <div className="band-wrap" role="img" aria-label={`Evidence clock. ${description}`}>
        <div className="band-track">
          {awareT !== undefined && deadlineT !== undefined && <div className="band-window" style={{ left: pct(timeline.awareAt!), width: `calc(${pct(fixed!.deadlineAt!)} - ${pct(timeline.awareAt!)})` }} />}
          {awareT !== undefined && <div className={`band-elapsed${deadlineT !== undefined && nowT > deadlineT ? ' exceeded' : ''}`} style={{ left: pct(timeline.awareAt!), width: `calc(${pct(now)} - ${pct(timeline.awareAt!)})` }} />}
        </div>
        {anchors.filter((a) => a.at).map((a) => (
          <div key={a.key} className={`pin ${a.key}`} style={{ left: pct(a.at!) }}>
            <span className="pin-label">{a.label}</span>
            <span className="pin-time">{fmt(a.at!)}</span>
          </div>
        ))}
        <div className="pin now" style={{ left: pct(now) }}><span className="pin-label">now</span></div>
        {fixed?.deadlineAt && <div className="pin deadline" style={{ left: pct(fixed.deadlineAt) }}><span className="pin-label">{fixed.windowLabel}</span><span className="pin-time">{fmt(fixed.deadlineAt)}</span></div>}
      </div>
      <p className="band-note">{fixed ? <>{fixed.note}</> : clocks[0]?.note}{timeline.awareAt && timeline.detectedAt && <> · Detection to awareness: <b>{Math.round((Date.parse(timeline.awareAt) - Date.parse(timeline.detectedAt)) / HOUR * 10) / 10} h</b></>}{timeline.occurredAt && timeline.detectedAt && <> · Occurrence to detection: <b>{Math.round((Date.parse(timeline.detectedAt) - Date.parse(timeline.occurredAt)) / HOUR * 10) / 10} h</b></>}</p>
    </section>
  );
}
