import { createClient } from "@clickhouse/client";
import {
  CLICKHOUSE_URL, CLICKHOUSE_DB, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD,
  MAX_ROWS_DEFAULT, MAX_ROWS_HARD, QUERY_TIMEOUT_MS, MAX_MEMORY_BYTES,
} from "./config.js";

let _client = null;

/** Open the ClickHouse client scoped to the `smartbuddy` database as the READ-ONLY user.
 *  readonly=1 + the SELECT-only grant on that DB make writes impossible at the engine level. */
export async function initDb() {
  if (_client) return _client;
  _client = createClient({
    url: CLICKHOUSE_URL,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
    database: CLICKHOUSE_DB,
    request_timeout: QUERY_TIMEOUT_MS + 2000,
    clickhouse_settings: {
      // Hard read-only session: no writes, and settings can't be changed by the query (level 2).
      readonly: 2,
      // Bound cost so an agent query can't starve the shared instance's live ingest.
      max_execution_time: Math.ceil(QUERY_TIMEOUT_MS / 1000),
      max_memory_usage: String(MAX_MEMORY_BYTES),
      max_result_rows: String(MAX_ROWS_HARD),
      result_overflow_mode: "break",
      // ISO-ish inputs are tolerated (matches how atlantic's reader configures the client).
      date_time_input_format: "best_effort",
    },
    // A generic client-level ping/keepalive is fine for a low-traffic agent adapter.
  });
  // Fail fast if the DB/user is wrong.
  await _client.query({ query: "SELECT 1", format: "JSONEachRow" });
  return _client;
}

// ── run_sql input guard ──────────────────────────────────────────────────────
// readonly=2 + a SELECT-only user already make writes/DDL impossible at the engine level. This is
// defense-in-depth at the string level: one statement, must start SELECT/WITH, and no ClickHouse
// data-movement / DDL / session verbs.
const LEADING_OK = /^\s*(with|select)\b/i;
const BANNED = /\b(insert|alter|create|drop|rename|truncate|attach|detach|optimize|grant|revoke|set|system|use|kill|exchange|move)\b/i;

export function validateReadOnlySql(sqlRaw) {
  const sql = String(sqlRaw || "").trim().replace(/;\s*$/, "");
  if (!sql) return { ok: false, error: "Empty query.", hint: "Provide a SELECT or WITH query." };
  if (sql.includes(";")) {
    return { ok: false, error: "Only a single statement is allowed.", hint: "Remove the ';' and send one SELECT/WITH statement." };
  }
  if (!LEADING_OK.test(sql)) {
    return { ok: false, error: "Only read-only SELECT / WITH queries are allowed.", hint: "Start the query with SELECT or WITH. The database is read-only." };
  }
  if (BANNED.test(sql)) {
    return { ok: false, error: "Query contains a disallowed keyword (INSERT/ALTER/CREATE/DROP/RENAME/TRUNCATE/ATTACH/OPTIMIZE/GRANT/SET/SYSTEM/USE/…).", hint: "Query only the existing tables with plain SELECT/WITH — the store is read-only." };
  }
  return { ok: true, sql };
}

/**
 * Execute a validated read-only query with a row cap (server + client) and a wall-clock timeout.
 * Returns { rows, rowCount, truncated } or { error, hint }.
 */
export async function runReadOnlySql(sqlRaw, maxRows) {
  const check = validateReadOnlySql(sqlRaw);
  if (!check.ok) return { error: check.error, hint: check.hint };

  const cap = Math.min(Math.max(1, Number(maxRows) || MAX_ROWS_DEFAULT), MAX_ROWS_HARD);
  const client = await initDb();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), QUERY_TIMEOUT_MS + 1000);
  try {
    const rs = await client.query({
      query: check.sql,
      format: "JSONEachRow",
      abort_signal: abort.signal,
      // per-query cap: fetch one more than the cap to detect truncation
      clickhouse_settings: { max_result_rows: String(cap + 1), result_overflow_mode: "break" },
    });
    const all = await rs.json();
    const truncated = all.length > cap;
    return { rows: truncated ? all.slice(0, cap) : all, rowCount: Math.min(all.length, cap), truncated };
  } catch (e) {
    return {
      error: String(e.message || e).split("\n")[0],
      hint: "Check table/column names with list_tables + describe_table. Read-only, single-statement SELECT/WITH only. This is ClickHouse SQL — use toDate('YYYY-MM-DD') (not DATE '…'), toDayOfWeek() (Mon=1..Sun=7), toDateOrNull() for text dates.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fast helper for internal queries (list_tables/describe_table/plan_service_route). Values go in
 *  query_params ({name:Type} placeholders) — never interpolated. */
export async function queryRows(sql, query_params) {
  const client = await initDb();
  const rs = await client.query({ query: sql, query_params, format: "JSONEachRow" });
  return rs.json();
}
