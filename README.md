# SMART Buddy twin — the digital twin (dashboard)

The **twin** repository of SMART Buddy helper: what a viewer sees. It holds the interactive insights
dashboard (Vite + MapLibre/OneMap, plain ES modules) at its root, and the `smartbuddy-frontend`
container that serves it (nginx) — the only published service of the stack. Everything behind it lives in the
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
until it is, the dashboard says "No data yet". Details: "The dashboard" below.

## Run it

```
npm install
npm run dev        # http://localhost:5188
```

`npm run dev` reads `.env` and then `.env.development.local` (both written by `./bootstrap-env.sh`;
the second switches the login off, since the dev server has no token proxy). Without either file it
runs with no login and no API base.

It needs a reachable api-service to show data (without one the basemap renders and the drawer says
"No data yet"): run the backend stack against the common Postgres, seeded with real rows or the
synthetic fixture (`backend/postgres/SEEDING.md` §5). The SAM chat needs a Solace broker and the agent:
with nothing configured it targets the shared local broker from `atlantic-platform/common` and shows
"offline" until the agent answers.

## Build and deploy

```
./bootstrap-env.sh              # .env + .env.development.local; see DEPLOY.md
docker compose up -d --build    # smartbuddy-frontend → host :8097
```

Frontend runbook: **DEPLOY.md** (env, the Solace defaults, the chat topics, routing, the STYL CIAM login). Whole
stack, seeding and the one-time VM cutover: **`backend/DEPLOY.md`**.

## Layout

| Path | What |
|---|---|
| `src/`, `index.html`, `public/` | the app: one module per window (map, school, terminals, network, wearables, items, savings, playback, compare, tour, shortcuts), `sam/` (the chat client) and `solace/` (the broker session) |
| `nginx.conf` | same-origin routing to the read API (`/smartbuddy-api/`, not token-checked: decision 0003), the login's token proxy (`/auth/token`) and the SPA |
| `docker/40-keycloak-token-proxy.sh` | writes the `/auth/token` include from the container's runtime environment (the client secret) |
| `Dockerfile`, `.dockerignore` | Vite build → nginx; the `VITE_*` build args. The build context is this root, so `.dockerignore` keeps every `.env*` out |
| `vite.config.js`, `package.json` | the dev server (port 5188) and the dependencies |
| `docker-compose.yml` | `smartbuddy-frontend` only (compose project `smartbuddy`, shared with backend — never `--remove-orphans`) |
| `bootstrap-env.sh`, `.env.example` | the env: one `.env` for compose and `npm run dev`, plus `.env.development.local` for dev |

## The dashboard

An interactive Singapore-map dashboard in the style of the tree-digital-twin frontend:
school markers on a MapLibre map, click a school to open its details in a drawer docked beside the map
(one view at a time; Back + breadcrumbs return to the previous view at the same tab and scroll).
**Compare:** "＋ Compare" on a school, stall or terminal (or Shift-click a school dot) pins it to a slim tray at the top
of the map (up to 4, one type at a time, lettered A–D with a matching badge on the map; hover a chip to peek its
numbers). The map zooms to fit the pinned items. "Compare ▸" opens one topic at a time (Spend / Errors / Speed /
Network / Food & menu) as graphs — a bar chart per measure, lines over time, 100% bars for shares — with the exact
numbers behind "Show numbers". The topic and the map key's "Colour by" follow each other.
**Top bar:** the month picker, the views of the workspace, search; the workspace menu (role ▾) holds Switch
workspace, Tours, Keyboard & mouse, Sign out. A "Not this month: …" chip appears only when a dataset is missing.
There is one mode and no upload: the data is whatever an operator seeded into the Postgres serving store
(`backend/postgres/SEEDING.md`); before the seed the drawer says "No data yet". **New viewers:** role picker (with Skip), then a
3-step getting-started checklist that ticks itself off; one-time tip on the drawer's Back. **Tour:** an opt-in
6-step spotlight tour (`src/tour.js`) — offered in the role picker, the checklist and the ▾ menu, never auto-started.
**Controls:** ▾ menu → "Keyboard & mouse" (or press `?`) lists them all (`src/shortcuts.js`). Highlights: Shift-click a
dot = add to Compare · Esc = Back in the drawer · search ↑ ↓ Enter · compare topics ← → · the map is 2D only (no
rotate / tilt).

### What's in it

