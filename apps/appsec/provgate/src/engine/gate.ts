import { sha256Hex } from './bundle';
import { classifyChanges, globToRegExp } from './classify';
import { SEVERITIES } from './types';
import type { AcceptanceProblemCode, Evaluation, Evidence, EvidenceType, FindingEvaluation, HashStatus, Manifest, Policy, Problem, RequirementResult } from './types';

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

interface Candidate { evidence: Evidence; problems: Problem[]; hashStatus: HashStatus; ageDays: number }

async function hashStatusOf(e: Evidence): Promise<HashStatus> {
  if (!e.artifactHash || e.artifact === undefined) return 'unverified';
  return (await sha256Hex(e.artifact)) === e.artifactHash ? 'verified' : 'mismatch';
}

async function assess(e: Evidence, type: EvidenceType, manifest: Manifest, policy: Policy, asOf: string, minReviewers: number, scopePaths: string[], classRequired: boolean): Promise<Candidate> {
  const problems: Problem[] = [];
  const ageDays = daysBetween(e.producedAt, asOf);
  if (ageDays < 0) problems.push({ code: 'future-dated', detail: `Produced ${e.producedAt}, after the as-of time ${asOf}.` });
  else if (ageDays > policy.maxEvidenceAgeDays) problems.push({ code: 'stale', detail: `${Math.floor(ageDays)} days old; policy allows ${policy.maxEvidenceAgeDays}.` });
  if (policy.requireSameCommit.includes(type) && e.commit !== manifest.release.commit) {
    problems.push({ code: 'wrong-commit', detail: `Evidence is for commit ${e.commit}; release is ${manifest.release.commit}.` });
  }
  const hashStatus = await hashStatusOf(e);
  if (hashStatus === 'mismatch') problems.push({ code: 'hash-mismatch', detail: 'SHA-256 of the inline artifact does not match artifactHash; the artifact or the record was altered.' });
  if (e.result === 'fail') problems.push({ code: 'failed', detail: 'Evidence records a failing result.' });

  if (type === 'code-review') {
    const identities = new Map(manifest.identities.map((i) => [i.id, i]));
    const distinct = [...new Set(e.reviewers ?? [])];
    if (distinct.includes(manifest.release.author)) problems.push({ code: 'self-review', detail: `Release author ${manifest.release.author} is listed as a reviewer.` });
    const lackingRole = distinct.filter((r) => !identities.get(r)?.roles.includes(policy.reviewerRole));
    if (lackingRole.length) problems.push({ code: 'reviewer-role', detail: `${lackingRole.join(', ')} lack the "${policy.reviewerRole}" role.` });
    const eligible = distinct.filter((r) => r !== manifest.release.author && identities.get(r)?.roles.includes(policy.reviewerRole));
    if (eligible.length < minReviewers) problems.push({ code: 'insufficient-reviewers', detail: `${eligible.length} eligible distinct reviewer(s); ${minReviewers} required (duplicates and the author do not count).` });
  }

  // Evidence that satisfies a change-class requirement must say what it covers; silence is not coverage.
  if (classRequired && !e.scope) {
    problems.push({ code: 'scope-missing', detail: `Required by a change class but declares no scope; cannot show it covers ${scopePaths.join(', ')}.` });
  }
  if (e.scope && scopePaths.length) {
    const regexes = e.scope.map(globToRegExp);
    const uncovered = scopePaths.filter((p) => !regexes.some((r) => r.test(p)));
    if (uncovered.length) problems.push({ code: 'scope-gap', detail: `Scope [${e.scope.join(', ')}] does not cover ${uncovered.join(', ')}.` });
  }
  return { evidence: e, problems, hashStatus, ageDays };
}

const severityRank = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);

