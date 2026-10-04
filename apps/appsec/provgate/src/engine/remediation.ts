import { classifyChanges, globToRegExp } from './classify';
import type { AcceptanceProblemCode, Evaluation, FindingEvaluation, Manifest, Policy, Problem, ProblemCode, RequirementResult } from './types';

/**
 * Every gate problem code plus `no-acceptance`, the one blocker the gate raises without a code
 * (an open finding at or above the blocking severity that has no risk acceptance at all).
 */
export type RemediationCode = ProblemCode | AcceptanceProblemCode | 'no-acceptance';

export interface RemediationItem {
  code: RemediationCode;
  /** What the action applies to: `<type> (<evidenceId>)`, `<findingId> (acceptance <id>)`, `acceptance <id>` … */
  target: string;
  /** The concrete step that would clear the problem, phrased with the policy's own numbers when the policy is supplied. */
  action: string;
  /** The gate's observation that raised the item (verbatim problem detail, blocker reason or warning). */
  detail: string;
}

/** Optional context: with it, actions quote the release commit, the author and the policy limits; without it they stay generic. */
export interface RemediationContext { policy?: Policy; manifest?: Manifest }

/**
 * Generic action per code. The exhaustive `Record` is the type-level guard: adding a code to `ProblemCode` or
 * `AcceptanceProblemCode` without adding an action here fails `tsc`, which `npm run build` runs.
 */
export const ACTION_SUMMARY: Record<ProblemCode | AcceptanceProblemCode, string> = {
  missing: 'Produce the required evidence for the release commit and add it to the manifest.',
  stale: 'Re-run the activity against the release commit and record a new artifact within the policy’s evidence age limit (maxEvidenceAgeDays).',
  'future-dated': 'Correct the producedAt timestamp (it is after the as-of time) or evaluate as of a later date; evidence from the future cannot be relied on.',
  'wrong-commit': 'Re-run the activity against the release commit; the policy requires this evidence type to match the release commit exactly.',
  'hash-mismatch': 'Recompute SHA-256 over the artifact that was actually produced and record that artifactHash, or re-run the activity; never edit the hash to fit.',
  failed: 'Fix the failures and re-run until the evidence records a pass; a failing result never satisfies the gate.',
  'self-review': 'Remove the release author from the reviewer list and obtain review from independent identities.',
  'insufficient-reviewers': 'Add enough distinct, eligible reviewers (holding the reviewer role and not the author) to meet the policy minimum.',
  'reviewer-role': 'Replace reviewers who lack the reviewer role, or grant the role through the identity source — not by editing the manifest.',
  'scope-gap': 'Extend the evidence scope, or produce new evidence, so it covers every changed path the requiring change class names.',
  'scope-missing': 'Declare the scope the evidence covers; class-required evidence with no scope is treated as covering nothing.',
  expired: 'Renew the risk acceptance with a new time-boxed window approved by an eligible approver, or fix the finding.',
  'not-yet-effective': 'Correct the approvedAt timestamp (it is after the as-of time) or evaluate once the acceptance is effective.',
  'too-long': 'Shorten the acceptance window to the policy maximum (acceptance.maxDays) and re-approve.',
  'approver-role': 'Have an identity holding the approver role approve the acceptance; the current approver is not eligible.',
  'approver-is-author': 'Have someone other than the release author approve the acceptance (separation of duties).',
  'unknown-finding': 'Retire the acceptance or correct its findingRef so it points at a finding that exists in the evidence.',
};

const UNKNOWN_FINDING_WARNING = /^Acceptance (\S+) references unknown finding (\S+)\.$/;

const describeRequiredBy = (requiredBy: string[]): string =>
  requiredBy.map((by) => (by === 'baseline' ? 'the policy baseline' : `the "${by}" change class`)).join(' and ');

