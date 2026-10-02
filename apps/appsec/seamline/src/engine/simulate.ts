import { applyTamper } from './tamper';
import type { Check, Decision, Divergence, Finding, Invariant, Message, Mode, OrderItem, Origin, Role, Run, Scalar, Scenario, Step, StepResult } from './types';

const money = (n: number) => Number(n.toFixed(2));
const WINDOW_SECONDS = 120;

/** Findings are keyed by the invariant that was violated, never by the script's tamper label. */
const FINDINGS: Record<Invariant, Omit<Finding, 'detail'>> = {
  'object-ownership': { kind: 'cross-user-read', cwe: 'CWE-639', cweName: 'Authorization Bypass Through User-Controlled Key', title: 'Server returned another user\u2019s order', severity: 'high' },
  'role-from-session': { kind: 'client-asserted-role', cwe: 'CWE-269', cweName: 'Improper Privilege Management', title: 'Server stored a role asserted by the client', severity: 'high' },
  'nonce-single-use': { kind: 'replay-accepted', cwe: 'CWE-294', cweName: 'Authentication Bypass by Capture-replay', title: 'Message with an already-used nonce was processed again', severity: 'high' },
  'timestamp-window': { kind: 'stale-timestamp-accepted', cwe: 'CWE-294', cweName: 'Authentication Bypass by Capture-replay', title: 'Message outside the freshness window was accepted', severity: 'medium' },
  'price-from-catalog': { kind: 'client-side-pricing', cwe: 'CWE-602', cweName: 'Client-Side Enforcement of Server-Side Security', title: 'Server charged a client-supplied price that differs from the catalog', severity: 'high' },
  'coupon-from-table': { kind: 'client-side-discount', cwe: 'CWE-602', cweName: 'Client-Side Enforcement of Server-Side Security', title: 'Server applied a client-supplied discount that differs from the coupon table', severity: 'high' },
  'points-from-table': { kind: 'client-side-points', cwe: 'CWE-602', cweName: 'Client-Side Enforcement of Server-Side Security', title: 'Server deducted a client-supplied points cost that differs from the reward table', severity: 'high' },
};
const INVARIANT_PRIORITY: Invariant[] = ['object-ownership', 'role-from-session', 'nonce-single-use', 'timestamp-window', 'price-from-catalog', 'coupon-from-table', 'points-from-table'];

interface ServerState { balances: Record<string, number>; roles: Record<string, Role>; names: Record<string, string>; nonces: Set<string> }

function flattenOrigins(payload: Message['payload'], mode: Mode): Record<string, Origin> {
  const origins: Record<string, Origin> = {};
  const serverOwned = new Set(['unitPrice', 'total', 'discountPercent', 'points', 'orderTotal']);
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'items' && Array.isArray(v)) {
      (v as OrderItem[]).forEach((_, i) => { origins[`items[${i}].sku`] = 'client-controlled'; origins[`items[${i}].qty`] = 'client-controlled'; origins[`items[${i}].unitPrice`] = mode === 'enforcing' ? 'server-derived' : 'client-controlled'; });
    } else if (k === 'role') origins[k] = mode === 'enforcing' ? 'session-derived' : 'client-controlled';
    else origins[k] = mode === 'enforcing' && serverOwned.has(k) ? 'server-derived' : 'client-controlled';
  }
  return origins;
}

