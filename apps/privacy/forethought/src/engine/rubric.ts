import type { Mitigation, Question } from './types';

/**
 * The ten-question rubric plus follow-ups. Effects are increments to a theme's likelihood (L) or
 * impact (I) from a base of 1; negative values model protective answers. Clamped to 1..5 at scoring.
 * Weights are an educational calibration (see README), not a standard.
 */
export const QUESTIONS: Question[] = [
  {
    id: 'q-purpose',
    prompt: 'What is the primary purpose of the processing?',
    options: [
      { id: 'core-service', label: 'Delivering the core service the person asked for', effects: [{ theme: 'lawfulness', impact: 1 }] },
      { id: 'improvement', label: 'Improving an existing service (analytics, quality)', effects: [{ theme: 'lawfulness', likelihood: 1 }] },
      { id: 'personalisation', label: 'Personalising content or recommendations', effects: [{ theme: 'lawfulness', likelihood: 2 }, { theme: 'automated-decisions', likelihood: 1 }] },
      { id: 'new-secondary', label: 'A new purpose for data collected for something else', effects: [{ theme: 'lawfulness', likelihood: 3, impact: 2 }, { theme: 'transparency', likelihood: 2 }] },
    ],
  },
  {
    id: 'q-notice',
    prompt: 'Has the privacy notice been updated to describe this purpose?',
    showIf: { questionId: 'q-purpose', optionIds: ['personalisation', 'new-secondary'] },
    options: [
      { id: 'updated', label: 'Yes, published', effects: [{ theme: 'transparency', likelihood: -1 }] },
      { id: 'planned', label: 'Drafted, not yet published', effects: [{ theme: 'transparency', likelihood: 1 }] },
      { id: 'no', label: 'No', effects: [{ theme: 'transparency', likelihood: 3, impact: 2 }] },
    ],
  },
  {
    id: 'q-basis',
    prompt: 'Which lawful basis is relied on?',
    help: 'Consent and legitimate interest carry handling obligations (withdrawal, objection) that raise the rights theme.',
    options: [
      { id: 'contract', label: 'Necessary for the contract', effects: [{ theme: 'rights', impact: 1 }] },
      { id: 'consent', label: 'Consent', effects: [{ theme: 'rights', likelihood: 1 }, { theme: 'transparency', likelihood: 1 }] },
      { id: 'legitimate-interest', label: 'Legitimate interest', effects: [{ theme: 'lawfulness', likelihood: 2 }, { theme: 'transparency', likelihood: 1 }, { theme: 'rights', likelihood: 1 }] },
      { id: 'undecided', label: 'Not yet decided', effects: [{ theme: 'lawfulness', likelihood: 3, impact: 2 }] },
    ],
  },
  {
    id: 'q-categories',
    prompt: 'What is the most sensitive category of data involved?',
    options: [
      { id: 'basic-contact', label: 'Identifiers and contact details', effects: [{ theme: 'minimisation', likelihood: 1 }] },
      { id: 'behavioural', label: 'Behavioural or usage data', effects: [{ theme: 'minimisation', likelihood: 2 }, { theme: 'automated-decisions', impact: 1 }, { theme: 'transparency', likelihood: 1 }] },
      { id: 'financial-or-location', label: 'Financial or precise location data', effects: [{ theme: 'security', impact: 2 }, { theme: 'minimisation', likelihood: 2 }] },
      { id: 'special-category', label: 'Special-category data (health, biometrics, beliefs…)', effects: [{ theme: 'security', impact: 3 }, { theme: 'lawfulness', impact: 2 }, { theme: 'vulnerable-subjects', impact: 1 }] },
    ],
  },
  {
    id: 'q-volume',
    prompt: 'Roughly how many people are affected?',
    options: [
      { id: 'under-10k', label: 'Fewer than 10,000', effects: [{ theme: 'security', impact: 1 }] },
      { id: '10k-100k', label: '10,000 to 100,000', effects: [{ theme: 'security', impact: 2 }] },
      { id: '100k-1m', label: '100,000 to 1 million', effects: [{ theme: 'security', impact: 3 }, { theme: 'rights', likelihood: 1 }] },
      { id: 'over-1m', label: 'More than 1 million', effects: [{ theme: 'security', impact: 4 }, { theme: 'rights', likelihood: 2 }, { theme: 'transparency', impact: 1 }] },
    ],
  },
  {
    id: 'q-rights-tooling',
    prompt: 'How will access, deletion and objection requests be handled at this scale?',
    showIf: { questionId: 'q-volume', optionIds: ['100k-1m', 'over-1m'] },
    options: [
      { id: 'automated', label: 'Automated through the rights desk', effects: [{ theme: 'rights', likelihood: -1 }] },
      { id: 'manual', label: 'Manually, case by case', effects: [{ theme: 'rights', likelihood: 1 }] },
      { id: 'none', label: 'Not yet planned', effects: [{ theme: 'rights', likelihood: 3, impact: 2 }] },
    ],
  },
  {
    id: 'q-profiling',
    prompt: 'Does the feature profile people or make automated decisions about them?',
    options: [
      { id: 'none', label: 'No profiling', effects: [] },
      { id: 'segmentation', label: 'Group-level segmentation only', effects: [{ theme: 'automated-decisions', likelihood: 2 }, { theme: 'transparency', likelihood: 1 }] },
      { id: 'individual-recommendations', label: 'Individual recommendations or ranking', effects: [{ theme: 'automated-decisions', likelihood: 2, impact: 1 }, { theme: 'transparency', likelihood: 2 }] },
      { id: 'decisions-with-effects', label: 'Automated decisions with legal or similarly significant effects', effects: [{ theme: 'automated-decisions', likelihood: 4, impact: 4 }, { theme: 'rights', likelihood: 2 }, { theme: 'lawfulness', likelihood: 2 }] },
    ],
  },
  {
    id: 'q-children',
    prompt: 'Could children or other vulnerable people be among the data subjects?',
    options: [
      { id: 'no', label: 'No, adults only with controls in place', effects: [] },
      { id: 'possible', label: 'Possibly, the service is general-audience', effects: [{ theme: 'vulnerable-subjects', likelihood: 2, impact: 2 }] },
      { id: 'yes-directed', label: 'Yes, the feature is directed at children', effects: [{ theme: 'vulnerable-subjects', likelihood: 4, impact: 4 }, { theme: 'lawfulness', likelihood: 2 }, { theme: 'transparency', likelihood: 2 }] },
    ],
  },
  {
    id: 'q-children-age-assurance',
    prompt: 'What age-assurance approach is used?',
    showIf: { questionId: 'q-children', optionIds: ['possible', 'yes-directed'] },
    options: [
      { id: 'none', label: 'None', effects: [{ theme: 'vulnerable-subjects', likelihood: 1, impact: 1 }] },
      { id: 'self-declared', label: 'Self-declared age', effects: [{ theme: 'vulnerable-subjects', likelihood: 1 }] },
      { id: 'verified', label: 'Verified or parental authorisation', effects: [{ theme: 'vulnerable-subjects', likelihood: -1 }] },
    ],
  },
  {
    id: 'q-sharing',
    prompt: 'Is the data shared with other organisations?',
    options: [
      { id: 'none', label: 'No', effects: [] },
      { id: 'processors', label: 'Yes, with processors acting on our instructions', effects: [{ theme: 'third-party', likelihood: 2, impact: 1 }] },
      { id: 'independent-controllers', label: 'Yes, with independent controllers', effects: [{ theme: 'third-party', likelihood: 3, impact: 3 }, { theme: 'transparency', likelihood: 1 }, { theme: 'lawfulness', likelihood: 1 }] },
      { id: 'sale', label: 'Yes, sold or shared for advertising', effects: [{ theme: 'third-party', likelihood: 4, impact: 4 }, { theme: 'lawfulness', likelihood: 2 }, { theme: 'rights', likelihood: 2 }] },
    ],
  },
  {
    id: 'q-sharing-contracts',
    prompt: 'Are data-processing or sharing agreements in place with every recipient?',
    showIf: { questionId: 'q-sharing', optionIds: ['processors', 'independent-controllers', 'sale'] },
    options: [
      { id: 'in-place', label: 'Yes, signed and reviewed', effects: [{ theme: 'third-party', likelihood: -1 }] },
      { id: 'partial', label: 'Some recipients only', effects: [{ theme: 'third-party', likelihood: 1 }] },
      { id: 'none', label: 'No', effects: [{ theme: 'third-party', likelihood: 2, impact: 1 }] },
    ],
  },
  {
    id: 'q-transfer',
    prompt: 'Where is the data stored and processed relative to the people it describes?',
    options: [
      { id: 'within-region', label: 'Within their region', effects: [] },
      { id: 'adequate-country', label: 'In a country with an adequacy decision', effects: [{ theme: 'cross-border', likelihood: 1, impact: 1 }] },
      { id: 'outside-with-safeguards', label: 'Outside their region, with contractual safeguards', effects: [{ theme: 'cross-border', likelihood: 2, impact: 2 }] },
      { id: 'outside-no-safeguards', label: 'Outside their region, no safeguards yet', effects: [{ theme: 'cross-border', likelihood: 4, impact: 3 }, { theme: 'lawfulness', likelihood: 2 }] },
    ],
  },
  {
    id: 'q-retention',
    prompt: 'Is a retention period defined and enforced for this data?',
    options: [
      { id: 'defined-and-enforced', label: 'Defined and enforced automatically', effects: [] },
      { id: 'defined-not-enforced', label: 'Defined on paper, not enforced', effects: [{ theme: 'retention', likelihood: 2, impact: 1 }] },
      { id: 'undefined', label: 'Not defined', effects: [{ theme: 'retention', likelihood: 4, impact: 3 }, { theme: 'minimisation', likelihood: 1 }] },
    ],
  },
  {
    id: 'q-security',
    prompt: 'What is the security posture of the systems involved?',
    options: [
      { id: 'encryption-and-access', label: 'Encrypted at rest and in transit with role-based access, recently tested', effects: [{ theme: 'security', likelihood: -1 }] },
      { id: 'standard-controls', label: 'Standard controls, not recently tested', effects: [{ theme: 'security', likelihood: 1 }] },
      { id: 'unknown', label: 'Unknown', effects: [{ theme: 'security', likelihood: 3, impact: 1 }] },
      { id: 'known-gaps', label: 'Known gaps', effects: [{ theme: 'security', likelihood: 4, impact: 2 }] },
    ],
  },
];

