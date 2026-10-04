import type { Catalog, ExceptionSubject, Finding, FindingCode, Graph, RetentionException, Severity } from './types';
import { retentionReviews } from './review';
import { effectiveRetentionDays } from './retention';

export { effectiveRetentionDays } from './retention';

export const SEVERITY: Record<FindingCode, Severity> = {
  ORPHAN_ELEMENT: 'high',
  MISSING_OWNER: 'medium',
  INACTIVE_OWNER: 'high',
  MISSING_SCHEDULE: 'high',
  SPECIAL_CATEGORY_UNSCHEDULED: 'critical',
  RETENTION_INFLATION: 'medium',
  PURPOSE_DRIFT: 'high',
  UNMAPPED_TRANSFER: 'critical',
  FLOW_CYCLE: 'low',
  DANGLING_FLOW: 'medium',
  EXCEPTION_EXPIRED: 'medium',
  EXCEPTION_APPROVER_INACTIVE: 'medium',
  EXCEPTION_OUT_OF_POLICY: 'medium',
  REVIEW_OVERDUE: 'low',
};

export const WHY: Record<FindingCode, string> = {
  ORPHAN_ELEMENT: 'Data that is recorded against a system nobody has registered cannot be owned, scheduled or deleted.',
  MISSING_OWNER: 'Without an accountable owner nobody can approve retention, answer rights requests or sign off exceptions.',
  INACTIVE_OWNER: 'The named owner has left or is inactive; decisions about this system are effectively unowned.',
  MISSING_SCHEDULE: 'Personal data with no retention period is kept by default forever, contrary to storage limitation.',
  SPECIAL_CATEGORY_UNSCHEDULED: 'Special-category data with no retention period is the highest-impact storage-limitation gap.',
  RETENTION_INFLATION: 'A downstream copy outlives its source, so deletion at the source does not actually delete the data.',
  PURPOSE_DRIFT: 'The receiving system has no purpose in common with the data it receives; this is a purpose-limitation question.',
  UNMAPPED_TRANSFER: 'A cross-region flow with no transfer mechanism recorded cannot be defended as a lawful transfer.',
  FLOW_CYCLE: 'Circular flows make it hard to say which system is the source of truth for deletion.',
  DANGLING_FLOW: 'The flow claims to move an element the source system does not hold; the inventory is inconsistent.',
  EXCEPTION_EXPIRED: 'The accepted risk has lapsed; the underlying finding is live again until re-approved.',
  EXCEPTION_OUT_OF_POLICY: 'An exception approved in the future, without an approval date, or for longer than the policy term cap cannot be relied on; the finding it names stays live.',
  EXCEPTION_APPROVER_INACTIVE: 'An exception approved by someone who has left needs a current approver to remain valid.',
  REVIEW_OVERDUE: 'Retention settings drift; a review past its cadence means nobody has recently confirmed the period is still right.',
};

/** Educational policy constant: an accepted risk may run for at most this many days per approval (matches the demo fixture's one-year exceptions). */
export const MAX_EXCEPTION_TERM_DAYS = 365;

/** Returns the reason an approved exception is outside policy, or undefined when its dates are acceptable. */
export function exceptionPolicyViolation(x: RetentionException, asOf: string): string | undefined {
  if (!x.approvedOn) return 'has no approval date';
  if (x.approvedOn > asOf) return `is approved on ${x.approvedOn}, after the as-of date ${asOf}`;
  const term = Math.round((Date.parse(x.expiresOn) - Date.parse(x.approvedOn)) / 86_400_000);
  if (term > MAX_EXCEPTION_TERM_DAYS) return `runs ${term} days from approval; the policy cap is ${MAX_EXCEPTION_TERM_DAYS} days`;
  if (term < 0) return `expires (${x.expiresOn}) before it was approved (${x.approvedOn})`;
  return undefined;
}

/**
 * Effective subject of an exception (October 2026): an explicit `subject` wins; otherwise the legacy `elementId`
 * names an element. Flow subjects are `flow-id` (UNMAPPED_TRANSFER, DANGLING_FLOW) or `flow-id/element-id`
 * (PURPOSE_DRIFT); matching against a finding is exact on kind and id.
 */
export function exceptionSubject(x: RetentionException): ExceptionSubject | undefined {
  if (x.subject) return x.subject;
  if (x.elementId !== undefined) return { kind: 'element', id: x.elementId };
  return undefined;
}

