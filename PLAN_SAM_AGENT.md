# PLAN — Deploy to VM + SAM agent over Feb data (DuckDB)

**Status:** ✅ **BUILT (local phases 1–5 + artifacts for 3/6/7)** — 8 Jul 2026. See
`AGENT_DEPLOY.md` for the deploy/execution companion. Remaining is VM/mesh-side only
(ship `feb.duckdb`, run compose, add the nginx route, register the agent, set secrets).
**Last run-through:** 8 Jul 2026

Three asks, one system:
1. Deploy the SMART Buddy dashboard to the VM (docker redo, modelled on `tree-digital-twin`).
2. A **SAM agent** (Solace Agent Mesh) that answers natural-language questions over the Feb data.
3. Resolve the DB-space concern (InfluxDB/Ditto too big) with a compact alternative.

Everything below is grounded in two reference repos we cloned and studied
(`C:\Users\STYLSG\Downloads\{iot-platform,htx-pilot}`, reference-only siblings of
`tree-digital-twin`). The build is **clone-and-adapt**, not design-from-scratch.

---

## 1 · Decisions locked in

| # | Decision | Choice |
|---|---|---|
| 1 | Agent topology | **SAM mesh + MCP**, same shape as tree-twin's `arborist` agent |
| 2 | Data the agent can query | **Full raw rows** (NL→SQL) — but **personal ids (`cardId`/`user_id`/`sync_id`) are salted-hash-anonymised** so the agent can group/count but never emit a real card/wearable id (added 8 Jul; device/school ids kept) |
| 3 | Database engine | **DuckDB / Parquet** (not Influx/Ditto) |
| 4 | Where it runs | **Shared UAT VM, isolated** (own project/port/network, via the shared nginx-proxy) |
| 5 | MCP language | **Node** (matches `mcp-rtls-server` — one house style, max reuse) |
| 6 | Agent model | **`claude-opus-4-8`** (Sonnet 5 is the cheaper option) |

---

## 2 · Architecture — end-to-end flow

```
 dashboard chat panel
   │  publish { text, context }
   ▼
 Solace topic  STYL/iot/smartbuddy/system/{tab-segment}/v1/sam/chat/request
   │
   ▼
 SAM Event Gateway rule ──▶ SMART Buddy agent (Claude Opus 4.8, on the mesh)
                               │  MCP call, Bearer MCP_API_KEY
                               ▼
                            nginx-proxy  /smartbuddy-mcp/
                               │
                               ▼
                            smartbuddy-mcp  (Node MCP server, POST /mcp)
                               │  read-only SQL
                               ▼
                            DuckDB  feb.duckdb  (~200–300 MB, full Feb rows)
   ◀── publish plain-text reply ── Solace topic  .../v1/sam/chat/response
   │
   ▼
 panel renders reply + action cards
```

This is the tree-twin `arborist` topology exactly (`SAM agent → nginx-proxy → MCP → store`),
with the knowledge store swapped from LightRAG (documents, vector embeddings) to **DuckDB SQL**
(structured tables) — because the Feb data is tabular, not documents. **No embeddings, no vector
DB, no LightRAG.** The FE↔agent leg is copied from the htx-pilot SAM-POC.

**Platform-side (mesh owner), not built here:** the SAM Event Gateway rule (request-topic →
agent → response-topic) and the agent registration. We supply the FE, the topics, the MCP
endpoint, and the agent brief.

---

## 3 · Components

### 3.1 Data store — `feb.duckdb`  (resolves the space concern)
- One-shot build script turns the existing Feb parquets into a single **read-only** DuckDB file:
  `feb_txn` (3,977,666 rows), `feb_health`, `feb_heart_rate`, `txn_perf_202602`, plus `schools`
  (geo + MOE) and the `stallcat` taxonomy view from `analysis/taxonomy.py`.
- **Footprint: ~0.6 GB file (~310 MB actual data)** for all of February; **no DB server
  process** to run. (DuckDB pads the file with free blocks it won't return to the OS — the
  real data is ~310 MB. Still trivially small vs multi-GB Influx/Ditto.)
- **Why not Influx/Ditto (the concern):**
  - *InfluxDB* is time-series keyed by tags; transactional rows carry high-cardinality IDs
    (`cardId` ~179K, `terminalId` ~2.6K) → **tag-cardinality explosion**, multi-GB indexes, slow.
  - *Ditto* stores current *thing state* (one doc per device), not millions of transactions.
  - *DuckDB* is columnar + ZSTD, purpose-built for these scans, already the pipeline engine, and
    the smallest possible footprint. **Confirmed choice.**

### 3.2 `smartbuddy-mcp` — the MCP adapter  (← copy `iot-platform/mcp-rtls-server`)
Mirror that service exactly; swap the InfluxDB/Ditto data layer for DuckDB.
- **Stack (copy verbatim):** Node ESM, `express` + `@modelcontextprotocol/sdk`
  (`McpServer` + `StreamableHTTPServerTransport`) + `zod`; Dockerfile `node:24-alpine`,
  `npm ci --omit=dev`.