export const MITIGATIONS: Mitigation[] = [
  { id: 'm-pseudonymise', name: 'Pseudonymise identifiers in the feature pipeline', description: 'Replace direct identifiers with keyed tokens before data reaches the feature.', themes: ['security', 'minimisation'], reduces: 'impact', by: 1, requiresEvidence: false },
  { id: 'm-pentest', name: 'Independent security test of the feature', description: 'Authorised penetration test with findings remediated.', themes: ['security'], reduces: 'likelihood', by: 2, requiresEvidence: true },
  { id: 'm-encryption', name: 'Field-level encryption for sensitive fields', description: 'Encrypt sensitive fields with keys held by the controller.', themes: ['security', 'cross-border'], reduces: 'impact', by: 1, requiresEvidence: true },
  { id: 'm-access-control', name: 'Least-privilege access with periodic review', description: 'Role-based access and quarterly access reviews.', themes: ['security'], reduces: 'likelihood', by: 1, requiresEvidence: false },
  { id: 'm-dpa', name: 'Signed data-processing agreements with every recipient', description: 'Processor terms covering instructions, security, sub-processors and deletion.', themes: ['third-party'], reduces: 'likelihood', by: 2, requiresEvidence: true },
  { id: 'm-sccs', name: 'Transfer safeguards (SCCs or equivalent) with transfer assessment', description: 'Executed clauses plus a documented transfer risk assessment.', themes: ['cross-border'], reduces: 'likelihood', by: 2, requiresEvidence: true },
  { id: 'm-retention-automation', name: 'Automated retention enforcement', description: 'Scheduled deletion or anonymisation jobs with monitoring.', themes: ['retention'], reduces: 'likelihood', by: 2, requiresEvidence: false },
  { id: 'm-notice-update', name: 'Publish an updated, layered privacy notice', description: 'Describe the new purpose, basis, recipients and rights in plain language.', themes: ['transparency'], reduces: 'likelihood', by: 1, requiresEvidence: false },
  { id: 'm-rights-tooling', name: 'Connect the feature to the rights-request desk', description: 'Access, deletion and objection requests reach this data store.', themes: ['rights'], reduces: 'likelihood', by: 1, requiresEvidence: false },
  { id: 'm-human-review', name: 'Meaningful human review of significant outcomes', description: 'A trained reviewer can override and explain outcomes.', themes: ['automated-decisions'], reduces: 'impact', by: 2, requiresEvidence: false },
  { id: 'm-opt-out', name: 'Easy opt-out from personalisation', description: 'One-click opt-out honoured across channels.', themes: ['automated-decisions', 'lawfulness'], reduces: 'likelihood', by: 1, requiresEvidence: false },
  { id: 'm-age-assurance', name: 'Proportionate age assurance', description: 'Age assurance appropriate to the risk, with parental authorisation where required.', themes: ['vulnerable-subjects'], reduces: 'likelihood', by: 2, requiresEvidence: true },
  { id: 'm-lia', name: 'Documented legitimate-interest assessment', description: 'Purpose, necessity and balancing test recorded and approved.', themes: ['lawfulness'], reduces: 'likelihood', by: 1, requiresEvidence: true },
];
