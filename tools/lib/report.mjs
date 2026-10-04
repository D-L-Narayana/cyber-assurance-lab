// Findings collection and output (human table or JSON) shared by the check-* tools.
//
// Severities: 'error' (fails the run, exit 1), 'warn' (printed; fails only with --strict), 'notice' (informational).
// Exit codes: 0 pass, 1 findings, 2 usage.

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;

export class Findings {
  constructor(tool) {
    this.tool = tool;
    this.items = [];
  }

  add(app, severity, code, message, detail) {
    const item = { app: app ?? null, severity, code, message };
    if (detail !== undefined && detail !== null) item.detail = detail;
    this.items.push(item);
    return item;
  }

  error(app, code, message, detail) {
    return this.add(app, 'error', code, message, detail);
  }

  warn(app, code, message, detail) {
    return this.add(app, 'warn', code, message, detail);
  }

  notice(app, code, message, detail) {
    return this.add(app, 'notice', code, message, detail);
  }

  count(severity) {
    return this.items.filter((i) => i.severity === severity).length;
  }

  forApp(app) {
    return this.items.filter((i) => i.app === app);
  }

  global() {
    return this.items.filter((i) => i.app === null);
  }
}

/**
 * Build the result object, print it (JSON or human) and return the exit code.
 * `apps` is the list of app dirs examined (for the per-app table); `extra` is merged into the JSON result.
 */
export function emit(findings, { json = false, strict = false, apps = [], extra = {}, quietOk = false } = {}) {
  const errors = findings.count('error');
  const warnings = findings.count('warn');
  const notices = findings.count('notice');
  const perApp = apps.map((dir) => {
    const items = findings.forApp(dir);
    return {
      dir,
      ok: !items.some((i) => i.severity === 'error' || (strict && i.severity === 'warn')),
      findings: items,
    };
  });
  const ok = errors === 0 && (!strict || warnings === 0);
  const result = {
    tool: findings.tool,
    generatedAt: new Date().toISOString(),
    ok,
    summary: {
      apps: apps.length,
      appsWithFindings: perApp.filter((a) => a.findings.length > 0).length,
      errors,
      warnings,
      notices,
    },
    apps: perApp,
    repo: findings.global(),
    ...extra,
  };
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHuman(result, { quietOk });
  }
  return ok ? EXIT_OK : EXIT_FINDINGS;
}

const TAG = { error: 'ERROR ', warn: 'WARN  ', notice: 'note  ' };

export function printHuman(result, { quietOk = false } = {}) {
  const out = [];
  out.push(`${result.tool}: ${result.apps.length} app(s) examined`);
  if (result.repo.length) {
    out.push('repo-level');
    for (const f of result.repo) out.push(...formatFinding(f));
  }
  for (const a of result.apps) {
    if (a.findings.length === 0) {
      if (!quietOk) out.push(`OK    ${a.dir}`);
      continue;
    }
    const e = a.findings.filter((f) => f.severity === 'error').length;
    const w = a.findings.filter((f) => f.severity === 'warn').length;
    const n = a.findings.filter((f) => f.severity === 'notice').length;
    const parts = [];
    if (e) parts.push(`${e} error${e === 1 ? '' : 's'}`);
    if (w) parts.push(`${w} warning${w === 1 ? '' : 's'}`);
    if (n) parts.push(`${n} note${n === 1 ? '' : 's'}`);
    out.push(`${a.ok ? 'OK   ' : 'FAIL '} ${a.dir} (${parts.join(', ')})`);
    for (const f of a.findings) out.push(...formatFinding(f));
  }
  const s = result.summary;
  out.push(
    `${result.ok ? 'PASS' : 'FAIL'}: ${s.errors} error(s), ${s.warnings} warning(s), ${s.notices} note(s) across ${s.appsWithFindings}/${s.apps} app(s)`,
  );
  process.stdout.write(out.join('\n') + '\n');
}

function formatFinding(f) {
  const lines = [`  ${TAG[f.severity] ?? f.severity} ${f.code.padEnd(26)} ${f.message}`];
  if (f.detail !== undefined) {
    const detailLines = Array.isArray(f.detail) ? f.detail.map(String) : String(f.detail).split('\n');
    for (const d of detailLines) lines.push(`         ${d}`);
  }
  return lines;
}

/** Print a usage message to stderr and return EXIT_USAGE. */
export function usage(text, errors = []) {
  for (const e of errors) process.stderr.write(`error: ${e}\n`);
  process.stderr.write(text.trimEnd() + '\n');
  return EXIT_USAGE;
}