export function runScenario(scenario: Scenario, mode: Mode): Run {
  const enforcing = mode === 'enforcing';
  const catalog = new Map(scenario.catalog.map((c) => [c.sku, c]));
  const coupons = new Map(scenario.coupons.map((c) => [c.code, c.percent]));
  const rewards = new Map(scenario.rewards.map((r) => [r.id, r.points]));
  const orders = new Map(scenario.orders.map((o) => [o.id, o]));
  const users = new Map(scenario.users.map((u) => [u.id, u]));
  const state: ServerState = {
    balances: { ...scenario.balances }, roles: Object.fromEntries(scenario.users.map((u) => [u.id, u.role])), names: Object.fromEntries(scenario.users.map((u) => [u.id, u.label])), nonces: new Set(),
  };
  const base = Date.parse(scenario.baseTime);
  const history: { stepId: string; message: Message }[] = [];
  const steps: StepResult[] = [];

  for (const step of scenario.steps) {
    const sent: Message = { user: step.client.user, event: step.client.event, nonce: step.client.nonce, ts: new Date(base + step.client.tOffset * 1000).toISOString().replace(/\.000Z$/, 'Z'), payload: JSON.parse(JSON.stringify(step.client.payload)) };
    const tampered = step.tamper ? applyTamper(sent, step.tamper, scenario, history) : { message: sent, changedFields: [], note: '' };
    const received = tampered.message;
    const serverNow = base + step.client.tOffset * 1000;
    const checks: Check[] = [];
    const serverView: Record<string, Scalar> = {};
    const divergences: Divergence[] = [];
    let neutralized = false;
    const user = users.get(received.user)!;
    checks.push({ name: 'session-valid', ran: true, passed: true, detail: `Token resolves to ${user.id} (role from session: ${state.roles[user.id]}).` });

    // Freshness and single use are generic boundary controls.
    const drift = Math.abs(serverNow - Date.parse(received.ts)) / 1000;
    checks.push(enforcing
      ? { name: 'timestamp-window', ran: true, passed: drift <= WINDOW_SECONDS, detail: `Client timestamp differs from server time by ${drift}s; window is ±${WINDOW_SECONDS}s.` }
      : { name: 'timestamp-window', ran: false, passed: true, detail: 'Not checked: trusting server accepts any client timestamp.' });
    if (drift > WINDOW_SECONDS) divergences.push({ invariant: 'timestamp-window', claimed: received.ts, truth: new Date(serverNow).toISOString().replace(/\.000Z$/, 'Z') });
    const nonceSeen = state.nonces.has(received.nonce);
    if (nonceSeen) divergences.push({ invariant: 'nonce-single-use', claimed: received.nonce, truth: 'already consumed' });
    // Event-specific claims compared with server truth, independent of the policy in force.
    switch (received.event) {
      case 'place-order': {
        const items = received.payload.items as OrderItem[];
        const catalogTotal = money(items.reduce((sum, it) => sum + it.qty * (catalog.get(it.sku)?.price ?? 0), 0));
        if (money(received.payload.total as number) !== catalogTotal || items.some((it) => it.unitPrice !== catalog.get(it.sku)?.price)) divergences.push({ invariant: 'price-from-catalog', claimed: (received.payload.total as number).toFixed(2), truth: catalogTotal.toFixed(2) });
        break;
      }
      case 'apply-coupon': {
        const table = coupons.get(String(received.payload.code));
        if (table === undefined || table !== received.payload.discountPercent) divergences.push({ invariant: 'coupon-from-table', claimed: String(received.payload.discountPercent), truth: table === undefined ? 'unknown coupon' : String(table) });
        break;
      }
      case 'redeem-reward': {
        const table = rewards.get(String(received.payload.rewardId));
        if (table === undefined || table !== received.payload.points) divergences.push({ invariant: 'points-from-table', claimed: String(received.payload.points), truth: table === undefined ? 'unknown reward' : String(table) });
        break;
      }
      case 'update-profile': {
        const claimed = received.payload.role as string | undefined;
        if (claimed !== undefined && claimed !== state.roles[user.id]) divergences.push({ invariant: 'role-from-session', claimed, truth: state.roles[user.id] });
        break;
      }
      case 'view-order': {
        const order = orders.get(String(received.payload.orderId));
        if (order && order.user !== user.id) divergences.push({ invariant: 'object-ownership', claimed: `order of ${order.user}`, truth: `session ${user.id}` });
        break;
      }
    }
    checks.push(enforcing
      ? { name: 'nonce-single-use', ran: true, passed: !nonceSeen, detail: nonceSeen ? `Nonce ${received.nonce} was already consumed.` : `Nonce ${received.nonce} is fresh; recorded.` }
      : { name: 'nonce-single-use', ran: false, passed: true, detail: 'Not checked: trusting server keeps no nonce ledger.' });
    const genericFailed = checks.some((c) => c.ran && !c.passed);

    if (!genericFailed) {
      switch (received.event) {
        case 'place-order': {
          const items = received.payload.items as OrderItem[];
          const clientTotal = received.payload.total as number;
          const catalogTotal = money(items.reduce((s, it) => s + it.qty * (catalog.get(it.sku)?.price ?? 0), 0));
          if (enforcing) {
            const differs = money(clientTotal) !== catalogTotal || items.some((it) => it.unitPrice !== catalog.get(it.sku)?.price);
            checks.push({ name: 'price-from-catalog', ran: true, passed: true, detail: differs ? `Client claimed ${clientTotal.toFixed(2)}; catalog says ${catalogTotal.toFixed(2)}. Client figures discarded.` : `Client total matches catalog (${catalogTotal.toFixed(2)}).` });
            neutralized = differs;
            serverView.total = catalogTotal; serverView.pricedFrom = 'catalog';
          } else {
            checks.push({ name: 'price-from-catalog', ran: false, passed: true, detail: 'Not checked: trusting server bills the total the client sent.' });
            serverView.total = money(clientTotal); serverView.pricedFrom = 'client';
          }
          break;
        }
        case 'apply-coupon': {
          const code = String(received.payload.code);
          const clientPct = received.payload.discountPercent as number;
          const tablePct = coupons.get(code);
          if (enforcing) {
            const known = tablePct !== undefined;
            checks.push({ name: 'coupon-from-table', ran: true, passed: known, detail: known ? (tablePct !== clientPct ? `Client asked for ${clientPct}%; coupon table grants ${tablePct}%.` : `${code} grants ${tablePct}% per coupon table.`) : `Unknown coupon ${code}.` });
            if (known) { neutralized = tablePct !== clientPct; serverView.discountPercent = tablePct; }
          } else {
            checks.push({ name: 'coupon-from-table', ran: false, passed: true, detail: 'Not checked: trusting server applies whatever percent the client sent.' });
            serverView.discountPercent = clientPct;
          }
          if (typeof serverView.discountPercent === 'number') serverView.discountedTotal = money((received.payload.orderTotal as number) * (1 - serverView.discountPercent / 100));
          break;
        }
        case 'redeem-reward': {
          const id = String(received.payload.rewardId);
          const clientPoints = received.payload.points as number;
          const tablePoints = rewards.get(id) ?? 0;
          const cost = enforcing ? tablePoints : clientPoints;
          const balance = state.balances[user.id] ?? 0;
          if (enforcing) {
            checks.push({ name: 'points-from-table', ran: true, passed: true, detail: tablePoints !== clientPoints ? `Client claimed ${clientPoints} points; reward table says ${tablePoints}.` : `Reward costs ${tablePoints} points per table.` });
            if (tablePoints !== clientPoints) neutralized = true;
            checks.push({ name: 'sufficient-balance', ran: true, passed: balance >= cost, detail: `Balance ${balance}, cost ${cost}.` });
          } else {
            checks.push({ name: 'points-from-table', ran: false, passed: true, detail: 'Not checked: trusting server deducts the points the client stated.' });
            checks.push({ name: 'sufficient-balance', ran: false, passed: true, detail: 'Not checked: balance may go negative.' });
          }
          const failed = checks.some((c) => c.ran && !c.passed);
          if (!failed) state.balances[user.id] = balance - cost;
          serverView.pointsCharged = failed ? 0 : cost; serverView.balanceAfter = state.balances[user.id] ?? 0;
          break;
        }
        case 'update-profile': {
          const roleField = received.payload.role as string | undefined;
          state.names[user.id] = String(received.payload.displayName);
          if (enforcing) {
            checks.push({ name: 'role-from-session', ran: true, passed: true, detail: roleField ? `Client sent role="${roleField}"; ignored, role stays ${state.roles[user.id]}.` : 'No role field; role unchanged.' });
            neutralized = roleField !== undefined;
          } else {
            checks.push({ name: 'role-from-session', ran: false, passed: true, detail: roleField ? `Client sent role="${roleField}"; stored as-is.` : 'No role field sent.' });
            if (roleField === 'customer' || roleField === 'staff') state.roles[user.id] = roleField;
          }
          serverView.displayName = state.names[user.id]; serverView.role = state.roles[user.id];
          break;
        }
        case 'view-order': {
          const order = orders.get(String(received.payload.orderId));
          const owns = !!order && order.user === user.id;
          if (enforcing) checks.push({ name: 'object-ownership', ran: true, passed: owns, detail: owns ? `Order ${order!.id} belongs to ${user.id}.` : `Order ${String(received.payload.orderId)} belongs to ${order?.user ?? 'nobody'}, not ${user.id}.` });
          else checks.push({ name: 'object-ownership', ran: false, passed: true, detail: 'Not checked: trusting server returns any order id it is given.' });
          const served = !!order && (owns || !enforcing);
          serverView.orderId = String(received.payload.orderId); serverView.served = served;
          if (served) { serverView.owner = order!.user; serverView.total = order!.total; }
          break;
        }
      }
    }
    // The nonce ledger is server truth in both modes; only the *check* depends on policy. A rejected message still
    // consumes its nonce (conservative: a legitimate retry must use a fresh nonce) — documented design choice.
    if (!nonceSeen) state.nonces.add(received.nonce);
    // A rejected redemption still reports the (unchanged) balance so the ledger can be read step by step.
    if (received.event === 'redeem-reward' && serverView.balanceAfter === undefined) { serverView.pointsCharged = 0; serverView.balanceAfter = state.balances[user.id] ?? 0; }

    const rejected = checks.some((c) => c.ran && !c.passed);
    const decision: Decision = rejected ? 'rejected' : neutralized ? 'neutralized' : 'accepted';
    // A finding exists only when the server accepted a message whose claims diverge from server truth.
    const landed = decision === 'accepted' && divergences.length > 0;
    const primary = landed ? INVARIANT_PRIORITY.find((inv) => divergences.some((d) => d.invariant === inv))! : undefined;
    const finding: Finding | undefined = primary ? {
      ...FINDINGS[primary],
      detail: `Claimed ${divergences.map((d) => `${d.invariant}: ${d.claimed} (server truth: ${d.truth})`).join('; ')}. The server processed it as sent: ${Object.entries(serverView).map(([k, v]) => `${k}=${String(v)}`).join(', ')}.${step.tamper ? ` Script annotation: ${step.tamper.kind} — ${tampered.note}` : ' No tamper annotation on this step: the client itself sent the divergent values.'}`,
    } : undefined;
    const narrative = rejected
      ? `Rejected by ${checks.filter((c) => c.ran && !c.passed).map((c) => c.name).join(', ')}.`
      : neutralized ? `Accepted, but client-supplied figures were replaced with server-derived values (${Object.entries(serverView).map(([k, v]) => `${k}=${String(v)}`).join(', ')}).`
      : `Accepted as sent (${Object.entries(serverView).map(([k, v]) => `${k}=${String(v)}`).join(', ')}).`;

    history.push({ stepId: step.id, message: sent });
    steps.push({ stepId: step.id, label: step.label, sent, received, ...(step.tamper ? { tamper: step.tamper } : {}), changedFields: tampered.changedFields, fieldOrigins: flattenOrigins(received.payload, mode), checks, divergences, decision, serverView, ...(finding ? { finding } : {}), narrative });
  }
  const summary = { steps: steps.length, accepted: steps.filter((s) => s.decision === 'accepted').length, neutralized: steps.filter((s) => s.decision === 'neutralized').length, rejected: steps.filter((s) => s.decision === 'rejected').length, findings: steps.filter((s) => s.finding).length };
  return { mode, steps, summary };
}

export const stepById = (run: Run, id: string): StepResult | undefined => run.steps.find((s) => s.stepId === id);
export type { Step };
