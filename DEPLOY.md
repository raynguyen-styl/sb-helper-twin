# DEPLOY — SMART Buddy twin (the frontend only)

This repository deploys one container: **`smartbuddy-frontend`** (Vite build served by nginx), the
only published service of SMART Buddy helper (host port **8097**; the ALB maps
`smartbuddy-helper-uat.styl.solutions/*` to it). Everything behind it — `smartbuddy-api`,
`smartbuddy-mcp`, `smartbuddy-ingest`, the one-shots, the data — is deployed from the sibling
**backend** repository. The whole-stack runbook, including the one-time VM **cutover** from the old
monorepo checkout, is **`backend/DEPLOY.md`**: read it first on a VM that still runs
`/data/smart-buddy-data`, and never `git pull` there.

## 1 · Build and run

```bash
cd /data/sb-helper/twin        # the twin checkout on the VM (locally: wherever you cloned it)
./bootstrap-env.sh             # writes .env + client/.env; prints where each value came from, never a value
docker compose up -d --build   # smartbuddy-frontend
```

A frontend-only change is: commit → push `origin` + `github` → on the VM `git pull` **here** → the
command above. The container is recreated in place under the same name. Compose warns that the
backend's containers are "orphans" (both repositories use project `smartbuddy`): expected — **never
pass `--remove-orphans`**, it would stop the backend.

The frontend starts with or without the backend: its nginx resolves the backend containers per
request, so `/smartbuddy-api/`, `/smartbuddy-mcp/` and `/smartbuddy-ingest/` fail until the platform
and the backend are up (502; the Keycloak-gated routes 500, because the token check itself cannot
reach `jwt-validator`), and `/healthz` answers 200 regardless.

## 2 · Environment (`.env` → build arguments)

`VITE_*` values are baked into the bundle at **build** time: rebuild after changing any. No secret
lives in this repository's `.env`; the backend's are in `backend/.env`.

| Variable | Notes |
|---|---|
| `SB_FRONTEND_PORT` | host port (default **8097**; the VM's ALB rule points here) |
| `VITE_SB_API_URL` | api-service base — same-origin `/smartbuddy-api` (this nginx proxies it). Empty → Playback uses bundled demo data |
| `VITE_KEYCLOAK_URL` / `VITE_KEYCLOAK_REALM` / `VITE_KEYCLOAK_CLIENT_ID` | realm `styl-iot`, client `smart-buddy`. Empty URL → no login (local dev only) |
| `VITE_SOLACE_URL` / `VITE_SOLACE_VPN` / `VITE_SOLACE_USER` / `VITE_SOLACE_PASSWORD` | the SAM chat transport — see "Solace defaults" |
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

## 3 · Routing (`client/nginx.conf`)

ONE hostname: the ALB maps it to this container and nginx same-origin-routes the rest, so the shared
platform nginx-proxy is untouched:
- `/` → the static SPA (Keycloak login in the browser via keycloak-js);
- `/smartbuddy-api/` → `smartbuddy-api:3320`, gated by Keycloak JWT (`auth_request` → the shared
  `jwt-validator:3200`);
- `/smartbuddy-mcp/` → `smartbuddy-mcp:3501`, guarded by the MCP's own Bearer (`SB_MCP_API_KEY`, set
  in backend);
- `/smartbuddy-ingest/` → `smartbuddy-ingest:8200`, Keycloak-gated, large chunked uploads allowed;
- `/healthz` → 200.

For that the container joins the external `backend` network and resolves the backend containers by
name per request (`resolver 127.0.0.11`).

## 4 · Keycloak

Register a **`smart-buddy`** client in the Keycloak admin console (realm `styl-iot`), add it to the
platform **`JWT_ALLOWED_CLIENTS`**, and add `https://<hostname>/*` to its redirect URIs — exactly like
the other demos. Never reuse `nparks-tree-twin`. To skip Keycloak (local dev / internal-only), leave
`VITE_KEYCLOAK_URL` empty and gate at the proxy instead.

## 5 · Verify

- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8097/healthz` → 200; the same for `/` (the
  SPA) → 200.
- In the browser: login; the map renders (OneMap tiles need outbound internet); the month picker shows
  both months; Playback animates (needs the backend); SAM chat answers (needs the broker + the agent;
  "offline" otherwise).

The full end-to-end list is `backend/DEPLOY.md` §8.

*Companion docs: `README.md` (the dashboard, dev) · `backend/DEPLOY.md` (whole stack + cutover) ·
`central-specs/HANDOVER.md` (orientation, the local harness).*