export async function evaluateRelease(manifest: Manifest, policy: Policy, options: { asOf?: string } = {}): Promise<Evaluation> {
  const asOf = options.asOf ?? manifest.release.createdAt;
  const req = classifyChanges(manifest, policy);
  const requirements: RequirementResult[] = [];
  const warnings: string[] = [];

  for (const type of req.required) {
    const candidates = await Promise.all(
      manifest.evidence.filter((e) => e.type === type).map((e) => assess(e, type, manifest, policy, asOf, req.minReviewers, req.scopePathsByType[type] ?? [], req.requiredBy[type].some((by) => by !== 'baseline'))),
    );
    if (candidates.length === 0) {
      requirements.push({ type, requiredBy: req.requiredBy[type], alternatives: [], problems: [{ code: 'missing', detail: `No "${type}" evidence in the manifest.` }], hashStatus: 'unverified', satisfied: false });
      continue;
    }
    // Strongest candidate first: fewest problems, then newest.
    candidates.sort((a, b) => a.problems.length - b.problems.length || Date.parse(b.evidence.producedAt) - Date.parse(a.evidence.producedAt));
    const best = candidates[0];
    if (best.problems.length === 0 && best.hashStatus === 'unverified') warnings.push(`${type} (${best.evidence.id}) has no inline artifact to hash; accepted as recorded, not verified.`);
    requirements.push({
      type, requiredBy: req.requiredBy[type], evidenceId: best.evidence.id,
      alternatives: candidates.slice(1).map((c) => c.evidence.id),
      problems: best.problems, hashStatus: best.hashStatus, ageDays: Math.floor(best.ageDays), satisfied: best.problems.length === 0,
    });
  }

  const identities = new Map(manifest.identities.map((i) => [i.id, i]));
  const threshold = severityRank(policy.blockOnOpenFindingsAtOrAbove);
  const findings: FindingEvaluation[] = [];
  for (const e of manifest.evidence) {
    for (const f of e.findings ?? []) {
      const base = { id: f.id, title: f.title, severity: f.severity, status: f.status, source: e.id };
      if (f.status === 'fixed') { findings.push({ ...base, blocking: false, reason: 'Recorded as fixed.' }); continue; }
      if (severityRank(f.severity) > threshold) { findings.push({ ...base, blocking: false, reason: `Below the blocking threshold (${policy.blockOnOpenFindingsAtOrAbove}).` }); continue; }
      const candidates = manifest.acceptances.filter((a) => a.findingRef === f.id);
      if (candidates.length === 0) { findings.push({ ...base, blocking: true, reason: `Open ${f.severity} finding with no risk acceptance.` }); continue; }
      // Evaluate every acceptance for this finding; choose deterministically (valid and latest-expiring first,
      // else fewest problems, latest expiry, id) so list order can never change the verdict.
      const scored = candidates.map((acceptance) => {
        const problems: Problem<AcceptanceProblemCode>[] = [];
        const approver = identities.get(acceptance.approvedBy);
        if (!approver?.roles.includes(policy.acceptance.approverRole)) problems.push({ code: 'approver-role', detail: `${acceptance.approvedBy} lacks the "${policy.acceptance.approverRole}" role.` });
        if (!policy.acceptance.approverMayBeAuthor && acceptance.approvedBy === manifest.release.author) problems.push({ code: 'approver-is-author', detail: 'The release author cannot accept risk on their own release.' });
        if (Date.parse(acceptance.expiresAt) <= Date.parse(asOf)) problems.push({ code: 'expired', detail: `Expired ${acceptance.expiresAt}; as-of ${asOf}.` });
        if (Date.parse(acceptance.approvedAt) > Date.parse(asOf)) problems.push({ code: 'not-yet-effective', detail: `Approved ${acceptance.approvedAt}, after the as-of time.` });
        if (daysBetween(acceptance.approvedAt, acceptance.expiresAt) > policy.acceptance.maxDays) problems.push({ code: 'too-long', detail: `Acceptance window exceeds ${policy.acceptance.maxDays} days.` });
        return { acceptance, problems };
      }).sort((x, y) => x.problems.length - y.problems.length || Date.parse(y.acceptance.expiresAt) - Date.parse(x.acceptance.expiresAt) || x.acceptance.id.localeCompare(y.acceptance.id));
      const { acceptance, problems } = scored[0];
      if (candidates.length > 1) warnings.push(`Finding ${f.id} has ${candidates.length} acceptances (${candidates.map((a) => a.id).join(', ')}); evaluated all and used ${acceptance.id}. Duplicates should be retired.`);
      findings.push({
        ...base, blocking: problems.length > 0,
        reason: problems.length ? `Acceptance ${acceptance.id} is invalid: ${problems.map((p) => p.code).join(', ')}.` : `Accepted by ${acceptance.approvedBy} until ${acceptance.expiresAt}: ${acceptance.rationale}`,
        acceptance: { id: acceptance.id, approvedBy: acceptance.approvedBy, expiresAt: acceptance.expiresAt, problems },
      });
    }
  }
  // Acceptances that reference nothing are surfaced as warnings; they never help.
  const knownFindings = new Set(findings.map((f) => f.id));
  for (const a of manifest.acceptances) if (!knownFindings.has(a.findingRef)) warnings.push(`Acceptance ${a.id} references unknown finding ${a.findingRef}.`);

  const blockers = [
    ...requirements.filter((r) => !r.satisfied).map((r) => `${r.type}: ${r.problems.map((p) => p.code).join(', ')}`),
    ...findings.filter((f) => f.blocking).map((f) => `${f.id} (${f.severity}): ${f.reason}`),
  ];
  const accepted = findings.some((f) => !f.blocking && f.acceptance && f.status !== 'fixed');
  const verdict = blockers.length ? 'blocked' : accepted ? 'release-with-accepted-risk' : 'release';
  return { asOf, verdict, classes: req.classes, minReviewers: req.minReviewers, requirements, findings, blockers, warnings };
}
