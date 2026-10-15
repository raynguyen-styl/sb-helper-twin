# DEPLOY — SMART Buddy twin (the frontend only)

This repository deploys one container: **`smartbuddy-frontend`** (Vite build served by nginx), the
only published service of SMART Buddy helper (host port **8097**; the ALB maps
`smartbuddy-helper-uat.styl.solutions/*` to it). Everything behind it — `smartbuddy-api` and the
Postgres serving store it reads — is deployed from the sibling **backend** repository and
`atlantic-platform/common`. The whole-stack runbook, including seeding and the one-time VM **cutover**
from the old monorepo checkout, is **`backend/DEPLOY.md`**: read it first on a VM that still runs
`/data/smart-buddy-data`, and never `git pull` there.

## 1 · Build and run

```bash
cd /data/sb-helper/twin        # the twin checkout on the VM (locally: wherever you cloned it)
./bootstrap-env.sh             # writes .env + client/.env; prints where each value came from, never a value
docker compose up -d --build   # smartbuddy-frontend
```

A frontend-only change is: commit → push `origin` + `github` → on the VM `git pull` **here** → the
command above. The container is recreated in place under the same name. Compose warns that the
backend's container is an "orphan" (both repositories use project `smartbuddy`): expected — **never
pass `--remove-orphans`**, it would stop the backend.

The frontend starts with or without the backend: its nginx resolves `smartbuddy-api` per request, so
`/smartbuddy-api/` fails until the platform and the backend are up (500 while the token check cannot
reach `jwt-validator`, 502 while the API is down), and `/healthz` answers 200 regardless.

## 2 · Environment (`.env` → build arguments)

`VITE_*` values are baked into the bundle at **build** time: rebuild after changing any. No secret
lives in this repository's `.env`; the backend's is in `backend/.env`.

| Variable | Notes |
|---|---|
| `SB_FRONTEND_PORT` | host port (default **8097**; the VM's ALB rule points here) |
| `VITE_SB_API_URL` | api-service base — same-origin `/smartbuddy-api` (this nginx proxies it). Empty → Playback uses bundled demo data |
| `VITE_KEYCLOAK_URL` / `VITE_KEYCLOAK_REALM` / `VITE_KEYCLOAK_CLIENT_ID` | realm `styl-iot`, client `smart-buddy`. Empty URL → no login (local dev only) |
| `VITE_SOLACE_URL` / `VITE_SOLACE_VPN` / `VITE_SOLACE_USER` / `VITE_SOLACE_PASSWORD` | the SAM chat transport — see "Solace defaults" |
| `VITE_SAM_TOPIC_REQUEST` / `VITE_SAM_TOPIC_RESPONSE` / `VITE_SAM_TOPIC_ERROR` | the chat's Solace topics — see "The chat" |
| `BACKEND_NETWORK` | the shared external docker network (default `solace-pubsub-geo-filtering_backend`) |

**Solace defaults.** With none of the four set, the build targets the shared local Solace that
`atlantic-platform/common` runs on every box: `ws://localhost:8008` (its Web Messaging port, published
on loopback), message VPN and client-username `default` (the broker image's built-in demo identity,
documented in `common/README.md` — not a secret). The same values hold wherever the common stack runs
beside this repository, so a box running both needs no Solace configuration. `bootstrap-env.sh`
resolves the four values in this order: already exported in the environment → an existing `.env` →
the pre-split monorepo's `.env` (`SB_LEGACY_ENV`, default `/data/smart-buddy-data/.env`) → those
defaults; its checklist names the source of each. Two limits to know: a browser that is not on the box
cannot reach `localhost:8008`, and an `https` page cannot open a `ws://` socket — so UAT keeps the
broker values it uses today (the bootstrap preserves them from the legacy `.env`). Point the four
values at another broker to use it. They ship in the browser bundle: low-privilege demo credentials
only, scoped to the smartbuddy chat topics. There is no proxy for the broker in this nginx, by
decision (`central-specs`, change `split-sb-helper-repos`, D12).

**The chat.** One topic set (central-specs capability `sam-chat`): the chat publishes each question as
`{correlationId, text, context, ts}` on `VITE_SAM_TOPIC_REQUEST` and takes the reply from
`VITE_SAM_TOPIC_RESPONSE` (errors from `VITE_SAM_TOPIC_ERROR`), matched by `correlationId`. The
defaults are `STYL/iot/smartbuddy-live/system/shared/v1/sam/chat/request`, `…/response`, `…/error` —
the topics the Redshift agent's gateway rule answers on (`backend/DEPLOY.md` §7). When the orchestrator
of `central-specs/docs/sb_helper_agent_system.md` exists, the mesh owner points that rule at it; the
twin does not change. The older `VITE_SAM_QUERY_TOPIC` / `VITE_SAM_RESPONSE_TOPIC` / `VITE_SAM_ERROR_TOPIC`
still override. `bootstrap-env.sh` resolves each key from the environment → an existing `.env`'s same
key → that file's pre-October `VITE_SAM_LIVE_TOPIC_*` → the default, so a box keeps the topics it used,
and its checklist names the source. No agent on the topic → the panel shows "offline" after 60 s; the
rest of the dashboard is unaffected. There is no Demo | Live toggle and no `#mode=` any more
(`central-specs/decisions/0002`).

## 3 · Routing (`client/nginx.conf`)

ONE hostname: the ALB maps it to this container and nginx same-origin-routes the rest, so the shared
platform nginx-proxy is untouched:
- `/` → the static SPA (Keycloak login in the browser via keycloak-js);
- `/smartbuddy-api/` → `smartbuddy-api:3320`, gated by Keycloak JWT (`auth_request` → the shared
  `jwt-validator:3200`) — the only backend route;
- `/healthz` → 200.

For that the container joins the external `backend` network and resolves the backend container by
name per request (`resolver 127.0.0.11`). The retired routes `/smartbuddy-mcp/`, `/smartbuddy-ingest/`
and `/smartbuddy-live/` fall through to the SPA; no backend receives them.

## 4 · Keycloak

Register a **`smart-buddy`** client in the Keycloak admin console (realm `styl-iot`), add it to the
platform **`JWT_ALLOWED_CLIENTS`**, and add `https://<hostname>/*` to its redirect URIs — exactly like
the other demos. Never reuse `nparks-tree-twin`. To skip Keycloak (local dev / internal-only), leave
`VITE_KEYCLOAK_URL` empty and gate at the proxy instead.

## 5 · Verify

- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8097/healthz` → 200; the same for `/` (the
  SPA) → 200.
- In the browser: login; the map renders (OneMap tiles need outbound internet); the month picker shows
  the seeded months (or the drawer says "No data yet" before the seed); Playback animates (needs the
  backend); SAM chat answers (needs the broker + the agent; "offline" otherwise).

The full end-to-end list is `backend/DEPLOY.md` §8.

*Companion docs: `README.md` (the dashboard, dev) · `backend/DEPLOY.md` (whole stack, seeding, cutover) ·
`central-specs/HANDOVER.md` (orientation).*
