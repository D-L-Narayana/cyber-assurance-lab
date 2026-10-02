import type { Catalog, DataCategory, NormalisationNote, Region, TransferMechanism } from './types';

export const CATEGORIES: readonly DataCategory[] = ['identifier', 'contact', 'financial', 'behavioural', 'special-category', 'credentials', 'technical', 'employment'];
export const REGIONS: readonly Region[] = ['EU', 'UK', 'US', 'IN', 'SG', 'BR'];
export const MECHANISMS: readonly TransferMechanism[] = ['adequacy', 'standard-contractual-clauses', 'binding-corporate-rules', 'none', 'not-applicable'];

/** Synonyms seen in real-world catalogs. Keys are compared lower-cased and trimmed. */
export const CATEGORY_SYNONYMS: Record<string, DataCategory> = {
  pii: 'identifier',
  id: 'identifier',
  identifiers: 'identifier',
  'personal identifier': 'identifier',
  email: 'contact',
  'email address': 'contact',
  phone: 'contact',
  address: 'contact',
  'contact details': 'contact',
  payment: 'financial',
  banking: 'financial',
  payroll: 'financial',
  finance: 'financial',
  behaviour: 'behavioural',
  behavior: 'behavioural',
  behavioral: 'behavioural',
  usage: 'behavioural',
  health: 'special-category',
  biometric: 'special-category',
  biometrics: 'special-category',
  sensitive: 'special-category',
  'special category': 'special-category',
  password: 'credentials',
  passwords: 'credentials',
  secrets: 'credentials',
  credential: 'credentials',
  ip: 'technical',
  'ip address': 'technical',
  logs: 'technical',
  device: 'technical',
  hr: 'employment',
  employee: 'employment',
};

export const REGION_SYNONYMS: Record<string, Region> = {
  europe: 'EU',
  'eu-west': 'EU',
  'eu-central': 'EU',
  eea: 'EU',
  'european union': 'EU',
  'united kingdom': 'UK',
  gb: 'UK',
  britain: 'UK',
  usa: 'US',
  'united states': 'US',
  'us-east': 'US',
  'us-west': 'US',
  america: 'US',
  india: 'IN',
  singapore: 'SG',
  brazil: 'BR',
  brasil: 'BR',
};

export const MECHANISM_SYNONYMS: Record<string, TransferMechanism> = {
  scc: 'standard-contractual-clauses',
  sccs: 'standard-contractual-clauses',
  'standard contractual clauses': 'standard-contractual-clauses',
  'model clauses': 'standard-contractual-clauses',
  bcr: 'binding-corporate-rules',
  bcrs: 'binding-corporate-rules',
  'binding corporate rules': 'binding-corporate-rules',
  'adequacy decision': 'adequacy',
  adequate: 'adequacy',
  'n/a': 'not-applicable',
  na: 'not-applicable',
  'same region': 'not-applicable',
  intra: 'not-applicable',
  unknown: 'none',
  missing: 'none',
  '': 'none',
};

function canon<T extends string>(value: string, allowed: readonly T[], synonyms: Record<string, T>): T | undefined {
  const key = value.trim().toLowerCase();
  const direct = allowed.find((a) => a.toLowerCase() === key);
  if (direct) return direct;
  return synonyms[key];
}

export function canonicalCategory(v: string): DataCategory | undefined { return canon(v, CATEGORIES, CATEGORY_SYNONYMS); }
export function canonicalRegion(v: string): Region | undefined { return canon(v, REGIONS, REGION_SYNONYMS); }
export function canonicalMechanism(v: string): TransferMechanism | undefined { return canon(v, MECHANISMS, MECHANISM_SYNONYMS); }

