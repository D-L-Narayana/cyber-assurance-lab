import type { FactKey, IncidentBundle, Readiness, ReadinessItem } from './types';
import { buildTimeline } from './timeline';
import { severity } from './severity';

/** Facts aligned to GDPR Art. 33(3)(a)-(d) plus internal derived checks. Labels are plain language, not legal text. */
export const FACTS: Array<{ key: FactKey; label: string; required: boolean }> = [
  { key: 'nature', label: 'Nature of the breach', required: true },
  { key: 'categoriesOfSubjects', label: 'Categories of data subjects', required: true },
  { key: 'approxSubjects', label: 'Approximate number of data subjects', required: true },
  { key: 'categoriesOfRecords', label: 'Categories of personal data records', required: true },
  { key: 'approxRecords', label: 'Approximate number of records', required: true },
  { key: 'contactPoint', label: 'DPO or other contact point', required: true },
  { key: 'likelyConsequences', label: 'Likely consequences for individuals', required: true },
  { key: 'measuresTaken', label: 'Measures taken to address the breach', required: true },
  { key: 'measuresProposed', label: 'Measures proposed, including mitigation of adverse effects', required: true },
  { key: 'awarenessBasis', label: 'How and when the controller became aware', required: false },
  { key: 'crossBorderElements', label: 'Cross-border elements (lead authority, other states)', required: false },
];

export function readiness(b: IncidentBundle): Readiness {
  const items: ReadinessItem[] = FACTS.map((f) => ({ key: f.key, label: f.label, required: f.required, present: Boolean(b.facts[f.key]?.trim()), source: 'facts' as const }));
  const t = buildTimeline(b.events);
  const timelineOk = Boolean(t.awareAt && t.detectedAt) && !t.issues.some((i) => i.code === 'AWARE_BEFORE_DETECTED' || i.code === 'CONTAINED_BEFORE_DETECTED');
  items.push({ key: 'timelineEstablished', label: 'Timeline established (detection and awareness recorded, consistent order)', required: true, present: timelineOk, source: 'derived', note: t.issues.map((i) => i.code).join(', ') || undefined });
  const applicable = b.containment.filter((c) => c.status !== 'not-applicable');
  const containmentOk = applicable.length > 0 && applicable.every((c) => c.status === 'done' && Boolean(c.evidenceRef?.trim()));
  items.push({ key: 'containmentComplete', label: 'Containment tasks done with evidence', required: false, present: containmentOk, source: 'derived', note: `${applicable.filter((c) => c.status === 'done').length}/${applicable.length} done` });
  const sev = severity(b);
  items.push({ key: 'severityAssessed', label: 'Severity assessed with a justified context adjustment', required: true, present: b.circumstances.dpcAdjustment === 0 || Boolean(b.circumstances.dpcJustification.trim()), source: 'derived', note: `${sev.band} (SE ${Math.round(sev.se * 100) / 100})` });
  items.push({ key: 'highRiskAssessed', label: 'High-risk-to-individuals question considered (Art. 34 trigger)', required: true, present: Boolean(b.facts.likelyConsequences?.trim()) && sev.band !== 'very-high' ? true : Boolean(b.facts.likelyConsequences?.trim() && b.facts.measuresProposed?.trim()), source: 'derived', note: sev.band === 'very-high' ? 'very-high severity: consequences and proposed measures both needed' : undefined });
  const required = items.filter((i) => i.required);
  const present = required.filter((i) => i.present);
  return { items, requiredTotal: required.length, requiredPresent: present.length, completeness: required.length ? present.length / required.length : 0, missing: required.filter((i) => !i.present).map((i) => i.label) };
}
