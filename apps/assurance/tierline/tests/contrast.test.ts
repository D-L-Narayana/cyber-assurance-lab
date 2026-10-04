import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards the theme tokens that are used as *text* against WCAG 2.1 AA (4.5:1) on the surfaces they appear on
// (modelled on Tessera's tests/contrast.test.ts). Added in the October 2026 round with the forecast table, which reuses
// the queue's selected-row surface (`tr.is-selected td` → --accent-bg); that surface carries kind text in --t2, the
// vendor link in --accent and the overdue marker in --bad, so those pairs are guarded too.
const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');
const token = (name: string): string => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
};
const hex = (v: string): string => (v.startsWith('#') ? v : token(v));
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('theme text contrast (WCAG 2.1 AA, 4.5:1)', () => {
  const pairs: [string, string][] = [];
  for (const t of ['--ink', '--ink-2', '--ink-3']) for (const s of ['--panel', '--ground', '--accent-bg']) pairs.push([t, s]);
  for (const t of ['--t1', '--t2', '--t3', '--accent', '--bad']) pairs.push([t, '--panel']);
  for (const t of ['--t2', '--accent', '--bad']) pairs.push([t, '--accent-bg']); // selected queue/forecast rows
  for (const s of ['--t1', '--t2', '--t3', '--ink']) pairs.push(['#ffffff', s]); // tier dots, tier badges, buttons, skip link
  for (const [fg, bg] of pairs) {
    it(`${fg} on ${bg} ≥ 4.5`, () => {
      expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the selected-row surface and the text tokens placed on it are the ones guarded above', () => {
    expect(css).toMatch(/tr\.is-selected td \{ background: var\(--accent-bg\); \}/);
    expect(css).toMatch(/\.kind--expiring-evidence, \.kind--exception-expiring, \.kind--tier-drift \{ color: var\(--t2\); \}/);
    expect(css).toMatch(/button\.linkish \{[^}]*color: var\(--accent\)/);
  });
  it('the contrast helper agrees with a known pair (black on white = 21)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
});
