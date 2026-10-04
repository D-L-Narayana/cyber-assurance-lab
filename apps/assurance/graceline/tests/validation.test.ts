import { describe, expect, it } from 'vitest';
import { applyEvent, newException } from '../src/engine/lifecycle';
import { validateBoard, validateBoardObject } from '../src/engine/validate';
import type { Board, Exception } from '../src/engine/types';

// Import-validation audit (October 2026 round): strict calendar dates on every date field, hostile nesting, non-finite
// numbers and unknown keys. The validator is the only way data enters the app (fixture, import, draft edits).

const AS_OF = '2026-10-01';
const DATE_ERROR = 'must be an ISO date (YYYY-MM-DD)';

function exc(): Exception {
  return newException({
    id: 'EX-1',
    title: 'Legacy report server cannot receive October patches',
    policyRef: 'SEC-POL-07 §4.2 Patch timelines',
    riskLevel: 'high',
    requester: 'app.owner',
    owner: 'infra.lead',
    compensatingControls: ['Network isolation to reporting VLAN'],
    justification: 'Vendor patch breaks the reporting module; replacement platform is in procurement with go-live in December.',
    requestedOn: '2026-09-20',
    startOn: AS_OF,
    expiresOn: '2026-12-15',
    remediation: { plan: 'Migrate reports to the new platform and decommission the server.', dueOn: '2026-12-10', status: 'planned' },
  });
}
/** An activated record carrying every optional dated sub-object (approvals, history, closure, pendingRenewal). */
function full(): Exception {
  let e = applyEvent(applyEvent(exc(), { type: 'submit', actor: 'app.owner' }, AS_OF), { type: 'start-review', actor: 'grc.analyst' }, AS_OF);
  e = applyEvent(e, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: 'ok' }, AS_OF);
  e = applyEvent(e, { type: 'approve', actor: 'line.manager', role: 'manager', note: 'ok' }, AS_OF);
  return {
    ...e,
    closure: { evidence: 'Server decommissioned 2026-12-19; CMDB record CI-4411 retired.', closedBy: 'infra.lead', closedOn: '2026-12-20' },
    pendingRenewal: { newExpiresOn: '2027-02-01', requestedBy: 'app.owner', requestedOn: '2026-12-10', note: '' },
  };
}
const board = (exceptions: Exception[]): Board => ({ schema: 'graceline.board/1', asOf: AS_OF, exceptions });
type Loose = Record<string, unknown>;
const clone = (b: Board): Loose => JSON.parse(JSON.stringify(b)) as Loose;
/** Assign `value` at a validator-style path such as `exceptions[0].approvals[1].decidedOn`. */
function setPath(root: Loose, path: string, value: unknown): void {
  const keys = path.split(/\.|\[|\]/).filter(Boolean);
  let cur: Loose = root;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Loose;
  cur[keys[keys.length - 1]] = value;
}

const DATE_PATHS = [
  'asOf',
  'exceptions[0].requestedOn',
  'exceptions[0].startOn',
  'exceptions[0].expiresOn',
  'exceptions[0].remediation.dueOn',
  'exceptions[0].approvals[0].decidedOn',
  'exceptions[0].approvals[1].decidedOn',
  'exceptions[0].history[0].at',
  'exceptions[0].history[3].at',
  'exceptions[0].closure.closedOn',
  'exceptions[0].pendingRenewal.newExpiresOn',
  'exceptions[0].pendingRenewal.requestedOn',
];

describe('strict calendar dates on every date field', () => {
  it('accepts the fully populated record as a baseline', () => {
    const r = validateBoardObject(clone(board([full()])));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.board.exceptions[0].approvals.length).toBe(2);
      expect(r.board.exceptions[0].history.length).toBeGreaterThanOrEqual(4);
      expect(r.board.exceptions[0].closure?.closedOn).toBe('2026-12-20');
      expect(r.board.exceptions[0].pendingRenewal?.newExpiresOn).toBe('2027-02-01');
    }
  });
  for (const path of DATE_PATHS) {
    it(`rejects 2026-02-30 at ${path} with that exact path`, () => {
      const b = clone(board([full()]));
      setPath(b, path, '2026-02-30');
      const r = validateBoardObject(b);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues).toContainEqual({ path, message: DATE_ERROR });
    });
  }
  it('rejects other non-calendar or non-canonical forms and accepts real leap days only', () => {
    for (const bad of ['2026-13-01', '2026-04-31', '2023-02-29', '2026-2-3', '20260203', '2026-02-03T00:00:00Z', '2026/02/03', '', ' 2026-02-03', 20260203, null, true]) {
      const b = clone(board([full()]));
      setPath(b, 'asOf', bad);
      const r = validateBoardObject(b);
      expect(r.ok, `asOf = ${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok) expect(r.issues).toContainEqual({ path: 'asOf', message: DATE_ERROR });
    }
    const leap = clone(board([full()]));
    setPath(leap, 'asOf', '2024-02-29');
    expect(validateBoardObject(leap).ok).toBe(true);
  });
});

describe('hostile structure', () => {
  it('survives 20 000-deep nesting at the root, in the exceptions list and inside a record without throwing', () => {
    const deepArray = '['.repeat(20_000) + ']'.repeat(20_000);
    const deepObject = '{"plan":'.repeat(20_000) + '"x"' + '}'.repeat(20_000);
    const texts = [
      deepArray,
      `{"schema":"graceline.board/1","asOf":"${AS_OF}","exceptions":${deepArray}}`,
      `{"schema":"graceline.board/1","asOf":"${AS_OF}","exceptions":[{"id":"EX-9","remediation":${deepObject}}]}`,
      `{"schema":"graceline.board/1","asOf":"${AS_OF}","exceptions":[{"id":"EX-9","history":${deepArray}}]}`,
    ];
    for (const text of texts) {
      expect(() => validateBoard(text)).not.toThrow();
      const r = validateBoard(text); // pure: a second call sees the same result
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues.length).toBeGreaterThan(0);
        expect(r.issues.length).toBeLessThanOrEqual(60); // issue list is capped
      }
    }
  });
  it('rejects non-finite numbers that JSON can smuggle in (1e400 parses to Infinity) and non-integers', () => {
    for (const n of ['1e400', '-1e400', '1.5', '-0.0001']) {
      const r = validateBoard(`{"schema":"graceline.board/1","asOf":"${AS_OF}","exceptions":[${JSON.stringify(full()).replace(/"renewals":\d+/, `"renewals":${n}`)}]}`);
      expect(r.ok, `renewals = ${n}`).toBe(false);
      if (!r.ok) expect(r.issues.some((i) => i.path === 'exceptions[0].renewals')).toBe(true);
    }
  });
  it('drops unknown keys and rebuilds records with known fields only', () => {
    const b = clone(board([full()]));
    b.extra = { nested: true };
    (b.exceptions as Loose[])[0].bogus = 'x';
    ((b.exceptions as Loose[])[0].remediation as Loose).owner = 'nobody';
    const r = validateBoardObject(b);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.board).sort()).toEqual(['asOf', 'exceptions', 'schema']);
      expect('bogus' in r.board.exceptions[0]).toBe(false);
      expect(Object.keys(r.board.exceptions[0].remediation).sort()).toEqual(['dueOn', 'plan', 'status']);
    }
  });
});
