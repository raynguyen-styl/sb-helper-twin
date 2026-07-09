// sb-api — SMART Buddy read API (InfluxDB history + Ditto state) for the playback frontend.
// Clone of tree-digital-twin/nparks-api. Behind the shared nginx-proxy; optional Bearer on /api.
import express from 'express';
import { SB_API_PORT, SB_API_KEY, DITTO_NAMESPACE, INFLUX_BUCKET } from './config.js';
import * as flux from './influx.js';
import * as ditto from './ditto.js';

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

// Optional Bearer auth on data routes (answers carry real, if hashed, ids → gate in prod)
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

// ── current state (Ditto) — map markers ────────────────────────────────────────
app.get('/api/schools', wrap(async (req, res) => res.json(await ditto.listSchools())));
app.get('/api/terminals', wrap(async (req, res) => res.json(await ditto.listTerminals(req.query.school))));

// ── history (Influx) — playback series ─────────────────────────────────────────
app.get('/api/schools/:id/playback', wrap(async (req, res) =>
  res.json(await flux.schoolDaily(req.params.id, req.query.from, req.query.to))));
app.get('/api/schools/:id/hourly', wrap(async (req, res) =>
  res.json(await flux.schoolHourly(req.params.id, req.query.from, req.query.to))));
app.get('/api/terminals/:id/playback', wrap(async (req, res) =>
  res.json(await flux.terminalHourly(req.params.id, req.query.from, req.query.to))));
app.get('/api/schools/:sid/stalls/:storeId/playback', wrap(async (req, res) =>
  res.json(await flux.stallDaily(req.params.sid, req.params.storeId, req.query.from, req.query.to))));
app.get('/api/wearable/playback', wrap(async (req, res) =>
  res.json(await flux.wearableCohort(req.query.from, req.query.to))));
app.get('/api/wearable/:token/playback', wrap(async (req, res) =>
  res.json(await flux.wearableUser(req.params.token, req.query.from, req.query.to))));

// individual CARD timeline — intentionally NOT enabled (decision A stored cardId as a FIELD to
// avoid 179K-series Influx cardinality; per-card correlation needs cardId as a TAG or a side index).
// The per-WEARABLE-USER analogue works (user_id is a tag): /api/wearable/:token/playback.
app.get('/api/cards/:token/timeline', (req, res) => res.status(501).json({
  error: 'individual card timeline not enabled',
  hint: 'sb_card stores cardId as a FIELD (decision A — avoids ~179K Influx series). Per-card reads '
      + 'need cardId as a tag (cardinality cost) or a small side index. Decide before enabling. '
      + 'Per-user wearable timeline is available at /api/wearable/:token/playback.',
}));

app.get('/health', (_req, res) => res.json({ status: 'ok', bucket: INFLUX_BUCKET, ns: DITTO_NAMESPACE, ts: Date.now() }));
app.get('/', (_req, res) => res.json({ name: 'sb-api', status: 'ok' }));

app.listen(SB_API_PORT, () => console.log(`[sb-api] listening on :${SB_API_PORT} — auth ${SB_API_KEY ? 'enabled' : 'disabled (dev)'}`));
