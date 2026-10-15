# SMART Buddy twin — the digital twin (dashboard)

The **twin** repository of SMART Buddy helper: what a viewer sees. It holds `client/`, the interactive
insights dashboard (Vite + MapLibre/OneMap, plain ES modules), and the `smartbuddy-frontend` container
that serves it (nginx) — the only published service of the stack. Everything behind it lives in the
sibling **backend** repository (the read API over the Postgres serving store, the seeding runbook, the
retained offline tooling); design, decisions and the handover live in **central-specs**. Workspace:
`presales-prototypes/atlantic-platform/sb-helper/` (decisions `central-specs/decisions/0001`, `0002`).

> **UAT VM operators:** the VM may still run the pre-split monorepo checkout `/data/smart-buddy-data`.
> **Never `git pull` there** — `main` of this repository no longer has the backend directories, so a
> pull would delete them from that checkout. Follow the cutover in `backend/DEPLOY.md` §11 instead.

## What it shows

One mode (decision `0002`): the months present in the Postgres serving store — **February + March
2026** once seeded — switched by a top-bar month picker, read per month through api-service (nothing is
bundled). A role hub (F&B / Engineering / Management) picks the views: an OneMap map of the 332 schools
(dots sized by spend, coloured by level / error rate / speed; PBS bookstore and stamp-point layers),
school details with stalls and terminals tabs, Network Overview, Terminal Health with a service route
planner, Wearables (Feb + Mar), Purchases and Saving (Mar), Playback, and a SAM chat panel over Solace
to the agents on the mesh, which answer from Redshift (so the chat and the dashboard can disagree:
`central-specs/decisions/0002`). Compare up to four schools, stalls or terminals side by side; opt-in
tours; keyboard-usable; deep links (`#role=`, `#school=`, `#terminal=`, `#layers=`, `#pins=`).
There is no upload and no sync: the store is seeded by an operator (`backend/postgres/SEEDING.md`);
until it is, the dashboard says "No data yet". Details: `client/README.md`.

## Run it

```
cd client
npm install
npm run dev        # http://localhost:5188
```

It needs a reachable api-service to show data (without one the basemap renders and the drawer says
"No data yet"): run the backend stack against the common Postgres, seeded with real rows or the
synthetic fixture (`backend/postgres/SEEDING.md` §5). The SAM chat needs a Solace broker and the agent:
with nothing configured it targets the shared local broker from `atlantic-platform/common` and shows
"offline" until the agent answers.

## Build and deploy

```
./bootstrap-env.sh              # .env + client/.env (no secrets); see DEPLOY.md
docker compose up -d --build    # smartbuddy-frontend → host :8097
```

Frontend runbook: **DEPLOY.md** (env, the Solace defaults, the chat topics, routing, the STYL CIAM login). Whole
stack, seeding and the one-time VM cutover: **`backend/DEPLOY.md`**.

## Layout

| Path | What |
|---|---|
| `client/src/` | the app: one module per window (map, school, terminals, network, wearables, items, savings, playback, compare, tour, shortcuts), `sam/` (the chat client) and `solace/` (the broker session) |
| `client/nginx.conf` | same-origin routing to the read API (`/smartbuddy-api/`, not token-checked: decision 0003), the login's token proxy (`/auth/token`) and the SPA |
| `client/docker/40-keycloak-token-proxy.sh` | writes the `/auth/token` include from the container's runtime environment (the client secret) |
| `client/Dockerfile` | Vite build → nginx; the `VITE_*` build args |
| `docker-compose.yml` | `smartbuddy-frontend` only (compose project `smartbuddy`, shared with backend — never `--remove-orphans`) |
| `bootstrap-env.sh`, `.env.example` | the frontend env |

## Related

- **backend** — `../backend/README.md`, `../backend/DEPLOY.md`, `../backend/postgres/SEEDING.md`
- **central-specs** — `../central-specs/README.md` (repository map, data facts, findings),
  `../central-specs/HANDOVER.md`, `../central-specs/decisions/`,
  `../central-specs/design/MAP_DATA_FLOW.png` (how the map view is built),
  `../central-specs/design/agent-chat/` (the designed chat box), `../central-specs/docs/sb_helper_agent_system.md`
