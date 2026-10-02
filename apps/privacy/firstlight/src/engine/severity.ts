import type { DataClass, DataScopeItem, IncidentBundle, ScopeSummary, SeverityBreakdown } from './types';

export const DPC_BASE: Record<DataClass, number> = { simple: 1, behavioural: 2, financial: 3, sensitive: 4 };
export const EI_SCORE = { negligible: 0.25, limited: 0.5, significant: 0.75, maximum: 1 } as const;
export const CB_CONF = { none: 0, 'known-recipients': 0.25, 'unknown-recipients': 0.5 } as const;
export const CB_INT = { none: 0, recoverable: 0.25, unrecoverable: 0.5 } as const;
export const CB_AVAIL = { none: 0, temporary: 0.25, permanent: 0.5 } as const;
export const CB_MALICIOUS = 0.5;
const CLASS_ORDER: DataClass[] = ['simple', 'behavioural', 'financial', 'sensitive'];

export function summariseScope(items: DataScopeItem[]): ScopeSummary {
  const byClass: ScopeSummary['byClass'] = { simple: { items: 0, subjects: 0, records: 0 }, behavioural: { items: 0, subjects: 0, records: 0 }, financial: { items: 0, subjects: 0, records: 0 }, sensitive: { items: 0, subjects: 0, records: 0 } };
  let totalRecords = 0; let encryptedRecords = 0; let anyEstimate = false; let maxSubjects = 0; let highest: DataClass = 'simple';
  for (const it of items) {
    byClass[it.dataClass].items += 1; byClass[it.dataClass].subjects += it.subjects; byClass[it.dataClass].records += it.records;
    totalRecords += it.records; if (it.encrypted) encryptedRecords += it.records;
    anyEstimate = anyEstimate || it.estimate;
    maxSubjects = Math.max(maxSubjects, it.subjects);
    if (CLASS_ORDER.indexOf(it.dataClass) > CLASS_ORDER.indexOf(highest)) highest = it.dataClass;
  }
  // Subjects overlap across items (the same person appears in several columns), so the total is the largest single item, not the sum.
  return { byClass, subjectsLowerBound: maxSubjects, totalRecords, encryptedShare: totalRecords ? encryptedRecords / totalRecords : 0, anyEstimate, highestClass: items.length ? highest : 'simple' };
}

/**
 * ENISA-inspired severity: SE = DPC x EI + CB (ENISA, "Recommendations for a methodology of the
 * assessment of severity of personal data breaches", v1.0, Dec 2013). DPC takes the highest data
 * class present, adjusted by a justified -3..+3 context factor and clamped to 1..4.
 */
export function severity(b: IncidentBundle): SeverityBreakdown {
  const scope = summariseScope(b.dataScope);
  const c = b.circumstances;
  const dpcBase = DPC_BASE[scope.highestClass];
  const adj = Math.max(-3, Math.min(3, Math.round(c.dpcAdjustment)));
  const dpcAdjusted = Math.max(1, Math.min(4, dpcBase + adj));
  const ei = EI_SCORE[c.easeOfIdentification];
  const cb = { confidentiality: CB_CONF[c.confidentialityLoss], integrity: CB_INT[c.integrityLoss], availability: CB_AVAIL[c.availabilityLoss], malicious: c.maliciousIntent ? CB_MALICIOUS : 0, total: 0 };
  cb.total = cb.confidentiality + cb.integrity + cb.availability + cb.malicious;
  const se = dpcAdjusted * ei + cb.total;
  const band: SeverityBreakdown['band'] = se < 2 ? 'low' : se < 3 ? 'medium' : se < 4 ? 'high' : 'very-high';
  const rationale = [
    `Data processing context: highest class present is ${scope.highestClass} (base ${dpcBase})${adj ? `, adjusted ${adj > 0 ? '+' : ''}${adj} → ${dpcAdjusted}: ${c.dpcJustification || 'no justification given'}` : ''}.`,
    `Ease of identification: ${c.easeOfIdentification} (${ei}).`,
    `Circumstances: confidentiality ${c.confidentialityLoss} (+${cb.confidentiality}), integrity ${c.integrityLoss} (+${cb.integrity}), availability ${c.availabilityLoss} (+${cb.availability}), malicious intent ${c.maliciousIntent ? 'yes (+0.5)' : 'no (+0)'}.`,
    `SE = ${dpcAdjusted} × ${ei} + ${cb.total} = ${Math.round(se * 100) / 100} → ${band.replace('-', ' ')} (bands: <2 low, <3 medium, <4 high, ≥4 very high).`,
    ...(scope.anyEstimate ? ['Some counts are estimates; the severity should be revisited when logs confirm them.'] : []),
    ...(scope.encryptedShare > 0 ? [`${Math.round(scope.encryptedShare * 100)}% of records were encrypted; ENISA treats effective encryption as a confidentiality-lowering factor, which this model does not apply automatically.`] : []),
  ];
  return { dpcBase, dpcAdjusted, dpcClass: scope.highestClass, ei, cb, se, band, rationale };
}
