import "dotenv/config";

// ── ClickHouse (shared platform instance `clickhouse`, in-network only) ──────────────────────────
// SMART Buddy's Feb data lives in its OWN database `smartbuddy` on the shared ClickHouse. The MCP
// connects as a DEDICATED READ-ONLY user (SELECT only, scoped to that database) so the agent's SQL
// can never touch other demos' tables (raw UWB/camera) — defense-in-depth on top of readonly=1.
export const CLICKHOUSE_URL = (process.env.CLICKHOUSE_URL || "http://clickhouse:8123").replace(/\/$/, "");
export const CLICKHOUSE_DB = (process.env.CLICKHOUSE_DB || "smartbuddy").trim();
export const CLICKHOUSE_USER = (process.env.CLICKHOUSE_USER || "smartbuddy_ro").trim();
export const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";

// Port 3501 — arborist (tree-twin) uses 3500; do NOT collide (see PLAN §3.5).
export const MCP_PORT = Number(process.env.MCP_PORT) || 3501;

// Bearer token. Empty disables auth (LOCAL DEV ONLY — public deploys MUST set it).
export const MCP_API_KEY = (process.env.MCP_API_KEY || "").trim();

// run_sql result caps + query timeout (SQL surface is agent-written — bound it). The timeout is
// also enforced server-side via ClickHouse max_execution_time so a heavy query can't starve the
// shared instance's live ingest.
export const MAX_ROWS_DEFAULT = Number(process.env.MCP_MAX_ROWS_DEFAULT) || 1000;
export const MAX_ROWS_HARD = Number(process.env.MCP_MAX_ROWS_HARD) || 5000;
export const QUERY_TIMEOUT_MS = Number(process.env.MCP_QUERY_TIMEOUT_MS) || 15000;
// Cap per-query memory so an agent aggregation can't compete with the UWB/camera firehose on the
// shared instance (bytes). Default 2 GB.
export const MAX_MEMORY_BYTES = Number(process.env.MCP_MAX_MEMORY_BYTES) || 2_000_000_000;

// Where service routes start (plan_service_route). Coordinates from OneMap search for postal 408705.
// Keep in sync with client/src/eng-window.js START.
export const SERVICE_START = { name: "STYL Service Center", address: "3015A Ubi Road 1, #06-02, Singapore 408705", lat: 1.328343, lng: 103.893102 };

// The dataset is two fixed historical months; the time tools anchor here, NOT "now".
export const DATASET = { months: ["2026-02", "2026-03"], from: "2026-02-01", to: "2026-03-31", tz: "Asia/Singapore (SGT, UTC+8)" };
