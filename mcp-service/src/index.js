import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { MCP_PORT, MCP_API_KEY, DATASET, MAX_ROWS_DEFAULT, MAX_ROWS_HARD, CLICKHOUSE_DB, SERVICE_START } from "./config.js";
import { initDb, runReadOnlySql, queryRows } from "./db.js";
import { TABLES, LISTED, GLOBAL_NOTES } from "./schema.js";
import { resolveTimeRange } from "./timeRange.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/; // safe object-name guard for metadata tools
const json = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });

// Service visit order: from the start, always go to the nearest unvisited school. Same rule as
// client/src/eng-window.js orderStops — keep the two in sync.
// ponytail: greedy nearest-next on straight-line km, not road routing — OneMap routing API if drive times matter.
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
function orderStops(start, stops) {
  const out = [], left = [...stops];
  let at = start, total = 0;
  while (left.length) {
    let i = 0;
    left.forEach((s, j) => { if (km(at, s) < km(at, left[i])) i = j; });
    const [s] = left.splice(i, 1), leg = km(at, s);
    total += leg;
    out.push({ ...s, leg_km: +leg.toFixed(1), cum_km: +total.toFixed(1) });
    at = s;
  }
  return out;
}

function runSqlDescription() {
  const tableLines = LISTED.map((t) => `  ${t.padEnd(17)} — ${TABLES[t].purpose.split(". ")[0]}.`);
  return [
    "Run a READ-ONLY SQL query against the SMART Buddy ClickHouse store (February 2026 + March 2026) and get rows back.",
    "This is the main tool — write ClickHouse SQL to answer the question, then cite the numbers you get.",
    "",
    "HARD RULES (enforced): a single statement, must start with SELECT or WITH, read-only. Anything else is rejected with an {error, hint}.",
    "MONTH: every fact table has a `month` String column ('2026-02' | '2026-03'). ALWAYS filter WHERE month = '2026-0X' (or GROUP BY month). Wearables (health, heart_rate) are Feb-only; items + saving_spending are March-only; transactions/speed/stalls exist for both.",
    "ClickHouse dialect: dates are toDate('2026-03-14') (NOT DATE '…'); day-of-week is toDayOfWeek(txn_date) (Mon=1..Sun=7); recorded_time is a UNIX epoch → toDateTime(recorded_time); median()/quantile() and count(DISTINCT x) work; cast messy values with toInt32OrNull(toString(x)).",
    "",
    "Tables / views (call describe_table for columns + units):",
    ...tableLines,
    "",
    "Analysis rules you MUST follow:",
    ...GLOBAL_NOTES.map((n) => `  - ${n}`),
    "",
    "Example queries (copy & adapt — note the month filter):",
    "  -- verified-name food category coverage for a month (verified-only denominators for shares)",
    "  SELECT sc.mcat, count(*) AS txns, round(sum(t.amount)/100.0,2) AS revenue_sgd",
    "  FROM tx t JOIN stallcat sc USING (month, schoolId, storeId)",
    "  WHERE t.month = '2026-03' GROUP BY sc.mcat ORDER BY txns DESC;",
    "",
    "  -- spend per school MOE governance type ('atas' axis), matched schools only, one month",
    "  SELECT s.type AS moe_type, count(*) AS txns, round(avg(t.amount)/100.0,2) AS avg_ticket_sgd",
    "  FROM tx t JOIN schools s USING (schoolId) WHERE t.month = '2026-02' GROUP BY s.type ORDER BY txns DESC;",
    "",
    "  -- compare the two months' daily revenue",
    "  SELECT month, txn_date, round(sum(amount)/100.0,2) AS revenue_sgd, count(*) AS txns",
    "  FROM tx GROUP BY month, txn_date ORDER BY month, txn_date;",
    "",
    "  -- mean heart rate, FEBRUARY only (exclude 0/255 sentinels; recorded_time is an epoch)",
    "  SELECT round(avg(bpm_number),1) AS mean_bpm, count(*) AS readings, count(DISTINCT user_id) AS users",
    "  FROM heart_rate WHERE month = '2026-02' AND bpm_number BETWEEN 30 AND 220;",
    "",
    "  -- MARCH Healthier-Choice share of purchase items",
    "  SELECT round(100.0*countIf(toInt32OrNull(toString(healthyChoice))=1)/count(),1) AS healthy_pct",
    "  FROM items WHERE month = '2026-03';",
    "",
    "  -- transaction speed by network stack, one month (guard startToFinish > 0)",
    "  SELECT posNetworkType, count(*) AS n, round(median(startToFinish)) AS median_ms",
    "  FROM txn_perf WHERE month = '2026-02' AND startToFinish > 0 GROUP BY posNetworkType ORDER BY n DESC;",
    "",
    "  -- service list: machines with a problem in March, worst first, with where to go (then plan_service_route)",
    "  SELECT terminalId, schoolId, school_name, postal, zone, storeName, problems, err_pct, med_ms",
    "  FROM terminal_health WHERE month = '2026-03' AND notEmpty(problems) ORDER BY err_pct DESC LIMIT 50;",
    "",
    `Use resolve_time_range for date phrases (CNY, weekends, 'first week', a weekday). maxRows caps the result (default ${MAX_ROWS_DEFAULT}, max ${MAX_ROWS_HARD}); large results are truncated with truncated=true — aggregate in SQL instead of pulling raw rows.`,
  ].join("\n");
}

