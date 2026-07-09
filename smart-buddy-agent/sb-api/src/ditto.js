// Ditto current-state reads. Clone of tree-digital-twin/nparks-api/src/ditto.js patterns:
// Basic-auth REST, cursor-paginated search (Ditto caps a page at 200), marker mapping.
import { DITTO_BASE_URL, DITTO_USERNAME, DITTO_PASSWORD, DITTO_NAMESPACE } from './config.js';

const auth = 'Basic ' + Buffer.from(`${DITTO_USERNAME}:${DITTO_PASSWORD}`).toString('base64');

// Search ALL things matching a filter, following cursors past the 200/page cap.
async function searchAll(filter, fields) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 200; page += 1) {
    const opt = cursor ? `size(200),cursor(${encodeURIComponent(cursor)})` : 'size(200)';
    const f = fields ? `&fields=${encodeURIComponent(fields)}` : '';
    const url = `${DITTO_BASE_URL}/api/2/search/things?filter=${encodeURIComponent(filter)}&option=${opt}${f}`;
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`Ditto search -> HTTP ${res.status}`);
    const body = await res.json();
    for (const it of body.items || []) items.push(it);
    cursor = body.cursor || null;
    if (!cursor) break;
  }
  return items;
}

// School map markers (+ current spend/network state from the twin).
export async function listSchools() {
  const items = await searchAll(`like(thingId,"${DITTO_NAMESPACE}:school-*")`);
  return items.map((t) => {
    const a = t.attributes || {};
    const s = t.features?.spend?.properties || {};
    const n = t.features?.network?.properties || {};
    return {
      schoolId: a.schoolId, name: a.name, moeType: a.moe_type, level: a.level, zone: a.zone,
      lat: a.lat ?? null, lng: a.lng ?? null,
      totalSgd: s.total_sgd ?? null, avgTicket: s.avg_ticket ?? null, distinctCards: s.distinct_cards ?? null,
      errPct: n.err_pct ?? null, offlinePct: n.offline_pct ?? null, medianSpeedMs: n.median_speed_ms ?? null,
    };
  });
}

// Terminal markers (+ current health/fault state). Optional schoolId filter (client-side).
export async function listTerminals(schoolId) {
  const items = await searchAll(`like(thingId,"${DITTO_NAMESPACE}:terminal-*")`);
  return items
    .map((t) => {
      const a = t.attributes || {};
      const h = t.features?.health?.properties || {};
      return {
        terminalId: a.terminalId, schoolId: a.schoolId, networkType: a.network_type,
        txns: h.txns ?? null, errPct: h.err_pct ?? null, medianSpeedMs: h.median_speed_ms ?? null,
        p95SpeedMs: h.p95_speed_ms ?? null, flag: h.flag ?? null,
      };
    })
    .filter((t) => !schoolId || t.schoolId === schoolId);
}

// One Thing by full thingId (null on 404).
export async function getThing(thingId) {
  const res = await fetch(`${DITTO_BASE_URL}/api/2/things/${encodeURIComponent(thingId)}`, { headers: { Authorization: auth } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Ditto GET ${thingId} -> HTTP ${res.status}`);
  return res.json();
}
