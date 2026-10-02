import { EVENT_KINDS, TAMPER_KINDS } from './types';
import type { CatalogItem, EventKind, OrderItem, Payload, Scalar, Scenario, Step, Tamper, TamperKind, User } from './types';

export const LIMITS = { maxBytes: 96 * 1024, maxSteps: 60, maxUsers: 12, maxCatalog: 40, maxItemsPerOrder: 10, maxPayloadKeys: 12, maxStringLength: 120, maxOffsetSeconds: 86_400, maxDepth: 8, maxListLength: 500 } as const;

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.maxStringLength;
const money = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000;
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v));
export const byteLength = (t: string) => new TextEncoder().encode(t).length;

function structuralProblem(root: unknown): string | null {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++visited > 50_000) return 'Scenario has too many values.';
    if (depth > LIMITS.maxDepth) return `Nesting exceeds ${LIMITS.maxDepth}.`;
    if (Array.isArray(value)) { if (value.length > LIMITS.maxListLength) return `A list exceeds ${LIMITS.maxListLength}.`; for (const v of value) stack.push({ value: v, depth: depth + 1 }); }
    else if (value && typeof value === 'object') { const keys = Object.keys(value as object); if (keys.length > LIMITS.maxListLength) return 'An object has too many keys.'; for (const k of keys) stack.push({ value: (value as Record<string, unknown>)[k], depth: depth + 1 }); }
    else if (typeof value === 'number' && !Number.isFinite(value)) return 'Numbers must be finite.';
  }
  return null;
}

export type ScenarioResult = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

export function parseScenario(text: string): ScenarioResult {
  if (byteLength(text) > LIMITS.maxBytes) return { ok: false, errors: [`Scenario exceeds ${LIMITS.maxBytes} bytes (UTF-8).`] };
  try { return validateScenario(JSON.parse(text)); } catch { return { ok: false, errors: ['Scenario is not valid JSON.'] }; }
}

const PAYLOAD_SHAPES: Record<EventKind, { required: string[]; optional: string[] }> = {
  'place-order': { required: ['items', 'total'], optional: [] },
  'apply-coupon': { required: ['code', 'discountPercent', 'orderTotal'], optional: [] },
  'redeem-reward': { required: ['rewardId', 'points'], optional: [] },
  'update-profile': { required: ['displayName'], optional: ['role'] },
  'view-order': { required: ['orderId'], optional: [] },
};

function validatePayload(event: EventKind, raw: unknown, catalog: Map<string, CatalogItem>, errors: string[], where: string): Payload {
  const out: Payload = {};
  if (!isObj(raw)) { errors.push(`${where}: payload must be an object.`); return out; }
  const shape = PAYLOAD_SHAPES[event];
  const keys = Object.keys(raw);
  if (keys.length > LIMITS.maxPayloadKeys) errors.push(`${where}: too many payload keys.`);
  for (const k of shape.required) if (!(k in raw)) errors.push(`${where}: payload.${k} is required for ${event}.`);
  for (const k of keys) {
    if (![...shape.required, ...shape.optional].includes(k)) { errors.push(`${where}: payload.${k} is not allowed for ${event}.`); continue; }
    const v = raw[k];
    if (k === 'items') {
      if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.maxItemsPerOrder) { errors.push(`${where}: items must hold 1–${LIMITS.maxItemsPerOrder} lines.`); continue; }
      const items: OrderItem[] = [];
      for (const it of v) {
        if (!isObj(it) || !str(it.sku) || !catalog.has(it.sku) || !Number.isInteger(it.qty) || (it.qty as number) < 1 || (it.qty as number) > 99 || !money(it.unitPrice)) { errors.push(`${where}: malformed order line.`); continue; }
        items.push({ sku: it.sku, qty: it.qty as number, unitPrice: it.unitPrice as number });
      }
      out.items = items;
    } else if (['total', 'discountPercent', 'orderTotal', 'points'].includes(k)) {
      if (!money(v)) errors.push(`${where}: payload.${k} must be a finite non-negative number.`); else out[k] = v;
    } else if (typeof v === 'string') {
      if (!str(v)) errors.push(`${where}: payload.${k} too long.`); else out[k] = v;
    } else errors.push(`${where}: payload.${k} has an unsupported type.`);
  }
  return out;
}

