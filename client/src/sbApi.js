// Client for sb-api (the SMART Buddy read API, backed by the shared ClickHouse `smartbuddy` db).
// Playback is a DAILY February timeline. Calls carry the Keycloak Bearer (the /smartbuddy-api/ proxy
// route validates it), so we wait for auth to settle before the first request. With no VITE_SB_API_URL
// set (offline dev) it falls back to deterministic DEMO data so the Playback UI is still usable.
import { authReady, authToken } from './auth.js';

const BASE = (import.meta.env.VITE_SB_API_URL || '').replace(/\/$/, '');
export const isLive = () => !!BASE;

// The dashboard's selected data month (set by main.js). Appended to every playback query so the
// server reads the right month's pb_* partition; empty → the server defaults to its newest month.
let MONTH = '';
export function setMonth(m) { MONTH = m || ''; }
const mq = () => (MONTH ? `?month=${encodeURIComponent(MONTH)}` : '');

async function get(path) {
  await authReady;
  const headers = {};
  const t = authToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(`${BASE}${path}`, { headers });
  if (!r.ok) throw new Error(`sb-api ${path} -> HTTP ${r.status}`);
  return r.json();
}

export async function schools() {
  if (!BASE) return DEMO_SCHOOLS;
  try { return await get(`/api/schools${mq()}`); } catch { return DEMO_SCHOOLS; }
}
export async function schoolSeries(id) {
  if (!BASE) return demoSchoolDaily(id);
  try { return await get(`/api/schools/${encodeURIComponent(id)}/playback${mq()}`); } catch { return demoSchoolDaily(id); }
}
export async function wearableCohort() {
  if (!BASE) return demoWearable();
  try { return await get(`/api/wearable/playback${mq()}`); } catch { return demoWearable(); }
}

// ── demo data (deterministic; illustrates the weekday rhythm + the CNY 16–18 Feb drop) ───────────
const DEMO_SCHOOLS = [
  { schoolId: 'ACSBR', name: 'Anglo-Chinese School (Barker Road)' },
  { schoolId: 'MGSP', name: "Methodist Girls' School (Primary)" },
  { schoolId: 'ACSI', name: 'Anglo-Chinese School (Independent)' },
  { schoolId: 'RGPS', name: "Raffles Girls' Primary School" },
];
const isSchoolDay = (d) => { const dow = new Date(Date.UTC(2026, 1, d)).getUTCDay(); return dow >= 1 && dow <= 5; };
function demoSchoolDaily(id) {
  const seed = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const scale = 0.8 + (seed % 5) * 0.12;
  const out = [];
  for (let d = 1; d <= 28; d += 1) {
    const cny = d >= 16 && d <= 18;                    // CNY window — near-zero
    let txns = Math.round(scale * (isSchoolDay(d) ? 4200 : 260));
    if (cny) txns = Math.round(txns * 0.03);
    out.push({ date: `2026-02-${String(d).padStart(2, '0')}`, txns, revenueSgd: +(txns * 1.8).toFixed(2) });
  }
  return out;
}
function demoWearable() {
  const out = [];
  for (let d = 1; d <= 28; d += 1) {
    const cny = d >= 16 && d <= 18;
    const steps = Math.round((isSchoolDay(d) && !cny ? 8100 : 3600) * (cny ? 0.7 : 1));
    out.push({ date: `2026-02-${String(d).padStart(2, '0')}`, activeUsers: isSchoolDay(d) ? 5900 : 2600,
      avgSteps: steps, medSteps: Math.round(steps * 0.95) });
  }
  return out;
}