function requirementAction(r: RequirementResult, p: Problem, ev: Evaluation, ctx: RemediationContext): string {
  const { policy, manifest } = ctx;
  const type = r.type;
  const commit = manifest ? `commit ${manifest.release.commit}` : 'the release commit';
  const id = r.evidenceId ?? type;
  const evidence = manifest?.evidence.find((e) => e.id === r.evidenceId);
  const reviewerRole = policy ? `"${policy.reviewerRole}"` : 'reviewer';
  const author = manifest?.release.author;
  switch (p.code) {
    case 'missing':
      return `Produce ${type} evidence for ${commit} and add it to the manifest; required by ${describeRequiredBy(r.requiredBy)}${policy?.requireSameCommit.includes(type) ? ' and, by policy, it must be for the release commit itself' : ''}.`;
    case 'stale':
      return policy
        ? `Re-run ${type} against ${commit} and record a new artifact; policy allows ${policy.maxEvidenceAgeDays} days of evidence age relative to the as-of time (${ev.asOf}).`
        : `Re-run ${type} against ${commit} and record a new artifact within the policy’s evidence age limit (maxEvidenceAgeDays).`;
    case 'future-dated':
      return `Correct producedAt on ${id}${evidence ? ` (${evidence.producedAt})` : ''} or evaluate as of a later date than ${ev.asOf}; evidence dated after the as-of time cannot be relied on.`;
    case 'wrong-commit':
      return `Re-run ${type} against ${commit} and record the result${evidence ? ` (the current evidence ${id} is for commit ${evidence.commit})` : ''}; the policy’s requireSameCommit list demands ${type} evidence for the release commit itself.`;
    case 'hash-mismatch':
      return `Recompute SHA-256 over the artifact actually produced for ${id} and record that artifactHash, or re-run ${type} against ${commit}; never edit the hash to fit — a mismatch means the artifact or the record was altered.`;
    case 'failed':
      return `Fix what made ${id} fail and re-run ${type} against ${commit} until it records a pass; a failing result never satisfies the gate.`;
    case 'self-review':
      return `Remove the release author${author ? ` ${author}` : ''} from the reviewers of ${id} and obtain review from independent identities; an author cannot review their own release.`;
    case 'insufficient-reviewers':
      return `Add reviewers so that at least ${ev.minReviewers} distinct identities holding the ${reviewerRole} role, other than the release author${author ? ` (${author})` : ''}, approve ${id}; duplicates count once.`;
    case 'reviewer-role': {
      const lacking = evidence && policy && manifest
        ? [...new Set(evidence.reviewers ?? [])].filter((rv) => !manifest.identities.find((i) => i.id === rv)?.roles.includes(policy.reviewerRole))
        : [];
      return `Replace the reviewers of ${id} who lack the ${reviewerRole} role${lacking.length ? ` (${lacking.join(', ')})` : ''} with eligible identities, or grant the role through the identity source — not by editing the manifest.`;
    }
    case 'scope-gap': {
      if (manifest && policy) {
        const req = classifyChanges(manifest, policy);
        const scopePaths = req.scopePathsByType[type] ?? [];
        const regexes = (evidence?.scope ?? []).map(globToRegExp);
        const uncovered = scopePaths.filter((path) => !regexes.some((rx) => rx.test(path)));
        const classes = r.requiredBy.filter((by) => by !== 'baseline');
        return `Extend the scope of ${id} (currently [${(evidence?.scope ?? []).join(', ')}]) or produce new ${type} evidence covering ${uncovered.join(', ')}; ${describeRequiredBy(classes.length ? classes : r.requiredBy)} requires ${type} to cover these paths.`;
      }
      return `Extend the scope of ${id}, or produce new ${type} evidence, so it covers every changed path named by ${describeRequiredBy(r.requiredBy)} (see the gate detail for the uncovered paths).`;
    }
    case 'scope-missing': {
      const paths = manifest && policy ? classifyChanges(manifest, policy).scopePathsByType[type] ?? [] : [];
      return `Declare a scope on ${id} listing the paths it covers${paths.length ? ` (${paths.join(', ')})` : ''}; evidence required by ${describeRequiredBy(r.requiredBy.filter((by) => by !== 'baseline'))} must say what it covers — silence is not coverage.`;
    }
  }
}

