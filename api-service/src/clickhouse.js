// ClickHouse reads for the dashboard. Two kinds of read:
//   • precomputed INSIGHT BUNDLES — insights(month, kind, json), built per-month by
//     ingestion-service/build_insights.py. The dashboard fetches these at runtime (map, overview,
//     terminal health, stall explorer, March items/savings) so nothing is baked into the JS bundle.
//   • PLAYBACK series — trivial SELECTs over the small pb_* aggregate tables, filtered by month.
// All read as the SELECT-only smartbuddy_ro user. Column aliases match what the frontend expects.
import { ch, CLICKHOUSE_DB } from './config.js';

const DB = CLICKHOUSE_DB;

async function rows(query, query_params) {
  const rs = await ch.query({ query, query_params, format: 'JSONEachRow' });
  return rs.json();
}

// ── months + insight bundles ────────────────────────────────────────────────────
// Which months exist and which bundle kinds each has — powers the top-bar month picker.
export async function listMonths() {
  return rows(
    `SELECT month, groupUniqArray(kind) AS kinds
       FROM ${DB}.insights GROUP BY month ORDER BY month`,
  );
}

// The newest month with any bundle — used as the default when the client omits ?month=.
export async function latestMonth() {
  const r = await rows(`SELECT max(month) AS m FROM ${DB}.insights`);
  return r[0]?.m || '';
}

// One precomputed bundle as its RAW json string (newest version wins). null if absent.
export async function getInsight(month, kind) {
  const r = await rows(
    `SELECT json FROM ${DB}.insights
       WHERE month = {m:String} AND kind = {k:String} ORDER BY updated_at DESC LIMIT 1`,
    { m: String(month), k: String(kind) },
  );
  return r[0]?.json ?? null;
}

// ── playback series (per month) ───────────────────────────────────────────────────
export async function listSchools(month) {
  return rows(
    `SELECT school_id AS schoolId, name FROM ${DB}.pb_schools
       WHERE month = {m:String} ORDER BY sgd DESC`,
    { m: String(month) },
  );
}

export async function schoolDaily(id, month) {
  return rows(
    `SELECT toString(date) AS date, txns, revenue_sgd AS revenueSgd
       FROM ${DB}.pb_school_daily WHERE school_id = {id:String} AND month = {m:String} ORDER BY date`,
    { id: String(id), m: String(month) },
  );
}

export async function wearableDaily(month) {
  return rows(
    `SELECT toString(date) AS date, active_users AS activeUsers, avg_steps AS avgSteps, med_steps AS medSteps
       FROM ${DB}.pb_wearable_daily WHERE month = {m:String} ORDER BY date`,
    { m: String(month) },
  );
}

export async function ping() {
  await ch.query({ query: 'SELECT 1', format: 'JSONEachRow' });
  return true;
}
