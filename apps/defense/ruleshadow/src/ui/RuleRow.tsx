import { parseCidr, parsePorts, addressCount } from '../engine/net';
import type { Rule } from '../engine/rules';

/** Visual footprint: address-block size (log2 scale) and port coverage across 0–65535. */
export function Footprint({ rule }: { rule: Rule }) {
  const src = parseCidr(rule.src), dst = parseCidr(rule.dst), ports = parsePorts(rule.ports) ?? [];
  const bits = (iv: { lo: number; hi: number } | null) => iv ? Math.log2(addressCount(iv)) : 0; // 0..32
  const W = 160, H = 26;
  return (
    <svg className="footprint" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Source block 2^${bits(src)} addresses, destination block 2^${bits(dst)} addresses, ports ${rule.ports}`}>
      <rect x={0} y={2} width={48} height={6} className="fp-track" /><rect x={0} y={2} width={(bits(src) / 32) * 48} height={6} className="fp-src" />
      <rect x={56} y={2} width={48} height={6} className="fp-track" /><rect x={56} y={2} width={(bits(dst) / 32) * 48} height={6} className="fp-dst" />
      <rect x={0} y={16} width={W} height={6} className="fp-track" />
      {rule.proto === 'icmp' ? <rect x={0} y={16} width={W} height={6} className="fp-icmp" /> : ports.map((p, i) => <rect key={i} x={(p.lo / 65535) * W} y={16} width={Math.max(2, ((p.hi - p.lo + 1) / 65536) * W)} height={6} className="fp-port" />)}
      <text x={108} y={9} className="fp-label">src · dst</text>
    </svg>
  );
}
