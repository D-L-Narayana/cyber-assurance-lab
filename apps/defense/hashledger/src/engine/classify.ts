import type { FileEntry } from './snapshot';

export type Label = 'public' | 'internal' | 'confidential' | 'restricted';
export interface Signal { id: string; label: Label; count: number; detail: string }
export interface Classification { label: Label; signals: Signal[] }
const RANK: Record<Label, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };

export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

/* Patterns are intentionally simple and documented. They run on bounded content (≤ 64 KiB) and avoid nested quantifiers. */
const NATIONAL_ID = /\b\d{3}-\d{2}-\d{4}\b/g;             // synthetic "XXX-XX-XXXX" identifier shape
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,19}\b/g;          // digit runs with optional separators; Luhn-checked afterwards
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const CONFIDENTIAL = /\bCONFIDENTIAL\b/;
const PAYROLL = /\b(payroll|salary|compensation)\b/i;
const SOURCE_EXT = /\.(ts|tsx|js|py|go|java|rs|c|cpp|cs|rb|sh)$/i;
const PUBLIC_NAME = /(^|\/)(README|LICENSE|CHANGELOG)(\.[a-z]+)?$/i;

export function classifyFile(f: FileEntry): Classification {
  const signals: Signal[] = [];
  const text = f.content.slice(0, 65_536);
  const ids = text.match(NATIONAL_ID)?.length ?? 0;
  if (ids) signals.push({ id: 'national-id-pattern', label: 'restricted', count: ids, detail: `${ids} identifier(s) shaped like XXX-XX-XXXX` });
  let cards = 0;
  for (const m of text.match(CARD_CANDIDATE) ?? []) if (luhnValid(m.replace(/[ -]/g, ''))) cards++;
  if (cards) signals.push({ id: 'payment-card', label: 'restricted', count: cards, detail: `${cards} Luhn-valid card-shaped number(s)` });
  if (PRIVATE_KEY.test(text)) signals.push({ id: 'private-key-header', label: 'restricted', count: 1, detail: 'PEM private-key header' });
  if (PAYROLL.test(text) || /payroll|salary/i.test(f.path)) signals.push({ id: 'payroll-keyword', label: 'confidential', count: 1, detail: 'payroll/salary keyword in content or path' });
  if (CONFIDENTIAL.test(text)) signals.push({ id: 'confidential-marker', label: 'confidential', count: 1, detail: 'explicit CONFIDENTIAL marker' });
  if (SOURCE_EXT.test(f.path)) signals.push({ id: 'source-code', label: 'internal', count: 1, detail: 'source-code extension' });
  if (PUBLIC_NAME.test(f.path) && signals.length === 0) signals.push({ id: 'public-doc-name', label: 'public', count: 1, detail: 'conventional public documentation file name' });
  let label: Label = signals.length ? 'public' : 'internal';
  for (const s of signals) if (RANK[s.label] > RANK[label]) label = s.label;
  if (!signals.length) label = 'internal';
  return { label, signals };
}
