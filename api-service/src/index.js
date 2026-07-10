// sb-api — SMART Buddy read API for the dashboard's Playback window. Serves per-school daily series,
// the wearable cohort daily series, and the school list from the shared ClickHouse `smartbuddy` db
// (read-only user). Behind the shared nginx-proxy at /smartbuddy-api/ (Keycloak JWT); optional
// Bearer on /api for defence-in-depth. No InfluxDB/Ditto — one OLAP store serves playback + agent.
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

// ── playback series (ClickHouse) ────────────────────────────────────────────────
app.get('/api/schools', wrap(async (_req, res) => res.json(await db.listSchools())));
app.get('/api/schools/:id/playback', wrap(async (req, res) => res.json(await db.schoolDaily(req.params.id))));
app.get('/api/wearable/playback', wrap(async (_req, res) => res.json(await db.wearableDaily())));

app.get('/health', wrap(async (_req, res) => {
  await db.ping();
  res.json({ status: 'ok', store: 'clickhouse', db: CLICKHOUSE_DB, ts: Date.now() });
}));
app.get('/', (_req, res) => res.json({ name: 'sb-api', status: 'ok' }));

app.listen(SB_API_PORT, () => console.log(
  `[sb-api] listening on :${SB_API_PORT} — ClickHouse ${CLICKHOUSE_DB} (read-only) — auth ${SB_API_KEY ? 'enabled' : 'disabled (dev)'}`,
));
