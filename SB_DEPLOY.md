# SB_DEPLOY — SMART Buddy playback stack (InfluxDB + Ditto) on the VM

Deploy runbook for the February-playback system, modelled on `tree-digital-twin` and deployed the
same way: **app services here, shared platform stores (Influx/Ditto/Solace/Keycloak/nginx-proxy)
already on the VM.** Like tree-twin, this does NOT run on the analysis workstation — it runs on the
VM where Docker + the platform stores live. Everything below is built and dry-run/boot-validated;
the first live run happens here.

## 0 · What runs
| Component | Dir | Role |
|---|---|---|
| `smartbuddy-ingestion` (one-shot) | `smart-buddy-agent/ingestion/` | `feb_data` CSVs → Influx `sb_*` history + Ditto `org.smartbuddy` twins (`sb_backfill.py --write`, mirrors tree-twin `backfill.py`) |
| `smartbuddy-api` | `smart-buddy-agent/sb-api/` | read API: Flux playback series + Ditto markers |
| `smartbuddy-frontend` | `smart-buddy-app/` | dashboard + **Playback** window (reads sb-api) + chat |
| SAM agent | `smart-buddy-agent/sam-agent-instructions.md` | NL questions via `IOT_UAT_MCP` Flux over `sb_*` |

## 1 · Isolation (no collisions with tree-twin / RTLS)
| Resource | tree-twin | SMART Buddy |
|---|---|---|
| Compose project | `tree-digital-twin` | **`smartbuddy`** |
| Containers | `nparks-*` | **`smartbuddy-api` / `-frontend` / `-ingestion`** |
| Host ports | 8087, 8088, 3310 | **8089** (frontend), **3320** (sb-api) |
| Influx bucket | `rtls` | **`rtls`** (shared) — new `sb_*` measurements |
| Ditto namespace | `org.nparks` | **`org.smartbuddy`** |
| Docker net | `twin` (+ external `backend`) | **`sb-net`** (+ external `backend`) |

## 2 · Prerequisites (platform owner)
- **InfluxDB**: a **write** token (ingestion) + a **read** token (sb-api) for bucket `rtls`; bucket
  retention **infinite** (data is months in the past). URL e.g. `https://iot-uat.styl.solutions/influx`.
- **Ditto**: write creds (`/ditto-raw` basic auth) + the shared policy id (`user:default-policy`) for
  ingestion; read creds for sb-api. URL e.g. `https://iot-uat.styl.solutions/ditto`.
- Shared platform up; the external `backend` network reachable.
- `IOT_UAT_MCP`'s `execute_flux_query` allowed to read the `sb_*` measurements (same bucket).
- **`feb_data/`** + **`analysis/`** present on the VM build host (gitignored — copy them over).
- Docker + Docker Compose on the VM.

## 3 · Steps
```bash
# on the VM, in the repo root
cp smart-buddy-agent/ingestion/.env.example smart-buddy-agent/ingestion/.env   # fill INFLUX write token + Ditto creds + SB_ID_SALT
cp smart-buddy-agent/sb-api/.env.example  .env                                 # fill INFLUX read token + Ditto read creds (compose reads root .env)
# set VITE_SB_API_URL + SB_FRONTEND_PORT in .env (see §4)

cd smart-buddy-agent

# 3a. Backfill — load Feb into the shared stores (one-shot). Dry-run first (no --write) to sanity check.
docker compose -f docker-compose.sb.yml run --rm ingestion            # runs sb_backfill.py --write
#   expect: "InfluxDB done — ~1.77M points", "Ditto done — 2937 things"

# 3b. Verify the data landed
#   Influx (Flux): sb_school revenue by school → PBS should top ~ $321,334
#   Ditto: GET /api/2/search/things?filter=like(thingId,"org.smartbuddy:school-*")&option=size(1)

# 3c. Bring up the read API + frontend
docker compose -f docker-compose.sb.yml up -d --build
curl -s http://localhost:3320/health          # {"status":"ok","bucket":"rtls","ns":"org.smartbuddy"}
curl -s "http://localhost:3320/api/schools" | head -c 300
```

## 4 · Frontend wiring (`.env` build args)
The frontend bakes `VITE_SB_API_URL` at build. Set it to the proxied sb-api base:
```
VITE_SB_API_URL=https://smart-buddy-uat.styl.solutions/smartbuddy-api
SB_FRONTEND_PORT=8089
# optional chat (SAM): VITE_SOLACE_URL/VPN/USER/PASSWORD (low-priv)
```
With `VITE_SB_API_URL` empty, Playback falls back to demo data (safe default). Rebuild the frontend
service after changing it.

## 5 · nginx-proxy + hostname
Add `smart-buddy-agent/nginx-smartbuddy.conf` to the shared proxy (own hostname, TLS, DNS). It
routes `/smartbuddy-api/` → `smartbuddy-api:3320` and `/` → `smartbuddy-frontend:8080`. Gate behind
Keycloak/auth like `/api/nparks/` (answers carry hashed-but-real ids). Enable the `backend` external
network so the proxy resolves the containers.

## 6 · SAM agent
Create the "SMART Buddy Helper" agent on the mesh using the **`IOT_UAT_MCP`** connector and paste
`smart-buddy-agent/sam-agent-instructions.md` §4 into Instructions. Wire the Event Gateway rule for
the `STYL/iot/smartbuddy/system/*/v1/sam/chat/{request,response}` topics. Verify: "Which school
spends the most?" → PBS.

## 7 · Cutover (ADDITIVE — decided)
This is additive, not a rip-out:
- **Ingestion** now feeds Influx/Ditto; **Playback** + the **agent** are the live Influx/Ditto layer.
- The existing analytical windows (Network Overview / school / Terminal Health / February / stall)
  keep their **precomputed bundled JSON** — they never queried a runtime engine, so nothing to retire
  there. DuckDB is now used **only at ingest time** (compute the `sb_*` aggregates); it is not a
  runtime store.
- To refresh data later: re-run the backfill (§3a). To migrate a specific window to live sb-api
  later, point it at the same endpoints the Playback window uses — incremental, per window.

## 8 · Verify end-to-end (the "works like tree-twin" check)
1. Backfill ran: Influx has `sb_*` points, Ditto has `org.smartbuddy:*` twins.
2. `sb-api` `/health` ok; `/api/schools` returns markers; `/api/schools/PBS/hourly` returns a series.
3. Dashboard → **Playback**: pick a school → the timeline animates real Feb data (recess spikes, CNY 16–18 drop).
4. Chat: "Which school spends the most?" → **PBS, ~$321,334**.

## 9 · Rollback
- Remove SMART Buddy data without touching RTLS: Influx delete predicate per `_measurement="sb_*"`;
  Ditto delete `like(thingId,"org.smartbuddy:*")`. `docker compose -f docker-compose.sb.yml down`.
