import type { Scenario } from './scenario';
/* Synthetic ransomware-like tabletop. No malware, no real indicators, fictional organisation "Northwind Example Ltd". */
export const RANSOMWARE_TABLETOP: Scenario = {
  id: 'ransomware-northwind-v1', title: 'Encrypted file server at Northwind Example', version: 1, startAt: '2026-10-06T09:00:00Z',
  description: 'A Monday-morning file-server encryption event with an extortion note. Five roles make decisions against SLA clocks while injects arrive. Everything is fictional.',
  roles: [
    { id: 'ic', name: 'Incident commander' }, { id: 'itops', name: 'IT operations' }, { id: 'comms', name: 'Communications' }, { id: 'legal', name: 'Legal & privacy' }, { id: 'exec', name: 'Executive sponsor' },
  ],
  injects: [
    { id: 'i-alert', atMinute: 0, role: 'ic', title: 'EDR alert: mass file renames on FS-01', body: 'Endpoint detection reports 12,000 file renames with a new extension on the finance file server FS-01 in four minutes. One user reports a text file "HOW_TO_RECOVER.txt" on their share.',
      decision: { id: 'd-isolate', prompt: 'How do you respond to FS-01?', slaMinutes: 15, options: [
        { id: 'isolate', label: 'Isolate FS-01 from the network now', score: 10, note: 'Containment first limits spread; forensics continue on the isolated host.', tasks: [{ id: 't-isolate', role: 'itops', title: 'Confirm FS-01 network isolation and preserve memory image', dueInMinutes: 20 }, { id: 't-scope', role: 'itops', title: 'Query EDR for the same extension on other hosts', dueInMinutes: 30 }], unlocks: [{ injectId: 'i-spread-check', afterMinutes: 20 }] },
        { id: 'observe', label: 'Keep FS-01 online and observe for 30 minutes', score: 0, note: 'Observation without containment lets encryption and lateral movement continue.', unlocks: [{ injectId: 'i-spread', afterMinutes: 25 }] },
        { id: 'poweroff', label: 'Hard power-off FS-01', score: 4, note: 'Stops encryption but destroys volatile evidence and may corrupt the file system.', tasks: [{ id: 't-poweroff-doc', role: 'itops', title: 'Document power-off time and reason for the forensic record', dueInMinutes: 15 }], unlocks: [{ injectId: 'i-spread-check', afterMinutes: 20 }] },
      ] } },
    { id: 'i-declare', atMinute: 10, role: 'ic', title: 'Declare an incident?', body: 'The service desk has 30 tickets about missing files. Nobody outside IT knows yet.',
      decision: { id: 'd-declare', prompt: 'Formally declare a major incident and open the bridge?', slaMinutes: 20, options: [
        { id: 'declare', label: 'Declare, open the bridge, page legal and comms', score: 8, note: 'Early declaration starts the clock for regulatory assessment and aligns messaging.', tasks: [{ id: 't-bridge', role: 'ic', title: 'Open incident bridge and start the decision log', dueInMinutes: 10 }, { id: 't-legal-brief', role: 'legal', title: 'Begin personal-data impact assessment with available facts', dueInMinutes: 60 }] },
        { id: 'wait', label: 'Wait for confirmation that it is ransomware', score: 2, note: 'Delays coordination; the facts already meet the major-incident threshold.' },
      ] } },
    { id: 'i-spread-check', atMinute: null, role: 'itops', title: 'EDR sweep result', body: 'The EDR query finds the same extension on two workstations in finance; both were isolated automatically by policy. No other servers affected.' },
    { id: 'i-spread', atMinute: null, role: 'itops', title: 'Encryption spreading', body: 'HR-FS-02 now shows the same renames. Eight additional shares are affected because FS-01 stayed online.', decision: { id: 'd-late-isolate', prompt: 'Isolate FS-01 and HR-FS-02 now?', slaMinutes: 5, options: [
      { id: 'yes', label: 'Isolate both servers immediately', score: 4, note: 'Late containment; impact is larger than it needed to be.', tasks: [{ id: 't-late-iso', role: 'itops', title: 'Isolate FS-01 and HR-FS-02', dueInMinutes: 10 }] },
      { id: 'no', label: 'Continue observing', score: 0, note: 'Unacceptable; the exercise records this as a critical gap.' },
    ] } },
    { id: 'i-note', atMinute: 25, role: 'legal', title: 'Extortion note analysed', body: 'The note demands payment within 72 hours and claims 40 GB of HR and customer data were copied before encryption. There is no proof of exfiltration yet.',
      decision: { id: 'd-exfil', prompt: 'How do you treat the exfiltration claim?', slaMinutes: 30, options: [
        { id: 'assume', label: 'Treat as credible until disproved; start breach assessment', score: 8, note: 'Regulatory clocks may already be running; assume the worst while verifying.', tasks: [{ id: 't-egress', role: 'itops', title: 'Pull proxy/firewall egress volumes for FS-01 for the last 14 days', dueInMinutes: 90 }, { id: 't-reg', role: 'legal', title: 'Draft notification-readiness memo (facts, unknowns, deadlines)', dueInMinutes: 120 }] },
        { id: 'dismiss', label: 'Dismiss as a bluff until evidence appears', score: 1, note: 'Reasonable attackers often tell the truth about exfiltration; dismissal risks missed deadlines.' },
      ] } },
    { id: 'i-press', atMinute: 40, role: 'comms', title: 'Journalist inquiry', body: 'A trade journalist emails: "We hear Northwind has been hit by ransomware. Comment by 1pm?"',
      decision: { id: 'd-press', prompt: 'What does Communications do?', slaMinutes: 25, options: [
        { id: 'holding', label: 'Send a short holding statement approved by legal', score: 8, note: 'Acknowledges an IT incident, confirms investigation, promises updates; no speculation.', tasks: [{ id: 't-holding', role: 'comms', title: 'Issue holding statement and brief the service desk script', dueInMinutes: 30 }] },
        { id: 'deny', label: 'Deny any incident', score: 0, note: 'Untrue statements destroy credibility and may have legal consequences.' },
        { id: 'silence', label: 'Do not respond', score: 3, note: 'Loses control of the narrative; staff and customers hear it from the press first.' },
      ] } },
    { id: 'i-exec', atMinute: 55, role: 'exec', title: 'Board member asks about paying', body: 'A board member asks whether paying would be faster than restoring.',
      decision: { id: 'd-pay', prompt: 'Recommendation to the executive sponsor?', slaMinutes: 40, options: [
        { id: 'restore', label: 'Recommend restore from backups; engage counsel on any payment question', score: 8, note: 'Backups were tested last quarter; payment decisions need legal and sanctions screening regardless.', tasks: [{ id: 't-restore-test', role: 'itops', title: 'Verify most recent clean backup of FS-01 and estimate restore time', dueInMinutes: 60 }] },
        { id: 'negotiate', label: 'Open negotiation to buy time', score: 3, note: 'Sometimes used by professionals, but outside this organisation\'s playbook and legal review.' },
        { id: 'pay', label: 'Recommend paying', score: 0, note: 'No guarantee of recovery, possible sanctions exposure, funds further crime.' },
      ] } },
    { id: 'i-staff', atMinute: 70, role: 'comms', title: 'Internal rumour', body: 'Staff chat is full of screenshots of the ransom note. Some people are told to "turn everything off".', decision: { id: 'd-staff', prompt: 'Internal message?', slaMinutes: 20, options: [
      { id: 'brief', label: 'All-staff note: what happened, what to do, what not to do', score: 6, note: 'Clear instructions reduce self-inflicted damage and leaks.', tasks: [{ id: 't-staff-note', role: 'comms', title: 'Publish all-staff guidance', dueInMinutes: 20 }] },
      { id: 'nothing', label: 'Say nothing internally yet', score: 1, note: 'Rumours fill the gap.' },
    ] } },
    { id: 'i-wrap', atMinute: 110, role: 'ic', title: 'End of first phase', body: 'Containment holds. Restore planning is under way. Capture lessons before the memory fades.' },
  ],
};
