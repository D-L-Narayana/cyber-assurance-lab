import { CATALOG } from './catalog';
import { labRequest, validateLabRequest } from './lab';
import type { Build, LabRequest, LabResponse } from './lab';
import { ORACLES, evaluateOracle } from './oracles';
import type { OracleSpec } from './oracles';

export type Level = 'high' | 'medium' | 'low';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'retest-requested' | 'still-open' | 'fixed' | 'wont-fix';

export interface Observation { id: string; at: string; build: Build; request: LabRequest; response: LabResponse; note: string; hash: string }
export interface Retest { at: string; build: Build; observationId: string; outcome: 'fixed' | 'still-open'; evidence: string }
export interface Finding {
  id: string;
  signature: string;
  title: string;
  oracle: OracleSpec;
  cwe: string;
  cweName: string;
  owasp2021: string;
  endpoint: string;
  impact: Level;
  likelihood: Level;
  severity: Severity;
  rationale: string;
  remediation: string;
  status: FindingStatus;
  evidence: { observationId: string; hash: string; detail: string }[];
  retests: Retest[];
  history: { at: string; from: FindingStatus | null; to: FindingStatus; note?: string }[];
}
export interface NotebookState { observations: Observation[]; findings: Finding[] }
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Impact × likelihood → severity. Transparent and deliberately coarse; not CVSS. */
const MATRIX: Record<Level, Record<Level, Severity>> = {
  high: { high: 'critical', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
};
export const rateSeverity = (impact: Level, likelihood: Level): Severity => MATRIX[impact][likelihood];

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const canonical = (req: LabRequest, res: LabResponse, build: Build) => JSON.stringify({ build, request: { method: req.method, path: req.path, query: req.query ?? {}, body: req.body ?? {}, session: req.session ?? null }, response: { status: res.status, headers: res.headers, body: res.body } });

const ALLOWED: Record<FindingStatus, FindingStatus[]> = {
  open: ['retest-requested', 'wont-fix'],
  'retest-requested': ['still-open', 'fixed'],
  'still-open': ['retest-requested', 'wont-fix'],
  fixed: ['retest-requested'],
  'wont-fix': ['retest-requested'],
};
const REQUIRES_RETEST: FindingStatus[] = ['fixed', 'still-open'];

export function createNotebook(options: { clock?: () => string; maxObservations?: number; maxFindings?: number } = {}) {
  const clock = options.clock ?? (() => new Date().toISOString());
  const maxObservations = options.maxObservations ?? 500;
  const maxFindings = options.maxFindings ?? 100;
  const state: NotebookState = { observations: [], findings: [] };
  let seq = 0;

  const snapshot = (): NotebookState => JSON.parse(JSON.stringify(state));
  const endpointOf = (req: LabRequest) => `${req.method} ${req.path.replace(/^\/receipts\/.+$/, '/receipts/{id}')}`;

  function move(f: Finding, to: FindingStatus, note?: string): Result<{ status: FindingStatus }> {
    if (!ALLOWED[f.status].includes(to)) return { ok: false, error: `Cannot move ${f.id} from ${f.status} to ${to}.` };
    f.history.push({ at: clock(), from: f.status, to, note });
    f.status = to;
    return { ok: true, status: to };
  }

  async function observe(build: Build, request: LabRequest, note: string): Promise<Observation> {
    if (state.observations.length >= maxObservations) throw new Error(`Notebook limit reached (${maxObservations} observations). Export and start a new notebook.`);
    const valid = validateLabRequest(request);
    if (!valid.ok) throw new Error(valid.error);
    const response = labRequest(build, request);
    const hash = await sha256Hex(canonical(request, response, build));
    const observation: Observation = { id: `obs-${++seq}`, at: clock(), build, request: JSON.parse(JSON.stringify(request)), response, note: note.slice(0, 500), hash };
    state.observations.push(observation);
    return JSON.parse(JSON.stringify(observation));
  }

  return {
    state: snapshot,
    observe,

    recordFinding(observationId: string, oracle: OracleSpec, rating: { impact: Level; likelihood: Level; rationale?: string }): Result<{ finding: Finding; merged: boolean }> {
      const obs = state.observations.find((o) => o.id === observationId);
      if (!obs) return { ok: false, error: `Unknown observation ${observationId}.` };
      const verdict = evaluateOracle(oracle, obs.request, obs.response);
      if (!verdict.vulnerable) return { ok: false, error: `Oracle "${oracle.kind}" did not fire on ${observationId}: ${verdict.evidence}` };
      const def = ORACLES[oracle.kind];
      const endpoint = endpointOf(obs.request);
      const signature = `${endpoint}|${oracle.kind}`;
      const existing = state.findings.find((f) => f.signature === signature);
      if (existing) {
        if (!existing.evidence.some((e) => e.observationId === obs.id)) existing.evidence.push({ observationId: obs.id, hash: obs.hash, detail: verdict.evidence });
        return { ok: true, finding: JSON.parse(JSON.stringify(existing)), merged: true };
      }
      if (state.findings.length >= maxFindings) return { ok: false, error: `Finding limit reached (${maxFindings}).` };
      const severity = rateSeverity(rating.impact, rating.likelihood);
      const finding: Finding = {
        id: `F-${String(state.findings.length + 1).padStart(2, '0')}`, signature, title: def.title, oracle, cwe: def.cwe, cweName: def.cweName, owasp2021: def.owasp2021,
        endpoint, impact: rating.impact, likelihood: rating.likelihood, severity,
        rationale: rating.rationale?.slice(0, 1000) ?? `Impact ${rating.impact} × likelihood ${rating.likelihood} → ${severity} (notebook rubric).`,
        remediation: def.remediation, status: 'open',
        evidence: [{ observationId: obs.id, hash: obs.hash, detail: verdict.evidence }], retests: [],
        history: [{ at: clock(), from: null, to: 'open' }],
      };
      state.findings.push(finding);
      return { ok: true, finding: JSON.parse(JSON.stringify(finding)), merged: false };
    },

    rerate(findingId: string, impact: Level, likelihood: Level, rationale?: string): Result<{ severity: Severity }> {
      const f = state.findings.find((x) => x.id === findingId);
      if (!f) return { ok: false, error: `Unknown finding ${findingId}.` };
      const before = { impact: f.impact, likelihood: f.likelihood, severity: f.severity, rationale: f.rationale };
      f.impact = impact; f.likelihood = likelihood; f.severity = rateSeverity(impact, likelihood);
      if (rationale !== undefined) f.rationale = rationale.slice(0, 1000);
      // Re-ratings are part of the audit trail: one history entry per actual change, none for no-ops.
      const changes: string[] = [];
      if (before.impact !== f.impact || before.likelihood !== f.likelihood) changes.push(`impact ${before.impact}→${f.impact}, likelihood ${before.likelihood}→${f.likelihood}`);
      if (before.severity !== f.severity) changes.push(`severity ${before.severity} → ${f.severity}`);
      if (before.rationale !== f.rationale) changes.push('rationale edited');
      if (changes.length) f.history.push({ at: clock(), from: f.status, to: f.status, note: `Re-rated: ${changes.join('; ')}.` });
      return { ok: true, severity: f.severity };
    },

    requestRetest(findingId: string): Result<{ status: FindingStatus }> {
      const f = state.findings.find((x) => x.id === findingId);
      if (!f) return { ok: false, error: `Unknown finding ${findingId}.` };
      return move(f, 'retest-requested');
    },

    transition(findingId: string, to: FindingStatus, note?: string): Result<{ status: FindingStatus }> {
      const f = state.findings.find((x) => x.id === findingId);
      if (!f) return { ok: false, error: `Unknown finding ${findingId}.` };
      if (REQUIRES_RETEST.includes(to)) return { ok: false, error: `"${to}" can only be reached through an automated retest, not set by hand.` };
      if (to === 'wont-fix' && !(note && note.trim().length >= 10)) return { ok: false, error: 'Marking won\u2019t-fix requires a written rationale (at least 10 characters).' };
      return move(f, to, note);
    },

    /** Replays the finding's original request against a build and moves the state based on the oracle. */
    async retest(findingId: string, build: Build): Promise<Result<{ status: FindingStatus; observation: Observation }>> {
      const f = state.findings.find((x) => x.id === findingId);
      if (!f) return { ok: false, error: `Unknown finding ${findingId}.` };
      if (f.status !== 'retest-requested') return { ok: false, error: `Request a retest first (current status: ${f.status}).` };
      const original = state.observations.find((o) => o.id === f.evidence[0].observationId)!;
      const observation = await observe(build, original.request, `Retest of ${f.id} on ${build}`);
      const verdict = evaluateOracle(f.oracle, observation.request, observation.response);
      const outcome = verdict.vulnerable ? 'still-open' : 'fixed';
      f.retests.push({ at: observation.at, build, observationId: observation.id, outcome, evidence: verdict.evidence });
      if (verdict.vulnerable) f.evidence.push({ observationId: observation.id, hash: observation.hash, detail: verdict.evidence });
      move(f, outcome, `Automated retest on ${build}: ${verdict.evidence}`);
      return { ok: true, status: outcome, observation };
    },

    async runCatalog(build: Build): Promise<{ executed: number; recorded: number; merged: number; clean: string[] }> {
      let recorded = 0, merged = 0;
      const clean: string[] = [];
      for (const entry of CATALOG) {
        const obs = await observe(build, entry.request, `${entry.id} ${entry.title}`);
        const def = ORACLES[entry.oracle.kind];
        const r = this.recordFinding(obs.id, entry.oracle, { impact: def.defaultImpact, likelihood: def.defaultLikelihood });
        if (r.ok) { if (r.merged) merged += 1; else recorded += 1; } else clean.push(entry.id);
      }
      return { executed: CATALOG.length, recorded, merged, clean };
    },
  };
}
export type Notebook = ReturnType<typeof createNotebook>;
