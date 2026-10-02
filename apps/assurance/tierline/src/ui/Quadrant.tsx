import { TIER_THRESHOLDS } from '../engine/model';
import { inherentScore } from '../engine/assess';
import type { Vendor, VendorAssessment } from '../engine/types';

interface Props {
  vendors: Vendor[];
  assessments: Map<string, VendorAssessment>;
  selected: string | null;
  onSelect: (id: string) => void;
}

const W = 760;
const H = 300;
const PAD = { l: 44, r: 16, t: 14, b: 36 };

export function Quadrant({ vendors, assessments, selected, onSelect }: Props) {
  const x = (score: number) => PAD.l + (score / 100) * (W - PAD.l - PAD.r);
  const y = (cov: number) => PAD.t + (1 - cov) * (H - PAD.t - PAD.b);
  const sel = selected ? assessments.get(selected) : undefined;
  const selVendor = selected ? vendors.find((v) => v.id === selected) : undefined;
  const ghosts = sel && selVendor
    ? sel.flips.slice(0, 6).map((f) => ({ f, score: inherentScore({ ...selVendor.answers, [f.questionId]: f.toOptionId }).score }))
    : [];

  return (
    <figure className="quadfig">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-labelledby="quad-title" aria-describedby="quad-desc" className="quadsvg">
        <title id="quad-title">Vendors plotted by inherent score and assurance coverage</title>
        <desc id="quad-desc">
          {vendors.map((v) => { const a = assessments.get(v.id)!; return `${v.name}: tier ${a.tier}, inherent ${a.inherent}, coverage ${Math.round(a.coverage * 100)}%.`; }).join(' ')}
        </desc>
        {/* tier bands */}
        <rect x={x(0)} y={PAD.t} width={x(TIER_THRESHOLDS.tier2) - x(0)} height={H - PAD.t - PAD.b} className="band band3" />
        <rect x={x(TIER_THRESHOLDS.tier2)} y={PAD.t} width={x(TIER_THRESHOLDS.tier1) - x(TIER_THRESHOLDS.tier2)} height={H - PAD.t - PAD.b} className="band band2" />
        <rect x={x(TIER_THRESHOLDS.tier1)} y={PAD.t} width={x(100) - x(TIER_THRESHOLDS.tier1)} height={H - PAD.t - PAD.b} className="band band1" />
        <text x={x(TIER_THRESHOLDS.tier2 / 2)} y={PAD.t + 14} className="bandlabel">tier 3 band</text>
        <text x={x((TIER_THRESHOLDS.tier2 + TIER_THRESHOLDS.tier1) / 2)} y={PAD.t + 14} className="bandlabel">tier 2 band</text>
        <text x={x((TIER_THRESHOLDS.tier1 + 100) / 2)} y={PAD.t + 14} className="bandlabel">tier 1 band</text>
        {/* axes */}
        {[0, 25, 50, 75, 100].map((s) => (
          <g key={s}>
            <line x1={x(s)} x2={x(s)} y1={H - PAD.b} y2={H - PAD.b + 5} className="tick" />
            <text x={x(s)} y={H - PAD.b + 18} textAnchor="middle" className="axis">{s}</text>
          </g>
        ))}
        {[0, 0.5, 1].map((c) => (
          <g key={c}>
            <line x1={PAD.l - 5} x2={W - PAD.r} y1={y(c)} y2={y(c)} className="grid" />
            <text x={PAD.l - 8} y={y(c) + 4} textAnchor="end" className="axis">{Math.round(c * 100)}%</text>
          </g>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" className="axis axis--label">inherent risk score (0–100)</text>
        <text transform={`translate(12 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis axis--label">assurance coverage</text>
        {/* ghosts for the selected vendor */}
        {sel && ghosts.map(({ f, score }, i) => (
          <g key={i} className="ghost">
            <line x1={x(sel.inherent)} y1={y(sel.coverage)} x2={x(score)} y2={y(sel.coverage)} className="ghostline" />
            <circle cx={x(score)} cy={y(sel.coverage)} r={6} className={`ghostdot t${f.newTier}`} />
          </g>
        ))}
        {/* vendors */}
        {vendors.map((v) => {
          const a = assessments.get(v.id)!;
          const isSel = v.id === selected;
          return (
            <g key={v.id} className={`dotg ${isSel ? 'is-selected' : ''}`} tabIndex={0} role="button" aria-label={`${v.name}, tier ${a.tier}, inherent ${a.inherent}, coverage ${Math.round(a.coverage * 100)} percent`}
              onClick={() => onSelect(v.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(v.id); } }}>
              <circle cx={x(a.inherent)} cy={y(a.coverage)} r={isSel ? 9 : 6.5} className={`dot t${a.tier}`} />
              {isSel && <text x={x(a.inherent) + 12} y={y(a.coverage) + 4} className="dotlabel">{v.name}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted">x: inherent score; y: share of required evidence that is valid (exceptions count half). Vertical bands mark the tier thresholds (≥ {TIER_THRESHOLDS.tier1} tier 1, ≥ {TIER_THRESHOLDS.tier2} tier 2); hard triggers can place a vendor in a higher tier than its band.</figcaption>
    </figure>
  );
}
