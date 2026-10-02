import type { IncidentBundle, Readiness, SeverityBreakdown, Timeline, ClockState } from './types';
import { buildTimeline } from './timeline';
import { evidenceClock } from './clock';
import { severity, summariseScope } from './severity';
import { readiness } from './readiness';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Masks listed personal tokens (case-insensitive, whole phrase) and any email-shaped string. */
export function redactText(text: string, tokens: string[]): string {
  let out = text.replace(EMAIL, '[REDACTED]');
  for (const t of tokens) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    out = out.replace(new RegExp(escapeRegExp(trimmed), 'gi'), '[REDACTED]');
  }
  return out;
}

export interface Packet {
  schema: 'firstlight.readiness-packet';
  version: 1;
  generatedAt: string;
  redacted: boolean;
  incident: { id: string; title: string; type: IncidentBundle['incidentType']; jurisdictions: IncidentBundle['jurisdictions']; controllerRole: IncidentBundle['controllerRole'] };
  timeline: { anchors: Pick<Timeline, 'occurredAt' | 'detectedAt' | 'awareAt' | 'containedAt'>; issues: Timeline['issues']; events: Array<{ id: string; at: string; kind: string; summary: string }> };
  clocks: ClockState[];
  scope: ReturnType<typeof summariseScope>;
  severity: SeverityBreakdown;
  facts: Record<string, string>;
  readiness: Readiness;
  containment: IncidentBundle['containment'];
  disclaimer: string;
}

export function buildPacket(b: IncidentBundle, generatedAt: string, redacted: boolean): Packet {
  const r = (s: string) => (redacted ? redactText(s, b.personalTokens) : s);
  const t = buildTimeline(b.events);
  const { occurredAt, detectedAt, awareAt, containedAt } = t;
  return {
    schema: 'firstlight.readiness-packet',
    version: 1,
    generatedAt,
    redacted,
    incident: { id: b.id, title: r(b.title), type: b.incidentType, jurisdictions: b.jurisdictions, controllerRole: b.controllerRole },
    timeline: {
      anchors: { ...(occurredAt ? { occurredAt } : {}), ...(detectedAt ? { detectedAt } : {}), ...(awareAt ? { awareAt } : {}), ...(containedAt ? { containedAt } : {}) },
      issues: t.issues.map((i) => ({ ...i, message: r(i.message) })),
      events: t.events.map((e) => ({ id: e.id, at: e.at, kind: e.kind, summary: redacted && e.personal ? '[REDACTED: personal detail withheld]' : r(e.summary) })),
    },
    clocks: b.jurisdictions.map((j) => evidenceClock(j, t.awareAt, generatedAt)),
    scope: summariseScope(b.dataScope),
    severity: severity(b),
    facts: Object.fromEntries(Object.entries(b.facts).map(([k, v]) => [k, r(v ?? '')])),
    readiness: readiness(b),
    containment: b.containment.map((c) => ({ ...c, title: r(c.title), ...(c.evidenceRef ? { evidenceRef: r(c.evidenceRef) } : {}) })),
    disclaimer: 'Notification-readiness packet for an educational, synthetic incident. It assembles facts; it is not a notification, not legal advice, and does not decide whether notification is required.',
  };
}