function buildMcpServer() {
  const server = new McpServer({ name: "smartbuddy-mcp", version: "1.0.0" });

  server.tool(
    "get_server_time",
    "Return the real server clock AND the fixed scope of this dataset. Call this first: the data is a historical snapshot of FEBRUARY 2026 and MARCH 2026 (SGT) — do not assume it matches your training year or 'today'. Every fact table has a `month` column ('2026-02' | '2026-03'); always filter it.",
    {},
    async () => {
      const now = Date.now();
      return { content: [{ type: "text", text: JSON.stringify({ serverNowMs: now, serverNowIso: new Date(now).toISOString(), dataset: DATASET, months: ["2026-02", "2026-03"], note: "Two months. Filter the `month` column. Wearables are Feb-only; items/saving_spending are March-only." }, null, 2) }] };
    },
  );

  server.tool(
    "resolve_time_range",
    "Turn a natural-language date phrase into exact dates (SGT) within a dataset month plus a ready-to-paste SQL predicate that pins the `month` column + a txn_date range. Detects 'March'/'February' (default Feb; CNY forces Feb). Handles: explicit dates (2026-03-14 or 3-14), 'CNY'/'Chinese New Year' (+ 'CNY week'), 'Valentine', 'first/second/third/last week', 'weekend', 'weekday'/'school day', and weekday names. Use its `predicate` directly in run_sql; it returns the `month` too.",
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
        try { rowCount = Number((await queryRows(`SELECT count(*) AS n FROM ${t}`))[0].n); } catch { /* ignore */ }
        out.push({ name: t, kind: TABLES[t].kind, rowCount, purpose: TABLES[t].purpose });
      }
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    },
  );

  server.tool(
    "describe_table",
    "Show a table/view's columns with live ClickHouse types PLUS curated notes on units (cents SGD, millical, cm), exclusions, and gotchas (HR 255 sentinel, no txn↔health linkage, verified-name taxonomy). Call before writing SQL against a table.",
    { table: z.string().describe(`Table/view name. One of: ${LISTED.join(", ")} (or stall_category).`) },
    async ({ table }) => {
      const name = String(table || "").trim();
      if (!IDENT.test(name)) return { content: [{ type: "text", text: JSON.stringify({ error: `Invalid table name '${table}'.`, hint: `Use one of: ${LISTED.join(", ")}.` }) }] };
      const meta = TABLES[name] || (name === "stall_category" ? TABLES.stallcat : null);
      let cols;
      try {
        // name is IDENT-guarded above (safe to interpolate); CLICKHOUSE_DB is trusted config.
        // DESCRIBE works with just the SELECT grant on the db — no need for system.* access.
        const raw = await queryRows(`DESCRIBE TABLE \`${CLICKHOUSE_DB}\`.\`${name}\``);
        cols = raw.map((c) => ({ column_name: c.name, data_type: c.type }));
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
      sql: z.string().describe("A single read-only ClickHouse query. Must start with SELECT or WITH."),
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

  server.tool(
    "plan_service_route",
    `Order service visits for the machines a service staff member chose (find them first in terminal_health). Groups the machines by school (one stop fixes all of them there), starts at the ${SERVICE_START.name} (${SERVICE_START.address}) and always goes to the nearest next school. Returns the stops in order with address, straight-line km per leg and each machine's problems, plus machines it can't route (no confirmed location, e.g. PBS/SSSTM vendor machines). Distances are straight-line, not driving.`,
    {
      month: z.string().regex(/^\d{4}-\d{2}$/).describe("Data month, e.g. '2026-03'."),
      terminalIds: z.array(z.string().max(40)).max(300).optional().describe("Chosen machine serials (terminal_health.terminalId)."),
      schoolIds: z.array(z.string().max(20)).max(300).optional().describe("Chosen schools — includes every machine there that has a problem."),
    },
    async ({ month, terminalIds = [], schoolIds = [] }) => {
      console.log(`[tool] plan_service_route month=${month} terminals=${terminalIds.length} schools=${schoolIds.length}`);
      if (!terminalIds.length && !schoolIds.length) {
        return json({ error: "Give terminalIds and/or schoolIds.", hint: "Query terminal_health first and let the user pick." });
      }
      let rows;
      try {
        rows = await queryRows(
          `SELECT terminalId, schoolId, school_name, postal, zone, lat, lng, storeName, problems, err_pct, med_ms, last_day
             FROM terminal_health WHERE month = {m:String}
              AND (has({t:Array(String)}, terminalId) OR (has({s:Array(String)}, schoolId) AND notEmpty(problems)))`,
          { m: month, t: terminalIds, s: schoolIds });
      } catch (e) { return json({ error: String(e.message || e).split("\n")[0] }); }

      const bySchool = new Map(), notRoutable = [];
      for (const r of rows) {
        const m = { terminalId: r.terminalId, storeName: r.storeName, problems: r.problems, err_pct: r.err_pct,
                    med_ms: r.med_ms == null ? null : Number(r.med_ms), last_day: r.last_day };
        if (r.lat == null || r.lng == null) { notRoutable.push({ ...m, schoolId: r.schoolId }); continue; }
        if (!bySchool.has(r.schoolId)) {
          bySchool.set(r.schoolId, { schoolId: r.schoolId, school_name: r.school_name, postal: r.postal, zone: r.zone,
                                     lat: r.lat, lng: r.lng, machines: [] });
        }
        bySchool.get(r.schoolId).machines.push(m);
      }
      const stops = orderStops(SERVICE_START, [...bySchool.values()]);
      const found = new Set(rows.map((r) => r.terminalId));
      return json({
        month, start: SERVICE_START, stops: stops.map((s, i) => ({ stop: i + 1, ...s })),
        total_km: stops.length ? stops[stops.length - 1].cum_km : 0,
        not_routable: notRoutable, not_found: terminalIds.filter((t) => !found.has(t)),
        note: `Straight-line distances, not driving routes. Faults describe ${month}, not today.`,
      });
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

// Always start listening — do NOT hard-exit if ClickHouse isn't ready. The `smartbuddy` db + the
// read-only user are created by ch-ingest; until then (or during a transient ClickHouse blip) tool
// calls degrade gracefully to {error,hint} instead of crash-looping the container (mirrors sb-api).
app.listen(MCP_PORT, () => {
  console.log(`[smartbuddy-mcp] listening on :${MCP_PORT} — auth: ${MCP_API_KEY ? "enabled" : "disabled (dev)"} — ClickHouse READ-ONLY`);
});
initDb()
  .then(() => console.log("[smartbuddy-mcp] ClickHouse reachable — smartbuddy db ready"))
  .catch((e) => console.warn(`[smartbuddy-mcp] ClickHouse not ready yet (tools error until ch-ingest runs): ${e.message}`));
