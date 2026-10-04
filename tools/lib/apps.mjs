// App discovery for the repo-level tools. Zero dependencies, Node >= 20.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute repository root (this file lives in <root>/tools/lib/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Discover `apps/<track>/<slug>` directories.
 * An app is a directory with a `package.json`; `requireLockfile` additionally demands `package-lock.json`.
 * Returns [{ dir, track, slug, abs }] sorted by dir. `stray` lists directories without a package.json.
 */
export function discoverApps({ root = REPO_ROOT, requireLockfile = false } = {}) {
  const appsDir = path.join(root, 'apps');
  const apps = [];
  const stray = [];
  if (!fs.existsSync(appsDir)) return { apps, stray };
  for (const track of listDirs(appsDir)) {
    for (const slug of listDirs(path.join(appsDir, track))) {
      const abs = path.join(appsDir, track, slug);
      const dir = `apps/${track}/${slug}`;
      if (!fs.existsSync(path.join(abs, 'package.json'))) {
        stray.push(dir);
        continue;
      }
      if (requireLockfile && !fs.existsSync(path.join(abs, 'package-lock.json'))) continue;
      apps.push({ dir, track, slug, abs });
    }
  }
  apps.sort((a, b) => a.dir.localeCompare(b.dir));
  return { apps, stray };
}

function listDirs(p) {
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => d.name)
    .sort();
}

/**
 * Keep the apps matching any selector: track name, slug, `track/slug`, repo-relative dir, or a filesystem path
 * (relative to cwd or absolute) pointing at the app directory.
 */
export function filterApps(apps, selectors) {
  if (!selectors || selectors.length === 0) return { apps, unmatched: [] };
  const unmatched = [];
  const chosen = new Set();
  for (const raw of selectors) {
    const s = raw.replace(/\/+$/, '');
    const asPath = path.resolve(process.cwd(), s);
    let hit = false;
    for (const a of apps) {
      if (a.track === s || a.slug === s || a.dir === s || `${a.track}/${a.slug}` === s || asPath === a.abs) {
        chosen.add(a.dir);
        hit = true;
      }
    }
    if (!hit) unmatched.push(raw);
  }
  return { apps: apps.filter((a) => chosen.has(a.dir)), unmatched };
}

/** Resolve a user-supplied app path (`.`, `apps/x/y`, absolute) to an app record or null. */
export function appFromPath(p, { root = REPO_ROOT } = {}) {
  const abs = path.resolve(process.cwd(), p);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  const m = /^apps\/([^/]+)\/([^/]+)$/.exec(rel);
  if (!m) return null;
  return { dir: rel, track: m[1], slug: m[2], abs };
}
