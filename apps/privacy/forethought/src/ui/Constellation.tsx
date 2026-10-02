import type { Scorecard, Theme } from '../engine/types';
import { THEME_LABEL } from '../engine/types';
import { band } from '../engine/scoring';

const SHORT: Record<Theme, string> = {
  lawfulness: 'LA', minimisation: 'MI', transparency: 'TR', rights: 'RI', security: 'SE', retention: 'RE', 'third-party': '3P', 'cross-border': 'XB', 'vulnerable-subjects': 'VU', 'automated-decisions': 'AD',
};

const CELL = 44;
const PAD_L = 26;
const PAD_B = 22;
const W = PAD_L + CELL * 5 + 6;
const H = CELL * 5 + PAD_B + 6;

function pos(l: number, i: number, jitter = 0) {
  // likelihood on x (1..5 left→right), impact on y (1 bottom → 5 top)
  return { x: PAD_L + (l - 0.5) * CELL + jitter, y: (5 - i + 0.5) * CELL + 3 + jitter };
}

/**
 * The risk constellation: a 5x5 likelihood x impact matrix. Each theme is drawn as a hollow dot at
 * its inherent position and a filled dot at its residual position, joined by an arrow when they differ.
 */
export function Constellation({ card }: { card: Scorecard }) {
  // Spread themes that share a residual cell so labels stay readable.
  const seen = new Map<string, number>();
  const placed = card.themes.map((t) => {
    const key = `${t.residual.likelihood}-${t.residual.impact}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const jitter = (n % 3) * 9 - 9 * Math.min(n, 1);
    return { t, jitter: n === 0 ? 0 : jitter };
  });
  const summary = card.themes.map((t) => `${THEME_LABEL[t.theme]}: inherent ${t.inherent.band} (${t.inherent.likelihood}×${t.inherent.impact}), residual ${t.residual.band} (${t.residual.likelihood}×${t.residual.impact})`).join('; ');
  return (
    <div className="constellation">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Risk constellation. ${summary}.`}>
        <defs>
          <marker id="tri" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5a4370" /></marker>
        </defs>
        {Array.from({ length: 5 }, (_, li) => Array.from({ length: 5 }, (_, ii) => {
          const l = li + 1; const i = ii + 1;
          const b = band(l * i);
          return <rect key={`${l}-${i}`} className={`cell-${b}`} x={PAD_L + li * CELL} y={(5 - i) * CELL + 3} width={CELL - 1} height={CELL - 1} rx={2} />;
        }))}
        {Array.from({ length: 5 }, (_, k) => (
          <g key={k}>
            <text className="axis" x={PAD_L + (k + 0.5) * CELL} y={H - 8} textAnchor="middle">L{k + 1}</text>
            <text className="axis" x={PAD_L - 6} y={(5 - (k + 1) + 0.5) * CELL + 6} textAnchor="end">I{k + 1}</text>
          </g>
        ))}
        {placed.map(({ t, jitter }) => {
          const a = pos(t.inherent.likelihood, t.inherent.impact, jitter);
          const b = pos(t.residual.likelihood, t.residual.impact, jitter);
          const moved = a.x !== b.x || a.y !== b.y;
          return (
            <g key={t.theme}>
              {moved && <line className="arrow" x1={a.x} y1={a.y} x2={b.x + (a.x - b.x) * 0.18} y2={b.y + (a.y - b.y) * 0.18} />}
              {moved && <circle className="dot-inherent" cx={a.x} cy={a.y} r={7} />}
              <circle className="dot-residual" cx={b.x} cy={b.y} r={8}><title>{THEME_LABEL[t.theme]}: residual {t.residual.band}</title></circle>
              <text className="dot-label" x={b.x} y={b.y + 2.7} textAnchor="middle">{SHORT[t.theme]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const THEME_SHORT = SHORT;