- **Endpoint (copy verbatim):** stateless `POST /mcp` (new server+transport per request), Bearer
  `MCP_API_KEY` guard, CORS headers, `GET /health`, `GET /`.
- **Tools (adapt to DuckDB):**

  | Tool | Modelled on | Purpose |
  |---|---|---|
  | `get_server_time` | same-named rtls tool | anchor "now" — data is Feb 2026, not the model's year |
  | `resolve_time_range` | same-named rtls tool | NL date phrase → exact ms (SGT) |
  | `list_tables` | — | table names |
  | `describe_table` | — | columns + types + **units notes** (cents SGD, etc.) |
  | `run_sql` | **`execute_flux_query`** | read-only SELECT → rows |
  | `sample_rows` | — | quick peek so the agent learns the shape |

  `run_sql` copies the `execute_flux_query` design: a **big schema-laden description** (tables +
  columns + units + the analysis policy + copy-paste example queries), a **`maxRows` cap**
  (1000 default / 5000 max), and **errors returned as `{error, hint}` content, not thrown**, so
  the agent self-corrects. Large results are **compacted + given a `replyHint`** (rtls pattern)
  to fit the SAM tool-result size budget.
- **Text-to-SQL hardening (critical — agent writes SQL over real IDs):**
  - DuckDB `access_mode=READ_ONLY`; `SET enable_external_access=false`, `disabled_filesystems`,
    disable community extensions, then `SET lock_configuration=true` → blocks
    `read_csv`/`COPY TO`/`ATTACH`/arbitrary file reads from the SQL surface.
  - `run_sql` accepts **SELECT / WITH only** (parse-check; reject DDL/DML/PRAGMA/dot-commands).
  - Enforce `LIMIT`, a statement timeout, and a max result-row/byte cap.
  - Treat query *results* as untrusted (a free-text `storeName` could carry prompt-injection) —
    say so in the agent brief.

### 3.3 FE ↔ Agent  (← copy `htx-pilot/front-end/src/sam/` + `src/solace/`)
Vanilla JS, same style as `smart-buddy-app`, so it drops in cleanly. Copy four files into
`smart-buddy-app/src/sam/` + `src/solace/` and adapt:
- **`samClient.js`** — transports (first match wins):
  1. **Solace Event Gateway (default, SAM-POC style):** per-tab topics — each browser tab gets a
     UUID segment → `STYL/iot/smartbuddy/system/{segment}/v1/sam/chat/request|response|error`,
     **FIFO** matching. **BUILT text-only** (SAM agent is text-in/text-out): the request body is a
     plain-text question with a short `(Context: …)` preamble; the reply is plain text. 60 s timeout.
  2. **HTTP fallback:** `VITE_SAM_ENDPOINT` → `POST {base}/chat`, Bearer `VITE_SAM_API_KEY`.
  - **Adapt:** topic base `htx` → `smartbuddy`.
- **`samPanel.js`** — self-contained DOM chat panel: snapshots dashboard state via a `getContext`
  provider (role + open school/stall/terminal), sends `chat(text, context)`, renders the text reply.
  **No action cards** (dropped for text-only). Light theme to match the app.
- **`solace/solace.js`** — solclientjs Web Messaging (SMF `wss:443`) `publish`/`subscribe`.
- **Config (`.env`):** `VITE_SOLACE_URL/VPN/USER/PASSWORD` + `VITE_SAM_*` topic/timeout vars.
  ⚠ **public in the built bundle** → use **low-priv shared demo creds** (same rule as the
  tree-twin frontend).

### 3.4 SAM agent brief — `smart-buddy-agent-prompt.md`  (← format from `iot-platform/sam-agent`)
Prompt-only markdown (no runtime code), same format as the rtls `*-agent-prompt.md` files.
Ships the schema + analysis policy so answers stay correct: units (`amount` = cents SGD),
exclusions (`schoolId!='STYL'`, `NOT ILIKE '%retrieve%'`, `amount<=20000`), the verified-name
taxonomy caveat, HR sync-time backfill, "aggregate only — no cross-dataset user linkage," and
"write DuckDB SQL via the tools, cite counts, never fabricate." Registered on the mesh by the
platform owner.

### 3.5 Docker "redo"  (← split like `tree-digital-twin` + `rag-ai`)
tree-twin splits app services (root compose) from the AI stack (`rag-ai/docker-compose.rag.yml`).
Mirror that split:
- Keep **`docker-compose.yml`** (frontend) as-is.
- Add **`smart-buddy-agent/docker-compose.sam.yml`**:
  - `smartbuddy-mcp` (build `./smartbuddy-mcp`) — internal port **3501** (arborist uses 3500),
    `expose` only (no host port), networks `[sb-net, backend]`, mem limit ~192m.
  - `sb-data-build` (profile `build`, one-shot) — builds `feb.duckdb` into a mounted `./data/`.
