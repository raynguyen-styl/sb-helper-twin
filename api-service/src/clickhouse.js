// ClickHouse reads for the Playback window. Trivial SELECTs over the small pb_* aggregate tables
// that ch-ingest precomputes (build_feb_clickhouse.py) — so sb-api never runs heavy aggregation on
// the shared instance. Column aliases match the shapes the frontend (sbApi.js) expects.
import { ch, CLICKHOUSE_DB } from './config.js';

const DB = CLICKHOUSE_DB;

async function rows(query, query_params) {
  const rs = await ch.query({ query, query_params, format: 'JSONEachRow' });
  return rs.json();
}

// Dropdown list — biggest spenders first.
export async function listSchools() {
  return rows(`SELECT school_id AS schoolId, name FROM ${DB}.pb_schools ORDER BY sgd DESC`);
}

// Per-school daily series (txns + revenue) across February.
export async function schoolDaily(id) {
  return rows(
    `SELECT toString(date) AS date, txns, revenue_sgd AS revenueSgd
       FROM ${DB}.pb_school_daily WHERE school_id = {id:String} ORDER BY date`,
    { id: String(id) },
  );
}

// Wearable cohort daily series (steps + active users).
export async function wearableDaily() {
  return rows(
    `SELECT toString(date) AS date, active_users AS activeUsers, avg_steps AS avgSteps, med_steps AS medSteps
       FROM ${DB}.pb_wearable_daily ORDER BY date`,
  );
}

export async function ping() {
  await ch.query({ query: 'SELECT 1', format: 'JSONEachRow' });
  return true;
}
