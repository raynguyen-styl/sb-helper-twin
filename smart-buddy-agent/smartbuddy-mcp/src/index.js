import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { MCP_PORT, MCP_API_KEY, DATASET, MAX_ROWS_DEFAULT, MAX_ROWS_HARD } from "./config.js";
import { initDb, runReadOnlySql, queryRows } from "./db.js";
import { TABLES, LISTED, GLOBAL_NOTES } from "./schema.js";
import { resolveTimeRange } from "./timeRange.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/; // safe object-name guard for metadata tools

function runSqlDescription() {
  const tableLines = LISTED.map((t) => `  ${t.padEnd(17)} — ${TABLES[t].purpose.split(". ")[0]}.`);
  return [
    "Run a READ-ONLY SQL query against the SMART Buddy February-2026 DuckDB store and get rows back.",
    "This is the main tool — write DuckDB SQL to answer the question, then cite the numbers you get.",
    "",
    "HARD RULES (enforced): a single statement, must start with SELECT or WITH, read-only, no file/extension access. Anything else is rejected with an {error, hint}.",
    "",
    "Tables / views (call describe_table for columns + units):",
    ...tableLines,
    "",
    "Analysis rules you MUST follow:",
    ...GLOBAL_NOTES.map((n) => `  - ${n}`),
    "",
    "Example queries (copy & adapt):",
    "  -- verified-name food category coverage (use verified-only denominators for shares)",
    "  SELECT sc.mcat, count(*) AS txns, round(sum(t.amount)/100.0,2) AS revenue_sgd",
    "  FROM tx t JOIN stallcat sc USING (schoolId, storeId) GROUP BY sc.mcat ORDER BY txns DESC;",
    "",
    "  -- spend per school with MOE governance type ('atas' axis), matched schools only",
    "  SELECT s.type AS moe_type, count(*) AS txns, round(avg(t.amount)/100.0,2) AS avg_ticket_sgd",
    "  FROM tx t JOIN schools s USING (schoolId) GROUP BY s.type ORDER BY txns DESC;",
    "",
    "  -- CNY impact: daily revenue across the CNY window",
    "  SELECT txn_date, round(sum(amount)/100.0,2) AS revenue_sgd, count(*) AS txns",
    "  FROM tx WHERE txn_date BETWEEN DATE '2026-02-13' AND DATE '2026-02-22' GROUP BY txn_date ORDER BY txn_date;",
    "",
    "  -- mean heart rate (exclude the 255 sentinel; Feb dates only)",
    "  SELECT round(avg(bpm_number),1) AS mean_bpm, count(*) AS readings, count(DISTINCT user_id) AS users",
    "  FROM feb_heart_rate WHERE bpm_number BETWEEN 30 AND 220",
    "    AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28';",
    "",
    "  -- transaction speed by network stack (guard startToFinish > 0)",
    "  SELECT posNetworkType, count(*) AS n, round(median(startToFinish)) AS median_ms",
    "  FROM txn_perf_202602 WHERE startToFinish > 0 GROUP BY posNetworkType ORDER BY n DESC;",
    "",
    `Use resolve_time_range for date phrases (CNY, weekends, 'first week', a weekday). maxRows caps the result (default ${MAX_ROWS_DEFAULT}, max ${MAX_ROWS_HARD}); large results are truncated with truncated=true — aggregate in SQL instead of pulling raw rows.`,
  ].join("\n");
}

