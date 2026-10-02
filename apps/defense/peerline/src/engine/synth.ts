import type { ActivityRecord } from './ueba';
import { dayType } from './ueba';

function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface Injected { user: string; day: string; kind: string; description: string }

const DEPTS = ['finance', 'engineering', 'sales', 'hr'];
const NAMES = ['ada', 'bram', 'cleo', 'dev', 'esme', 'faris', 'gita', 'hugo', 'ines', 'jiro', 'kaia', 'luan', 'mira', 'nilo', 'orla', 'pavel', 'quin', 'rhea', 'sami', 'tova', 'uma', 'vik', 'wren', 'xiu', 'yara', 'zed', 'amal', 'bo', 'cass', 'dani'];

/** 30 fictional users × 28 days (2026-09-01 … 2026-09-28). Days 1–21 are training, 22–28 are scored. */
export function generateActivity(seed: number): { records: ActivityRecord[]; injected: Injected[] } {
  const r = mulberry32(seed);
  const jitter = (base: number, spread: number) => Math.max(0, Math.round(base + (r() - 0.5) * 2 * spread));
  const users = NAMES.map((n, i) => {
    const dept = DEPTS[i % DEPTS.length];
    const profile = { logins: dept === 'engineering' ? 8 : 4, uploadMB: dept === 'engineering' ? 120 : dept === 'sales' ? 45 : 20, hosts: dept === 'engineering' ? 6 : 2, afterHours: dept === 'engineering' ? 0.2 : 0.05 };
    if (n === 'orla') profile.uploadMB = 600;       // habitual heavy uploader in sales: PEER_DEVIATION, not a spike
    if (n === 'hugo') profile.afterHours = 0.6;     // night-shift worker in hr: habitual, should not spike
    return { user: `${n}.example`, dept, profile, weekendWorker: n === 'hugo' || n === 'kaia' };
  });
  const records: ActivityRecord[] = [];
  for (let d = 1; d <= 28; d++) {
    const day = `2026-09-${String(d).padStart(2, '0')}`;
    const weekend = dayType(day) === 'weekend';
    for (const u of users) {
      const active = !weekend || u.weekendWorker || r() < 0.15;
      const f = weekend && !u.weekendWorker ? 0.3 : 1;
      records.push({
        user: u.user, dept: u.dept, day,
        logins: active ? jitter(u.profile.logins * f, 1.5) : 0,
        uploadMB: active ? jitter(u.profile.uploadMB * f, u.profile.uploadMB * 0.25) : 0,
        distinctHosts: active ? jitter(u.profile.hosts * f, 1) : 0,
        afterHoursPct: active ? Math.min(1, Math.max(0, +(u.profile.afterHours + (r() - 0.5) * 0.08).toFixed(2))) : 0,
      });
    }
  }
  const injected: Injected[] = [
    { user: 'ada.example', day: '2026-09-23', kind: 'UPLOAD_SPIKE', description: 'Finance analyst uploads 40× her usual volume.' },
    { user: 'bram.example', day: '2026-09-24', kind: 'HOST_SPREAD', description: 'Engineer touches 25 hosts in one day (lateral movement pattern).' },
    { user: 'cleo.example', day: '2026-09-25', kind: 'LOGIN_SPIKE', description: 'Sales rep account logs in 40 times (credential sharing or stuffing).' },
    { user: 'dev.example', day: '2026-09-22', kind: 'AFTER_HOURS', description: 'HR account becomes almost entirely after-hours.' },
    { user: 'esme.example', day: '2026-09-26', kind: 'UPLOAD_SPIKE+HOST_SPREAD', description: 'Combined upload and host spread two days before a resignation (synthetic story).' },
  ];
  const bump = (user: string, day: string, over: Partial<ActivityRecord>) => { const i = records.findIndex(x => x.user === user && x.day === day); records[i] = { ...records[i], ...over }; };
  bump('ada.example', '2026-09-23', { uploadMB: 820, logins: 5 });
  bump('bram.example', '2026-09-24', { distinctHosts: 25 });
  bump('cleo.example', '2026-09-25', { logins: 40 });
  bump('dev.example', '2026-09-22', { afterHoursPct: 0.85, logins: 4 });
  bump('esme.example', '2026-09-26', { uploadMB: 700, distinctHosts: 14, logins: 6 });
  return { records, injected };
}
