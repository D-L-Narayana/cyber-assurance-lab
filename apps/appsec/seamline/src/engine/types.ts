export type EventKind = 'place-order' | 'apply-coupon' | 'redeem-reward' | 'update-profile' | 'view-order';
export const EVENT_KINDS: EventKind[] = ['place-order', 'apply-coupon', 'redeem-reward', 'update-profile', 'view-order'];
export type TamperKind = 'price-rewrite' | 'coupon-inflate' | 'replay' | 'role-escalate' | 'other-user-object' | 'backdate' | 'points-inflate';
export const TAMPER_KINDS: TamperKind[] = ['price-rewrite', 'coupon-inflate', 'replay', 'role-escalate', 'other-user-object', 'backdate', 'points-inflate'];
export type Role = 'customer' | 'staff';
export type Mode = 'trusting' | 'enforcing';

export type Scalar = string | number | boolean;
export interface OrderItem { sku: string; qty: number; unitPrice: number }
export type Payload = Record<string, Scalar | OrderItem[]>;

export interface User { id: string; label: string; role: Role; token: string }
export interface CatalogItem { sku: string; name: string; price: number }
export interface Tamper { kind: TamperKind; of?: string }
export interface Step { id: string; label: string; client: { user: string; event: EventKind; nonce: string; tOffset: number; payload: Payload }; tamper?: Tamper }
export interface Scenario {
  schema: 'seamline.scenario/1';
  name: string;
  baseTime: string;
  users: User[];
  catalog: CatalogItem[];
  coupons: { code: string; percent: number }[];
  orders: { id: string; user: string; total: number }[];
  rewards: { id: string; points: number }[];
  balances: Record<string, number>;
  steps: Step[];
}

export interface Message { user: string; event: EventKind; nonce: string; ts: string; payload: Payload }
export interface TamperResult { message: Message; changedFields: string[]; note: string }

export type Origin = 'client-controlled' | 'server-derived' | 'session-derived';
export type Decision = 'accepted' | 'neutralized' | 'rejected';
export interface Check { name: string; ran: boolean; passed: boolean; detail: string }
export interface Finding { kind: string; cwe: string; cweName: string; title: string; detail: string; severity: 'high' | 'medium' | 'low' }
/** A security-relevant claim in the received message that disagrees with what the server itself can establish. */
export type Invariant = 'object-ownership' | 'role-from-session' | 'nonce-single-use' | 'timestamp-window' | 'price-from-catalog' | 'coupon-from-table' | 'points-from-table';
export interface Divergence { invariant: Invariant; claimed: string; truth: string }

export interface StepResult {
  stepId: string;
  label: string;
  sent: Message;
  received: Message;
  tamper?: Tamper;
  changedFields: string[];
  fieldOrigins: Record<string, Origin>;
  checks: Check[];
  divergences: Divergence[];
  decision: Decision;
  serverView: Record<string, Scalar>;
  finding?: Finding;
  narrative: string;
}
export interface Run { mode: Mode; steps: StepResult[]; summary: { steps: number; accepted: number; neutralized: number; rejected: number; findings: number } }
