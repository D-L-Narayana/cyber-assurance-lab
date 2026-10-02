export type Status = 'new' | 'investigating' | 'closed';
export type Disposition = 'true_positive' | 'false_positive' | 'benign_expected';

export interface TriageEntry {
  status: Status;
  disposition: Disposition | null;
  note: string;
  history: { at: number; from: Status; to: Status; note: string }[];
}
export type TriageState = Record<string, TriageEntry>;

export interface Transition { to: Status; disposition?: Disposition; note?: string; at?: number }
export type TransitionResult = { ok: true; state: TriageState } | { ok: false; reason: string };

const ALLOWED: Record<Status, Status[]> = { new: ['investigating'], investigating: ['closed', 'new'], closed: ['investigating'] };

export function createTriage(ids: string[]): TriageState {
  const s: TriageState = {};
  for (const id of ids) s[id] = { status: 'new', disposition: null, note: '', history: [] };
  return s;
}

export function transitionAlert(state: TriageState, id: string, t: Transition): TransitionResult {
  const cur = state[id];
  if (!cur) return { ok: false, reason: `Unknown alert ${id}` };
  if (!ALLOWED[cur.status].includes(t.to)) return { ok: false, reason: `Cannot move from ${cur.status} to ${t.to}` };
  if (t.to === 'closed') {
    if (!t.disposition) return { ok: false, reason: 'Closing needs a disposition' };
    if (!t.note || t.note.trim().length < 3) return { ok: false, reason: 'Closing needs a short evidence note' };
  }
  const entry: TriageEntry = {
    status: t.to,
    disposition: t.to === 'closed' ? t.disposition! : null,
    note: t.note?.trim().slice(0, 500) ?? cur.note,
    history: [...cur.history, { at: t.at ?? 0, from: cur.status, to: t.to, note: t.note?.trim().slice(0, 500) ?? '' }],
  };
  return { ok: true, state: { ...state, [id]: entry } };
}
