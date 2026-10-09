# DEPLOY — SMART Buddy (dashboard + Playback + SAM agent)

Single deploy runbook for the whole SMART Buddy stack. It is a **separate project** from
tree-digital-twin (`tree-twin-uat.styl.solutions`) but **plugs into the same shared IoT platform**
(shared ClickHouse / Solace / Keycloak) the same way tree-twin does — but it is fronted by its OWN
nginx (in the client container), so the shared platform nginx-proxy is untouched. Everything is built and
boot-validated; the **first live run happens on the VM** (it needs Docker + the shared ClickHouse).

---

## 1 · Architecture (ClickHouse-only, two compose stacks)

February 2026 is a **fixed historical month**, so there is **ONE data store**: the shared ClickHouse
instance (atlantic's `clickhouse`, in-network) with its own **`smartbuddy` database**. Both the
**Playback API** and the **SAM agent** read it as a **read-only user (`smartbuddy_ro`)**. There is
**no InfluxDB / Ditto / backfill** — see "Why ClickHouse" below.

ONE public hostname. The ALB maps `smartbuddy-helper-uat.styl.solutions/*` to the client container;
the client's OWN nginx same-origin-routes everything (like car-identify's dashboard / atlantic's
super-admin-web), so the shared platform nginx-proxy is **not touched**:

```
 ALB: smartbuddy-helper-uat.styl.solutions/*  ─▶  client (Vite→nginx, host :8097)
        ├─ /                → static SPA  (Keycloak login: realm styl-iot, client smart-buddy)
        ├─ /smartbuddy-api/ → api-service :3320   (JWT via jwt-validator) ─┐ read-only
        └─ /smartbuddy-mcp/ → mcp-service :3501    (Bearer MCP_API_KEY)    ─┤ smartbuddy_ro
                                                                           ▼
                                     shared ClickHouse  →  database `smartbuddy`
                                     (loaded once by ingestion-service / ch-ingest)
 SAM chat: browser ─Solace─▶ SAM agent (mesh) ─▶ https://<host>/smartbuddy-mcp/mcp
```

