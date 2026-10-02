import type { LicenseVerdict, Policy } from './types';

/**
 * Bounded SPDX-style licence expression evaluator.
 * Grammar (precedence low → high): or-expr := and-expr (OR and-expr)* ; and-expr := term (AND term)* ;
 * term := IDENT | '(' or-expr ')'. `WITH` exceptions and `+` operators are not supported and fail closed.
 * Any malformed, unbalanced, over-long or over-nested expression evaluates to `unknown` — never to `allow`.
 */
export const LICENSE_LIMITS = { maxTokens: 64, maxDepth: 8, maxLength: 400 } as const;

const VERDICT_ORDER: LicenseVerdict[] = ['allow', 'review', 'unknown', 'deny'];
const best = (a: LicenseVerdict, b: LicenseVerdict) => (VERDICT_ORDER.indexOf(a) <= VERDICT_ORDER.indexOf(b) ? a : b);
const worst = (a: LicenseVerdict, b: LicenseVerdict) => (VERDICT_ORDER.indexOf(a) >= VERDICT_ORDER.indexOf(b) ? a : b);

type Token = { kind: 'lparen' | 'rparen' | 'and' | 'or' | 'with' } | { kind: 'ident'; value: string };
const IDENT = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;

function tokenize(text: string): Token[] | null {
  const out: Token[] = [];
  const parts = text.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
  if (parts.length > LICENSE_LIMITS.maxTokens) return null;
  for (const p of parts) {
    const up = p.toUpperCase();
    if (p === '(') out.push({ kind: 'lparen' });
    else if (p === ')') out.push({ kind: 'rparen' });
    else if (up === 'AND') out.push({ kind: 'and' });
    else if (up === 'OR') out.push({ kind: 'or' });
    else if (up === 'WITH') out.push({ kind: 'with' });
    else if (IDENT.test(p)) out.push({ kind: 'ident', value: p });
    else return null;
  }
  return out;
}

export type LicenseNode = { type: 'id'; id: string } | { type: 'and' | 'or'; left: LicenseNode; right: LicenseNode };

class ParseFailure extends Error {}

/** Recursive-descent parser over at most 64 tokens and 8 nesting levels; throws ParseFailure on anything else. */
function parse(tokens: Token[]): LicenseNode {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const orExpr = (depth: number): LicenseNode => {
    let left = andExpr(depth);
    while (peek()?.kind === 'or') { next(); left = { type: 'or', left, right: andExpr(depth) }; }
    return left;
  };
  const andExpr = (depth: number): LicenseNode => {
    let left = term(depth);
    while (peek()?.kind === 'and') { next(); left = { type: 'and', left, right: term(depth) }; }
    return left;
  };
  const term = (depth: number): LicenseNode => {
    const t = next();
    if (!t) throw new ParseFailure('unexpected end of expression');
    if (t.kind === 'ident') {
      if (peek()?.kind === 'with') throw new ParseFailure('WITH exceptions are not supported');
      if (t.value.endsWith('+')) throw new ParseFailure('"+" (or-later) operator is not supported');
      return { type: 'id', id: t.value };
    }
    if (t.kind === 'lparen') {
      if (depth + 1 > LICENSE_LIMITS.maxDepth) throw new ParseFailure(`nesting deeper than ${LICENSE_LIMITS.maxDepth}`);
      const inner = orExpr(depth + 1);
      if (next()?.kind !== 'rparen') throw new ParseFailure('missing closing parenthesis');
      return inner;
    }
    throw new ParseFailure(`unexpected token "${t.kind}"`);
  };
  const tree = orExpr(0);
  if (i !== tokens.length) throw new ParseFailure(`unexpected trailing token "${tokens[i].kind === 'ident' ? (tokens[i] as { value: string }).value : tokens[i].kind}"`);
  return tree;
}

export function parseLicenseExpression(expression: string): { ok: true; tree: LicenseNode } | { ok: false; reason: string } {
  if (expression.length > LICENSE_LIMITS.maxLength) return { ok: false, reason: `longer than ${LICENSE_LIMITS.maxLength} characters` };
  const tokens = tokenize(expression);
  if (!tokens) return { ok: false, reason: 'contains unsupported characters or more than 64 tokens' };
  if (tokens.length === 0) return { ok: false, reason: 'empty' };
  try { return { ok: true, tree: parse(tokens) }; } catch (e) { return { ok: false, reason: e instanceof ParseFailure ? e.message : 'malformed' }; }
}

const render = (n: LicenseNode): string => n.type === 'id' ? n.id : `(${render(n.left)} ${n.type.toUpperCase()} ${render(n.right)})`;

export function evaluateLicense(expression: string, policy: Policy): { expression: string; verdict: LicenseVerdict; detail: string } {
  const text = expression.trim();
  if (!text) return { expression, verdict: 'unknown', detail: 'No licence declared in the snapshot.' };
  const parsed = parseLicenseExpression(text);
  if (!parsed.ok) return { expression, verdict: 'unknown', detail: `Expression could not be parsed (${parsed.reason}); treated as unknown, never as allowed.` };
  const lookup = (id: string): LicenseVerdict => policy.licenses.allow.includes(id) ? 'allow' : policy.licenses.review.includes(id) ? 'review' : policy.licenses.deny.includes(id) ? 'deny' : 'unknown';
  const unlisted: string[] = [];
  const denied: string[] = [];
  const evaluate = (n: LicenseNode): LicenseVerdict => {
    if (n.type === 'id') { const v = lookup(n.id); if (v === 'unknown') unlisted.push(n.id); if (v === 'deny') denied.push(n.id); return v; }
    const l = evaluate(n.left), r = evaluate(n.right);
    return n.type === 'or' ? best(l, r) : worst(l, r);
  };
  const verdict = evaluate(parsed.tree);
  const shape = parsed.tree.type === 'id' ? 'Single identifier' : `Parsed as ${render(parsed.tree)} (OR takes the most permissive side, AND the strictest)`;
  const why = verdict === 'allow' ? 'resolves to allow.'
    : verdict === 'review' ? 'resolves to review: a licence decision is needed before release.'
    : verdict === 'deny' ? `resolves to deny (${[...new Set(denied)].join(', ')} on the deny list).`
    : `resolves to unknown${unlisted.length ? ` (${[...new Set(unlisted)].join(', ')} not on any policy list)` : ''}; confirm before relying on it.`;
  return { expression, verdict, detail: `${shape} ${why}` };
}
