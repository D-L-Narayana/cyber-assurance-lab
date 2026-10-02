import type { DataElement, RetentionSchedule } from './types';

/** Element override wins over the schedule period; undefined when neither is set. */
export function effectiveRetentionDays(element: DataElement, schedules: RetentionSchedule[]): number | undefined {
  if (element.retentionDaysOverride !== undefined) return element.retentionDaysOverride;
  const schedule = schedules.find((s) => s.id === element.scheduleId);
  return schedule?.days;
}