- **Map** — 332 schools with markers (MOE-directory-matched + OneMap-geocoded; incl. 12 special-education
  schools). Dot **size** = spend per student-day; dot **colour** switches between School Level / Error rate /
  Transaction speed (legend, bottom-left). Status colours are colour-blind-safe (Okabe-Ito: teal / amber /
  vermillion) and the worst dots also get a dark ring. Engineering opens on Error rate; the other roles on Level.
  **Map key** (bottom-left, collapsible) is also the layer filter: colour by Level / Errors / Speed, then a show/hide row with a count for Primary · Secondary · Junior College · Other · **PBS Bookstores** (squares) · **Stamp points** (diamonds) — any combination, "Reset view" when filtered, kept in the URL
  (`#layers=…`). PBS and Self Serve Stamps are vendors, not schools: their shops/points sit beside the host school
  only when the placement is evidenced (`backend/ingestion-service/pbs_hosts.csv`, `stamp_hosts.csv`); "Lists: PBS
  bookstores" in the legend shows every shop, unplaced ones first.
- **Search** (top bar) — by school ID or name; works for unmapped schools too. Picking a school flies the map there.
- **School window** (click a marker) — spend/ticket/cards/error/speed stats, MOE badges
  (Independent · IP · GEP · SAP), and two tabs:
  - *Stalls & Spending* — weekly canteen revenue, revenue by stall (click a bar to open the stall)
  - *Terminals* — every machine tagged to its stall, with its machine-vs-site verdict
- **Terminals window** (Engineering) — every machine at the site where it **last** transacted that month, with
  problem tags (machine fault · site issue · no peers · slow · stopped · offline · retrieved). Tick machines →
  **Plan route** → **Service route** window: one stop per school, nearest-next from the STYL Service Center
  (3015A Ubi Road 1), straight-line km. PBS/stamp machines are listed as "Not routed" (no confirmed service
  location yet). Same rows SAM reads from `terminal_health`.
- **On load:** the role hub (F&B / Engineering / Management), or the saved role's primary view. A top-bar
  **month picker** switches every view; per-month views appear only when that month has the data
  (Wearables: Feb + Mar · Purchases & Saving: Mar).
- **Network Overview window** — four tabs: Network Health, Speed Trends,
  Food Trends, School Spending (the "atas" comparison). Clickable: a "Terminals needing attention" row opens the
  terminal; a top-spender row flies the map to the school and opens it; a school-type bar filters the table.
  Holiday days/weeks are shaded (CNY, March break — taken from the month's wearable bundle, not hard-coded).
- **Linked hover:** hovering a table row that names a school outlines its dot on the map, and the reverse.
- **Keyboard:** Tab reaches map dots and clickable rows; Enter/Space opens them.
- Deep link: `http://localhost:5188/#school=TKGS` opens that school on load; `#pins=school:MGSP,TKGS` opens that comparison
  (copy the URL after pinning). `#layers=…` keeps the Map key's shown layers.
- Tours: ▾ menu → Tours… (chapters for the current workspace) or "▶ Tour" in a view's header; content in `src/tour.js`.

### Data

Read per month (**Feb + March 2026** once seeded) from the Postgres serving store via api-service:
the `insights` table holds each month's precomputed bundles (`global`, `schools`, `stalls`, +
`wearable` / `items` / `savings` where present) in the shapes `backend/ingestion-service/build_insights.py`
defines, and the `pb_*` tables the Playback series (`backend/postgres/SEEDING.md` §1 is the contract).
The chat's agents read Redshift, not this store (`central-specs/decisions/0002`). How the map view is
built: `central-specs/design/MAP_DATA_FLOW.png`; runbooks: `DEPLOY.md` (this frontend) and
`backend/DEPLOY.md` (the whole stack).
Exclusions from spend: STYL vendor test terminals, "Retrieve…" stalls (real sales at machines later pulled —
kept in the Terminals view, tagged *retrieved*), amounts >$200.
School names/types: MOE School Directory (data.gov.sg), receipt-verified (all 332 school IDs geocoded);
coordinates via OneMap postal-code geocoding. **Food categories use verified stall names only**
(taxonomy v2) — a stall is classified only when its registered name says what it sells and its
own prices don't contradict it; generic-named stalls are **Unclassified** (price bands only).
No price-based category guessing. March receipts show what each stall actually sells, but never
assign a food category.

To refresh the data: an operator re-seeds the month (`backend/postgres/SEEDING.md`); the dashboard
picks it up on the next load.


## Related

- **backend** — `../backend/README.md`, `../backend/DEPLOY.md`, `../backend/postgres/SEEDING.md`
- **central-specs** — `../central-specs/README.md` (repository map, data facts, findings),
  `../central-specs/HANDOVER.md`, `../central-specs/decisions/`,
  `../central-specs/design/MAP_DATA_FLOW.png` (how the map view is built),
  `../central-specs/design/agent-chat/` (the designed chat box), `../central-specs/docs/sb_helper_agent_system.md`
