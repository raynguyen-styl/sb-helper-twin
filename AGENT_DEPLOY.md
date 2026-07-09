# AGENT_DEPLOY — SMART Buddy SAM agent (deploy brief)

**For the engineer + mesh owner deploying the SMART Buddy Data Agent.** This adds a
natural-language chat assistant to the SMART Buddy dashboard: the FE chat panel talks
to a **SAM (Solace Agent Mesh) agent**, which answers by running read-only SQL over a
compact **DuckDB** file (`feb.duckdb`) through the **`smartbuddy-mcp`** adapter.

It is **additive** — the existing static dashboard (see `DEPLOY.md`) is unchanged; with
no SAM env configured, the chat panel simply shows "offline" and nothing else is affected.

```
 dashboard chat panel ──(Solace per-tab topic)──▶ SAM agent (Claude Opus 4.8, on the mesh)
   STYL/iot/smartbuddy/system/{tab}/v1/sam/chat/request        │  MCP call, Bearer MCP_API_KEY
                                                               ▼
                                              nginx-proxy  /smartbuddy-mcp/
                                                               ▼
                                              smartbuddy-mcp (Node, :3501, READ-ONLY)
                                                               ▼
                                              feb.duckdb  (~0.6 GB, full Feb rows)
   ◀──(plain-text reply on .../response)──
```

Why DuckDB (the space concern): the whole February dataset is one **~0.6 GB** read-only
file (≈310 MB of actual data), no DB server process. InfluxDB would explode on the
high-cardinality `cardId`/`terminalId` tags; Ditto stores current thing-state, not millions
of rows. DuckDB is the smallest, correct fit. (The plan estimated 200–300 MB; the built file
is ~0.6 GB on disk because DuckDB pads with free blocks it does not return to the OS — still
trivially small for the VM.)

---

## What's in this repo (built + verified locally)

| Path | What |
|---|---|
| `smart-buddy-agent/build_feb_duckdb.py` | one-shot builder: Feb parquets → `feb.duckdb` (verified: 3.98M txns, 158 schools, taxonomy view = 17.5% verified) |
| `smart-buddy-agent/data/feb.duckdb` | the store (gitignored — real ids; build/ship separately) |
| `smart-buddy-agent/smartbuddy-mcp/` | Node MCP server (tools + SQL hardening) — smoke-tested locally over the MCP protocol |
| `smart-buddy-agent/docker-compose.sam.yml` | the `smartbuddy-mcp` service (isolated: project `smartbuddy`, port 3501, `sb-net`) |
| `smart-buddy-agent/nginx-smartbuddy-mcp.conf` | nginx-proxy `/smartbuddy-mcp/` route snippet |
| `smart-buddy-agent/smart-buddy-agent-prompt.md` | the agent's system prompt (schema + policy + safety) — for the mesh owner |
| `smart-buddy-app/src/{sam,solace}/` | FE chat panel + Solace transport (wired into `main.js`, build passes) |

---

## Prerequisites & who owns them

| Item | Owner | For |
|---|---|---|
| VM outbound egress to `api.anthropic.com` | deploying engineer / platform | agent LLM calls |
| A **new** Anthropic API key (for this agent) | you / STYL | agent LLM — do NOT reuse another project's key |
| A fresh **`MCP_API_KEY`** secret | you | Bearer auth on `smartbuddy-mcp` — never a tree-twin key |
| SAM **Event Gateway rule + agent registration** | mesh/platform owner | wiring FE topics ↔ agent (see below) |
| Low-priv **Solace Web-Messaging creds** for the FE | platform owner | FE↔agent transport (public in the bundle) |
| Hostname + auth for the chat entry point | deploying engineer | exposure (see `DEPLOY.md` §B/§C) |

---

## Steps

### 1 · Build `feb.duckdb` (analysis workstation, where the parquets live)
```bash
cd smart-buddy-agent
python build_feb_duckdb.py          # → data/feb.duckdb   (needs duckdb + pandas)
```
This is NOT done on the VM (the source parquets are gitignored and not shipped). Copy the
resulting file to the VM:
```bash
scp smart-buddy-agent/data/feb.duckdb  <vm>:/data/smart-buddy-dashboard/smart-buddy-agent/data/feb.duckdb
```

### 2 · Run the MCP adapter on the VM
```bash
export SB_MCP_API_KEY=$(openssl rand -hex 32)      # fresh secret; share with the mesh owner
# from the repo root, alongside the frontend stack:
docker compose -f docker-compose.yml -f smart-buddy-agent/docker-compose.sam.yml up -d --build
```
`smartbuddy-mcp` listens on `:3501` **in-network only** (no host port). It opens
`feb.duckdb` READ-ONLY. Sanity check from inside the network / proxy host:
`GET http://smartbuddy-mcp:3501/health` → `{"status":"ok"}`.

