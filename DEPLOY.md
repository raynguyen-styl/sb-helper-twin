# SMART Buddy dashboard — deployment brief

**For the engineer deploying this.** SMART Buddy is a **completely separate project**
from the tree-digital-twin (`tree-twin-uat.styl.solutions`). This brief has everything
needed to stand it up **without conflicting with tree-twin's data or server**.

Everything up to the actual VM/host build is done and verified here. The three
infrastructure decisions (**where it runs**, **hostname**, **auth**) are yours — they're
laid out in §3 with a checklist for each.

---

## 1 · What it is (and why there's no database)

The interactive app (`smart-buddy-app/`, Vite + MapLibre) reads its data from precomputed
JSON that Vite **bundles into the build at compile time** (`src/main.js`:
`import GLOBAL from './data/global.json'` …). The built `dist/` is therefore fully
self-contained: **no API, no InfluxDB, no Ditto, no Solace, no Keycloak client in the app.**
The entire runtime is one nginx container serving static files.

**Consequence for you:** there is *nothing to point at a backend*. Unlike the tree-twin
frontend, this build takes **no `VITE_*` args** — `docker compose up -d --build` is the
whole build. (The reports `SMART_Buddy_*.html/.pdf` in the repo root are separate,
double-click-to-open files and need no hosting at all.)

## 2 · Isolation from tree-twin-uat — the guarantees

### Data: safe by construction (no shared-store access exists)
SMART Buddy has **no code path** to any shared platform store. This is structural, not a
setting:

| Shared store | tree-twin-uat uses | SMART Buddy | Conflict |
|---|---|---|---|
| InfluxDB org `styl`, bucket `rtls` | tilt telemetry | never connects | **None** |
| Eclipse Ditto namespace `org.nparks` | one Thing per tree | never connects | **None** |
| Solace VPN `ai-poc-event-broker`, topic `nparks` | pub/sub | never connects | **None** |

### Server: values tree-twin-uat already occupies — **do NOT reuse these**
(Structural values only; live secrets live in the VM's `.env`, not here.)

| Resource | tree-twin-uat value |
|---|---|
| Public domain | `tree-twin-uat.styl.solutions` |
| Shared platform host | `iot-uat.styl.solutions` (Keycloak `/auth`, Ditto `/ditto-raw`, Influx `influxdb.iot-uat…`, API `/api/nparks`) |
| Host ports | **8087** frontend · **3310** api · **3400** forecast · **3300** history-api |
| Container names | `nparks-frontend` · `nparks-api` · `nparks-forecast-service` · `nparks-ingestion` |
| Compose project | `tree-digital-twin` |
| Docker networks | `twin` (bridge) + external `solace-pubsub-geo-filtering_backend` |
| Keycloak | realm `styl-iot`, client `nparks-tree-twin` |

### Values SMART Buddy already claims (chosen NOT to collide)
| Resource | SMART Buddy value | Set where |
|---|---|---|
| Host port | **8088** (override with env `SB_FRONTEND_PORT`) | `docker-compose.yml` |
| Container name | `smartbuddy-frontend` | `docker-compose.yml` |
| Compose project | `smartbuddy` (pinned via `name:`) | `docker-compose.yml` |
| Docker network | `sb-net` (private bridge; **does not** join tree-twin's `backend`) | `docker-compose.yml` |
| Internal listen port | `8080` (inside the container only) | `smart-buddy-app/nginx.conf` |
| Domain / Keycloak client | **none yet — your decision (§3)** | — |

## 3 · The three decisions you own (+ checklist for each)

> Whatever you pick, the compose stack stays fully isolated (own project, port, network;
> no shared stores). These decisions only affect *how it's exposed and gated*.

### A · Where it runs
- **Same shared UAT VM, isolated** — put it in e.g. `/data/smart-buddy-dashboard`,
  `docker compose up -d --build`. It listens on host `8088` and shares nothing but the
  kernel. Route it via the platform nginx-proxy (see B).
- **Separate / dedicated host** — copy the repo, `docker compose up -d --build`, put any
  reverse proxy + TLS in front. Nothing is shared with tree-twin at all.

### B · Hostname / routing
Give it its **own** hostname — never `tree-twin-uat.styl.solutions`. Suggested:
`smart-buddy-uat.styl.solutions`.

**If routing via the shared nginx-proxy (same-VM path):**
1. In `docker-compose.yml`, uncomment the `backend` external-network block **and** switch
   the service line to `networks: [sb-net, backend]` so the proxy can resolve
   `smartbuddy-frontend`.
2. Add a proxy server block: `server_name smart-buddy-uat.styl.solutions;` →
   `location / { proxy_pass http://smartbuddy-frontend:8080; }` (+ `/healthz` is available
   for upstream checks). No `/api/` route needed — there is no API.
3. Issue TLS for the new hostname; add the DNS record.

**If on a separate host:** point your reverse proxy / load balancer at `host:8088`
(or publish 80/443 directly). Same single `location /` → the container.

### C · Auth (the app carries real card / device / user IDs — gate it)
- **Own Keycloak client on realm `styl-iot`** — create a **new** client (e.g.
  `smart-buddy-dashboard`); do **not** reuse `nparks-tree-twin`. Gate at the proxy with
  `auth_request` (like tree-twin's `/api/`), add the client to the shared `jwt-validator`
  `JWT_ALLOWED_CLIENTS`, and add `https://<hostname>/*` to the client redirect URIs.
  ⚠ Note: the app has **no** `keycloak-js` login flow built in, so proxy-level
  `auth_request` gating is the intended approach. App-level OIDC login would be extra work.
- **Basic auth / IP allowlist at the proxy** — simplest; no Keycloak client needed.
- **Internal network only** — acceptable only if the network itself is the boundary.

## 4 · Files in this repo

| File | Role |
|---|---|
| `smart-buddy-app/Dockerfile` | two-stage `node` build → `nginx:1.27-alpine` serving `dist/` on 8080 |
| `smart-buddy-app/nginx.conf` | SPA fallback (hash routing), immutable `/assets/` cache, `/healthz` |
| `smart-buddy-app/.dockerignore` | keeps `node_modules`/`dist`/`.env` out of the build context |
| `docker-compose.yml` (repo root) | the whole stack — one isolated `frontend` service |

## 5 · Operational notes

- **Basemap needs outbound internet.** MapLibre fetches Carto Positron tiles from a CDN at
  runtime. With egress the map renders; on a fully air-gapped host the basemap image is
  blank (all data, charts, tables, school list still work). If air-gapped, self-host a tile
  source and repoint MapLibre.
- **Data is a point-in-time snapshot** (Feb 2026, generated 7 Jul 2026). To refresh:
  regenerate the JSON via the `analysis/` pipeline (HANDOVER.md §4), copy into
  `smart-buddy-app/src/data/`, then `docker compose up -d --build` to bake it into a new image.
- **Dev server unchanged.** `npm run dev` (5188) / `npm run preview` (5189) still work for
  local iteration; the container is the shareable artifact.
- **Verified here:** `npm run build` succeeds (self-contained `dist/` = 1 HTML + 1 CSS +
  1 JS). The image itself was **not** built here (no Docker on the analysis workstation) —
  first real build happens on your target host.

## 6 · No-Docker fallback

`npm run build` produces `smart-buddy-app/dist/` — a static folder you can drop onto any
static host (internal IIS/nginx, an HTTP file share, an object-store static site). Serve
`index.html` with SPA fallback; behaviour is identical.