function buildMcpServer() {
  const server = new McpServer({ name: "smartbuddy-mcp", version: "1.0.0" });

  server.tool(
    "get_server_time",
    "Return the real server clock AND the fixed scope of this dataset. Call this first: the data is a historical snapshot of FEBRUARY 2026 (SGT) — do not assume it matches your training year or 'today'. All date filtering must stay within 2026-02-01..2026-02-28.",
    {},
    async () => {
      const now = Date.now();
      return { content: [{ type: "text", text: JSON.stringify({ serverNowMs: now, serverNowIso: new Date(now).toISOString(), dataset: DATASET, note: "Query dates within February 2026 only." }, null, 2) }] };
    },
  );

  server.tool(
    "resolve_time_range",
    "Turn a natural-language date phrase into exact February-2026 dates (SGT) plus a ready-to-paste SQL predicate on txn_date. Handles: explicit dates (2026-02-14 or 2-14), 'CNY'/'Chinese New Year' (and 'CNY week'), 'Valentine', 'first/second/third/last week', 'weekend', 'weekday'/'school day', and weekday names (returns every matching Feb date). Use its `predicate` directly in run_sql.",
    { text: z.string().describe("The date phrase, e.g. 'CNY week', 'first week', 'every Monday', '2-14', 'weekends'.") },
    async ({ text }) => {
      console.log(`[tool] resolve_time_range text=${String(text).slice(0, 60)}`);
      return { content: [{ type: "text", text: JSON.stringify(resolveTimeRange(text), null, 2) }] };
    },
  );

  server.tool(
    "list_tables",
    "List the queryable tables/views with their purpose and row counts. Start here to learn the shape of the data before writing SQL.",
    {},
    async () => {
      const out = [];
      for (const t of LISTED) {
        let rowCount = null;
        try { rowCount = (await queryRows(`SELECT count(*) AS n FROM ${t}`))[0].n; } catch { /* ignore */ }
        out.push({ name: t, kind: TABLES[t].kind, rowCount, purpose: TABLES[t].purpose });
      }
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    },
  );

  server.tool(
    "describe_table",
    "Show a table/view's columns with live DuckDB types PLUS curated notes on units (cents SGD, millical, cm), exclusions, and gotchas (HR 255 sentinel, no txn↔health linkage, verified-name taxonomy). Call before writing SQL against a table.",
    { table: z.string().describe(`Table/view name. One of: ${LISTED.join(", ")} (or stall_category).`) },
    async ({ table }) => {
      const name = String(table || "").trim();
      if (!IDENT.test(name)) return { content: [{ type: "text", text: JSON.stringify({ error: `Invalid table name '${table}'.`, hint: `Use one of: ${LISTED.join(", ")}.` }) }] };
      const meta = TABLES[name] || (name === "stall_category" ? TABLES.stallcat : null);
      let cols;
      try {
        cols = await queryRows(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='main' AND table_name = ? ORDER BY ordinal_position",
          [name],
        );
      } catch (e) { return { content: [{ type: "text", text: JSON.stringify({ error: e.message.split("\n")[0] }) }] }; }
      if (!cols.length) return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown table '${name}'.`, hint: `Use one of: ${LISTED.join(", ")}.` }) }] };
      return { content: [{ type: "text", text: JSON.stringify({ table: name, kind: meta?.kind ?? "table", purpose: meta?.purpose ?? null, columns: cols, notes: meta?.notes ?? [] }, null, 2) }] };
    },
  );

  server.tool(
    "sample_rows",
    "Return the first few rows of a table/view so you can see the actual shape and value formats before writing SQL. NOT a random sample — just a quick peek.",
    {
      table: z.string().describe(`Table/view name. One of: ${LISTED.join(", ")} (or stall_category).`),
      limit: z.number().int().min(1).max(20).optional().describe("Rows to return (default 5, max 20)."),
    },
    async ({ table, limit }) => {
      const name = String(table || "").trim();
      if (!IDENT.test(name)) return { content: [{ type: "text", text: JSON.stringify({ error: `Invalid table name '${table}'.` }) }] };
      const n = Math.min(Math.max(1, Number(limit) || 5), 20);
      const res = await runReadOnlySql(`SELECT * FROM ${name} LIMIT ${n}`, n);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );

  server.tool(
    "run_sql",
    runSqlDescription(),
    {
      sql: z.string().describe("A single read-only DuckDB query. Must start with SELECT or WITH."),
      maxRows: z.number().int().min(1).max(MAX_ROWS_HARD).optional().describe(`Row cap (default ${MAX_ROWS_DEFAULT}, max ${MAX_ROWS_HARD}). Aggregate in SQL rather than pulling raw rows.`),
    },
    async ({ sql, maxRows }) => {
      console.log(`[tool] run_sql maxRows=${maxRows ?? MAX_ROWS_DEFAULT} sql=${String(sql).slice(0, 140).replace(/\s+/g, " ")}`);
      const res = await runReadOnlySql(sql, maxRows);
      if (res.error) console.warn(`[tool] run_sql rejected/failed: ${res.error}`);
      else console.log(`[tool] run_sql OK rows=${res.rowCount} truncated=${res.truncated}`);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );

  return server;
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => { console.log(`[http] ${req.method} ${req.path} from ${req.ip}`); next(); });

function setMcpCorsHeaders(res) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

app.use("/mcp", (req, res, next) => {
  setMcpCorsHeaders(res);
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// Bearer auth guard. Empty MCP_API_KEY disables it (LOCAL DEV ONLY).
if (MCP_API_KEY) {
  app.use("/mcp", (req, res, next) => {
    const auth = String(req.headers["authorization"] || "").trim();
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth;
    if (token !== MCP_API_KEY) {
      console.warn("[mcp] auth failed from", req.ip);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
}

// Stateless MCP endpoint — new server + transport per request.
app.all("/mcp", async (req, res) => {
  const method = req.body?.method;
  if (method === "tools/call") console.log(`[mcp] tool call: ${req.body?.params?.name}`);
  else console.log(`[mcp] request: ${method}`);
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] request error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));
app.get("/", (_req, res) => res.json({ name: "smartbuddy-mcp", status: "ok" }));

initDb()
  .then(() => app.listen(MCP_PORT, () => {
    console.log(`[smartbuddy-mcp] listening on :${MCP_PORT} — auth: ${MCP_API_KEY ? "enabled" : "disabled (dev)"} — db READ_ONLY`);
  }))
  .catch((e) => { console.error("[smartbuddy-mcp] failed to open DuckDB:", e.message); process.exit(1); });
