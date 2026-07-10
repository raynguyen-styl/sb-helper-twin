// sb-api — SMART Buddy read API. Serves (1) the precomputed per-month INSIGHT BUNDLES the whole
// dashboard now reads from ClickHouse (map, overview, terminal health, stalls, March items/savings),
// and (2) the Playback daily series — all from the shared `smartbuddy` db as the read-only user, all
// scoped by month. Behind the client nginx at /smartbuddy-api/ (Keycloak JWT); optional Bearer on /api
// for defence-in-depth. No InfluxDB/Ditto — one OLAP store serves the dashboard, playback + agent.
import express from 'express';
import { SB_API_PORT, SB_API_KEY, CLICKHOUSE_DB } from './config.js';
import * as db from './clickhouse.js';

const app = express();
app.use(express.json());

// CORS (browser app calls this via the proxy)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Optional Bearer auth on data routes (answers carry hashed-but-real ids → gate in prod too)
if (SB_API_KEY) {
  app.use('/api', (req, res, next) => {
    const a = String(req.headers.authorization || '');
    const t = a.startsWith('Bearer ') ? a.slice(7).trim() : a;
    if (t !== SB_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
}

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('[sb-api]', e.message);
  res.status(500).json({ error: String(e.message || e) });
});

// month = ?month=YYYY-MM if given (and valid), else the newest month with data.
const resolveMonth = async (req) => {
  const m = String(req.query.month || '').trim();
  return /^\d{4}-\d{2}$/.test(m) ? m : await db.latestMonth();
};

// ── months + insight bundles (the dashboard reads these) ─────────────────────────
app.get('/api/months', wrap(async (_req, res) => res.json(await db.listMonths())));

app.get('/api/insights', wrap(async (req, res) => {
  const kind = String(req.query.kind || '').trim();
  if (!/^[a-z_]+$/.test(kind)) return res.status(400).json({ error: 'bad or missing kind' });
  const month = await resolveMonth(req);
  const json = await db.getInsight(month, kind);            // raw json string (avoid parse+reserialize)
  if (json == null) return res.status(404).json({ error: `no ${kind} bundle for ${month || '(no data)'}` });
  res.set('X-SB-Month', month).type('application/json').send(json);
}));

// ── playback series (ClickHouse, per month) ──────────────────────────────────────
app.get('/api/schools', wrap(async (req, res) => res.json(await db.listSchools(await resolveMonth(req)))));
app.get('/api/schools/:id/playback', wrap(async (req, res) =>
  res.json(await db.schoolDaily(req.params.id, await resolveMonth(req)))));
app.get('/api/wearable/playback', wrap(async (req, res) =>
  res.json(await db.wearableDaily(await resolveMonth(req)))));

app.get('/health', wrap(async (_req, res) => {
  await db.ping();
  res.json({ status: 'ok', store: 'clickhouse', db: CLICKHOUSE_DB, ts: Date.now() });
}));
app.get('/', (_req, res) => res.json({ name: 'sb-api', status: 'ok' }));

app.listen(SB_API_PORT, () => console.log(
  `[sb-api] listening on :${SB_API_PORT} — ClickHouse ${CLICKHOUSE_DB} (read-only) — auth ${SB_API_KEY ? 'enabled' : 'disabled (dev)'}`,
));
