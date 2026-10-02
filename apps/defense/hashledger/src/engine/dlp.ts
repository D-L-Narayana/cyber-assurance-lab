import type { Classification, Label } from './classify';

export type Channel = 'internal_share' | 'email_internal' | 'email_external' | 'usb' | 'cloud_share';
export const CHANNEL_LABEL: Record<Channel, string> = { internal_share: 'Internal file share', email_internal: 'Email to internal recipient', email_external: 'Email to external recipient', usb: 'Removable USB media', cloud_share: 'Public cloud share link' };
export const EXTERNAL_CHANNELS: Channel[] = ['email_external', 'usb', 'cloud_share'];
export interface EgressRequest { id: string; path: string; channel: Channel; actor: string; recipientDomain?: string }
export type Decision = 'allow' | 'block' | 'quarantine';
export interface DlpResult { decision: Decision; ruleId: string; because: string[] }
export interface Policy { partnerDomains: string[]; usbAllowedUpTo: Label; cloudAllowedUpTo: Label }
export const DEFAULT_POLICY: Policy = { partnerDomains: ['partner.example', 'auditor.example'], usbAllowedUpTo: 'internal', cloudAllowedUpTo: 'internal' };
const RANK: Record<Label, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };

export const RULES = [
  { id: 'DLP-RESTRICTED-EGRESS', text: 'Restricted data (identifiers, card numbers, private keys) never leaves on an external channel.' },
  { id: 'DLP-CONF-PARTNER', text: 'Confidential data may be emailed to an allowlisted partner domain; other external recipients are quarantined for review.' },
  { id: 'DLP-REMOVABLE', text: 'USB media accepts data up to the configured label (default: internal).' },
  { id: 'DLP-CLOUD', text: 'Public cloud share links accept data up to the configured label (default: internal).' },
  { id: 'DLP-INTERNAL-OK', text: 'Internal channels accept any label; the event is still recorded.' },
  { id: 'DLP-PUBLIC', text: 'Public data is allowed anywhere.' },
];

export function decideEgress(req: EgressRequest, cls: Classification, policy: Policy): DlpResult {
  const sig = cls.signals.length ? `signals: ${cls.signals.map(s => s.id).join(', ')}` : 'no sensitive signals detected';
  const base = [`file classified ${cls.label} (${sig})`, `channel: ${CHANNEL_LABEL[req.channel]}`];
  if (cls.label === 'public') return { decision: 'allow', ruleId: 'DLP-PUBLIC', because: [...base, 'public data may leave on any channel'] };
  if (!EXTERNAL_CHANNELS.includes(req.channel)) return { decision: 'allow', ruleId: 'DLP-INTERNAL-OK', because: [...base, 'internal channel; recorded for audit'] };
  if (cls.label === 'restricted') return { decision: 'block', ruleId: 'DLP-RESTRICTED-EGRESS', because: [...base, 'restricted data is never permitted on external channels'] };
  if (req.channel === 'email_external') {
    const dom = (req.recipientDomain ?? '').toLowerCase();
    if (cls.label === 'confidential') {
      if (dom && policy.partnerDomains.includes(dom)) return { decision: 'allow', ruleId: 'DLP-CONF-PARTNER', because: [...base, `recipient domain ${dom} is an allowlisted partner`] };
      return { decision: 'quarantine', ruleId: 'DLP-CONF-PARTNER', because: [...base, dom ? `recipient domain ${dom} is not in the partner allowlist [${policy.partnerDomains.join(', ')}]` : 'no recipient domain supplied', 'held for reviewer release'] };
    }
    return { decision: 'allow', ruleId: 'DLP-CONF-PARTNER', because: [...base, 'internal-labelled data may be emailed externally under this policy'] };
  }
  const cap = req.channel === 'usb' ? policy.usbAllowedUpTo : policy.cloudAllowedUpTo;
  const rule = req.channel === 'usb' ? 'DLP-REMOVABLE' : 'DLP-CLOUD';
  if (RANK[cls.label] <= RANK[cap]) return { decision: 'allow', ruleId: rule, because: [...base, `label ${cls.label} is within the channel cap (${cap})`] };
  return { decision: 'block', ruleId: rule, because: [...base, `label ${cls.label} exceeds the channel cap (${cap})`] };
}
