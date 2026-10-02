export interface RobustStats { median: number; mad: number; n: number }

export function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Median and median absolute deviation (unscaled). */
export function robustStats(values: number[]): RobustStats {
  if (!values.length) return { median: 0, mad: 0, n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const dev = sorted.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  return { median: med, mad: median(dev), n: values.length };
}

/**
 * Robust z-score: 0.6745 * (x - median) / MAD, where 0.6745 makes MAD comparable to one standard deviation
 * for normal data. `madFloor` prevents division by zero on constant baselines.
 */
export function robustZ(x: number, s: RobustStats, madFloor: number): number {
  const scale = Math.max(s.mad, madFloor);
  if (scale === 0) return 0;
  return (0.6745 * (x - s.median)) / scale;
}
