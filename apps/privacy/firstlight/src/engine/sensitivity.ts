import type { Circumstances, DataClass, Flip, IncidentBundle } from './types';
import { severity, summariseScope } from './severity';

/**
 * Severity sensitivity: which single-field changes would move the band?
 *
 * Every candidate is applied to a copy of the bundle and measured with the same `severity` function the
 * card uses, so the list can never disagree with the card and the DPC clamp (1..4) is honoured for free.
 * The candidate set is bounded by construction — at most 2 + 2 + 2 + 3 + 1 + 2 + 2 = 14 variants — so no
 * traversal budget or truncation flag is needed. Pure: the input bundle is never mutated.
 */

const CLASS_ORDER: readonly DataClass[] = ['simple', 'behavioural', 'financial', 'sensitive'];
const CONFIDENTIALITY: readonly Circumstances['confidentialityLoss'][] = ['none', 'known-recipients', 'unknown-recipients'];
const INTEGRITY: readonly Circumstances['integrityLoss'][] = ['none', 'recoverable', 'unrecoverable'];
const AVAILABILITY: readonly Circumstances['availabilityLoss'][] = ['none', 'temporary', 'permanent'];
const EASE: readonly Circumstances['easeOfIdentification'][] = ['negligible', 'limited', 'significant', 'maximum'];
/** The context adjustment is bounded the same way `severity` bounds it. */
export const DPC_ADJUSTMENT_RANGE = { min: -3, max: 3 } as const;

interface Candidate {
  field: string;
  from: string;
  to: string;
  apply: (b: IncidentBundle) => IncidentBundle;
}

function withCircumstances(b: IncidentBundle, patch: Partial<Circumstances>): IncidentBundle {
  return { ...b, circumstances: { ...b.circumstances, ...patch } };
}

/** All single-field variants of the bundle, in a fixed enumeration order. */
function candidates(b: IncidentBundle): Candidate[] {
  const c = b.circumstances;
  const out: Candidate[] = [];
  for (const v of CONFIDENTIALITY) if (v !== c.confidentialityLoss) out.push({ field: 'confidentialityLoss', from: c.confidentialityLoss, to: v, apply: (x) => withCircumstances(x, { confidentialityLoss: v }) });
  for (const v of INTEGRITY) if (v !== c.integrityLoss) out.push({ field: 'integrityLoss', from: c.integrityLoss, to: v, apply: (x) => withCircumstances(x, { integrityLoss: v }) });
  for (const v of AVAILABILITY) if (v !== c.availabilityLoss) out.push({ field: 'availabilityLoss', from: c.availabilityLoss, to: v, apply: (x) => withCircumstances(x, { availabilityLoss: v }) });
  for (const v of EASE) if (v !== c.easeOfIdentification) out.push({ field: 'easeOfIdentification', from: c.easeOfIdentification, to: v, apply: (x) => withCircumstances(x, { easeOfIdentification: v }) });

  out.push({ field: 'maliciousIntent', from: String(c.maliciousIntent), to: String(!c.maliciousIntent), apply: (x) => withCircumstances(x, { maliciousIntent: !c.maliciousIntent }) });

  // Same normalisation as `severity`: rounded and clamped, then one step either way inside the range.
  const adj = Math.max(DPC_ADJUSTMENT_RANGE.min, Math.min(DPC_ADJUSTMENT_RANGE.max, Math.round(c.dpcAdjustment)));
  for (const next of [adj - 1, adj + 1]) {
    if (next < DPC_ADJUSTMENT_RANGE.min || next > DPC_ADJUSTMENT_RANGE.max) continue;
    out.push({ field: 'dpcAdjustment', from: String(adj), to: String(next), apply: (x) => withCircumstances(x, { dpcAdjustment: next }) });
  }

  // The highest data class present moves one class down or up, modelled as reclassifying the items at that class.
  if (b.dataScope.length > 0) {
    const highest = summariseScope(b.dataScope).highestClass;
    const i = CLASS_ORDER.indexOf(highest);
    for (const target of [CLASS_ORDER[i - 1], CLASS_ORDER[i + 1]]) {
      if (!target) continue;
      out.push({ field: 'dataScope.highestClass', from: highest, to: target, apply: (x) => ({ ...x, dataScope: x.dataScope.map((d) => (d.dataClass === highest ? { ...d, dataClass: target } : d)) }) });
    }
  }
  return out;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** |ΔSE| descending, then field, then target value — locale-independent so the order is the same everywhere. */
function compareFlips(a: Flip, b: Flip): number {
  return Math.abs(b.seDelta) - Math.abs(a.seDelta) || byCodeUnit(a.field, b.field) || byCodeUnit(a.to, b.to);
}

/** Enumerates the single-field changes that move the severity band, sorted by |seDelta| desc, then field. */
export function severitySensitivity(bundle: IncidentBundle): Flip[] {
  const base = severity(bundle);
  const flips: Flip[] = [];
  for (const k of candidates(bundle)) {
    const after = severity(k.apply(bundle));
    if (after.band === base.band) continue;
    flips.push({ field: k.field, from: k.from, to: k.to, bandFrom: base.band, bandTo: after.band, seDelta: Math.round((after.se - base.se) * 1e6) / 1e6 });
  }
  return flips.sort(compareFlips);
}

/**
 * Applies a flip to a copy of the bundle. Only a flip that is a valid single-field candidate for this
 * bundle (same field, from and to) is applied; anything else returns the bundle unchanged, so a stale or
 * hand-made flip cannot write arbitrary values into the circumstances.
 */
export function applyFlip(bundle: IncidentBundle, flip: Pick<Flip, 'field' | 'from' | 'to'>): IncidentBundle {
  const match = candidates(bundle).find((k) => k.field === flip.field && k.from === flip.from && k.to === flip.to);
  return match ? match.apply(bundle) : bundle;
}
