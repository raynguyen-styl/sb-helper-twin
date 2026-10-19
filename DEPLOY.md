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
./bootstrap-env.sh             # writes .env + .env.development.local; prints where each value came from, never a value
docker compose up -d --build   # smartbuddy-frontend
```

A frontend-only change is: commit → push `origin` + `github` → on the VM `git pull` **here** → the
command above. The container is recreated in place under the same name. Compose warns that the
backend's container is an "orphan" (both repositories use project `smartbuddy`): expected — **never
pass `--remove-orphans`**, it would stop the backend.

**Once, after the pull that flattened this repository** (the app used to sit in `client/`; change
`flatten-twin-repo`): `client/` is left holding only ignored files (an old `client/.env`, maybe
`node_modules/` and `dist/`). Nothing reads them: `rm -rf client`. The root `.env` and the command
above are unchanged. The build context is now this root, and `.dockerignore` keeps every `.env*` out
of the image.

The frontend starts with or without the backend: its nginx resolves `smartbuddy-api` per request, so
`/smartbuddy-api/` answers 502 until the backend is up, and `/healthz` answers 200 regardless.

## 2 · Environment (`.env` → build arguments)

`VITE_*` values are baked into the bundle at **build** time: rebuild after changing any. The one secret
in this repository's `.env` is the login's `KEYCLOAK_CLIENT_SECRET`, a **runtime** setting of the
container (§4) — never a build argument; the backend's secrets are in `backend/.env`.

| Variable | Notes |
|---|---|
| `SB_FRONTEND_PORT` | host port (default **8097**; the VM's ALB rule points here) |
| `VITE_SB_API_URL` | api-service base — same-origin `/smartbuddy-api` (this nginx proxies it). Empty → Playback uses bundled demo data |
| `VITE_KEYCLOAK_ENABLED` | `true` → the STYL CIAM login gates the app (the bootstrap writes `true` in `.env`, and `false` in `.env.development.local`, which only `npm run dev` reads). Anything else → no login (local dev only) |
| `VITE_KEYCLOAK_OIDC_CONFIG_URL` | the realm's discovery URL (default `https://ciam-uat.styl.solutions/realms/demo/.well-known/openid-configuration`) |
| `VITE_KEYCLOAK_CLIENT_ID` | default `demo-application`; also the token proxy's client id at runtime |
| `VITE_KEYCLOAK_TOKEN_PROXY` | the token proxy's path, relative to the base (default `auth/token`); empty → keycloak-js calls the token endpoint directly (a public client) |
| `KEYCLOAK_CLIENT_SECRET` | **runtime only**: `demo-application`'s secret, added by the `/auth/token` proxy. Not baked in: change it with `docker compose up -d`, no rebuild. The bootstrap keeps it across re-runs and marks it MISSING when unset |
| `KEYCLOAK_TOKEN_ENDPOINT` | runtime only: where the proxy forwards (default the CIAM `demo` realm's token endpoint) |
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
and its checklist names the source. There is no Demo | Live toggle and no `#mode=` any more
(`central-specs/decisions/0002`).

The reply (central-specs capability `agent-system`, decision `0006`) is `{correlationId, reply,
actions, kind?, agents?, report?, suggestions?, steps?}`:
- `reply` is short Markdown — paragraphs, headings, bold, italics, code, lists and pipe tables —
  rendered as elements (`src/sam/markdown.js`), never as HTML: a link or an `<img>` shows as text.
- `report.mode: "brief"` (at most 3 tiles and one chart or table) draws inside the answer bubble;
  `"report"`, or a report without a mode, draws the full report card (tiles, inline-SVG charts with a
  "Numbers" table, tables, notes, Copy and CSV).
- `steps: [{agent, text}]` fold under the answer as "How it worked · N steps".
- A school named exactly (in a table cell, a tile label or bold) becomes a button that opens it on the map.
- An answer with `report` null or brief and exactly one specialist `done` is that specialist's bubble;
  any other is the orchestrator's. `kind: "refusal"` is styled as a refusal; `suggestions[]` are chips.

While a question waits the chat shows Sent → Received → Answered with the seconds; a message with the
same `correlationId`, `status: "working"` and no `reply` is progress: the routing card (one row per
specialist in `agents[]`) replaces the steps and the wait restarts. The gateway's own "Request received
by gateway…" frame is a receipt: it marks Received and the question keeps waiting. The wait is
`VITE_SAM_TIMEOUT_MS` (default 60 s), doubled for a question that asks for a report; with no reply or
progress in that time the chat shows "offline" and the rest of the dashboard is unaffected. A
specialist marked `failed` or `timeout` gets a Retry chip that re-sends the question with
`retry: ask only <agent_name>` in the context hint. Registering the agents:
`central-specs/docs/sb_helper_agent_mesh_setup.md`.

To render a captured exchange without the broker (debugging), in the browser console:
`SB.chatReplay({ question, progress: [...], reply })` — `progress` holds working messages or the
gateway's receipt; without `reply` the question is left waiting. For example:
`SB.chatReplay({ question: 'Top 5 schools by spend', reply: { reply: '**MGSP** led.', agents: [{ name: 'sb_spend', status: 'done' }], report: { mode: 'brief', kpis: [{ label: 'Top school', value: 74602, unit: 'SGD' }], charts: [{ kind: 'bar', title: 'Spend by school', unit: 'SGD', series: [{ name: 'Spend', points: [['MGSP', 74602], ['RGPS', 26281]] }] }] }, steps: [{ agent: 'sb_spend', text: 'Ranked schools by spend.' }] } })`.

## 3 · Routing (`nginx.conf`)

ONE hostname: the ALB maps it to this container and nginx same-origin-routes the rest, so the shared
platform nginx-proxy is untouched:
- `/` → the static SPA (the STYL CIAM login in the browser via keycloak-js, §4);
- `/smartbuddy-api/` → `smartbuddy-api:3320` — the only backend route, **not token-checked**
  (`central-specs/decisions/0003`: the shared `jwt-validator` trusts only the old `styl-iot` realm, and
  the browser login is the only gate). Anyone who can reach the hostname can read it;
- `POST /auth/token` → the CIAM token endpoint, with the client secret added (§4); any other method → 403;
- `/healthz` → 200.

For that the container joins the external `backend` network and resolves the backend container by
name per request (`resolver 127.0.0.11`). The retired routes `/smartbuddy-mcp/`, `/smartbuddy-ingest/`
and `/smartbuddy-live/` fall through to the SPA; no backend receives them.

## 4 · Keycloak (STYL CIAM)

The dashboard logs in the way Bibo Bus does (`central-specs/decisions/0003`, change
`ciam-keycloak-login`): realm **`demo`** on `https://ciam-uat.styl.solutions`, confidential client
**`demo-application`** (shared with Bibo Bus), authorization code + PKCE S256, `check-sso`, scope
`openid`, returning to the bare origin. Viewers need an account in that realm; old `styl-iot` logins do
not work here.

- **In the CIAM admin console** (client `demo-application`): add `https://<hostname>` — exactly, no
  path or trailing slash — to *Valid redirect URIs* and *Valid post logout redirect URIs*. Web origins
  do not matter: the token call goes server-to-server through the proxy. **Check that *Service
  accounts* and *Direct access grants* are OFF** for that client: `/auth/token` attaches the secret
  to any grant it forwards, so with either on, anyone reaching it could get tokens without signing in
  (decision 0003).
- **The secret**: put `KEYCLOAK_CLIENT_SECRET=<the client's secret>` in this repository's `.env` on the
  VM (or export it before `./bootstrap-env.sh`, which keeps it). Then `docker compose up -d`. The
  container's start log says `40-keycloak-token-proxy: /auth/token -> ciam-uat.styl.solutions (client
  credentials set)`; without it, "forwarding as a public client", and sign-in fails with
  `unauthorized_client`. Rotating it (it is shared with Bibo Bus) means one `docker compose up -d` in
  each twin.
- **How the secret stays out of the browser**: keycloak-js posts the code exchange and every refresh
  to this container's `/auth/token`; `docker/40-keycloak-token-proxy.sh` writes, at container
  start, an nginx include (mode 600) that adds the secret as HTTP Basic, drops the visitor's Cookie,
  Origin and Referer, and forwards to CIAM over verified TLS. Trade-off, accepted in decision 0003:
  anyone who can reach `/auth/token` gets the secret attached to their request, but a real sign-in, a
  valid code and its PKCE verifier are still required.
- **Sessions**: tokens are kept in the tab's `sessionStorage` (a reload does not redirect); a failed
  refresh sends the viewer back to login. If CIAM cannot be reached the dashboard does not load and
  says "Sign-in failed".
- **Local dev**: `npm run dev` runs without login (the dev server has no token proxy).
- **Rollback**: check out the previous commit and `docker compose up -d --build`; the old `styl-iot`
  client `smart-buddy` and the platform's `jwt-validator` are untouched, so the old login works again.

## 5 · Verify

- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8097/healthz` → 200; the same for `/` (the
  SPA) → 200.
- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8097/auth/token` → 403 (POST only), and
  `docker logs smartbuddy-frontend 2>&1 | grep 40-keycloak` → "client credentials set".
- In the browser: the CIAM login page; after signing in, the map renders; a reload does not go back to
  CIAM; the ☰ menu shows "Signed in as …" and Sign out returns to the login page; the map renders (OneMap tiles need outbound internet); the month picker shows
  the seeded months (or the drawer says "No data yet" before the seed); Playback animates (needs the
  backend); SAM chat answers (needs the broker + the agent; "offline" otherwise).

The full end-to-end list is `backend/DEPLOY.md` §8.

*Companion docs: `README.md` (the dashboard, dev) · `backend/DEPLOY.md` (whole stack, seeding, cutover) ·
`central-specs/HANDOVER.md` (orientation).*
