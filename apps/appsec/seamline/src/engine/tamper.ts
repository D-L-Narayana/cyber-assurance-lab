import type { Message, OrderItem, Scenario, Tamper, TamperResult } from './types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * The tamper layer stands between the client and the server and edits a message in transit.
 * It models an attacker who controls the device or the channel: nothing here is a server-side flaw;
 * the server's job is to make these edits harmless.
 */
export function applyTamper(original: Message, tamper: Tamper, scenario: Scenario, earlier: { stepId: string; message: Message }[]): TamperResult {
  const message = clone(original);
  const changed: string[] = [];
  switch (tamper.kind) {
    case 'price-rewrite': {
      const items = (message.payload.items as OrderItem[] | undefined) ?? [];
      items.forEach((it, i) => { it.unitPrice = 0.01; changed.push(`items[${i}].unitPrice`); });
      message.payload.total = Number((items.reduce((s, it) => s + it.qty * 0.01, 0)).toFixed(2));
      changed.push('total');
      return { message, changedFields: changed, note: 'Unit prices and total rewritten to 0.01 per item before transmission.' };
    }
    case 'coupon-inflate':
      message.payload.discountPercent = 95; changed.push('discountPercent');
      return { message, changedFields: changed, note: 'Discount percent inflated to 95 while keeping the real coupon code.' };
    case 'points-inflate':
      message.payload.points = 1; changed.push('points');
      return { message, changedFields: changed, note: 'Points cost of the reward lowered to 1.' };
    case 'role-escalate':
      message.payload.role = 'staff'; changed.push('role');
      return { message, changedFields: changed, note: 'A "role" field the client never legitimately sends is added with the value staff.' };
    case 'other-user-object': {
      const own = message.payload.orderId;
      const other = scenario.orders.find((o) => o.user !== message.user);
      if (other) { message.payload.orderId = other.id; changed.push('orderId'); }
      return { message, changedFields: changed, note: `orderId changed from ${String(own)} to ${other?.id ?? '(none available)'}, which belongs to another user.` };
    }
    case 'backdate': {
      message.ts = new Date(Date.parse(message.ts) - 10 * 60_000).toISOString().replace(/\.000Z$/, 'Z'); changed.push('ts');
      return { message, changedFields: changed, note: 'Client timestamp moved ten minutes into the past.' };
    }
    case 'quantity-rewrite': {
      // The attacker edits the first line's quantity (default -1: a negative quantity turns the order into a credit) and keeps
      // the client's own unit prices, so the total is "consistent" with the lines — only the quantity bound is violated.
      const items = (message.payload.items as OrderItem[] | undefined) ?? [];
      const value = tamper.value ?? -1;
      if (items.length === 0) return { message, changedFields: [], note: 'No order lines to rewrite; message sent unchanged.' };
      items[0].qty = value; changed.push('items[0].qty');
      message.payload.total = Number(items.reduce((s, it) => s + it.qty * it.unitPrice, 0).toFixed(2)); changed.push('total');
      return { message, changedFields: changed, note: `Quantity of the first order line (${items[0].sku}) rewritten to ${value}; total recomputed from the client’s own unit prices.` };
    }
    case 'replay': {
      const ref = earlier.find((e) => e.stepId === tamper.of);
      if (!ref) return { message, changedFields: [], note: `Replay target ${tamper.of} not found; message sent unchanged.` };
      message.nonce = ref.message.nonce; changed.push('nonce');
      message.payload = clone(ref.message.payload); changed.push('payload');
      return { message, changedFields: changed, note: `Nonce and payload copied from ${tamper.of}; only the timestamp is new.` };
    }
  }
}
