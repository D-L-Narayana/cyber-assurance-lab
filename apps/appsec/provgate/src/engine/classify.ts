import type { EvidenceType, Manifest, Policy } from './types';

/** Minimal, linear-time glob: `**` spans segments, `*` stays inside one segment. No brace/charclass syntax. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more whole segments; bare `**` matches anything.
        if (glob[i + 2] === '/') { out += '(?:[^/]+/)*'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (/[.+?^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
}

export interface Requirements {
  classes: { id: string; label: string; paths: string[] }[];
  required: EvidenceType[];
  requiredBy: Record<EvidenceType, string[]>;
  minReviewers: number;
  /** Paths each evidence type must cover: the changes of every class that requires it (baseline types cover every change). */
  scopePathsByType: Record<EvidenceType, string[]>;
}

export function classifyChanges(manifest: Manifest, policy: Policy): Requirements {
  const requiredBy = {} as Record<EvidenceType, string[]>;
  const scopePathsByType = {} as Record<EvidenceType, string[]>;
  const add = (type: EvidenceType, by: string, paths: string[]) => {
    (requiredBy[type] ??= []).push(by);
    const set = new Set([...(scopePathsByType[type] ?? []), ...paths]);
    scopePathsByType[type] = [...set];
  };
  const allPaths = manifest.changes.map((c) => c.path);
  for (const t of policy.baseline) add(t, 'baseline', allPaths);
  let minReviewers = policy.minReviewers;
  const classes: Requirements['classes'] = [];
  for (const cls of policy.changeClasses) {
    const regexes = cls.match.map(globToRegExp);
    const paths = manifest.changes.filter((c) => regexes.some((r) => r.test(c.path))).map((c) => c.path);
    if (paths.length === 0) continue;
    classes.push({ id: cls.id, label: cls.label, paths });
    for (const t of cls.requires) add(t, cls.id, paths);
    if (cls.minReviewers !== undefined) minReviewers = Math.max(minReviewers, cls.minReviewers);
  }
  const required = Object.keys(requiredBy) as EvidenceType[];
  return { classes, required, requiredBy, minReviewers, scopePathsByType };
}
