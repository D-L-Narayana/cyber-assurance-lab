import type { ClockState, Jurisdiction } from './types';

const HOUR = 3_600_000;

/**
 * Teaching model of the notification windows. Each clock starts at the recorded awareness/discovery
 * event and counts fixed hours; none of them decides whether notification is actually required, and
 * statutory exceptions (law-enforcement delay, scope determination) are documented, not modelled.
 */
export const CLOCK_RULES: Record<Jurisdiction, { rule: ClockState['rule']; hours: number; windowLabel: string; citation: string }> = {
  'EU-GDPR': { rule: 'fixed-72h', hours: 72, windowLabel: '72 hours', citation: 'GDPR Art. 33(1): notify the supervisory authority without undue delay and, where feasible, not later than 72 hours after becoming aware; later notifications carry reasons for the delay.' },
  'UK-GDPR': { rule: 'fixed-72h', hours: 72, windowLabel: '72 hours', citation: 'UK GDPR Art. 33(1) mirrors the EU text (72 hours from awareness).' },
  'US-CA': { rule: 'fixed-30d', hours: 30 * 24, windowLabel: '30 calendar days', citation: 'Cal. Civ. Code 1798.82(a)(2) as amended by SB 446 (effective 2026-01-01): consumer notice within 30 calendar days of discovery or notification of the breach, with delay permitted for law-enforcement needs or to determine scope and restore system integrity; the separate 15-day Attorney General sample-copy rule for >500 residents is not modelled.' },
};

/** Educational evidence clock. It measures elapsed time from awareness; it does not decide whether notification is required. */
export function evidenceClock(jurisdiction: Jurisdiction, awareAt: string | undefined, now: string): ClockState {
  const rule = CLOCK_RULES[jurisdiction];
  const common = { jurisdiction, rule: rule.rule, windowLabel: rule.windowLabel, windowHours: rule.hours };
  if (!awareAt) return { ...common, phase: 'clock-not-started', note: 'The clock starts at the moment of awareness; record an awareness event to start it.' };
  const awareMs = Date.parse(awareAt);
  const nowMs = Date.parse(now);
  const deadline = awareMs + rule.hours * HOUR;
  // Phase is decided on the exact millisecond values; the displayed hours are rounded afterwards.
  const exceeded = nowMs > deadline;
  const elapsedHours = round((nowMs - awareMs) / HOUR);
  const remainingHours = round((deadline - nowMs) / HOUR);
  return {
    ...common, awareAt, deadlineAt: new Date(deadline).toISOString().replace(/\.\d{3}Z$/, 'Z'), elapsedHours, remainingHours,
    phase: exceeded ? 'window-exceeded' : 'within-window',
    note: exceeded
      ? `The ${rule.windowLabel} window closed ${-remainingHours} h ago.${rule.rule === 'fixed-72h' ? ' A notification made now must be accompanied by reasons for the delay (Art. 33(1)).' : ' Any permitted delay (law enforcement, scope determination) must be documented.'}`
      : `${remainingHours} h remain in the ${rule.windowLabel} window. ${rule.citation}`,
  };
}

function round(n: number): number { return Math.round(n * 10) / 10; }
