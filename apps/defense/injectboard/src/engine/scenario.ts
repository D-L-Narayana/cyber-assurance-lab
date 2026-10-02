export interface Role { id: string; name: string }
export interface TaskTemplate { id: string; role: string; title: string; dueInMinutes: number }
export interface Option { id: string; label: string; score: number; note: string; tasks?: TaskTemplate[]; unlocks?: { injectId: string; afterMinutes: number }[] }
export interface Decision { id: string; prompt: string; slaMinutes: number; options: Option[] }
export interface Inject { id: string; atMinute: number | null; role: string; title: string; body: string; decision?: Decision }
export interface Scenario { id: string; title: string; version: number; startAt: string; roles: Role[]; injects: Inject[]; description?: string }

export const LIMITS = { maxInjects: 200, maxMinute: 24 * 60, maxRoles: 12, maxText: 2000 };

export type ScenarioValidation = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

export function validateScenario(input: unknown): ScenarioValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['Scenario must be an object.'] };
  const s = input as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.title !== 'string') errors.push('id and title must be strings.');
  if (!Array.isArray(s.roles) || s.roles.length === 0 || s.roles.length > LIMITS.maxRoles) errors.push(`roles must be a non-empty array (≤ ${LIMITS.maxRoles}).`);
  if (!Array.isArray(s.injects)) errors.push('injects must be an array.');
  if (errors.length) return { ok: false, errors };
  const roles = s.roles as Role[]; const injects = s.injects as Inject[];
  if (injects.length > LIMITS.maxInjects) errors.push(`Too many injects: ${injects.length} (limit ${LIMITS.maxInjects}).`);
  const roleIds = new Set(roles.map(r => r.id));
  const ids = new Set<string>(); const decisionIds = new Set<string>(); const taskIds = new Set<string>();
  for (const inj of injects) {
    if (typeof inj.id !== 'string' || !inj.id) { errors.push('Every inject needs a string id.'); continue; }
    if (ids.has(inj.id)) errors.push(`Duplicate inject id "${inj.id}".`);
    ids.add(inj.id);
    if (!roleIds.has(inj.role)) errors.push(`Inject "${inj.id}" targets unknown role "${inj.role}".`);
    if (inj.atMinute !== null && (typeof inj.atMinute !== 'number' || inj.atMinute < 0 || inj.atMinute > LIMITS.maxMinute)) errors.push(`Inject "${inj.id}" atMinute must be null or 0–${LIMITS.maxMinute}.`);
    if (typeof inj.title !== 'string' || typeof inj.body !== 'string' || inj.body.length > LIMITS.maxText) errors.push(`Inject "${inj.id}" needs title/body strings (body ≤ ${LIMITS.maxText}).`);
    if (inj.decision) {
      const d = inj.decision;
      if (decisionIds.has(d.id)) errors.push(`Duplicate decision id "${d.id}".`);
      decisionIds.add(d.id);
      if (!Array.isArray(d.options) || d.options.length < 2) errors.push(`Decision "${d.id}" needs at least two options.`);
      if (typeof d.slaMinutes !== 'number' || d.slaMinutes <= 0) errors.push(`Decision "${d.id}" needs slaMinutes > 0.`);
      for (const o of d.options ?? []) {
        for (const t of o.tasks ?? []) { if (taskIds.has(t.id)) errors.push(`Duplicate task id "${t.id}".`); taskIds.add(t.id); if (!roleIds.has(t.role)) errors.push(`Task "${t.id}" targets unknown role "${t.role}".`); }
        for (const u of o.unlocks ?? []) if (!injects.some(x => x.id === u.injectId)) errors.push(`Option "${o.id}" unlocks unknown inject "${u.injectId}".`);
      }
    }
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, scenario: input as Scenario };
}
