import { robustStats, robustZ, type RobustStats } from './stats';

export interface ActivityRecord {
  user: string; dept: string; day: string; // YYYY-MM-DD
  logins: number; uploadMB: number; distinctHosts: number; afterHoursPct: number; // 0..1
}
export type Feature = 'logins' | 'uploadMB' | 'distinctHosts' | 'afterHoursPct';
export const FEATURES: Feature[] = ['logins', 'uploadMB', 'distinctHosts', 'afterHoursPct'];
export type ReasonCode = 'LOGIN_SPIKE' | 'UPLOAD_SPIKE' | 'HOST_SPREAD' | 'AFTER_HOURS' | 'PEER_DEVIATION' | 'NO_BASELINE';
export const FEATURE_CODE: Record<Feature, ReasonCode> = { logins: 'LOGIN_SPIKE', uploadMB: 'UPLOAD_SPIKE', distinctHosts: 'HOST_SPREAD', afterHoursPct: 'AFTER_HOURS' };
export const FEATURE_LABEL: Record<Feature, string> = { logins: 'logins / day', uploadMB: 'upload MB / day', distinctHosts: 'distinct hosts / day', afterHoursPct: 'after-hours share' };

export interface Suppression { user: string; code: ReasonCode; rationale: string }
export interface Config {
  zThreshold: number;        // per-feature robust z that counts as a spike
  peerZThreshold: number;    // peer-group z that counts as deviation
  alertThreshold: number;    // weighted score at/above which a day becomes an alert
  minBaselineDays: number;   // minimum training days per day-type
  madFloor: Record<Feature, number>;
  weights: Record<ReasonCode, number>;
  suppressions: Suppression[];
}
export const DEFAULT_CONFIG: Config = {
  zThreshold: 3.5, peerZThreshold: 3.5, alertThreshold: 5, minBaselineDays: 5,
  madFloor: { logins: 1, uploadMB: 5, distinctHosts: 1, afterHoursPct: 0.05 },
  weights: { LOGIN_SPIKE: 3, UPLOAD_SPIKE: 5, HOST_SPREAD: 4, AFTER_HOURS: 2, PEER_DEVIATION: 2, NO_BASELINE: 0 },
  suppressions: [],
};

export const isActive = (r: ActivityRecord) => r.logins > 0 || r.uploadMB > 0 || r.distinctHosts > 0;

