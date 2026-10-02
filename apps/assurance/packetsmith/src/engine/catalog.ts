// Educational 12-control subset of NIST SP 800-53 Rev. 5 (Release 5.2.0, August 2025).
// Control identifiers, titles and families are from the NIST catalog (https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final).
// `summary` and `determinations` are this project's PARAPHRASES for teaching; they are not the authoritative control
// statements or the SP 800-53A Rev. 5 assessment procedures. Assessment methods (examine / interview / test) follow
// SP 800-53A Rev. 5 (https://csrc.nist.gov/pubs/sp/800/53/a/r5/final).
import type { Control } from './types';

export const CATALOG_VERSION = 'NIST SP 800-53 Rev. 5 (Release 5.2.0, 2025-08-27)';
export const PROCEDURES_VERSION = 'Assessment methods per NIST SP 800-53A Rev. 5 (2022-01)';
export const SUBSET_LABEL = '12 controls (educational subset; determinations paraphrased)';

export const CATALOG: readonly Control[] = [
  {
    id: 'AC-2', title: 'Account Management', family: 'Access Control',
    summary: 'Account types are defined, accounts are authorised, created, modified, disabled and removed under a documented process, and usage is monitored.',
    determinations: [
      { id: 'AC-2.a', text: 'Allowed and prohibited account types are defined and documented.' },
      { id: 'AC-2.d', text: 'Each account has an authorised approver and the approval is recorded before access is granted.' },
      { id: 'AC-2.h', text: 'Accounts are disabled or removed within the organisation-defined time after the need ends.' },
    ],
    objects: {
      examine: ['Account management policy and procedure', 'Sample of account creation/termination records', 'Directory export of accounts'],
      interview: ['Personnel with account management responsibilities', 'System administrators'],
      test: ['Automated mechanism that disables inactive accounts', 'Approval workflow for new accounts'],
    },
  },
  {
    id: 'AC-6', title: 'Least Privilege', family: 'Access Control',
    summary: 'Users and processes are allowed only the access necessary to accomplish assigned tasks.',
    determinations: [
      { id: 'AC-6.1', text: 'Privileged roles are defined and assigned only to authorised individuals.' },
      { id: 'AC-6.2', text: 'Privilege assignments are reviewed at the organisation-defined frequency and excess privileges are removed.' },
    ],
    objects: {
      examine: ['Role definitions and privilege matrix', 'Privileged account review records'],
      interview: ['Personnel responsible for defining least privilege', 'Application owners'],
      test: ['Role-based access enforcement for a sample privileged function'],
    },
  },
  {
    id: 'AT-2', title: 'Literacy Training and Awareness', family: 'Awareness and Training',
    summary: 'Security and privacy literacy training is provided to users initially, periodically and when required by changes.',
    determinations: [
      { id: 'AT-2.a', text: 'Literacy training is delivered to new users and at the defined frequency thereafter.' },
      { id: 'AT-2.c', text: 'Training content is updated at the defined frequency or following defined events.' },
    ],
    objects: {
      examine: ['Training policy', 'Completion records', 'Training content and change log'],
      interview: ['Personnel responsible for training', 'A sample of system users'],
      test: ['Mechanism that tracks and enforces training completion'],
    },
  },
  {
    id: 'AU-2', title: 'Event Logging', family: 'Audit and Accountability',
    summary: 'The event types the system can log are identified, the subset to be logged is selected and the selection is reviewed periodically.',
    determinations: [
      { id: 'AU-2.a', text: 'Loggable event types are identified for the system.' },
      { id: 'AU-2.c', text: 'The specific event types to be logged, and their logging frequency, are specified.' },
      { id: 'AU-2.e', text: 'The logged event types are reviewed and updated at the defined frequency.' },
    ],
    objects: {
      examine: ['Logging standard', 'Logging configuration for a sample component', 'Review records'],
      interview: ['Personnel with audit and accountability responsibilities'],
      test: ['Generate a sample event and confirm it is logged with required attributes'],
    },
  },
  {
    id: 'AU-6', title: 'Audit Record Review, Analysis, and Reporting', family: 'Audit and Accountability',
    summary: 'Audit records are reviewed and analysed at a defined frequency for inappropriate or unusual activity, with findings reported to designated personnel.',
    determinations: [
      { id: 'AU-6.a', text: 'Audit records are reviewed and analysed at the defined frequency for defined indications of inappropriate or unusual activity.' },
      { id: 'AU-6.b', text: 'Findings are reported to the defined personnel or roles.' },
    ],
    objects: {
      examine: ['Audit review procedure', 'Review records / SIEM case history', 'Escalation reports'],
      interview: ['Security operations analysts', 'Personnel receiving escalations'],
      test: ['Alert rule fires on a sample inappropriate activity in a test environment'],
    },
  },
  {
    id: 'CM-6', title: 'Configuration Settings', family: 'Configuration Management',
    summary: 'Secure configuration settings are established using approved baselines, implemented, documented where deviations are approved, and monitored for change.',
    determinations: [
      { id: 'CM-6.a', text: 'Configuration settings reflecting the most restrictive mode consistent with operations are established and documented using the defined common secure configurations.' },
      { id: 'CM-6.b', text: 'The configuration settings are implemented on system components.' },
      { id: 'CM-6.c', text: 'Deviations from established settings are identified, documented and approved.' },
    ],
    objects: {
      examine: ['Secure configuration baseline', 'Deviation register', 'Configuration scan output'],
      interview: ['Personnel with configuration management responsibilities'],
      test: ['Compare running configuration of a sample component to the baseline'],
    },
  },
  {
    id: 'CP-9', title: 'System Backup', family: 'Contingency Planning',
    summary: 'User-level, system-level and documentation backups are performed at defined frequencies and their confidentiality, integrity and availability are protected.',
    determinations: [
      { id: 'CP-9.a', text: 'Backups of user-level information are conducted at the defined frequency.' },
      { id: 'CP-9.b', text: 'Backups of system-level information are conducted at the defined frequency.' },
      { id: 'CP-9.d', text: 'Confidentiality, integrity and availability of backup information are protected.' },
    ],
    objects: {
      examine: ['Backup policy and schedule', 'Backup job logs', 'Encryption and access settings for backup storage'],
      interview: ['Personnel with backup responsibilities'],
      test: ['Restore a sample backup and verify integrity'],
    },
  },
  {
    id: 'IA-2', title: 'Identification and Authentication (Organizational Users)', family: 'Identification and Authentication',
    summary: 'Organisational users are uniquely identified and authenticated, and that identity is associated with processes acting on their behalf.',
    determinations: [
      { id: 'IA-2.1', text: 'Each organisational user is uniquely identified before access is granted.' },
      { id: 'IA-2.2', text: 'Each organisational user is authenticated before access is granted.' },
    ],
    objects: {
      examine: ['Identification and authentication policy', 'Identity provider configuration export'],
      interview: ['Personnel with identity management responsibilities'],
      test: ['Attempt access with a shared or unknown identity; confirm denial'],
    },
  },
  {
    id: 'IR-4', title: 'Incident Handling', family: 'Incident Response',
    summary: 'An incident handling capability covering preparation, detection and analysis, containment, eradication and recovery is implemented and coordinated with contingency planning, with lessons learned incorporated.',
    determinations: [
      { id: 'IR-4.a', text: 'An incident handling capability consistent with the incident response plan covers preparation, detection and analysis, containment, eradication and recovery.' },
      { id: 'IR-4.c', text: 'Lessons learned from incident handling are incorporated into procedures, training and testing.' },
    ],
    objects: {
      examine: ['Incident response plan', 'Incident records', 'Post-incident review records'],
      interview: ['Incident response team members'],
      test: ['Tabletop or simulated incident walkthrough'],
    },
  },
  {
    id: 'RA-5', title: 'Vulnerability Monitoring and Scanning', family: 'Risk Assessment',
    summary: 'Systems and hosted applications are monitored and scanned for vulnerabilities at a defined frequency and when new vulnerabilities are identified; results are analysed, remediated and shared.',
    determinations: [
      { id: 'RA-5.a', text: 'Vulnerability scanning is performed at the defined frequency and when new vulnerabilities potentially affecting the system are reported.' },
      { id: 'RA-5.d', text: 'Legitimate vulnerabilities are remediated within the defined response times.' },
    ],
    objects: {
      examine: ['Scanning schedule', 'Scan reports', 'Remediation tracking records'],
      interview: ['Personnel with vulnerability management responsibilities'],
      test: ['Confirm scanner coverage for a sample asset and remediation ticket linkage'],
    },
  },
  {
    id: 'SC-7', title: 'Boundary Protection', family: 'System and Communications Protection',
    summary: 'Communications at external and key internal managed interfaces are monitored and controlled, with publicly accessible components separated from internal networks.',
    determinations: [
      { id: 'SC-7.a', text: 'Communications at external managed interfaces and key internal managed interfaces are monitored and controlled.' },
      { id: 'SC-7.b', text: 'Publicly accessible system components are on subnetworks that are physically or logically separated from internal networks.' },
    ],
    objects: {
      examine: ['Network architecture diagram', 'Firewall rule base export', 'Boundary device monitoring configuration'],
      interview: ['Network and security engineers'],
      test: ['Attempt a disallowed connection across the boundary from a test host; confirm block and log'],
    },
  },
  {
    id: 'SI-2', title: 'Flaw Remediation', family: 'System and Information Integrity',
    summary: 'System flaws are identified, reported and corrected; updates are tested before installation and installed within defined time periods.',
    determinations: [
      { id: 'SI-2.a', text: 'System flaws are identified, reported and corrected.' },
      { id: 'SI-2.c', text: 'Security-relevant updates are installed within the defined time period of release.' },
    ],
    objects: {
      examine: ['Patch management procedure', 'Patch compliance report', 'Change records for updates'],
      interview: ['Personnel with flaw remediation responsibilities'],
      test: ['Verify a sample component is at the expected patch level'],
    },
  },
];

export const CONTROL_IDS: ReadonlySet<string> = new Set(CATALOG.map((c) => c.id));
export const METHODS = ['examine', 'interview', 'test'] as const;
