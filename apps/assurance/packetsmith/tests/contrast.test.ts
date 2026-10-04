import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards the theme tokens that are used as *text* against WCAG 2.1 AA (4.5:1) on the surfaces they appear on
// (modelled on Tessera's tests/contrast.test.ts). Added in the October 2026 round when the history-chain badge
// reused the amber chip: --amber on --amber-2 measured 4.45:1, so --amber-2 was lightened #f6ecd2 → #f8f0dc (4.61:1).
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
  const surfaces = ['--paper', '--ground'];
  const textTokens = ['--ink', '--ink-2', '--ink-3', '--cobalt', '--red', '--green', '--amber'];
  for (const t of textTokens) {
    for (const s of surfaces) {
      it(`${t} on ${s} ≥ 4.5`, () => {
        expect(contrast(token(t), token(s))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  // Tinted chips/badges (text token on its pale companion), inverted controls and method tags (white on a fill).
  const pairs: [string, string][] = [
    ['--cobalt', '--cobalt-2'], ['--red', '--red-2'], ['--green', '--green-2'], ['--amber', '--amber-2'],
    ['#ffffff', '--cobalt'], ['#ffffff', '--red'], ['#ffffff', '--ink-3'], ['#ffffff', '--ink'],
    ['#ffffff', '#3b5bdb'], ['#ffffff', '#7a4ba3'], ['#ffffff', '#0f766e'],
  ];
  for (const [fg, bg] of pairs) {
    it(`${fg} on ${bg} ≥ 4.5`, () => {
      expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the history-chain badge classes exist and reuse the guarded chip tokens', () => {
    expect(css).toMatch(/\.chip--ok \{ border-color: var\(--green\); color: var\(--green\); background: var\(--green-2\); \}/);
    expect(css).toMatch(/\.chip--bad \{ border-color: var\(--red\); color: var\(--red\); background: var\(--red-2\); \}/);
    expect(css).toMatch(/\.chip--missing \{ border-color: var\(--amber\); color: var\(--amber\); background: var\(--amber-2\); \}/);
  });
  it('the contrast helper agrees with a known pair (black on white = 21)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
});