| Service | Dir | Container | Port | Exposure |
|---|---|---|---|---|
| **client** (dashboard + Playback + SAM chat + Keycloak login) | `client/` | `smartbuddy-frontend` | host **8097** → 8080 | ALB maps the demo hostname/* → host 8097; its nginx routes the rest |
| **api-service** (Playback read API — reads `pb_*` daily tables) | `api-service/` | `smartbuddy-api` | 3320 (in-network, **no host port**) | client nginx `/smartbuddy-api/` (Keycloak JWT via jwt-validator) |
| **mcp-service** (SAM agent NL→SQL adapter) | `mcp-service/` | `smartbuddy-mcp` | 3501 (in-network, **no host port**) | client nginx `/smartbuddy-mcp/` (Bearer `SB_MCP_API_KEY`) |
| **ingestion-service** (one-shot Feb load) | `ingestion-service/` | `smartbuddy-ch-ingest` | — | compose profile `ingest` (not a running service) |

Two compose files, one project (`smartbuddy`):
- **`docker-compose.yml`** — the **app stack**: `client` + `api-service`.
- **`docker-compose.agent.yml`** — the **agent stack**: `mcp-service` + the `ch-ingest` one-shot.

Isolation from tree-twin / other demos (own project / port / container names, own `smartbuddy` db +
Solace topic — none collide): project `smartbuddy`; containers `smartbuddy-{frontend,api,mcp}`;
frontend host port **8097** (tree-twin is 8087); networks `sb-net` (private) + external `backend`
(so the client nginx reaches `clickhouse:8123` / `smartbuddy-api` / `smartbuddy-mcp` / `jwt-validator`
by name); Keycloak client
`smart-buddy` (never reuse `nparks-tree-twin`).

**Why ClickHouse (and NOT Influx/Ditto):** the agent needs rich ad-hoc SQL (joins, `GROUP BY`,
medians, distinct counts) over millions of Feb rows. *InfluxDB* is tag-keyed time-series and would
blow up on the high-cardinality `cardId`/`terminalId` values (no real joins); *Ditto* stores current
thing-state (one doc per device), not millions of transactional rows. A columnar **OLAP** store fits,
and the platform already runs a shared ClickHouse — so SMART Buddy's Feb working set goes into its
own `smartbuddy` database and is queried read-only.

---

## 2 · Standard deploy flow (how changes reach the VM)

**Never edit code/config directly on the VM.** Local is the source of truth:

1. Make changes **locally**, commit, `git push` to GitHub.
2. On the VM: `git pull` in the repo, then run the `docker compose` command(s) below.
3. **Gitignored files (`.env`, parquets) are NOT in git** — for those, either
   - run `./bootstrap-env.sh` on the VM (assembles `.env` from the sibling `/data` repos + fresh
     secrets), or
   - keep the local `.env` as source of truth and **`scp` it up** to the VM repo root;
   - copy the Feb parquets under `./analysis/` up to the VM (`scp -r`) — the ingest one-shot reads them.

So: **local → GitHub → VM `git pull` → `docker compose`**; secrets/data ride over `scp` (or
`bootstrap-env.sh`), never committed.

---

## 3 · Environment

`docker compose` reads the **single repo-root `.env`** for both stacks. Generate it on the VM:

```bash
# on the VM, in the repo root:
./bootstrap-env.sh        # assembles .env from the sibling /data repos + fresh per-demo secrets
#   (or: cp .env.example .env and fill by hand). Review the ✓ SET / ✗ MISSING checklist it prints.
```
`bootstrap-env.sh` writes the root `.env` **plus** three per-service `.env` files
(`client/.env`, `api-service/.env`, `mcp-service/.env`) used only for local `npm run dev`/`npm start`;
the docker deploy uses the root `.env`. If you edit `.env` locally instead, `scp` it up.

Variables this stack uses:

| Variable | Used by | Notes |
|---|---|---|
| `CLICKHOUSE_URL` | api-service, mcp-service, ch-ingest | `http://clickhouse:8123` (in-network) |
| `CLICKHOUSE_DB` | all | `smartbuddy` |
| `CLICKHOUSE_RO_USER` / `CLICKHOUSE_RO_PASSWORD` | api-service, mcp-service (+ created by ch-ingest) | the **read-only** user both read services connect as |
| `CLICKHOUSE_ADMIN_USER` / `CLICKHOUSE_ADMIN_PASSWORD` | **ch-ingest only** | shared-instance superuser — needed once to `CREATE` the db + read-only user. Not used at runtime |
| `SB_ID_SALT` | smartbuddy-ingest | keep it the same for every load, or hashed card/user tokens won't match across loads/months (`bootstrap-env.sh` keeps an existing one, else generates one; empty = unsalted hash) |
| `SB_FRONTEND_PORT` | client | host port for the frontend (default **8097**) |
| `VITE_SB_API_URL` | client (build arg) | api-service base — **same-origin** `/smartbuddy-api` (the client nginx proxies it). Empty → Playback uses bundled demo data |
| `VITE_KEYCLOAK_URL` / `VITE_KEYCLOAK_REALM` / `VITE_KEYCLOAK_CLIENT_ID` | client (build arg) | realm `styl-iot`, client `smart-buddy`. Empty `VITE_KEYCLOAK_URL` → no login (local dev only) |
| `VITE_SOLACE_URL` / `VITE_SOLACE_VPN` / `VITE_SOLACE_USER` / `VITE_SOLACE_PASSWORD` | client (build arg) | SAM chat transport — **low-priv** demo creds (they ship in the browser bundle) |
| `SB_MCP_API_KEY` | mcp-service | Bearer token the SAM agent sends to the MCP. **Fresh** random secret (`openssl rand -hex 32`) — never a tree-twin key |

The frontend bakes its `VITE_*` at **build** time — rebuild the `client` service after changing any.
No `INFLUX_*` / `DITTO_*`: that store does not exist here.

---

## 4 · Deploy commands (run on the VM, from the repo root)

The store now holds **two months (Feb + March 2026)** and **data arrives through the dashboard's
chunked Upload feature** (or `scripts/vm-load.sh` from a CLI) — no parquets, no bulk one-shot. Every
fact table is `PARTITION BY month` ('2026-02' | '2026-03'). The uploaded CSVs are a **temporary extract**;
the real source will be **Redshift** (being integrated — HANDOVER.md "Redshift integration — read first").

```bash
# 4a. Build + start both stacks (frontend + api-service; mcp + upload service):
docker compose up -d --build
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d --build

# 4b. ONE-SHOT: create the db + insights table + scoped ro/rw users (no data files needed):
docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-init

# 4c. Load data: open the dashboard → "Upload data" (chunked, any size), per month + dataset;
#     OR from a machine holding the files:  bash scripts/vm-load.sh <file> <dataset> <YYYY-MM> [replace|append] [rebuild]
#     Datasets: transactions, txn_perf, health, heart_rate (Feb + March) · items, saving_spending (March) · schools.

# 4d. Build each month's dashboard insight bundles (upload auto-triggers this; run manually to force):
SB_MONTH=2026-03 docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights
SB_MONTH=2026-02 docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights
docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights python build_insights_wearable.py 2026-02   # Feb wearable tab
docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights python build_insights_wearable.py 2026-03   # March wearable tab (health/heart_rate now Feb+March; see reload/MARCH_WEARABLE.md)
```

**`init_db.py`** creates the `smartbuddy` db, the `insights(month,kind,json)` table, and two scoped
users: **`smartbuddy_ro`** (`SELECT` only — api-service + MCP) and **`smartbuddy_rw`** (SELECT/INSERT/
ALTER/CREATE/DROP on `smartbuddy.*` only — the upload service). **`ingest_core.py`** loads each file
into its table's `month` partition (hashing PII, dropping names), rebuilding the `tx`/`stallcat` views
+ the `pb_*` playback rollups. **`build_insights.py`** / **`build_insights_wearable.py`** precompute the
per-month bundles the dashboard reads. Tables (all MergeTree, NO TTL, `PARTITION BY month`):
- **facts** — `txn`, `txn_perf`, `health`, `heart_rate` (Feb), `items`, `saving_spending` (March),
  `stall_category` + the `tx` / `stallcat` views; **dimension** `schools` (no month).
- **playback** — `pb_school_daily`, `pb_schools`, `pb_wearable_daily`.
- **bundles** — `insights(month, kind, json)`: `global` / `schools` / `stalls` / `items` / `savings` /
  `wearable`, served verbatim to the client by api-service.
- **service** — `terminal_health` (one row per month × terminal: latest location, problem tags, school
  postal/zone/coords). Written by `build_insights.py` alongside the `stalls` bundle (same rows), read by SAM
  (`plan_service_route`). Created on first build; no `init_db.py` change.

---

## 5 · Hostname + routing (ONE hostname, no shared-proxy change)

Everything is served under **one** hostname — `smartbuddy-helper-uat.styl.solutions/*` (never reuse
`tree-twin-uat…`). You only need **one ALB rule**: map that hostname to the **client** container
(host port **8097**), plus its DNS record + TLS at the ALB. That's it — the **shared platform
nginx-proxy is NOT touched.**

The client's own nginx (`client/nginx.conf`) same-origin-routes the rest — the same pattern
car-identify's dashboard and atlantic's super-admin-web use:
- `/` → the static SPA (the browser then does Keycloak login via keycloak-js).
- `/smartbuddy-api/` → `smartbuddy-api:3320`, **gated by Keycloak JWT** (`auth_request` → the shared
  `jwt-validator:3200`; answers carry hashed-but-real ids).
- `/smartbuddy-mcp/` → `smartbuddy-mcp:3501`, guarded by the MCP's own **Bearer `SB_MCP_API_KEY`**;
  the SAM agent's MCP base URL is `https://smartbuddy-helper-uat.styl.solutions/smartbuddy-mcp/mcp`.

For this the **client container joins the external `backend` network** (already set in
`docker-compose.yml`) so its nginx reaches `smartbuddy-api` / `smartbuddy-mcp` / `jwt-validator` by
name. `api-service` and `mcp-service` have **no host port** — they are reachable only through the
client nginx.

---

## 6 · Keycloak

Register a **`smart-buddy`** client in the Keycloak admin console (realm `styl-iot`), add it to the
platform **`JWT_ALLOWED_CLIENTS`**, and add `https://<hostname>/*` to its redirect URIs — exactly like
the other demos. The frontend ships a `keycloak-js` login flow (`VITE_KEYCLOAK_*`) and the
`/smartbuddy-api/` route is gated by `auth_request`. Never reuse `nparks-tree-twin`. If you skip
Keycloak (local dev / internal-only), leave `VITE_KEYCLOAK_URL` empty and gate at the proxy instead.

---

## 7 · Register the SAM agent (mesh owner)

- Create the SAM agent (model `claude-opus-4-8`). **Paste the ```text block from
  `mcp-service/agent-prompt.md` § "Copy For AI Agent"** (the single maintained instruction copy) into
  the SAM "Instructions" field; `mcp-service/agent-setup.md` has the surrounding setup + a redeploy
  checklist. Configure the MCP endpoint + `SB_MCP_API_KEY` (§4/§5) and a **new** Anthropic API key (do
  not reuse another project's key). **After any `schema.js` change, rebuild + redeploy `smartbuddy-mcp`
  and re-paste the block** — the schema is baked into the image.
- Add the Event Gateway rule: subscribe `STYL/iot/smartbuddy/system/*/v1/sam/chat/request`, reply on
  `.../system/{same}/v1/sam/chat/response` (and optionally `.../error`).
- Point the FE at Solace via `VITE_SOLACE_*` and rebuild the `client` service; the chat panel goes
  live. With no SAM env configured, the chat panel simply shows "offline" — the rest is unaffected.

---

## 8 · Verify end-to-end

1. **ch-ingest ran:** ClickHouse `smartbuddy` has the agent tables + the `pb_*` playback tables.
2. **api-service health:** `docker compose exec smartbuddy-api wget -qO- http://localhost:3320/health`
   → `{"status":"ok","store":"clickhouse","db":"smartbuddy"}`. `/api/schools` returns the school list
   (biggest spenders first — a REAL school on top, e.g. Methodist Girls' School (Primary); `PBS`/`SSSTM`
   are vendor codes excluded from `tx`/`pb_schools`, not schools — see `ingestion-service/ingest_core.py`
   TX_FILTER). `/api/schools/<schoolId>/playback` returns a per-day series for any real school.
