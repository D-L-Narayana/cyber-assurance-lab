import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/ledgerly-contract.json';
import { validateContract } from '../contract';
import { generateCases } from '../cases';
import { runSuite } from '../runner';
import { compareRuns } from '../compare';
import { buildReport, reportToMarkdown } from '../report';
import type { Contract, Flaw } from '../types';

const contract = (): Contract => {
  const result = validateContract(fixture);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.contract;
};
const vulnerableFlaws = (): Flaw[] => fixture.builds.vulnerable.flaws as Flaw[];
const c = contract();
const cases = generateCases(c);
const run140 = () => runSuite(c, cases, vulnerableFlaws());
const run141 = () => runSuite(c, cases, []);

describe('run comparison (retest)', () => {
  it('closes every 1.4.0 finding when the suite is re-run on 1.4.1 and lists per-case verdict changes sorted by case id', () => {
    const before = run140();
    const diff = compareRuns(before, run141());
    expect(diff.closed.map((f) => f.key)).toEqual([
      'create-invoice|mass-assignment',
      'delete-user|function-bypass',
      'get-invoice|object-bypass',
      'get-user|sensitive-exposure',
      'patch-user|mass-assignment',
    ]);
    expect(diff.opened).toEqual([]);
    expect(diff.persisted).toEqual([]);
    const failedBefore = before.results.filter((r) => r.verdict !== 'pass');
    expect(diff.caseChanges).toHaveLength(failedBefore.length);
    expect(diff.caseChanges.every((ch) => ch.to === 'pass' && ch.from !== 'pass')).toBe(true);
    expect(diff.caseChanges.map((ch) => ch.caseId)).toEqual([...diff.caseChanges.map((ch) => ch.caseId)].sort());
    expect(diff.summary).toMatchObject({ closed: 5, opened: 0, persisted: 0, caseChanges: failedBefore.length, identical: false });
  });

  it('reports opened findings in the other direction and persisted findings when both runs share them', () => {
    const partial = runSuite(c, cases, vulnerableFlaws().filter((f) => !(f.endpoint === 'patch-user' && f.kind === 'accept-all-fields')));
    const fixedOne = compareRuns(run140(), partial);
    expect(fixedOne.closed.map((f) => f.key)).toEqual(['patch-user|mass-assignment']);
    expect(fixedOne.persisted.map((f) => f.key)).toEqual([
      'create-invoice|mass-assignment',
      'delete-user|function-bypass',
      'get-invoice|object-bypass',
      'get-user|sensitive-exposure',
    ]);
    expect(fixedOne.opened).toEqual([]);
    const regressed = compareRuns(run141(), run140());
    expect(regressed.opened).toHaveLength(5);
    expect(regressed.closed).toEqual([]);
    expect(regressed.caseChanges.length).toBeGreaterThan(0);
    expect(regressed.caseChanges.every((ch) => ch.from === 'pass' && ch.to !== 'pass')).toBe(true);
  });

  it('yields an empty diff for identical runs', () => {
    const diff = compareRuns(run140(), run140());
    expect(diff.closed).toEqual([]);
    expect(diff.opened).toEqual([]);
    expect(diff.caseChanges).toEqual([]);
    expect(diff.persisted).toHaveLength(5);
    expect(diff.summary.identical).toBe(true);
    expect(diff.summary.casesOnlyBefore).toBe(0);
    expect(diff.summary.casesOnlyAfter).toBe(0);
    expect(diff.summary.casesCompared).toBe(cases.length);
  });

  it('is deterministic', () => {
    const a = compareRuns(run140(), run141());
    const b = compareRuns(run140(), run141());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is embedded in the report as an additive optional field and a Markdown "Retest" section', () => {
    const before = run140();
    const after = run141();
    const plain = buildReport(c, after, { build: 'fixed', generatedAt: '2026-10-04T00:00:00.000Z' });
    expect(plain.schema).toBe('permitmatrix.report/1');
    expect('comparison' in plain).toBe(false);
    expect(reportToMarkdown(plain)).not.toMatch(/## Retest/);
    const retest = buildReport(c, after, { build: 'fixed', generatedAt: '2026-10-04T00:00:00.000Z', previous: { run: before, build: 'vulnerable' } });
    expect(retest.schema).toBe('permitmatrix.report/1');
    expect(retest.comparison?.beforeBuild).toBe('vulnerable');
    expect(retest.comparison?.afterBuild).toBe('fixed');
    expect(retest.comparison?.closed).toHaveLength(5);
    expect(retest.comparison?.summary.identical).toBe(false);
    const md = reportToMarkdown(retest);
    expect(md).toMatch(/## Retest/);
    expect(md).toMatch(/Closed: 5/);
    expect(md).toContain('get-invoice|object-bypass');
    expect(JSON.stringify(retest)).not.toMatch(/mock-token-/);
  });
});
