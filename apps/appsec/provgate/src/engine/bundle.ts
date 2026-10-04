import { remediationFor } from './remediation';
import type { RemediationItem } from './remediation';
import type { Evaluation, Manifest, Policy } from './types';

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Bundle {
  schema: 'provgate.bundle/1';
  generatedAt: string;
  tool: { name: 'provgate'; mode: 'browser-local deterministic evaluation' };
  manifest: Manifest;
  policy: Policy;
  evaluation: Evaluation;
  /** Additive (October 2026): the remediation checklist derived from the evaluation, policy and manifest. */
  remediation?: RemediationItem[];
  digest: string;
  digestNote: string;
  disclaimer: string;
}

export const DIGEST_NOTE = 'SHA-256 content digest of this bundle with digest/digestNote removed, computed in the browser. It detects accidental edits; it is NOT a signature and proves nothing about who produced the bundle.';
export const DISCLAIMER = 'Educational prototype. The gate evaluates synthetic release metadata against a local policy. It is not a compliance attestation, audit opinion or production release control.';

export async function buildBundle(manifest: Manifest, policy: Policy, evaluation: Evaluation, generatedAt = new Date().toISOString()): Promise<Bundle> {
  const remediation = remediationFor(evaluation, { policy, manifest });
  const body = { schema: 'provgate.bundle/1' as const, generatedAt, tool: { name: 'provgate' as const, mode: 'browser-local deterministic evaluation' as const }, manifest, policy, evaluation, remediation, disclaimer: DISCLAIMER };
  const digest = await sha256Hex(JSON.stringify({ ...body, digest: undefined, digestNote: undefined }));
  return { ...body, digest, digestNote: DIGEST_NOTE };
}

export function bundleToMarkdown(b: Bundle): string {
  const e = b.evaluation;
  const remediation = b.remediation ?? remediationFor(e, { policy: b.policy, manifest: b.manifest });
  const lines = [
    `# Release gate — ${b.manifest.release.name} (${b.manifest.release.version}, ${b.manifest.release.commit})`,
    '',
    `Verdict: **${e.verdict.toUpperCase()}** · as of ${e.asOf} · policy "${b.policy.name}"`,
    '',
    `> ${b.disclaimer}`,
    '',
    '## Change classes',
    ...(e.classes.length ? e.classes.map((c) => `- ${c.label} (${c.id}): ${c.paths.join(', ')}`) : ['- none matched; baseline only']),
    '',
    '## Evidence requirements',
    '| Type | Required by | Evidence | Hash | Problems |',
    '|---|---|---|---|---|',
    ...e.requirements.map((r) => `| ${r.type} | ${r.requiredBy.join(', ')} | ${r.evidenceId ?? '—'} | ${r.hashStatus} | ${r.problems.length ? r.problems.map((p) => `${p.code}: ${p.detail}`).join('<br>') : 'none'} |`),
    '',
    '## Findings',
    ...(e.findings.length ? e.findings.map((f) => `- ${f.severity.toUpperCase()} ${f.id} ${f.title} — ${f.status}; ${f.blocking ? 'BLOCKING' : 'not blocking'}: ${f.reason}`) : ['- none reported']),
    '',
    '## Blockers',
    ...(e.blockers.length ? e.blockers.map((x) => `- ${x}`) : ['- none']),
    '',
    '## Remediation checklist',
    ...(remediation.length ? remediation.map((i) => `- [ ] **${i.code}** \`${i.target}\` — ${i.action} _(gate: ${i.detail})_`) : ['- none']),
    '',
    `Bundle digest (SHA-256, not a signature): \`${b.digest}\``,
  ];
  return lines.join('\n');
}