3. **Playback:** dashboard → Playback → pick a school → the daily timeline animates real Feb data
   (watch the CNY 16–18 revenue drop).
4. **SAM chat:** ask *"Which school spends the most?"* → **Methodist Girls' School (Primary),
   ~$101,474** (MOE-verified; if you still see "PBS", the live `tx`/`pb_schools` aggregates haven't
   been rebuilt since the schoolId fix — rerun `ingest_core._rebuild()` for `tx`/`pb_school_daily`/
   `pb_schools`, no raw-file reload needed).
5. **Service route:** `SELECT month, count() FROM smartbuddy.terminal_health GROUP BY month` → one row per
   month with bundles (Mar 2,633 / Feb 2,621). SAM: *"which terminals have machine faults in March?"* then
   *"route me to …"* → ordered stops from the STYL Service Center. Expected values: `reload/SERVICE_ROUTE_DEPLOY.md`.

---

## 9 · Safety notes (shared instance — keep these)

- **Identity masked at ingest** — `studentId` and student **names are DROPPED entirely** (not loaded,
  not even as a token). `cardId`, `user_id`, `sync_id` become one-way salted-hash tokens (`sb_…`)
  before rows ever reach ClickHouse (pin `SB_ID_SALT` to keep them stable) — used only for grouping/
  counting; the real card / wearable id can never be emitted.
