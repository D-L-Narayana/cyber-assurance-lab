import { describe, it, expect } from 'vitest';
import { validateManifest, LIMITS, type FileEntry } from './snapshot';
import { SAMPLE_FILES } from './fixtures';

const f = (path: string, content = 'x', mode = '0644', owner = 'svc-app'): FileEntry => ({ path, content, mode, owner });
const errorsOf = (v: ReturnType<typeof validateManifest>) => (v.ok ? [] : v.errors).join('\n');

describe('manifest hardening', () => {
  it('requires owner to be a printable string of 1–64 characters', () => {
    const empty = validateManifest([f('a.txt', 'x', '0644', '')]);
    expect(empty.ok).toBe(false);
    expect(errorsOf(empty)).toMatch(/files\[0\]\.owner/);
    expect(validateManifest([f('a.txt', 'x', '0644', 'o'.repeat(65))]).ok).toBe(false);
    expect(validateManifest([f('a.txt', 'x', '0644', 'svc\u0000app')]).ok).toBe(false);
    expect(validateManifest([f('a.txt', 'x', '0644', 'svc\napp')]).ok).toBe(false);
    expect(validateManifest([{ path: 'a.txt', content: 'x', mode: '0644', owner: 42 } as unknown as FileEntry]).ok).toBe(false);
    expect(validateManifest([f('a.txt', 'x', '0644', 'o'.repeat(64))]).ok).toBe(true);
    expect(LIMITS.maxOwnerChars).toBe(64);
  });

  it('allows only [A-Za-z0-9._/-] in paths, after the existing segment checks', () => {
    const space = validateManifest([f('team notes.md')]);
    expect(space.ok).toBe(false);
    expect(errorsOf(space)).toMatch(/files\[0\]\.path/);
    expect(validateManifest([f('a$b.txt')]).ok).toBe(false);
    expect(validateManifest([f('résumé.txt')]).ok).toBe(false);
    expect(validateManifest([f('ok-1_2/File.TXT')]).ok).toBe(true);
    expect(validateManifest([f('a/./b.txt')]).ok).toBe(false); // still caught by the segment rule
  });

  it('rejects non-array manifests and non-object rows without throwing', () => {
    expect(validateManifest('nope' as unknown as FileEntry[]).ok).toBe(false);
    expect(() => validateManifest([null as unknown as FileEntry])).not.toThrow();
    const v = validateManifest([f('a.txt'), null as unknown as FileEntry, 'row' as unknown as FileEntry]);
    expect(v.ok).toBe(false);
    expect(errorsOf(v)).toMatch(/files\[1\]/);
    expect(errorsOf(v)).toMatch(/files\[2\]/);
  });

  it('keeps the shipped fixture valid under the new rules', () => {
    expect(validateManifest(SAMPLE_FILES).ok).toBe(true);
    expect(SAMPLE_FILES.every(x => /^[A-Za-z0-9._/-]+$/.test(x.path) && x.owner.length >= 1 && x.owner.length <= 64)).toBe(true);
  });
});
