import type { IncidentEvent, SequenceIssue, Timeline } from './types';

const HOUR = 3_600_000;
export const LARGE_GAP_DAYS = 7;

/**
 * Deduplicates (same id, or same instant + kind + summary), sorts chronologically (ties by kind
 * order then id) and derives the anchor timestamps. Sequence problems are reported, never fixed.
 */
export function buildTimeline(input: IncidentEvent[]): Timeline {
  const seenIds = new Set<string>();
  const seenSig = new Set<string>();
  const events: IncidentEvent[] = [];
  const duplicatesRemoved: IncidentEvent[] = [];
  const ordered = [...input].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
  for (const e of ordered) {
    const sig = `${Date.parse(e.at)}|${e.kind}|${e.summary.trim()}`;
    if (seenIds.has(e.id) || seenSig.has(sig)) { duplicatesRemoved.push(e); continue; }
    seenIds.add(e.id); seenSig.add(sig);
    events.push(e);
  }
  const first = (kind: IncidentEvent['kind']) => events.find((e) => e.kind === kind);
  const occurred = first('occurred'); const detected = first('detected'); const aware = first('aware'); const contained = first('contained');
  const issues: SequenceIssue[] = [];
  if (duplicatesRemoved.length) issues.push({ code: 'DUPLICATE_EVENT', message: `${duplicatesRemoved.length} duplicate event(s) removed: ${duplicatesRemoved.map((d) => d.id).join(', ')}.`, eventIds: duplicatesRemoved.map((d) => d.id) });
  if (!detected) issues.push({ code: 'MISSING_DETECTION', message: 'No detection event recorded; the detection time is unknown.', eventIds: [] });
  if (!aware) issues.push({ code: 'MISSING_AWARENESS', message: 'No awareness event recorded; the notification clock cannot start until the moment of awareness is established.', eventIds: [] });
  if (aware && detected && Date.parse(aware.at) < Date.parse(detected.at)) issues.push({ code: 'AWARE_BEFORE_DETECTED', message: `Awareness (${aware.at}) is recorded before detection (${detected.at}); one of the two timestamps is wrong.`, eventIds: [aware.id, detected.id] });
  if (contained && detected && Date.parse(contained.at) < Date.parse(detected.at)) issues.push({ code: 'CONTAINED_BEFORE_DETECTED', message: `Containment (${contained.at}) is recorded before detection (${detected.at}).`, eventIds: [contained.id, detected.id] });
  if (occurred && detected && Date.parse(detected.at) - Date.parse(occurred.at) > LARGE_GAP_DAYS * 24 * HOUR) {
    const days = Math.round((Date.parse(detected.at) - Date.parse(occurred.at)) / (24 * HOUR));
    issues.push({ code: 'LARGE_GAP', message: `${days} days between occurrence and detection; the exposure window is long and the occurrence time should be evidenced.`, eventIds: [occurred.id, detected.id] });
  }
  for (const e of events) if (Date.parse(e.at) < (occurred ? Date.parse(occurred.at) : -Infinity) && e.kind !== 'note') issues.push({ code: 'OUT_OF_ORDER', message: `${e.id} (${e.kind}) is recorded before the occurrence event.`, eventIds: [e.id] });
  return {
    events, duplicatesRemoved, issues,
    ...(occurred ? { occurredAt: occurred.at } : {}), ...(detected ? { detectedAt: detected.at } : {}), ...(aware ? { awareAt: aware.at } : {}), ...(contained ? { containedAt: contained.at } : {}),
  };
}

const KIND_ORDER: IncidentEvent['kind'][] = ['occurred', 'detected', 'aware', 'escalated', 'contained', 'evidence', 'note'];