### 3 · Expose the MCP to the mesh via nginx-proxy
- In `smart-buddy-agent/docker-compose.sam.yml`, enable the `backend` network opt-in (network
  block + the service `networks: [sb-net, backend]` line) so the proxy can resolve `smartbuddy-mcp`.
- Add the route from `smart-buddy-agent/nginx-smartbuddy-mcp.conf` to the proxy server block.
- The agent's MCP base URL becomes `https://<proxy-host>/smartbuddy-mcp/mcp` (Bearer `MCP_API_KEY`).
- **Do not** expose `/smartbuddy-mcp/` to the public internet — mesh/agent network only.

### 4 · Register the agent on the mesh (mesh owner)
- Create the SAM agent from `smart-buddy-agent/smart-buddy-agent-prompt.md` (model `claude-opus-4-8`),
  with the MCP endpoint + `MCP_API_KEY` from step 2–3 and the new Anthropic key.
- Add the Event Gateway rule: subscribe `STYL/iot/smartbuddy/system/*/v1/sam/chat/request`,
  reply on `.../system/{same}/v1/sam/chat/response` (and optionally `.../error`).

### 5 · Point the FE at Solace + rebuild the dashboard
- Fill `smart-buddy-app/.env` from `.env.example`: `VITE_SOLACE_URL/VPN/USER/PASSWORD` (low-priv),
  timeouts as needed. Per-tab topics need no extra config.
- Rebuild the frontend image (`docker compose up -d --build`). The chat panel goes live.

---

## Auth (the answers contain real card/device/user ids — gate it)

Reuse the dashboard's exposure decision from `DEPLOY.md` §C. In order of preference:
1. **Proxy `auth_request` via a NEW Keycloak client** (e.g. `smart-buddy-dashboard`) on realm
   `styl-iot` — never reuse `nparks-tree-twin`. Gates the whole dashboard incl. the chat panel.
2. **Basic auth / IP allowlist** at the proxy — simplest.
3. **Internal-network-only** — acceptable only if the network is the boundary.

Separately: the **Solace creds in the FE bundle are public** — scope them to the smartbuddy
chat topics only, low privilege. The **MCP** is always Bearer-guarded and never public.

---

## SQL-hardening checklist (verified in `smartbuddy-mcp`)

The agent writes SQL over the data, so the SQL surface is locked down AND the customer
identifiers are anonymised before they ever reach the agent. All of these are implemented
(`build_feb_duckdb.py` + `smartbuddy-mcp/src/db.js`) and were confirmed by the local smoke
tests:

- [x] **Personal ids anonymised at build time** — `cardId`, `user_id`, `sync_id` are replaced by
  one-way **salted-hash tokens** (`sb_…`) in `feb.duckdb`. The salt is **ephemeral** (random per
  build, never stored), so tokens are irreversible even to us. Grouping/counting is preserved
  (distinct token = distinct card/user; cross-table `user_id` still joins health↔heart_rate), but
  the agent can never emit a real 16-digit card or wearable id (verified: `cardId` → `sb_…`).
  Device (`terminalId`/`readerId`) and school (`schoolId`/`storeName`) ids are kept — not personal,
  and needed for the network/terminal analysis.
- [x] DuckDB opened **`access_mode=read_only`** → writes impossible at the engine level (`CREATE`/`DROP`/… rejected).
- [x] **`enable_external_access=false`** → `read_csv`/`COPY`/`httpfs`/`ATTACH` file I/O blocked (verified: `read_csv('/etc/hostname')` denied).
- [x] Extension autoinstall/autoload disabled, then **`lock_configuration=true`** → cannot be re-enabled from SQL (verified: `SET enable_external_access=true` rejected).
- [x] `run_sql` guard: **single statement**, must start `SELECT`/`WITH`, denylist of `ATTACH/COPY/INSTALL/LOAD/PRAGMA/EXPORT/IMPORT/CALL/CHECKPOINT` → returned as `{error,hint}`, never thrown (verified: multi-statement + `DROP` rejected).
- [x] Per-query **row cap** (1000 default / 5000 max) + **15 s wall-clock timeout** (cancels via `interrupt()`).
- [x] **Bearer `MCP_API_KEY`** on `/mcp`; separate from all tree-twin secrets.
- [x] Agent brief instructs treating query **results (e.g. `storeName`) as untrusted** — prompt-injection guard.
- [ ] **You set:** a fresh `SB_MCP_API_KEY` + a new Anthropic key on the VM (step 2 + step 4).
- [ ] **You confirm:** the chat entry point is gated (auth section above) before sharing the URL.

---

## Out of scope / notes
- No InfluxDB/Ditto/LightRAG/embeddings — the data is tabular, answered by text-to-SQL.
- `feb.duckdb`, `.env`, parquets, `node_modules` are gitignored (real ids / secrets / regenerable).
- The DuckDB file is a point-in-time Feb-2026 snapshot; to refresh, re-run `build_feb_duckdb.py` and re-ship.
- The plan document is `PLAN_SAM_AGENT.md`; this file is the execution/deploy companion.
