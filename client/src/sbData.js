// sbData.js — the dashboard's data layer. Every view now reads precomputed per-month INSIGHT BUNDLES
// from the read API (ClickHouse-backed) instead of JSON baked into the bundle, so the data is live
// and the month is switchable. Bundles: global · schools · stalls · wearable (Feb) · items/savings
// (March). Shapes match what the windows expect (they're built by ingestion-service/build_insights.py).
import { authReady, authToken } from './auth.js';

const BASE = (import.meta.env.VITE_SB_API_URL || '').replace(/\/$/, '');

async function api(path) {
  await authReady;                                   // don't race the Keycloak token
  const tok = authToken();
  const r = await fetch(BASE + path, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

// [{ month: '2026-03', kinds: ['global','schools','stalls','items','savings'] }, …] oldest→newest
export async function fetchMonths() {
  return api('/api/months');
}

// One bundle for a month. Throws on 404 (bundle not built yet) — callers default it.
export async function fetchBundle(month, kind) {
  return api(`/api/insights?month=${encodeURIComponent(month)}&kind=${encodeURIComponent(kind)}`);
}

// ── month label helpers (windows show the SELECTED month, not a hardcoded "February") ──────────────
const MONTHS_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(m) {                       // '2026-03' -> 'March 2026'
  if (!/^\d{4}-\d{2}$/.test(m || '')) return '';
  const [y, mo] = m.split('-');
  return `${MONTHS_FULL[+mo]} ${y}`;
}
export const monthName = (m) => (monthLabel(m).split(' ')[0] || '');   // '2026-03' -> 'March'
// Is this month February (used to gate CNY-specific notes/highlights)?
export const isCNYMonth = (m) => m === '2026-02';