- **SAM answers strictly aggregate** — the prompt + `schema.js` forbid printing any token or returning
  a single-person / single-card / single-user row, and make SAM refuse requests to identify an
  individual. (The dashboard already sends only aggregates to the browser — no personal token reaches
  the client.)
- **Own `smartbuddy` database** — walled off from atlantic's raw UWB/camera tables.
- **Dedicated read-only user** (`smartbuddy_ro`, `SELECT` only on `smartbuddy.*`) — the read services
  cannot touch the other demos' tables.
- **No TTL** on the SMART Buddy MergeTree tables — this transactional month is permanent, unlike the
  shared instance's 30-day raw tables.
- **mcp-service session is hard read-only** (`readonly=2`) — no writes, no per-query setting changes;
  plus a `run_sql` guard (single statement, must start `SELECT`/`WITH`, DDL/data-movement denylist),
  a per-query **row cap** (1000 default / 5000 max), a **15 s timeout**, and a **~2 GB memory cap**, so
  a heavy agent query can't starve the shared instance's live ingest.
- **Bearer `SB_MCP_API_KEY`** on `/smartbuddy-mcp/`; the Solace creds in the FE bundle are public, so
  scope them low-privilege to the smartbuddy chat topics only.
- **Basemap needs outbound internet** — MapLibre fetches OneMap (SLA) Grey raster tiles from `www.onemap.gov.sg` at runtime (keyless; Carto was dropped when its CDN began requiring an API key);
  on an air-gapped host the basemap is blank (all data/charts/tables/list still work).

---

## 10 · Refresh / rollback

- **Refresh the snapshot:** regenerate the parquets via the `analysis/` pipeline (see PIPELINE.md),
  copy them to `./analysis` on the VM, and re-run the `ch-ingest` one-shot (§4a).
- **Rollback:** `DROP DATABASE smartbuddy` on the shared ClickHouse removes all SMART Buddy data
  without touching the other demos (own db + read-only user). Bring the stacks down with
  `docker compose down` (add `-f docker-compose.agent.yml` for the agent stack).

*Companion docs: **README.md** (overview + data facts + deliverables) · **PIPELINE.md** (the offline
analysis pipeline that produces the parquets/JSON/reports).*
