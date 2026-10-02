export interface Key { user: string; day: string }
export interface Metrics { tp: number; fp: number; fn: number; precision: number; recall: number }
export function evaluateDetections(detected: Key[], labeled: Key[]): Metrics {
  const k = (x: Key) => `${x.user}|${x.day}`;
  const det = new Set(detected.map(k)); const lab = new Set(labeled.map(k));
  let tp = 0; for (const d of det) if (lab.has(d)) tp++;
  const fp = det.size - tp; const fn = lab.size - tp;
  return { tp, fp, fn, precision: det.size ? tp / det.size : 0, recall: lab.size ? tp / lab.size : 0 };
}
