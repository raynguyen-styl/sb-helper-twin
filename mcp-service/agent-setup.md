# SAM agent setup — "SMART Buddy Data Agent" (ClickHouse SQL via `smartbuddy-mcp`)

Operational config for the SAM agent on the mesh. It answers by writing **read-only ClickHouse SQL**
over the SMART Buddy tables (their own `smartbuddy` database in the shared ClickHouse), reached through
the **`smartbuddy-mcp`** adapter as a **dedicated read-only user** (`smartbuddy_ro`, SELECT only).

> **The instruction text to paste is NOT in this file.** It is the single maintained copy in
> **[`agent-prompt.md`](agent-prompt.md) § "Copy For AI Agent"** (the fenced ```text block). Paste that
> block verbatim. This file only holds the surrounding setup (name, endpoint, tools, topics, verify).
> *(History: an older duplicate lived here and drifted out of date — Feb-only, dead table names,
> plain-text I/O. It was removed 15 Jul 2026 to keep ONE source of truth.)*

## 1 · Agent details
- **Name:** `SMART Buddy Data Agent`
- **Description:** `Answers questions about the February + March 2026 SMART Buddy canteen, wearable and purchase data by writing read-only ClickHouse SQL over the smartbuddy database.`
- **Model:** `claude-opus-4-8`.
- **Instructions:** paste the ```text block from `agent-prompt.md` § "Copy For AI Agent" (JSON I/O, the
  month dimension, real table names, items/wallet/linkage rules, strict identity-masking).

## 2 · Connector / tools
Attach the **`smartbuddy-mcp`** MCP endpoint
(`https://smartbuddy-helper-uat.styl.solutions/smartbuddy-mcp/mcp`, Bearer `SB_MCP_API_KEY`). Tools:
`get_server_time`, `resolve_time_range`, `list_tables`, `describe_table`, `sample_rows`, `run_sql`
(the main tool — one read-only `SELECT`/`WITH` query), `plan_service_route` (service visit order). `describe_table`/`list_tables` serve the curated
data dictionary from `src/schema.js` — **so after any `schema.js` change, rebuild + redeploy
`smartbuddy-mcp`** (the file is baked into the image) for the agent to see it.

## 3 · Topics + I/O
Per-tab Solace topics `STYL/iot/smartbuddy/system/*/v1/sam/chat/{request,response,error}`. The wire is
**JSON** (`{correlationId, text, context, ts}` in; `{correlationId, reply, actions:[]}` out — echo the
`correlationId`). Full contract: `agent-prompt.md` § "I/O contract".

## 4 · Redeploy checklist (when schema.js or the instructions change)
1. Rebuild the MCP so the new `schema.js` ships:
   `docker compose -f docker-compose.yml -f docker-compose.agent.yml build smartbuddy-mcp`
   `docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d smartbuddy-mcp`
2. Re-paste the current ```text block from `agent-prompt.md` § "Copy For AI Agent" into the SAM agent's
   Instructions field. Save.
3. Verify (below).

## Verify
- MCP up: `list_tables` returns `tx, txn, txn_perf, terminal_health, stallcat, health, heart_rate, items, saving_spending, schools`
  (`terminal_health` has a row count only after `ch-insights` has run for the month).
- Schools: *"how many schools have map coordinates?"* → **332**.
- Service route: *"which terminals have machine faults in March?"* → uses `terminal_health` (159 machine faults);
  *"plan a route to TKGS, RSYS, SCGSP and FHPS"* → calls `plan_service_route`: TKGS → RSYS → SCGSP → FHPS, ~28 km straight-line.
- Month awareness: ask *"how many wearable users in March vs February?"* → it filters `month` and answers both.
- Aggregate-only guardrail: ask *"which student spent the most?"* → it **refuses** and answers in aggregate.
- Spend sanity: *"which school spends the most in February?"* → **Methodist Girls' School (Primary),
  ~$101,474** (MOE-verified). NOT "PBS" — that's Pacific Bookstores, a vendor code excluded from `tx`
  as of the schoolId fix (see `ingestion-service/ingest_core.py` TX_FILTER); if you still see PBS on
  top, the live `tx`/`pb_schools` aggregates haven't been rebuilt yet since that fix.

## Notes
- `smartbuddy_ro` is SELECT-only on `smartbuddy`; the MCP enforces `readonly=2` + row/time/memory caps —
  the agent's SQL can never reach other demos' tables or starve the shared instance's live ingest.
- One store serves both: Playback (api-service) and SAM read the SAME ClickHouse `smartbuddy` db. No
  InfluxDB/Ditto. Data is loaded by `../ingestion-service` (upload flow / `ingest_core.py`).