/** Flow id of a flow subject id (`flow-id` or `flow-id/element-id`). */
export function flowIdOfSubject(subjectId: string): string {
  const slash = subjectId.indexOf('/');
  return slash === -1 ? subjectId : subjectId.slice(0, slash);
}

function describeSubject(x: RetentionException): string {
  const s = exceptionSubject(x);
  return s ? `${s.kind} ${s.id}` : 'no subject';
}

function isLiveException(x: RetentionException, catalog: Catalog, asOf: string): boolean {
  if (x.status !== 'approved') return false;
  if (x.expiresOn < asOf) return false;
  if (exceptionPolicyViolation(x, asOf)) return false;
  const approver = catalog.owners.find((o) => o.id === x.approvedBy);
  return Boolean(approver && approver.active);
}

/**
 * Runs every consistency check. Findings carry stable ids (code + subject) so runs can be diffed,
 * a plain-language "why", and an `accepted` flag when a live exception covers them.
 */
export function runChecks(catalog: Catalog, graph: Graph, asOf: string): Finding[] {
  const findings: Finding[] = [];
  const systems = new Map(catalog.systems.map((s) => [s.id, s]));
  const owners = new Map(catalog.owners.map((o) => [o.id, o]));
  const elements = new Map(catalog.elements.map((e) => [e.id, e]));
  const schedules = new Map(catalog.schedules.map((s) => [s.id, s]));
  const flows = new Map(catalog.flows.map((f) => [f.id, f]));
  /** System an exception finding is attached to: the element's system, or the receiving system of a flow subject. */
  const systemOfSubject = (x: RetentionException): string | undefined => {
    const s = exceptionSubject(x);
    if (!s) return undefined;
    return s.kind === 'element' ? elements.get(s.id)?.systemId : flows.get(flowIdOfSubject(s.id))?.toSystemId;
  };

  const push = (code: FindingCode, subject: Finding['subject'], message: string, systemId?: string) => {
    findings.push({ id: `${code}:${subject.kind}:${subject.id}`, code, severity: SEVERITY[code], subject, ...(systemId ? { systemId } : {}), message, why: WHY[code], accepted: false });
  };

  for (const s of catalog.systems) {
    if (!s.ownerId) push('MISSING_OWNER', { kind: 'system', id: s.id }, `${s.name} has no owner.`, s.id);
    else {
      const o = owners.get(s.ownerId);
      if (!o) push('MISSING_OWNER', { kind: 'system', id: s.id }, `${s.name} names owner "${s.ownerId}" who is not in the owner register.`, s.id);
      else if (!o.active) push('INACTIVE_OWNER', { kind: 'system', id: s.id }, `${s.name} is owned by ${o.name}, who is inactive${o.leftOn ? ` since ${o.leftOn}` : ''}.`, s.id);
    }
  }

  for (const e of catalog.elements) {
    if (!systems.has(e.systemId)) {
      push('ORPHAN_ELEMENT', { kind: 'element', id: e.id }, `${e.name} (${e.id}) belongs to unregistered system "${e.systemId}".`);
      continue;
    }
    const days = effectiveRetentionDays(e, catalog.schedules);
    if (days === undefined) {
      if (e.category === 'special-category') push('SPECIAL_CATEGORY_UNSCHEDULED', { kind: 'element', id: e.id }, `${e.name} in ${systems.get(e.systemId)!.name} is special-category data with no retention schedule.`, e.systemId);
      else push('MISSING_SCHEDULE', { kind: 'element', id: e.id }, `${e.name} in ${systems.get(e.systemId)!.name} has no retention schedule or override.`, e.systemId);
    } else if (e.scheduleId && !schedules.has(e.scheduleId) && e.retentionDaysOverride === undefined) {
      push('MISSING_SCHEDULE', { kind: 'element', id: e.id }, `${e.name} references unknown schedule "${e.scheduleId}".`, e.systemId);
    }
  }

  for (const f of catalog.flows) {
    const from = systems.get(f.fromSystemId);
    const to = systems.get(f.toSystemId);
    if (!from || !to) {
      push('DANGLING_FLOW', { kind: 'flow', id: f.id }, `Flow ${f.id} references an unregistered system (${!from ? f.fromSystemId : f.toSystemId}).`);
      continue;
    }
    for (const elId of f.elementIds) {
      const el = elements.get(elId);
      if (!el || el.systemId !== from.id) {
        push('DANGLING_FLOW', { kind: 'flow', id: f.id }, `Flow ${f.id} carries "${elId}", which ${el ? `belongs to ${el.systemId}` : 'does not exist'}, not to source ${from.id}.`, from.id);
        continue;
      }
      // Purpose drift: receiving system shares no purpose with the element.
      if (!el.purposes.some((p) => to.purposes.includes(p))) {
        push('PURPOSE_DRIFT', { kind: 'flow', id: `${f.id}/${el.id}` }, `${el.name} (purposes: ${el.purposes.join(', ')}) flows from ${from.name} to ${to.name}, whose purposes are ${to.purposes.join(', ')}.`, to.id);
      }
      // Retention inflation: a downstream copy of the same-named element kept longer than the source.
      const sourceDays = effectiveRetentionDays(el, catalog.schedules);
      const copy = catalog.elements.find((x) => x.systemId === to.id && (x.name.toLowerCase() === el.name.toLowerCase() || x.id === `${to.id}.${el.id.split('.').slice(1).join('.')}`));
      const copyDays = copy ? effectiveRetentionDays(copy, catalog.schedules) : undefined;
      if (copy && sourceDays !== undefined && copyDays !== undefined && copyDays > sourceDays) {
        push('RETENTION_INFLATION', { kind: 'element', id: copy.id }, `${to.name} keeps ${copy.name} for ${copyDays} days but the source ${from.name} keeps it for ${sourceDays} days.`, to.id);
      }
    }
    if (from.region !== to.region && f.mechanism === 'none') {
      push('UNMAPPED_TRANSFER', { kind: 'flow', id: f.id }, `${from.name} (${from.region}) → ${to.name} (${to.region}) has no transfer mechanism recorded.`, to.id);
    }
  }

  for (const cycle of graph.cycles) {
    push('FLOW_CYCLE', { kind: 'system', id: cycle.join('>') }, `Circular flow: ${cycle.map((id) => systems.get(id)?.name ?? id).join(' → ')} → ${systems.get(cycle[0]!)?.name ?? cycle[0]}.`, cycle[0]);
  }

  for (const x of catalog.exceptions) {
    if (x.status === 'approved' && x.expiresOn < asOf) {
      push('EXCEPTION_EXPIRED', { kind: 'exception', id: x.id }, `Exception ${x.id} for ${describeSubject(x)} (${x.acceptsFinding}) expired on ${x.expiresOn}.`, systemOfSubject(x));
    } else if (x.status === 'approved') {
      const violation = exceptionPolicyViolation(x, asOf);
      if (violation) push('EXCEPTION_OUT_OF_POLICY', { kind: 'exception', id: x.id }, `Exception ${x.id} for ${describeSubject(x)} (${x.acceptsFinding}) ${violation}.`, systemOfSubject(x));
      const approver = owners.get(x.approvedBy ?? '');
      if (!approver || !approver.active) push('EXCEPTION_APPROVER_INACTIVE', { kind: 'exception', id: x.id }, `Exception ${x.id} was approved by ${approver ? approver.name : `unknown owner "${x.approvedBy}"`}, who is ${approver ? 'inactive' : 'not registered'}.`, systemOfSubject(x));
    }
  }

  for (const r of retentionReviews(catalog, asOf)) {
    if (r.status === 'overdue') {
      const el = elements.get(r.elementId)!;
      push('REVIEW_OVERDUE', { kind: 'element', id: r.elementId }, `${el.name} in ${systems.get(r.systemId)?.name ?? r.systemId} was last reviewed ${r.lastReviewedOn}; the ${r.reviewEveryDays}-day review is ${-(r.daysUntilDue ?? 0)} days overdue.`, r.systemId);
    }
  }

  // Apply exceptions: element- and flow-subject findings only, exact match on code, subject kind and subject id.
  const live = catalog.exceptions.filter((x) => isLiveException(x, catalog, asOf));
  for (const f of findings) {
    if (f.subject.kind !== 'element' && f.subject.kind !== 'flow') continue;
    const match = live.find((x) => {
      const s = exceptionSubject(x);
      return s !== undefined && x.acceptsFinding === f.code && s.kind === f.subject.kind && s.id === f.subject.id;
    });
    if (match) { f.accepted = true; f.exceptionId = match.id; }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}
