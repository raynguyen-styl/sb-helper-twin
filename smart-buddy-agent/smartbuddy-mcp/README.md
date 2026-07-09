# smartbuddy-mcp

MCP (Model Context Protocol) adapter that lets the SMART Buddy SAM agent answer
natural-language questions by writing **read-only SQL** over the February-2026
DuckDB store (`../data/feb.duckdb`). Modelled on `iot-platform/mcp-rtls-server`,
with the InfluxDB/Ditto data layer swapped for DuckDB.

## Tools

| Tool | Purpose |
|---|---|
| `get_server_time` | Real clock **+ the fixed dataset scope** (Feb 2026, SGT). Call first — the data is not "today". |
| `resolve_time_range` | NL date phrase → exact Feb dates + a ready SQL predicate (CNY, weekends, "first week", a weekday). |
| `list_tables` | Queryable tables/views + row counts + purpose. |
| `describe_table` | Live column types **+ curated units/exclusions/gotchas**. |
| `sample_rows` | First N rows (≤20) to see the shape. |
| `run_sql` | **The main tool** — run one read-only `SELECT`/`WITH` query, get rows back. |

Data surface: `tx` (student-traffic-filtered txn view — use for spend/behaviour),
`feb_txn` (raw), `stallcat`/`stall_category` (verified-name food category),
`txn_perf_202602` (speed), `feb_health`, `feb_heart_rate`, `schools`.

## Security (the SQL surface is agent-written)

- DuckDB opened **`access_mode=read_only`** → no writes possible at the engine level.
- **`enable_external_access=false`** → `read_csv`/`COPY`/`httpfs`/`ATTACH` file I/O all blocked.
- Extension autoinstall/autoload disabled, then **`lock_configuration=true`** → nothing can be re-enabled from SQL.
- `run_sql` guard: **single statement**, must start `SELECT`/`WITH`, denylist of data-movement/extension verbs → returned as `{error, hint}` (never thrown, so the agent self-corrects).
- Per-query **row cap** (default 1000 / max 5000) + **wall-clock timeout** (15 s, cancels via `interrupt()`).
- **Bearer `MCP_API_KEY`** on `/mcp` (empty = disabled, local dev only). Use a fresh secret on the VM — never a tree-twin key.
- Query **results are untrusted** (e.g. `storeName` free text) — the agent brief tells the model to treat them as data, never instructions.

## Run locally

```bash
npm install
# needs ../data/feb.duckdb — build it with:  python ../build_feb_duckdb.py
npm start                      # → http://localhost:3501  (auth disabled unless MCP_API_KEY set)
node test-client.mjs           # smoke test over the real MCP protocol (server must be running)
```

`GET /health` → `{status:"ok"}`. MCP endpoint is stateless `POST /mcp`.

## Docker

Base image is **`node:24-slim`** (Debian/glibc) — the `@duckdb/node-api` native
binding has no musl (alpine) prebuilt. The DuckDB file is **bind-mounted** at
`/app/data/feb.duckdb` (not baked into the image — real IDs, and large). See
`../docker-compose.sam.yml` and `../../AGENT_DEPLOY.md`.

Env: see `.env.example` (`MCP_PORT=3501`, `MCP_API_KEY`, `FEB_DUCKDB_PATH`, caps/timeout).