export type DayType = 'weekday' | 'weekend';
export function dayType(day: string): DayType {
  const d = new Date(day + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6 ? 'weekend' : 'weekday';
}

export interface Baselines {
  user: Map<string, Record<DayType, Record<Feature, RobustStats>>>;
  dept: Map<string, Record<Feature, RobustStats>>;   // per-user medians pooled by department (weekday)
  deptOfUser: Map<string, string>;
  trainingDays: { from: string; to: string; count: number };
}

export function buildBaselines(records: ActivityRecord[], cfg: Config): Baselines {
  const byUser = new Map<string, ActivityRecord[]>();
  for (const r of records) (byUser.get(r.user) ?? byUser.set(r.user, []).get(r.user)!).push(r);
  const user: Baselines['user'] = new Map();
  const deptOfUser = new Map<string, string>();
  const perUserMedians = new Map<string, Record<Feature, number>[]>();
  for (const [u, recs] of byUser) {
    const out = { weekday: {} as Record<Feature, RobustStats>, weekend: {} as Record<Feature, RobustStats> };
    for (const dt of ['weekday', 'weekend'] as DayType[]) {
      // Only active days count as behavioural evidence; a day with no activity says nothing about "normal".
      const sub = recs.filter(r => dayType(r.day) === dt && isActive(r));
      for (const f of FEATURES) out[dt][f] = robustStats(sub.map(r => r[f]));
    }
    user.set(u, out);
    deptOfUser.set(u, recs[0].dept);
    if (out.weekday.logins.n >= cfg.minBaselineDays) {
      const meds = {} as Record<Feature, number>;
      for (const f of FEATURES) meds[f] = out.weekday[f].median;
      (perUserMedians.get(recs[0].dept) ?? perUserMedians.set(recs[0].dept, []).get(recs[0].dept)!).push(meds);
    }
  }
  const dept: Baselines['dept'] = new Map();
  for (const [d, meds] of perUserMedians) {
    const st = {} as Record<Feature, RobustStats>;
    for (const f of FEATURES) st[f] = robustStats(meds.map(m => m[f]));
    dept.set(d, st);
  }
  const days = records.map(r => r.day).sort();
  return { user, dept, deptOfUser, trainingDays: { from: days[0] ?? '', to: days[days.length - 1] ?? '', count: new Set(days).size } };
}

export interface Reason { code: ReasonCode; feature: Feature | null; value: number; baseline: RobustStats; z: number; weight: number; text: string }
export interface ScoredDay {
  user: string; dept: string; day: string; dayType: DayType; score: number; state: 'alert' | 'normal' | 'unscored';
  reasons: Reason[]; suppressed: { code: ReasonCode; rationale: string }[]; baselineNote: string | null; record: ActivityRecord;
}

const fmt = (f: Feature, v: number) => f === 'afterHoursPct' ? `${Math.round(v * 100)}%` : f === 'uploadMB' ? `${v.toFixed(0)} MB` : `${v}`;

export function scoreRecords(records: ActivityRecord[], base: Baselines, cfg: Config): ScoredDay[] {
  return records.map(r => {
    const dt = dayType(r.day);
    const ub = base.user.get(r.user);
    const reasons: Reason[] = [];
    const suppressed: ScoredDay['suppressed'] = [];
    const other: DayType = dt === 'weekday' ? 'weekend' : 'weekday';
    // Prefer the same day-type baseline; fall back to the other day type (flagged) before giving up.
    let useDt: DayType | null = null;
    if (ub && ub[dt].logins.n >= cfg.minBaselineDays) useDt = dt;
    else if (ub && ub[other].logins.n >= cfg.minBaselineDays) useDt = other;
    if (!ub || useDt === null) {
      const n = ub ? ub[dt].logins.n : 0;
      reasons.push({ code: 'NO_BASELINE', feature: null, value: n, baseline: { median: 0, mad: 0, n }, z: 0, weight: 0, text: `Only ${n} active ${dt} training days (minimum ${cfg.minBaselineDays}) and no usable fallback; this day cannot be scored against the user's own history. Review manually or wait for more data.` });
      return { user: r.user, dept: r.dept, day: r.day, dayType: dt, score: 0, state: 'unscored', reasons, suppressed, baselineNote: null, record: r };
    }
    const baselineNote = useDt === dt ? null : `Only ${ub[dt].logins.n} active ${dt} days in history; compared against the ${other} baseline instead.`;
    let anySpike = false;
    for (const f of FEATURES) {
      const st = ub[useDt][f];
      const z = robustZ(r[f], st, cfg.madFloor[f]);
      if (z >= cfg.zThreshold) {
        anySpike = true;
        const code = FEATURE_CODE[f];
        const sup = cfg.suppressions.find(s => s.user === r.user && s.code === code);
        const reason: Reason = { code, feature: f, value: r[f], baseline: st, z, weight: cfg.weights[code], text: `${FEATURE_LABEL[f]} was ${fmt(f, r[f])} against a ${useDt} median of ${fmt(f, st.median)} (MAD ${fmt(f, st.mad)}, ${st.n} days): robust z ${z.toFixed(1)} ≥ ${cfg.zThreshold}.` };
        if (sup) suppressed.push({ code, rationale: sup.rationale }); else reasons.push(reason);
      }
    }
    // Peer deviation: the user's own medians sit far from the department's distribution of user medians.
    const db = base.dept.get(base.deptOfUser.get(r.user) ?? r.dept);
    if (db && !anySpike) {
      for (const f of FEATURES) {
        const pz = robustZ(ub.weekday[f].median, db[f], cfg.madFloor[f]);
        if (pz >= cfg.peerZThreshold && robustZ(r[f], db[f], cfg.madFloor[f]) >= cfg.peerZThreshold) {
          const sup = cfg.suppressions.find(s => s.user === r.user && s.code === 'PEER_DEVIATION');
          const reason: Reason = { code: 'PEER_DEVIATION', feature: f, value: r[f], baseline: db[f], z: pz, weight: cfg.weights.PEER_DEVIATION, text: `${FEATURE_LABEL[f]} is normal for this user (median ${fmt(f, ub.weekday[f].median)}) but the department's typical user median is ${fmt(f, db[f].median)} (MAD ${fmt(f, db[f].mad)}, ${db[f].n} users): peer z ${pz.toFixed(1)}.` };
          if (sup) suppressed.push({ code: 'PEER_DEVIATION', rationale: sup.rationale }); else reasons.push(reason);
          break;
        }
      }
    }
    // Weight × severity multiplier (how many thresholds deep, capped at 3) so an extreme single-feature deviation can still alert.
    const score = +reasons.reduce((s, x) => s + x.weight * Math.min(3, x.z / (x.code === 'PEER_DEVIATION' ? cfg.peerZThreshold : cfg.zThreshold)), 0).toFixed(2);
    return { user: r.user, dept: r.dept, day: r.day, dayType: dt, score, state: score >= cfg.alertThreshold ? 'alert' : 'normal', reasons, suppressed, baselineNote, record: r };
  });
}

export function applyFeedback(cfg: Config, s: Suppression): Config {
  const rationale = s.rationale.trim().slice(0, 300);
  if (!rationale) return cfg;
  const rest = cfg.suppressions.filter(x => !(x.user === s.user && x.code === s.code));
  return { ...cfg, suppressions: [...rest, { ...s, rationale }] };
}
export function removeFeedback(cfg: Config, user: string, code: ReasonCode): Config {
  return { ...cfg, suppressions: cfg.suppressions.filter(x => !(x.user === user && x.code === code)) };
}
