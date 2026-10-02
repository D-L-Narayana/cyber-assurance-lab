import type { Assessment, Band, Question, Scorecard, Theme, ThemeScore } from './types';
import { THEMES } from './types';
import { MITIGATIONS, QUESTIONS } from './rubric';

const clamp = (n: number) => Math.min(5, Math.max(1, n));

/** 5x5 matrix bands: 1-4 low, 5-9 medium, 10-14 high, 15-25 very high. An educational convention, not a standard. */
export function band(product: number): Band {
  if (product >= 15) return 'very-high';
  if (product >= 10) return 'high';
  if (product >= 5) return 'medium';
  return 'low';
}

const BAND_RANK: Record<Band, number> = { low: 0, medium: 1, high: 2, 'very-high': 3 };
export const worseBand = (a: Band, b: Band): Band => (BAND_RANK[a] >= BAND_RANK[b] ? a : b);

/** Questions that apply given the current answers (progressive disclosure). */
export function visibleQuestions(a: Pick<Assessment, 'answers'>): Question[] {
  return QUESTIONS.filter((q) => !q.showIf || q.showIf.optionIds.includes(a.answers[q.showIf.questionId] ?? ''));
}

function cell(likelihood: number, impact: number) {
  const l = clamp(likelihood);
  const i = clamp(impact);
  return { likelihood: l, impact: i, score: l * i, band: band(l * i) };
}

/** A mitigation counts when implemented, or verified; one that requires evidence counts only when verified with a reference. */
export function mitigationCounts(m: Assessment['mitigations'][number]): boolean {
  const def = MITIGATIONS.find((x) => x.id === m.mitigationId);
  if (!def) return false;
  if (def.requiresEvidence) return m.status === 'verified' && Boolean(m.evidenceRef && m.evidenceRef.trim());
  return m.status === 'implemented' || m.status === 'verified';
}

export function score(a: Assessment): Scorecard {
  const visible = visibleQuestions(a);
  const themes: ThemeScore[] = THEMES.map((theme) => {
    let L = 1;
    let I = 1;
    const contributing: ThemeScore['contributingAnswers'] = [];
    for (const q of visible) {
      const optionId = a.answers[q.id];
      const option = q.options.find((o) => o.id === optionId);
      if (!option) continue;
      for (const e of option.effects) {
        if (e.theme !== theme) continue;
        L += e.likelihood ?? 0;
        I += e.impact ?? 0;
        contributing.push({ questionId: q.id, optionId: option.id, likelihood: e.likelihood ?? 0, impact: e.impact ?? 0 });
      }
    }
    const inherent = cell(L, I);
    let rl = inherent.likelihood;
    let ri = inherent.impact;
    let pl = inherent.likelihood;
    let pi = inherent.impact;
    const active: string[] = [];
    const planned: string[] = [];
    for (const m of a.mitigations) {
      const def = MITIGATIONS.find((x) => x.id === m.mitigationId);
      if (!def || !def.themes.includes(theme)) continue;
      const counts = mitigationCounts(m);
      if (counts) {
        active.push(def.id);
        if (def.reduces === 'likelihood') rl -= def.by; else ri -= def.by;
        if (def.reduces === 'likelihood') pl -= def.by; else pi -= def.by;
      } else {
        planned.push(def.id);
        if (def.reduces === 'likelihood') pl -= def.by; else pi -= def.by;
      }
    }
    const residual = cell(rl, ri);
    const projected = cell(pl, pi);
    const acceptance = a.acceptances.find((x) => x.theme === theme);
    return { theme, inherent, residual, projected, contributingAnswers: contributing, activeMitigations: active, plannedMitigations: planned, ...(acceptance ? { acceptance } : {}) };
  });
  const overall = themes.reduce((acc, t) => ({ inherent: worseBand(acc.inherent, t.inherent.band), residual: worseBand(acc.residual, t.residual.band), projected: worseBand(acc.projected, t.projected.band) }), { inherent: 'low' as Band, residual: 'low' as Band, projected: 'low' as Band });
  const highThemes: Theme[] = themes.filter((t) => t.residual.band === 'high' || t.residual.band === 'very-high').map((t) => t.theme);
  return { themes, overall, highThemes, isDpiaScale: themes.some((t) => t.inherent.band === 'very-high') };
}
