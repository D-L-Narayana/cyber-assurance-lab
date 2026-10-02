// Graceline exception policy — a custom educational rule set. Every number here is this project's own choice,
// documented in README.md; it is not a published standard.
import type { RiskLevel, Role } from './types';

export interface QuorumRule {
  count: number; // approvals required
  requiredRoles: Role[]; // roles that must appear among the approvals
  description: string;
}

export const POLICY = {
  /** Maximum exception duration from start to expiry, by risk level. */
  maxDurationDays: { critical: 30, high: 90, moderate: 180, low: 365 } as Record<RiskLevel, number>,
  /** Risk levels that must name at least one compensating control before submission. */
  requireCompensating: ['high', 'critical'] as RiskLevel[],
  /** Approval quorum by risk level. */
  quorum: {
    low: { count: 1, requiredRoles: [], description: '1 approval, any role' },
    moderate: { count: 1, requiredRoles: [] as Role[], description: '1 approval, any role' },
    high: { count: 2, requiredRoles: ['risk-owner'], description: '2 approvals including the risk-owner role' },
    critical: { count: 2, requiredRoles: ['risk-owner', 'ciso'], description: '2 approvals: risk-owner and ciso' },
  } as Record<RiskLevel, QuorumRule>,
  /** Renewals allowed before a new exception must be raised. */
  maxRenewals: 2,
  /** Days before expiry when an active exception is flagged as expiring. */
  expiringWindowDays: 14,
  /** Days after expiry before an unclosed exception escalates. */
  escalationGraceDays: 14,
  /** Minimum text lengths that count as substantive. */
  minJustification: 30,
  minClosureEvidence: 20,
  /** Priority weights. */
  riskWeight: { critical: 4, high: 3, moderate: 2, low: 1 } as Record<RiskLevel, number>,
  compensatingRelief: 0.7,
} as const;

export const POLICY_NOTE =
  'Durations, quorum, separation-of-duties, renewal caps, grace windows and priority weights are a custom educational policy defined in this project; adapt them to a real organisation\'s standards before any use.';
