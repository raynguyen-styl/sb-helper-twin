import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to the read-only Feb DuckDB store. In Docker it is bind-mounted
// at /app/data/feb.duckdb (set FEB_DUCKDB_PATH); locally it resolves next door.
export const DB_PATH = (
  process.env.FEB_DUCKDB_PATH || path.resolve(__dirname, "../../data/feb.duckdb")
).trim();

// Port 3501 — arborist (tree-twin) uses 3500; do NOT collide (see PLAN §3.5).
export const MCP_PORT = Number(process.env.MCP_PORT) || 3501;

// Bearer token. Empty disables auth (LOCAL DEV ONLY — public deploys MUST set it).
export const MCP_API_KEY = (process.env.MCP_API_KEY || "").trim();

// run_sql result caps + query timeout (SQL surface is agent-written — bound it).
export const MAX_ROWS_DEFAULT = Number(process.env.MCP_MAX_ROWS_DEFAULT) || 1000;
export const MAX_ROWS_HARD = Number(process.env.MCP_MAX_ROWS_HARD) || 5000;
export const QUERY_TIMEOUT_MS = Number(process.env.MCP_QUERY_TIMEOUT_MS) || 15000;

// The dataset is a fixed historical month; the time tools anchor here, NOT "now".
export const DATASET = { from: "2026-02-01", to: "2026-02-28", tz: "Asia/Singapore (SGT, UTC+8)" };
