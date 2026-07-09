// Client for sb-api (the InfluxDB/Ditto read API). When VITE_SB_API_URL is unset (or a fetch
// fails), falls back to DEMO data so the playback UI is fully usable offline — the same "mock mode"
// idea tree-digital-twin's frontend uses. Real deployments set VITE_SB_API_URL to the proxied
// sb-api and get live Feb data.
const BASE = (import.meta.env.VITE_SB_API_URL || '').replace(/\/$/, '');
export const isLive = () => !!BASE;

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`sb-api ${path} -> HTTP ${r.status}`);
  return r.json();
}

export async function schools() {
  if (!BASE) return DEMO_SCHOOLS;
  try { return await get('/api/schools'); } catch { return DEMO_SCHOOLS; }
}
export async function schoolHourly(id) {
  if (!BASE) return demoHourly(id);
  try { return await get(`/api/schools/${encodeURIComponent(id)}/hourly`); } catch { return demoHourly(id); }
}
export async function wearableCohort() {
  if (!BASE) return demoCohort();
  try { return await get('/api/wearable/playback'); } catch { return demoCohort(); }
}

// ── demo data (deterministic; illustrates recess spikes + the CNY 16–18 Feb drop) ──────────────
const DEMO_SCHOOLS = [
  { schoolId: 'ACSBR', name: 'Anglo-Chinese School (Barker Road)' },
  { schoolId: 'MGSP', name: "Methodist Girls' School (Primary)" },
  { schoolId: 'ACSI', name: 'Anglo-Chinese School (Independent)' },
  { schoolId: 'RGPS', name: "Raffles Girls' Primary School" },
];
function demoHourly(id) {
  // vary the level a little by school id so switching schools visibly changes the curve
  const seed = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const scale = 0.8 + (seed % 5) * 0.12;
  const out = [];
  for (let d = 1; d <= 28; d += 1) {
    const dow = new Date(Date.UTC(2026, 1, d)).getUTCDay(); // 0 Sun … 6 Sat
    const schoolDay = dow >= 1 && dow <= 5;
    const cny = d >= 16 && d <= 18;             // CNY window — near-zero
    for (let h = 7; h <= 15; h += 1) {
      const recess = h >= 9 && h <= 11 ? 3 : 1; // recess spike
      let txns = Math.round(scale * (schoolDay ? 1 : 0.12) * recess * (h === 10 ? 60 : 28));
      if (cny) txns = Math.round(txns * 0.05);
      const iso = `2026-02-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
      out.push({ time: iso, txns, revenueSgd: +(txns * 1.8).toFixed(2),
        errCount: Math.round(txns * 0.08), offlineCount: Math.round(txns * 0.3) });
    }
  }
  return out;
}
function demoCohort() {
  const out = [];
  for (let d = 1; d <= 28; d += 1) {
    const dow = new Date(Date.UTC(2026, 1, d)).getUTCDay();
    const schoolDay = dow >= 1 && dow <= 5;
    const cny = d >= 16 && d <= 18;
    const steps = Math.round((schoolDay && !cny ? 8100 : 3600) * (cny ? 0.7 : 1));
    out.push({ date: `2026-02-${String(d).padStart(2, '0')}`, activeUsers: schoolDay ? 5900 : 2600,
      avgSteps: steps, meanBpm: +(80 + (schoolDay ? 2 : 0)).toFixed(1), restingBpm: 68 });
  }
  return out;
}
