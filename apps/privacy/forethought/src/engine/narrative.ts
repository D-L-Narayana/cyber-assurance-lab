import type { Assessment, Scorecard } from './types';
import { THEME_LABEL } from './types';
import { MITIGATIONS } from './rubric';

const BAND_TEXT = { low: 'low', medium: 'medium', high: 'high', 'very-high': 'very high' } as const;

/** Deterministic plain-language summary for executives. Template-based; no generative model. */
export function executiveSummary(a: Assessment, card: Scorecard): string {
  const high = card.themes.filter((t) => t.residual.band === 'high' || t.residual.band === 'very-high');
  const improved = card.themes.filter((t) => t.residual.band !== t.inherent.band);
  const counts = { verified: 0, implemented: 0, planned: 0 };
  for (const m of a.mitigations) counts[m.status] += 1;
  const accepted = card.themes.filter((t) => t.acceptance && (t.residual.band === 'high' || t.residual.band === 'very-high'));
  const parts: string[] = [];
  parts.push(`${a.title} (${a.id}) is assessed at ${BAND_TEXT[card.overall.inherent]} inherent privacy risk, reduced to ${BAND_TEXT[card.overall.residual]} after the controls currently in place.`);
  if (high.length) parts.push(`${high.length} theme(s) remain high or very high: ${high.map((t) => THEME_LABEL[t.theme].toLowerCase()).join(', ')}.`);
  else parts.push('No theme remains high after mitigation.');
  if (improved.length) parts.push(`Controls lowered the band for ${improved.map((t) => THEME_LABEL[t.theme].toLowerCase()).join(', ')}.`);
  parts.push(`Mitigations: ${counts.verified} verified, ${counts.implemented} implemented, ${counts.planned} planned${counts.planned ? ` (if completed, overall risk would be ${BAND_TEXT[card.overall.projected]})` : ''}.`);
  if (accepted.length) parts.push(`Residual risk has been formally accepted for ${accepted.map((t) => `${THEME_LABEL[t.theme].toLowerCase()} by the ${t.acceptance!.acceptedBy.replace('-', ' ')}`).join('; ')}.`);
  if (card.isDpiaScale) parts.push(`The inherent profile is DPIA-scale; DPO consultation is ${a.dpoConsulted ? 'recorded' : 'outstanding'}.`);
  const plannedNames = a.mitigations.filter((m) => m.status === 'planned').map((m) => MITIGATIONS.find((x) => x.id === m.mitigationId)?.name).filter(Boolean);
  if (plannedNames.length) parts.push(`Next actions: ${plannedNames.join('; ')}.`);
  parts.push('This is an educational assessment on synthetic data and is not legal advice.');
  return parts.join(' ');
}
