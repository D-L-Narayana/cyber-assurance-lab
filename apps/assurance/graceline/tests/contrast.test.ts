import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards the theme tokens that are used as *text* against WCAG 2.1 AA (4.5:1) on the surfaces they appear on
// (modelled on Tessera's tests/contrast.test.ts; added in the October 2026 round). Surfaces: --panel (cards' containers,
// detail, priority list), --bg (page and kanban cards), the selected priority row (--plum-2), card hover (#eef1ec) and
// the tinted chips (risk badges, guard box).
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
  for (const t of ['--ink', '--ink-2', '--ink-3', '--plum', '--amber', '--brick', '--moss']) for (const s of ['--panel', '--bg']) pairs.push([t, s]);
  for (const t of ['--ink', '--ink-2', '--ink-3', '--plum', '--brick', '--moss']) pairs.push([t, '--plum-2']); // selected priority row
  pairs.push(['--ink-3', '#eef1ec'], ['--ink', '#eef1ec']); // card hover
  pairs.push(['--moss', '--moss-2'], ['--slate', '#e5e9f3'], ['--amber', '--amber-2'], ['--brick', '--brick-2'], ['--plum', '--plum-2'], ['--ink', '--brick-2']); // risk chips, role chip, guard box
  pairs.push(['#ffffff', '--plum'], ['#ffffff', '--ink']); // primary buttons, skip link
  for (const [fg, bg] of pairs) {
    it(`${fg} on ${bg} ≥ 4.5`, () => {
      expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the chip and surface rules use the guarded tokens', () => {
    expect(css).toMatch(/\.risk--low \{ background: var\(--moss-2\); color: var\(--moss\); \}/);
    expect(css).toMatch(/\.risk--moderate \{ background: #e5e9f3; color: var\(--slate\); \}/);
    expect(css).toMatch(/\.risk--high \{ background: var\(--amber-2\); color: var\(--amber\); \}/);
    expect(css).toMatch(/\.risk--critical \{ background: var\(--brick-2\); color: var\(--brick\); \}/);
    expect(css).toMatch(/\.prow\.is-selected \{ border-color: var\(--plum\); background: var\(--plum-2\); \}/);
    expect(css).toMatch(/\.card:hover \{ background: #eef1ec; \}/);
  });
  it('the contrast helper agrees with a known pair (black on white = 21)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
});