export function validateScenario(input: unknown): ScenarioResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['Scenario must be a JSON object.'] };
  const structural = structuralProblem(input);
  if (structural) return { ok: false, errors: [structural] };
  if (input.schema !== 'seamline.scenario/1') errors.push('schema must be "seamline.scenario/1".');
  if (!str(input.name) || !input.name) errors.push('name is required.');
  if (!isoDate(input.baseTime)) errors.push('baseTime must be an ISO-8601 UTC timestamp.');

  const users: User[] = [];
  const userIds = new Set<string>();
  const rawUsers = Array.isArray(input.users) ? input.users : [];
  if (rawUsers.length === 0 || rawUsers.length > LIMITS.maxUsers) errors.push(`users must contain 1–${LIMITS.maxUsers} entries.`);
  for (const u of rawUsers.slice(0, LIMITS.maxUsers)) {
    if (!isObj(u) || !str(u.id) || !ID.test(u.id) || !str(u.label) || (u.role !== 'customer' && u.role !== 'staff') || !str(u.token) || !ID.test(u.token)) { errors.push('user entries need id, label, role customer|staff and token.'); continue; }
    if (userIds.has(u.id)) errors.push(`duplicate user ${u.id}.`);
    userIds.add(u.id);
    users.push({ id: u.id, label: u.label, role: u.role, token: u.token });
  }

  const catalog: CatalogItem[] = [];
  const catalogMap = new Map<string, CatalogItem>();
  const rawCatalog = Array.isArray(input.catalog) ? input.catalog : [];
  if (rawCatalog.length === 0 || rawCatalog.length > LIMITS.maxCatalog) errors.push(`catalog must contain 1–${LIMITS.maxCatalog} items.`);
  for (const c of rawCatalog.slice(0, LIMITS.maxCatalog)) {
    if (!isObj(c) || !str(c.sku) || !ID.test(c.sku) || !str(c.name) || !money(c.price)) { errors.push('catalog entries need sku, name and a finite non-negative price.'); continue; }
    if (catalogMap.has(c.sku)) errors.push(`duplicate sku ${c.sku}.`);
    const item = { sku: c.sku, name: c.name, price: c.price };
    catalog.push(item); catalogMap.set(c.sku, item);
  }

  const coupons: Scenario['coupons'] = [];
  for (const c of (Array.isArray(input.coupons) ? input.coupons : []).slice(0, LIMITS.maxCatalog)) {
    if (!isObj(c) || !str(c.code) || !/^[A-Z0-9]{3,16}$/.test(c.code) || typeof c.percent !== 'number' || !Number.isInteger(c.percent) || c.percent < 0 || c.percent > 100) { errors.push('coupon entries need an uppercase code and an integer percent 0–100.'); continue; }
    coupons.push({ code: c.code, percent: c.percent });
  }
  const orders: Scenario['orders'] = [];
  const orderIds = new Set<string>();
  for (const o of (Array.isArray(input.orders) ? input.orders : []).slice(0, LIMITS.maxCatalog)) {
    if (!isObj(o) || !str(o.id) || !ID.test(o.id) || !str(o.user) || !userIds.has(o.user) || !money(o.total)) { errors.push('order entries need id, a known user and a total.'); continue; }
    if (orderIds.has(o.id)) errors.push(`duplicate order ${o.id}.`);
    orderIds.add(o.id); orders.push({ id: o.id, user: o.user, total: o.total });
  }
  const rewards: Scenario['rewards'] = [];
  const rewardIds = new Set<string>();
  for (const r of (Array.isArray(input.rewards) ? input.rewards : []).slice(0, LIMITS.maxCatalog)) {
    if (!isObj(r) || !str(r.id) || !ID.test(r.id) || !money(r.points)) { errors.push('reward entries need id and points.'); continue; }
    rewardIds.add(r.id); rewards.push({ id: r.id, points: r.points });
  }
  const balances: Record<string, number> = {};
  if (isObj(input.balances)) for (const [k, v] of Object.entries(input.balances)) { if (!userIds.has(k) || !money(v)) errors.push(`balance for ${k} is invalid.`); else balances[k] = v as number; }

  const steps: Step[] = [];
  const stepIds = new Set<string>();
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length === 0 || rawSteps.length > LIMITS.maxSteps) errors.push(`steps must contain 1–${LIMITS.maxSteps} entries.`);
  let lastOffset = -1;
  for (const [i, s] of rawSteps.slice(0, LIMITS.maxSteps).entries()) {
    const where = `step ${i + 1}`;
    if (!isObj(s) || !str(s.id) || !ID.test(s.id) || !str(s.label) || !isObj(s.client)) { errors.push(`${where}: needs id, label and client.`); continue; }
    if (stepIds.has(s.id)) errors.push(`${where}: duplicate step id ${s.id}.`);
    const c = s.client;
    if (!str(c.user) || !userIds.has(c.user)) errors.push(`${where}: client.user ${String(c.user)} is not a known user.`);
    if (!EVENT_KINDS.includes(c.event as EventKind)) errors.push(`${where}: unknown event ${String(c.event)}.`);
    if (!str(c.nonce) || !ID.test(c.nonce)) errors.push(`${where}: nonce must be a short identifier.`);
    if (typeof c.tOffset !== 'number' || !Number.isFinite(c.tOffset) || c.tOffset < 0 || c.tOffset > LIMITS.maxOffsetSeconds) errors.push(`${where}: tOffset must be 0–${LIMITS.maxOffsetSeconds} seconds.`);
    else if (c.tOffset < lastOffset) errors.push(`${where}: steps must be in non-decreasing time order.`);
    else lastOffset = c.tOffset;
    const payload = EVENT_KINDS.includes(c.event as EventKind) ? validatePayload(c.event as EventKind, c.payload, catalogMap, errors, where) : {};
    let tamper: Tamper | undefined;
    if (s.tamper !== undefined) {
      if (!isObj(s.tamper) || !TAMPER_KINDS.includes(s.tamper.kind as TamperKind)) errors.push(`${where}: unknown tamper kind ${isObj(s.tamper) ? String(s.tamper.kind) : ''}.`);
      else {
        tamper = { kind: s.tamper.kind as TamperKind };
        if (tamper.kind === 'replay') {
          if (!str(s.tamper.of) || !stepIds.has(s.tamper.of)) errors.push(`${where}: replay must reference an earlier step id.`);
          else tamper.of = s.tamper.of;
        }
        if (tamper.kind === 'other-user-object' && c.event !== 'view-order') errors.push(`${where}: other-user-object applies to view-order only.`);
        if (tamper.kind === 'price-rewrite' && c.event !== 'place-order') errors.push(`${where}: price-rewrite applies to place-order only.`);
      }
    }
    stepIds.add(s.id);
    steps.push({ id: s.id, label: s.label, client: { user: String(c.user), event: c.event as EventKind, nonce: String(c.nonce), tOffset: Number(c.tOffset), payload }, ...(tamper ? { tamper } : {}) });
  }
  // Payload references that need the full tables.
  for (const s of steps) {
    const p = s.client.payload as Record<string, Scalar>;
    if (s.client.event === 'view-order' && !orderIds.has(String(p.orderId))) errors.push(`step ${s.id}: orderId ${String(p.orderId)} is not a known order.`);
    if (s.client.event === 'redeem-reward' && !rewardIds.has(String(p.rewardId))) errors.push(`step ${s.id}: rewardId ${String(p.rewardId)} is not a known reward.`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, scenario: { schema: 'seamline.scenario/1', name: input.name as string, baseTime: input.baseTime as string, users, catalog, coupons, orders, rewards, balances, steps } };
}
