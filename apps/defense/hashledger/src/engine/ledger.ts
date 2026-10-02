import type { Channel, Decision } from './dlp';

export interface LedgerEvent { id: string; at: string; kind: 'egress' | 'change'; path: string; hash: string; decision: Decision | 'observed'; ruleId: string; because: string[]; channel?: Channel | string; actor: string; detail?: string }
export interface Case { id: string; openedAt: string; path: string; decision: Decision; ruleId: string; evidence: { hash: string; because: string[]; eventId: string; channel?: string; actor: string }; status: 'open' | 'closed'; note: string }
export interface Ledger { events: LedgerEvent[]; cases: Case[]; replaysRejected: number }

export const emptyLedger = (): Ledger => ({ events: [], cases: [], replaysRejected: 0 });

/** Idempotent: an event id seen before is rejected (replay). Block/quarantine egress opens a case with hash evidence. */
export function applyEvent(st: Ledger, ev: LedgerEvent): Ledger {
  if (st.events.some(e => e.id === ev.id)) return { ...st, replaysRejected: st.replaysRejected + 1 };
  const events = [...st.events, ev];
  let cases = st.cases;
  if (ev.kind === 'egress' && (ev.decision === 'block' || ev.decision === 'quarantine')) {
    cases = [...cases, { id: `case-${ev.id}`, openedAt: ev.at, path: ev.path, decision: ev.decision, ruleId: ev.ruleId, evidence: { hash: ev.hash, because: ev.because, eventId: ev.id, channel: ev.channel, actor: ev.actor }, status: 'open', note: '' }];
  }
  return { events, cases, replaysRejected: st.replaysRejected };
}

export function closeCase(st: Ledger, caseId: string, note: string): Ledger {
  const n = note.trim().slice(0, 400);
  if (n.length < 3) return st;
  return { ...st, cases: st.cases.map(c => c.id === caseId ? { ...c, status: 'closed', note: n } : c) };
}
