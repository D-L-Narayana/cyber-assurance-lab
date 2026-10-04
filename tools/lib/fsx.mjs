// Small filesystem helpers (read-only except where a caller explicitly writes a report).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', '.vercel', 'coverage', 'test-results', 'playwright-report', '.git']);

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Parse a JSON file; returns { ok: true, value } or { ok: false, error }. */
export function readJson(p) {
  const text = readText(p);
  if (text === null) return { ok: false, error: 'file not found or unreadable' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e.message}` };
  }
}

/**
 * Walk a directory tree (iteratively), yielding { rel, abs, size } for files.
 * `skip` names are not descended into; `maxFiles` bounds the walk.
 */
export function* walkFiles(root, { skip = SKIP_DIRS, maxFiles = 100000 } = {}) {
  const stack = [root];
  let count = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) stack.push(abs);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {
          /* ignore */
        }
        yield { rel: path.relative(root, abs).split(path.sep).join('/'), abs, size };
        if (++count >= maxFiles) return;
      }
    }
  }
}

/** Total bytes and file count under a directory (nothing skipped — used for dist/). */
export function dirStats(root) {
  let bytes = 0;
  let files = 0;
  for (const f of walkFiles(root, { skip: new Set() })) {
    bytes += f.size;
    files += 1;
  }
  return { bytes, files };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** First differing line between two texts: { line, a, b } (1-based) or null when identical. */
export function firstDifferingLine(textA, textB) {
  const a = textA.split('\n');
  const b = textB.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { line: i + 1, a: a[i] === undefined ? '<missing line>' : a[i], b: b[i] === undefined ? '<missing line>' : b[i] };
  }
  return null;
}

/** Convert a simple glob (`*`, `?`, `**`) to a RegExp over `/`-separated relative paths. */
export function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

/** Expand a glob relative to `root`; returns matching relative paths (bounded). */
export function expandGlob(root, glob, { limit = 50 } = {}) {
  const re = globToRegExp(glob.replace(/^\.\//, ''));
  const hits = [];
  for (const f of walkFiles(root)) {
    if (re.test(f.rel)) {
      hits.push(f.rel);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
