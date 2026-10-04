import { probeValue } from './cases';
import { createMockServer } from './mockServer';
import type { CaseResult, Contract, Coverage, Endpoint, FieldValue, Finding, FindingKind, Flaw, MockRequest, RecordRow, SuiteRun, TestCase, Verdict } from './types';

const SECRET_LIKE = /password|secret|token|hash|ssn|key/i;

const OWASP: Record<FindingKind, Finding['owaspApi']> = {
  'object-bypass': 'API1:2023',
  'function-bypass': 'API5:2023',
  'mass-assignment': 'API3:2023',
  'sensitive-exposure': 'API3:2023',
  'over-deny': 'n/a',
};

const TITLES: Record<FindingKind, string> = {
  'object-bypass': 'Broken Object Level Authorization',
  'function-bypass': 'Broken Function Level Authorization',
  'mass-assignment': 'Broken Object Property Level Authorization (mass assignment)',
  'sensitive-exposure': 'Broken Object Property Level Authorization (excessive data exposure)',
  'over-deny': 'Over-restrictive authorization (functional regression)',
};

const REMEDIATION: Record<FindingKind, string> = {
  'object-bypass': 'Resolve the record first, then compare its owner/tenant to the authenticated subject before any read or write. Centralize this in one authorization helper and add a negative test per endpoint.',
  'function-bypass': 'Enforce the role list from the contract in middleware that runs before the handler; deny by default for any route without an explicit policy.',
  'mass-assignment': 'Bind request bodies to an explicit allow-list DTO (writableFields) and discard everything else; never spread the raw body onto the entity — on create as well as on update.',
  'sensitive-exposure': 'Project responses through a view model that omits sensitive fields; strip at the serializer so every endpoint inherits the rule.',
  'over-deny': 'Not a security weakness: the server denies traffic the contract says should succeed. Fix the policy or the contract so expectations agree.',
};

/** A representative value for a field: taken from the first record on the resource that carries it (contract order). */
function representative(records: RecordRow[], field: string): FieldValue | undefined {
  for (const r of records) if (Object.prototype.hasOwnProperty.call(r.fields, field)) return r.fields[field];
  return undefined;
}

function buildRequest(endpoint: Endpoint, testCase: TestCase, currentFields: Record<string, FieldValue>, records: RecordRow[]): MockRequest {
  const path = testCase.targetRecord ? endpoint.path.replace('{id}', testCase.targetRecord) : endpoint.path;
  const request: MockRequest = { method: endpoint.method, path, principal: testCase.principal };
  if (endpoint.method === 'POST' && !testCase.targetRecord) {
    // Create path: send every writable field so the request is a plausible create, plus the probed
    // non-writable field. Values are derived from representative record values so types stay realistic.
    const body: Record<string, FieldValue> = {};
    for (const field of endpoint.writableFields ?? []) body[field] = probeValue(representative(records, field));
    if (testCase.probeField) body[testCase.probeField] = probeValue(representative(records, testCase.probeField));
    request.body = body;
  } else if (endpoint.method === 'PATCH' || endpoint.method === 'PUT' || endpoint.method === 'POST') {
    const body: Record<string, FieldValue> = {};
    const first = endpoint.writableFields?.[0];
    if (first) body[first] = probeValue(currentFields[first]);
    if (testCase.probeField) body[testCase.probeField] = probeValue(currentFields[testCase.probeField]);
    request.body = body;
  }
  return request;
}

function severityFor(kind: FindingKind, endpoint: Endpoint, probeFields: string[]): Finding['severity'] {
  if (kind === 'over-deny') return 'low';
  if (kind === 'sensitive-exposure') return probeFields.some((f) => SECRET_LIKE.test(f)) ? 'high' : 'medium';
  if (kind === 'mass-assignment') return probeFields.some((f) => /role|admin|status|owner|tenant|price|amount/i.test(f)) ? 'high' : 'medium';
  return endpoint.method === 'GET' ? 'high' : 'high';
}