- **Isolation (no collisions with tree-twin OR arborist):** project `smartbuddy`; containers
  `smartbuddy-mcp` / `smartbuddy-frontend`; DuckDB container-only; MCP never published to a host port.

### 3.6 nginx-proxy route  (shared-VM path)
One server-block route, mirroring arborist's `/arborist-mcp`:
`location /smartbuddy-mcp/ { proxy_pass http://smartbuddy-mcp:3501; }` (+ TLS on the chosen
hostname). The MCP checks the Bearer `MCP_API_KEY` itself.

---

## 4 · Security (load-bearing — anonymised personal ids + agent-written SQL)

0. **Anonymise personal ids in the store (DONE).** `cardId`/`user_id`/`sync_id` are salted-hash
   tokens (`sb_…`) in `feb.duckdb` — ephemeral per-build salt, irreversible, grouping preserved.
   The agent cannot emit a real customer id because the real value is never in the DB it queries.
1. **Gate the agent/chat behind auth.** Answers can contain real card/device/user IDs → internal
   only. Reuse the dashboard's Keycloak-client / proxy-auth decision (DEPLOY.md §C).
2. **Harden the SQL surface** (§3.2) — this is what stops NL→SQL becoming arbitrary-file-read or
   data-exfil.
3. **Separate secrets:** a new `MCP_API_KEY` and a **separate Anthropic API key** — never reuse
   any tree-twin secret (Influx token / Ditto password / Solace / Keycloak).
4. **Low-priv Solace creds in the FE bundle** (they're public); scope them to the smartbuddy chat
   topics only.
5. **Never commit** `.env`, `feb.duckdb`, or the parquets (all real IDs) — `.gitignore` them.
6. **Prompt-injection:** query results (esp. `storeName`) are untrusted; the agent brief guards.

---

## 5 · Prerequisites & open items (needed before/at execution)

| Item | Owner | Needed for |
|---|---|---|
| VM **outbound egress to `api.anthropic.com`** confirmed | deploying engineer / platform | agent LLM |
| **Anthropic API key** (new, for this agent) | you / STYL | agent LLM |
| **SAM Event Gateway rule + agent registration** on the mesh | mesh/platform owner | wiring FE topics ↔ agent |
| Low-priv **Solace Web-Messaging creds** for the FE | platform owner | FE↔agent transport |
| **Hostname + auth** for the dashboard/chat entry point | deploying engineer | exposure (DEPLOY.md §B/§C) |
| VM **free disk** (~300 MB for DuckDB) | deploying engineer | sanity only — it's tiny |
| Internal-network/VPN up for `git.styl.solutions` | — | re-cloning references if needed |

---

## 6 · Build phases (once approved)

1. **DB build** — script parquet → `feb.duckdb`; verify row counts + sample queries. *(local, safe, unblocks everything)*
2. **MCP service** — clone `mcp-rtls-server` structure → `smartbuddy-mcp`; implement the DuckDB
   tools + SQL hardening; test `/mcp` + tools locally.
3. **Compose + proxy** — `smart-buddy-agent/docker-compose.sam.yml` (isolation values) +
   nginx-proxy route snippet for the engineer.
4. **FE panel** — copy `htx-pilot` `sam/` + `solace/` into `smart-buddy-app`; rebase topics to
   `smartbuddy`; rewrite `buildSamContext()` for Feb state; wire `VITE_SOLACE_*`/`VITE_SAM_*`.
5. **Agent brief** — write `smart-buddy-agent-prompt.md` (schema + policy) for the mesh owner.
6. **Auth + hardening** — wire the auth decision; run the SQL-hardening checklist.
7. **Docs** — extend DEPLOY.md (or add `AGENT_DEPLOY.md`) with exact VM steps.

Phases 1–2 and 4–5 are all local/offline and safe to do without touching the VM or the mesh.
Phases 3, 6, 7 land on the shared VM and need the §5 prerequisites.

---

## 7 · Reference sources (studied 8 Jul, reference-only)

| Reference | Path | Used for |
|---|---|---|
| MCP server | `iot-platform/mcp-rtls-server` | §3.2 — copy stack/endpoint/`run_sql`/time tools |
| FE↔agent (SAM-POC) | `htx-pilot/front-end/src/sam/`, `src/solace/` | §3.3 — copy client + panel + transport |
| Agent brief format | `iot-platform/sam-agent/*-agent-prompt.md` | §3.4 — prompt template |
| Docker split | `tree-digital-twin` + `rag-ai/docker-compose.rag.yml` | §3.5 — compose topology |

---

## 8 · Out of scope
- No InfluxDB / Ditto / `rtls` writes; no LightRAG; no embeddings/vector DB.
- No change to the existing static dashboard deploy (it stays as-is; the agent is additive).
- Nothing touches `tree-twin-uat` data or its containers.
- We **do** use Solace as the FE↔agent chat bus (SAM-POC style) on our own
  `STYL/iot/smartbuddy/...` topic namespace — message transport, not a shared-store write.
