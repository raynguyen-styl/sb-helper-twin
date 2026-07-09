import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH, MAX_ROWS_DEFAULT, MAX_ROWS_HARD, QUERY_TIMEOUT_MS } from "./config.js";

let _instance = null;

/** Open the DuckDB store READ_ONLY and lock the config so the SQL surface
 *  cannot reach the filesystem or re-enable anything. Called once at startup. */
export async function initDb() {
  if (_instance) return _instance;
  _instance = await DuckDBInstance.create(DB_PATH, { access_mode: "read_only" });
  // Apply hardening on a throwaway connection; instance-level settings persist.
  const con = await _instance.connect();
  await con.run("SET enable_external_access=false"); // blocks read_csv/COPY/httpfs/ATTACH file I/O
  try { await con.run("SET autoinstall_known_extensions=false"); } catch { /* older engines */ }
  try { await con.run("SET autoload_known_extensions=false"); } catch { /* older engines */ }
  await con.run("SET lock_configuration=true");       // no further SET is possible
  con.closeSync?.();
  return _instance;
}

// ── run_sql input guard ──────────────────────────────────────────────────────
// READ_ONLY + enable_external_access=false already make writes and file access
// impossible at the engine level. This is defense-in-depth at the string level:
// one statement, must start SELECT/WITH, and no data-movement/extension verbs.
const LEADING_OK = /^\s*(with|select)\b/i;
const BANNED = /\b(attach|detach|copy|install|load|pragma|export|import|call|checkpoint)\b/i;

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
    return { ok: false, error: "Query contains a disallowed keyword (ATTACH/COPY/INSTALL/LOAD/PRAGMA/EXPORT/IMPORT/CALL/CHECKPOINT).", hint: "Query only the existing tables with plain SELECT/WITH; file and extension access is disabled." };
  }
  return { ok: true, sql };
}

/** JSON-safe scalar: BigInt -> number|string; DuckDB*Value (date/time/decimal) -> string. */
function jsonSafe(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") {
    return v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v.toString();
  }
  if (typeof v === "object") return String(v); // DuckDBDateValue / DuckDBTimeValue / DECIMAL / BLOB
  return v;
}

function rowsToPlain(rowObjects) {
  return rowObjects.map((r) => {
    const o = {};
    for (const k of Object.keys(r)) o[k] = jsonSafe(r[k]);
    return o;
  });
}

/**
 * Execute a validated read-only query with a row cap + a wall-clock timeout.
 * Returns { rows, rowCount, truncated } or { error, hint }.
 */
export async function runReadOnlySql(sqlRaw, maxRows) {
  const check = validateReadOnlySql(sqlRaw);
  if (!check.ok) return { error: check.error, hint: check.hint };

  const cap = Math.min(Math.max(1, Number(maxRows) || MAX_ROWS_DEFAULT), MAX_ROWS_HARD);
  const inst = await initDb();
  const con = await inst.connect(); // per-call connection: a slow query can't block others

  let timer;
  try {
    const result = await Promise.race([
      con.runAndReadUntil(check.sql, cap + 1), // stops reading after ~cap rows (chunked)
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { con.interrupt(); } catch { /* best effort */ }
          reject(new Error(`Query exceeded ${QUERY_TIMEOUT_MS} ms and was cancelled.`));
        }, QUERY_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    const all = rowsToPlain(result.getRowObjects());
    const truncated = all.length > cap;
    return { rows: truncated ? all.slice(0, cap) : all, rowCount: Math.min(all.length, cap), truncated };
  } catch (e) {
    clearTimeout(timer);
    return {
      error: e.message.split("\n")[0],
      hint: "Check table/column names with list_tables + describe_table. The DB is read-only, single-statement SELECT/WITH only; file and extension access is disabled.",
    };
  } finally {
    try { con.closeSync?.(); } catch { /* ignore */ }
  }
}

/** Fast helper for internal metadata queries (list_tables/describe_table/sample_rows). */
export async function queryRows(sql, params = []) {
  const inst = await initDb();
  const con = await inst.connect();
  try {
    const result = params.length
      ? await con.runAndReadAll(sql, params)
      : await con.runAndReadAll(sql);
    return rowsToPlain(result.getRowObjects());
  } finally {
    try { con.closeSync?.(); } catch { /* ignore */ }
  }
}
