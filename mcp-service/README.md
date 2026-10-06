# smartbuddy-mcp

MCP (Model Context Protocol) adapter that lets the SMART Buddy SAM agent answer
natural-language questions by writing **read-only ClickHouse SQL** over the February + March 2026
dataset. The data lives in the **shared ClickHouse instance** in its own `smartbuddy`
database (loaded by `../ingestion-service`: the dashboard upload flow / `ingest_core.py`, plus
`build_insights.py` for `terminal_health`); this adapter connects as a
**dedicated read-only user** (`smartbuddy_ro`, SELECT only on that database). Modelled on
`iot-platform/mcp-rtls-server`, with the InfluxDB/Ditto data layer swapped for ClickHouse.

## Tools

| Tool | Purpose |
|---|---|
| `get_server_time` | Real clock **+ the fixed dataset scope** (Feb + March 2026, SGT). Call first — the data is not "today". |
| `resolve_time_range` | NL date phrase → exact dates + a ready SQL predicate (CNY, weekends, "first week", a weekday). Defaults to Feb unless the phrase says March. |
| `list_tables` | Queryable tables/views + row counts + purpose. |
| `describe_table` | Live column types **+ curated units/exclusions/gotchas**. |
| `sample_rows` | First N rows (≤20) to see the shape. |
| `run_sql` | **The main tool** — run one read-only `SELECT`/`WITH` query, get rows back. |
| `plan_service_route` | Service staff: chosen machines (`terminal_health`) → ordered visit list, one stop per school, nearest-next from the STYL Service Center (straight-line km). Values bound as query params. |

Data surface (all in the `smartbuddy` database, every fact table has a `month` column): `tx`
(student-traffic-filtered txn view — use for spend/behaviour), `txn` (raw), `txn_perf` (speed),
`terminal_health` (service view), `stallcat`/`stall_category` (verified-name food category), `health`,
`heart_rate` (Feb + March), `items`, `saving_spending` (March only), `schools`. The curated notes live in
`src/schema.js`.

Dialect: this is **ClickHouse SQL** — `toDate('YYYY-MM-DD')` (not `DATE '…'`), `toDayOfWeek()`
(Mon=1..Sun=7), `toDateTime(recorded_time)` for the epoch columns; `median()`/`quantile()` and
`count(DISTINCT x)` are available.

## Security (the SQL surface is agent-written, on a SHARED instance)

- Connects as a **dedicated read-only user** (`smartbuddy_ro`) with `SELECT` only on `smartbuddy.*` →
  the agent's SQL can never read or touch the other demos' tables (raw UWB/camera).
- Session is **hard read-only** (`readonly=2`) → no writes and no per-query setting changes possible.
- `run_sql` guard: **single statement**, must start `SELECT`/`WITH`, denylist of ClickHouse
  data-movement/DDL/session verbs (`INSERT/ALTER/CREATE/DROP/RENAME/TRUNCATE/ATTACH/OPTIMIZE/GRANT/SET/SYSTEM/USE/…`)
  → returned as `{error, hint}` (never thrown, so the agent self-corrects).
- Per-query **row cap** (default 1000 / max 5000) + **timeout** (15 s, client abort + server-side
  `max_execution_time`) + a **`max_memory_usage` cap** (~2 GB) → a heavy agent query can't starve the
  shared instance's live ingest for RAM or CPU.
- **Bearer `MCP_API_KEY`** (set from the VM's `SB_MCP_API_KEY`) on `/mcp` (empty = disabled, local dev only). Use a fresh secret on the VM — never a tree-twin key.
- Query **results are untrusted** (e.g. `storeName` free text) — the agent brief tells the model to treat them as data, never instructions.

## Run locally

```bash
npm install
# needs a reachable ClickHouse with the `smartbuddy` db loaded — see ../DEPLOY.md
# (and point CLICKHOUSE_URL at it)
npm start                      # → http://localhost:3501  (auth disabled unless MCP_API_KEY set)
node test-client.mjs           # smoke test over the real MCP protocol (server must be running)
```

`GET /health` → `{status:"ok"}`. MCP endpoint is stateless `POST /mcp`.

## Docker

Node ESM image; queries ClickHouse over HTTP via `@clickhouse/client` — no local data file to
mount. See `../docker-compose.agent.yml` and `../../DEPLOY.md`.

Env: see `.env.example` — `MCP_PORT=3501`, `MCP_API_KEY`, `CLICKHOUSE_URL`, `CLICKHOUSE_DB=smartbuddy`,
`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD` (the read-only user), plus the row/timeout/memory caps.
