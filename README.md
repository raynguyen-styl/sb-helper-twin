# SMART Buddy twin — the digital twin (dashboard)

The **twin** repository of SMART Buddy helper: what a viewer sees. It holds `client/`, the interactive
insights dashboard (Vite + MapLibre/OneMap, plain ES modules), and the `smartbuddy-frontend` container
that serves it (nginx) — the only published service of the stack. Everything behind it lives in the
sibling **backend** repository (the read API, the SAM agent's MCP adapter, the upload service, the
one-shots, the offline analysis pipeline, the data runbooks); design, decisions and the handover live
in **central-specs**. Workspace: `presales-prototypes/atlantic-platform/sb-helper/`
(decision `central-specs/decisions/0001`).

> **UAT VM operators:** the VM may still run the pre-split monorepo checkout `/data/smart-buddy-data`.
> **Never `git pull` there** — `main` of this repository no longer has the backend directories, so a
> pull would delete them from that checkout. Follow the cutover in `backend/DEPLOY.md` §11 instead.

## What it shows

Two months — **February + March 2026** — switched by a top-bar month picker, read live per month from
the shared ClickHouse `smartbuddy` database through api-service (nothing is bundled). A role hub (F&B /
Engineering / Management) picks the views: an OneMap map of the 332 schools (dots sized by spend, coloured
by level / error rate / speed; PBS bookstore and stamp-point layers), school details with stalls and
terminals tabs, Network Overview, Terminal Health with a service route planner, Wearables (Feb + Mar),
Purchases and Saving (Mar), Playback, Upload (chunked, resumable), and a SAM chat panel over Solace.
A **Demo | Live** toggle on the nav bar switches the dashboard: Demo is the uploaded extract with every
view, Upload and the demo agent; Live is a Live overview, a live map and the live agent in the chat,
all from the last **Sync** (the backend asks the live agent — today the only path to Redshift — and
stores the answers) (`DEPLOY.md` "Demo and Live"; `#mode=live` in a link forces it). Compare up to four schools, stalls or
terminals side by side; opt-in tours; keyboard-usable; deep links (`#role=`, `#school=`, `#terminal=`,
`#layers=`, `#mode=`). Details: `client/README.md`.

## Run it

```
cd client
npm install
npm run dev        # http://localhost:5188
```

It needs a reachable api-service to show data (without one the basemap renders and the map is empty):
run the backend stack, or the local harness described in `central-specs/HANDOVER.md` "Run the dashboard
locally". The SAM chat needs a Solace broker and the agent: with nothing configured it targets the shared
local broker from `atlantic-platform/common` and shows "offline" until the agent answers.

## Build and deploy

```
./bootstrap-env.sh              # .env + client/.env (no secrets); see DEPLOY.md
docker compose up -d --build    # smartbuddy-frontend → host :8097
```

Frontend runbook: **DEPLOY.md** (env, the Solace defaults, routing, Keycloak). Whole stack and the
one-time VM cutover: **`backend/DEPLOY.md`**.

## Layout

| Path | What |
|---|---|
| `client/src/` | the app: one module per window (map, school, terminals, network, wearables, items, savings, playback, upload, compare, tour, shortcuts), `sam/` (the chat client) and `solace/` (the broker session) |
| `client/nginx.conf` | same-origin routing to the backend containers (`/smartbuddy-api/`, `/smartbuddy-mcp/`, `/smartbuddy-ingest/`) and the SPA |
| `client/Dockerfile` | Vite build → nginx; the `VITE_*` build args |
| `docker-compose.yml` | `smartbuddy-frontend` only (compose project `smartbuddy`, shared with backend — never `--remove-orphans`) |
| `bootstrap-env.sh`, `.env.example` | the frontend env |

## Related

- **backend** — `../backend/README.md`, `../backend/DEPLOY.md`, `../backend/reload/README.md`
- **central-specs** — `../central-specs/README.md` (repository map, data facts, findings),
  `../central-specs/HANDOVER.md`, `../central-specs/decisions/`,
  `../central-specs/design/MAP_DATA_FLOW.png` (how the map view is built)