function acceptanceAction(f: FindingEvaluation, p: Problem<AcceptanceProblemCode>, ev: Evaluation, ctx: RemediationContext): string {
  const { policy } = ctx;
  const a = f.acceptance!;
  const approverRole = policy ? `"${policy.acceptance.approverRole}"` : 'approver';
  const maxDays = policy ? `${policy.acceptance.maxDays} days` : 'the policy maximum (acceptance.maxDays)';
  const notAuthor = policy?.acceptance.approverMayBeAuthor ? '' : ', other than the release author,';
  switch (p.code) {
    case 'expired':
      return `Renew the acceptance for ${f.id}: an identity holding the ${approverRole} role${notAuthor} must approve a new window of at most ${maxDays} (acceptance ${a.id} expired ${a.expiresAt}; as of ${ev.asOf}) — or fix the finding and record it as fixed.`;
    case 'not-yet-effective':
      return `Correct approvedAt on acceptance ${a.id} or evaluate as of a date after it was approved; an acceptance cannot carry ${f.id} before it is effective (as of ${ev.asOf}).`;
    case 'too-long':
      return `Shorten the window of acceptance ${a.id} to at most ${maxDays} from approvedAt and re-approve; long-lived acceptances defeat the time box.`;
    case 'approver-role':
      return `Have an identity holding the ${approverRole} role approve acceptance ${a.id}; ${a.approvedBy} is not eligible to accept risk on ${f.id}.`;
    case 'approver-is-author':
      return `Have someone other than the release author (${a.approvedBy}) approve acceptance ${a.id}; separation of duties forbids accepting risk on one’s own release.`;
    case 'unknown-finding':
      return `Retire acceptance ${a.id} or correct its findingRef so it points at a finding that exists in the evidence.`;
  }
}

/**
 * Turns every blocker the gate raised into a concrete, ordered checklist: one item per requirement problem,
 * one per acceptance problem, one per open finding without any acceptance, and one per acceptance that
 * references a finding nobody recorded. Deterministic: follows the evaluation's own order.
 */
export function remediationFor(evaluation: Evaluation, context: RemediationContext = {}): RemediationItem[] {
  const { policy } = context;
  const items: RemediationItem[] = [];
  for (const r of evaluation.requirements) {
    for (const p of r.problems) {
      items.push({ code: p.code, target: r.evidenceId ? `${r.type} (${r.evidenceId})` : r.type, action: requirementAction(r, p, evaluation, context), detail: p.detail });
    }
  }
  for (const f of evaluation.findings) {
    if (f.acceptance) {
      for (const p of f.acceptance.problems) items.push({ code: p.code, target: `${f.id} (acceptance ${f.acceptance.id})`, action: acceptanceAction(f, p, evaluation, context), detail: p.detail });
    } else if (f.blocking) {
      const approverRole = policy ? `"${policy.acceptance.approverRole}"` : 'approver';
      const maxDays = policy ? `${policy.acceptance.maxDays} days` : 'the policy maximum (acceptance.maxDays)';
      const notAuthor = policy?.acceptance.approverMayBeAuthor ? '' : ' who is not the release author';
      // `f.source` is the id of the evidence that reported the finding; the evidence *type* comes from the manifest.
      const sourceType = context.manifest?.evidence.find((e) => e.id === f.source)?.type;
      const newEvidence = sourceType ? `new ${sourceType} evidence` : 'new evidence of the same type';
      items.push({
        code: 'no-acceptance', target: f.id,
        action: `Fix ${f.id} and record it as fixed in ${newEvidence} for the release commit, or obtain a time-boxed risk acceptance of at most ${maxDays} approved by an identity holding the ${approverRole} role${notAuthor}; until then this ${f.severity} finding blocks the release.`,
        detail: f.reason,
      });
    }
  }
  for (const w of evaluation.warnings) {
    const m = w.match(UNKNOWN_FINDING_WARNING);
    if (!m) continue;
    items.push({ code: 'unknown-finding', target: `acceptance ${m[1]}`, action: `Retire acceptance ${m[1]} or correct its findingRef: no finding ${m[2]} exists in the evidence, so the acceptance carries nothing and only adds noise.`, detail: w });
  }
  return items;
}
