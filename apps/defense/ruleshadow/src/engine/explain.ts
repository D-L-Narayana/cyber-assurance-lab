import { parseCidr, parsePorts, addressCount } from './net';
import type { Rule } from './rules';

const n = (x: number) => x.toLocaleString('en-US');
function where(cidr: string): string {
  const iv = parseCidr(cidr); if (!iv) return cidr;
  const c = addressCount(iv);
  if (c === 2 ** 32) return 'any address';
  return `${cidr} (${n(c)} address${c === 1 ? '' : 'es'})`;
}
function ports(r: Rule): string {
  if (r.proto === 'icmp') return 'ICMP';
  const iv = parsePorts(r.ports); if (!iv) return `ports ${r.ports}`;
  if (iv.length === 1 && iv[0].lo === 0 && iv[0].hi === 65535) return 'on all ports';
  return 'on port' + (iv.length === 1 && iv[0].lo === iv[0].hi ? ` ${iv[0].lo}` : `s ${iv.map(i => i.lo === i.hi ? `${i.lo}` : `${i.lo}–${i.hi}`).join(', ')}`);
}
export function explainRule(r: Rule): string {
  const proto = r.proto === 'any' ? 'any protocol' : r.proto.toUpperCase();
  const zones = r.zoneFrom !== 'any' || r.zoneTo !== 'any' ? ` [${r.zoneFrom} → ${r.zoneTo}]` : '';
  return `${r.action === 'allow' ? 'Allow' : 'Deny'} ${proto} from ${where(r.src)} to ${where(r.dst)} ${ports(r)}${zones}${r.enabled ? '' : ' — disabled'}${r.expires ? `, expires ${r.expires}` : ''}.`;
}