function normId(v: string): string {
  return v.trim().toLowerCase();
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/**
 * Normalises identifiers, vocabularies and list fields. Unknown vocabulary values are left as-is so
 * that validation (parseCatalog) can reject them with a precise message; this function never throws.
 */
export function normaliseCatalog(raw: Catalog): { catalog: Catalog; notes: NormalisationNote[] } {
  const notes: NormalisationNote[] = [];
  const idNote = (path: string, from: string, to: string) => { if (from !== to) notes.push({ path, from, to, rule: 'id-normalised' }); };
  const synNote = (path: string, from: string, to: string) => { if (from !== to) notes.push({ path, from, to, rule: 'synonym' }); };
  const dedupeNote = (path: string, from: number, to: number) => { if (from !== to) notes.push({ path, from: `${from} items`, to: `${to} items`, rule: 'deduplicated' }); };

  const owners = raw.owners.map((o, i) => {
    const id = normId(o.id);
    idNote(`owners[${i}].id`, o.id, id);
    return { ...o, id, name: o.name.trim(), team: o.team.trim() };
  });

  const systems = raw.systems.map((s, i) => {
    const id = normId(s.id);
    idNote(`systems[${i}].id`, s.id, id);
    const region = canonicalRegion(String(s.region)) ?? s.region;
    synNote(`systems[${i}].region`, String(s.region), String(region));
    const purposes = uniq(s.purposes.map((p) => normId(p)));
    dedupeNote(`systems[${i}].purposes`, s.purposes.length, purposes.length);
    const ownerId = s.ownerId !== undefined ? normId(s.ownerId) : undefined;
    if (s.ownerId !== undefined) idNote(`systems[${i}].ownerId`, s.ownerId, ownerId!);
    return { ...s, id, name: s.name.trim(), region, purposes, ...(ownerId !== undefined ? { ownerId } : {}) };
  });

  const schedules = raw.schedules.map((sc, i) => {
    const id = normId(sc.id);
    idNote(`schedules[${i}].id`, sc.id, id);
    return { ...sc, id, name: sc.name.trim() };
  });

  const elements = raw.elements.map((e, i) => {
    const id = normId(e.id);
    idNote(`elements[${i}].id`, e.id, id);
    const systemId = normId(e.systemId);
    idNote(`elements[${i}].systemId`, e.systemId, systemId);
    const category = canonicalCategory(String(e.category)) ?? e.category;
    synNote(`elements[${i}].category`, String(e.category), String(category));
    const purposes = uniq(e.purposes.map((p) => normId(p)));
    dedupeNote(`elements[${i}].purposes`, e.purposes.length, purposes.length);
    const scheduleId = e.scheduleId !== undefined ? normId(e.scheduleId) : undefined;
    if (e.scheduleId !== undefined) idNote(`elements[${i}].scheduleId`, e.scheduleId, scheduleId!);
    return { ...e, id, systemId, name: e.name.trim(), category, purposes, ...(scheduleId !== undefined ? { scheduleId } : {}) };
  });

  const flows = raw.flows.map((f, i) => {
    const id = normId(f.id);
    idNote(`flows[${i}].id`, f.id, id);
    const fromSystemId = normId(f.fromSystemId);
    idNote(`flows[${i}].fromSystemId`, f.fromSystemId, fromSystemId);
    const toSystemId = normId(f.toSystemId);
    idNote(`flows[${i}].toSystemId`, f.toSystemId, toSystemId);
    const elementIds = uniq(f.elementIds.map((x) => normId(x)));
    dedupeNote(`flows[${i}].elementIds`, f.elementIds.length, elementIds.length);
    const mechanism = canonicalMechanism(String(f.mechanism)) ?? f.mechanism;
    synNote(`flows[${i}].mechanism`, String(f.mechanism), String(mechanism));
    return { ...f, id, fromSystemId, toSystemId, elementIds, mechanism };
  });

  const exceptions = raw.exceptions.map((x, i) => {
    const id = normId(x.id);
    idNote(`exceptions[${i}].id`, x.id, id);
    const elementId = normId(x.elementId);
    idNote(`exceptions[${i}].elementId`, x.elementId, elementId);
    const approvedBy = x.approvedBy !== undefined ? normId(x.approvedBy) : undefined;
    return { ...x, id, elementId, ...(approvedBy !== undefined ? { approvedBy } : {}) };
  });

  return { catalog: { ...raw, owners, systems, schedules, elements, flows, exceptions }, notes };
}
