import { parseCidr, parsePorts, addressCount } from '../engine/net';
import type { Rule } from '../engine/rules';
import { formatCoverage, type Coverage } from '../engine/boxes';

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

/**
 * Union coverage of a rule by earlier enabled rules (boxes.ts): a text percentage first (never colour-only), a bar as a
 * visual aid, and an explicit "approx." marker when the fragment budget limited the estimate. Disabled rules are not
 * analysed and show an em dash.
 */
export function CoverageBar({ c }: { c: Coverage | undefined }) {
  if (!c) return <span className="muted small">— not analysed (disabled)</span>;
  const pct = formatCoverage(c.fraction);
  const fill = c.fraction <= 0 ? 0 : Math.max(1, Math.min(100, Math.round(c.fraction * 100)));
  const by = c.coveringRuleIds.length ? ` by ${c.coveringRuleIds.join(', ')}` : '';
  return (
    <span className="coverage" title={`${pct} of this rule's address × port space is already matched by earlier enabled rules${by}${c.approximate ? ' (approximate: fragment budget reached)' : ''}`}>
      <span className="cov-label">{pct}{c.approximate ? ' approx.' : ''}</span>
      <svg className="covbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect x={0} y={0} width={100} height={8} className="cov-track" />
        <rect x={0} y={0} width={fill} height={8} className="cov-fill" />
      </svg>
      <span className="visually-hidden">{` of this rule's address and port space already matched by earlier rules${by}${c.approximate ? '; approximate, fragment budget reached' : ''}`}</span>
    </span>
  );
}
