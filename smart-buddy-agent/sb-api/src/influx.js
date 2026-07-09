// Flux readers over the pre-aggregated sb_* measurements. Because ingestion writes ONE point per
// entity per bucket (compute-at-ingest), the API never re-aggregates — it just filters to one
// entity, merges the field-split with group(["_field"]) (tree-twin's mandatory step), pivots the
// fields into columns, and maps to a clean shape. Money is cents in Influx → dollars out.
import { queryApi, INFLUX_BUCKET, POC_START, POC_END } from './config.js';

const B = INFLUX_BUCKET;
const esc = (s) => String(s).replace(/"/g, '\\"');
const day = (d) => String(d).slice(0, 10);
const range = (from, to) => `range(start: ${from || POC_START}T00:00:00Z, stop: ${to || POC_END}T23:59:59Z)`;

// Generic single-entity series read. `predicate` filters to one entity (empty for a cohort).
async function pivotSeries(measurement, predicate, from, to) {
  return queryApi.collectRows(`
from(bucket: "${B}")
  |> ${range(from, to)}
  |> filter(fn: (r) => r._measurement == "${measurement}"${predicate ? ` and ${predicate}` : ''})
  |> group(columns: ["_field"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])`);
}

// per-school per-day KPIs
export async function schoolDaily(schoolId, from, to) {
  const rows = await pivotSeries('sb_school', `r.schoolId == "${esc(schoolId)}"`, from, to);
  return rows.map((r) => ({
    date: day(r._time), txns: r.txns ?? 0, revenueSgd: (r.revenue_cents ?? 0) / 100,
    errPct: r.err_pct ?? null, distinctCards: r.distinct_cards ?? 0,
  }));
}

// per-school per-HOUR (recess spikes, CNY drop) — counts only, no speed at school level
export async function schoolHourly(schoolId, from, to) {
  const rows = await pivotSeries('sb_school_hr', `r.schoolId == "${esc(schoolId)}"`, from, to);
  return rows.map((r) => ({
    time: r._time, txns: r.txns ?? 0, revenueSgd: (r.revenue_cents ?? 0) / 100,
    errCount: r.err_count ?? 0, offlineCount: r.offline_count ?? 0,
  }));
}

// per-terminal per-HOUR (the detail timeline — carries speed)
export async function terminalHourly(terminalId, from, to) {
  const rows = await pivotSeries('sb_txn', `r.terminalId == "${esc(terminalId)}"`, from, to);
  return rows.map((r) => ({
    time: r._time, txns: r.txns ?? 0, revenueSgd: (r.revenue_cents ?? 0) / 100,
    errCount: r.err_count ?? 0, offlineCount: r.offline_count ?? 0, medianSpeedMs: r.median_speed_ms ?? null,
  }));
}

// per-stall per-day
export async function stallDaily(schoolId, storeId, from, to) {
  const rows = await pivotSeries('sb_stall', `r.schoolId == "${esc(schoolId)}" and r.storeId == "${esc(storeId)}"`, from, to);
  return rows.map((r) => ({ date: day(r._time), txns: r.txns ?? 0, revenueSgd: (r.revenue_cents ?? 0) / 100 }));
}

// wearable COHORT per day (the wearable window)
export async function wearableCohort(from, to) {
  const rows = await pivotSeries('sb_wearable_cohort', '', from, to);
  return rows.map((r) => ({
    date: day(r._time), activeUsers: r.active_users ?? 0, avgSteps: r.avg_steps ?? null,
    meanBpm: r.mean_bpm ?? null, restingBpm: r.resting_bpm ?? null,
  }));
}

// individual WEARABLE-USER per day (user_id is a tag → this works; the per-CARD analogue does not,
// see the /api/cards route). token = the sb_… hashed user id.
export async function wearableUser(token, from, to) {
  const rows = await pivotSeries('sb_wearable', `r.user_id == "${esc(token)}"`, from, to);
  return rows.map((r) => ({ date: day(r._time), steps: r.steps ?? null, meanBpm: r.mean_bpm ?? null, restingBpm: r.resting_bpm ?? null }));
}