/** Runs every case against a fresh server so that destructive cases cannot influence each other. */
export function runSuite(contract: Contract, cases: TestCase[], flaws: Flaw[]): SuiteRun {
  const endpoints = new Map(contract.endpoints.map((e) => [e.id, e]));
  const principals = new Map(contract.principals.map((p) => [p.id, p]));
  const recordsByResource = new Map(contract.resources.map((r) => [r.id, r.records]));
  const results: CaseResult[] = [];

  for (const testCase of cases) {
    const endpoint = endpoints.get(testCase.endpoint)!;
    const principal = principals.get(testCase.principal)!;
    const server = createMockServer(contract, flaws);
    const before = testCase.targetRecord ? server.inspect(endpoint.resource, testCase.targetRecord) : undefined;
    const request = buildRequest(endpoint, testCase, before?.fields ?? {}, recordsByResource.get(endpoint.resource) ?? []);
    const response = server.handle(request);
    const ok = response.status >= 200 && response.status < 300;

    let verdict: Verdict;
    let explanation: string;
    if (response.status === 401 || response.status === 404 || response.status >= 500 || response.status === 400 || response.status === 405) {
      verdict = 'error';
      explanation = `Unexpected ${response.status}; the case could not be evaluated.`;
    } else if (testCase.expected === 'deny') {
      verdict = ok ? 'bypass' : 'pass';
      explanation = ok ? `Expected a denial but the server answered ${response.status}.` : `Denied with ${response.status} as the contract requires.`;
    } else if (!ok) {
      verdict = 'over-deny';
      explanation = `Contract expects success but the server answered ${response.status}.`;
    } else if (testCase.probeField && endpoint.method === 'POST' && !testCase.targetRecord) {
      // Create-path oracle: the response alone proves nothing (201 either way), so read the record the
      // server created, the way an integration test would query the database after the call.
      const createdId = response.body?.id;
      const created = createdId ? server.inspect(endpoint.resource, createdId) : undefined;
      const sent = request.body?.[testCase.probeField];
      if (!created) {
        verdict = 'error';
        explanation = `Server answered ${response.status} but did not identify the created record, so "${testCase.probeField}" could not be inspected.`;
      } else {
        const persisted = Object.prototype.hasOwnProperty.call(created.fields, testCase.probeField) && created.fields[testCase.probeField] === sent;
        verdict = persisted ? 'mass-assignment' : 'pass';
        explanation = persisted
          ? `Server state shows the created record ${created.id} carries non-writable "${testCase.probeField}" = ${JSON.stringify(sent)} taken from the request body.`
          : `"${testCase.probeField}" was discarded; created record ${created.id} does not carry it.`;
      }
    } else if (testCase.probeField && (endpoint.method === 'PATCH' || endpoint.method === 'PUT')) {
      const after = server.inspect(endpoint.resource, testCase.targetRecord!);
      const changed = after && before && after.fields[testCase.probeField] !== before.fields[testCase.probeField];
      verdict = changed ? 'mass-assignment' : 'pass';
      explanation = changed
        ? `Server state shows "${testCase.probeField}" changed from ${JSON.stringify(before!.fields[testCase.probeField])} to ${JSON.stringify(after!.fields[testCase.probeField])}.`
        : `"${testCase.probeField}" was ignored; state unchanged.`;
    } else if (testCase.probeField && endpoint.method === 'GET') {
      const leaked = response.body?.fields !== undefined && Object.prototype.hasOwnProperty.call(response.body.fields, testCase.probeField);
      verdict = leaked ? 'exposure' : 'pass';
      explanation = leaked ? `Response body includes sensitive field "${testCase.probeField}".` : `Sensitive field "${testCase.probeField}" absent from the response.`;
    } else if (testCase.targetKind === 'collection' && endpoint.method === 'GET' && response.body?.items) {
      const outOfScope = response.body.items.filter((item) =>
        endpoint.access.ownership === 'own' ? item.owner !== principal.id : endpoint.access.ownership === 'same-tenant' ? item.tenant !== principal.tenant : false,
      );
      verdict = outOfScope.length ? 'bypass' : 'pass';
      explanation = outOfScope.length ? `Listing returned ${outOfScope.length} record(s) outside the caller’s scope: ${outOfScope.map((i) => i.id).join(', ')}.` : `All ${response.body.items.length} listed records are inside the caller’s scope.`;
    } else {
      verdict = 'pass';
      explanation = `Allowed with ${response.status} as the contract requires.`;
    }

    results.push({
      caseId: testCase.id, endpoint: endpoint.id, role: testCase.role, principal: testCase.principal,
      targetKind: testCase.targetKind, expected: testCase.expected, verdict,
      request: { ...request, headers: { Authorization: `Bearer mock-token-${testCase.principal}`, 'Content-Type': 'application/json' } },
      response, explanation,
    });
  }

  const findings = aggregateFindings(contract, cases, results);
  const coverage = buildCoverage(contract, results);
  return { results, findings, coverage };
}

function aggregateFindings(contract: Contract, cases: TestCase[], results: CaseResult[]): Finding[] {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const endpoints = new Map(contract.endpoints.map((e) => [e.id, e]));
  const groups = new Map<string, { kind: FindingKind; endpoint: Endpoint; cases: string[]; probeFields: string[] }>();
  for (const r of results) {
    const c = caseById.get(r.caseId)!;
    let kind: FindingKind | null = null;
    if (r.verdict === 'bypass') kind = c.category === 'function' ? 'function-bypass' : 'object-bypass';
    else if (r.verdict === 'mass-assignment') kind = 'mass-assignment';
    else if (r.verdict === 'exposure') kind = 'sensitive-exposure';
    else if (r.verdict === 'over-deny') kind = 'over-deny';
    if (!kind) continue;
    const key = `${r.endpoint}:${kind}`;
    const group = groups.get(key) ?? { kind, endpoint: endpoints.get(r.endpoint)!, cases: [], probeFields: [] };
    group.cases.push(r.caseId);
    if (c.probeField) group.probeFields.push(c.probeField);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, g]) => ({
    id: key,
    endpoint: g.endpoint.id,
    kind: g.kind,
    owaspApi: OWASP[g.kind],
    title: TITLES[g.kind],
    severity: severityFor(g.kind, g.endpoint, g.probeFields),
    evidenceCases: g.cases,
    remediation: REMEDIATION[g.kind],
  }));
}

function buildCoverage(contract: Contract, results: CaseResult[]): Coverage {
  const coverage: Coverage = {};
  for (const e of contract.endpoints) {
    coverage[e.id] = {};
    for (const role of contract.roles) coverage[e.id][role.id] = { total: 0, pass: 0, failed: 0 };
  }
  for (const r of results) {
    const cell = coverage[r.endpoint]?.[r.role];
    if (!cell) continue;
    cell.total += 1;
    if (r.verdict === 'pass') cell.pass += 1;
    else cell.failed += 1;
  }
  return coverage;
}
