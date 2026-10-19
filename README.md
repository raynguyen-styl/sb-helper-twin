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

One mode (decision `0002`): the months present in the Postgres serving store, switched in the top
bar and read per month through api-service (nothing is bundled). An OneMap map of the 332 schools
(dots sized by spend, coloured by level / error rate / speed; PBS bookstore and stamp-point layers) and
eight views — Overview, Schools, Terminals (with a service route planner), Subsidies, Purchases,
Savings, Wearables and Playback — plus each school, stall and terminal. The chat ("SMART Buddy", the
orchestrator of the specialist agents on the mesh, over Solace) answers from Redshift with Markdown,
brief visuals or full reports, and shows which agent answered (so the chat and the dashboard can
disagree: `central-specs/decisions/0002`). Compare up to four schools, stalls or terminals; workspaces
(F&B / Engineering / Management) in the menu; opt-in tours; keyboard-usable; deep links; one frame
from a 360 px phone to a wide screen (central-specs change `overhaul-dashboard-and-agent-replies`).
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
| `src/`, `index.html`, `public/` | the app: `main.js` (the frame, the map, search, deep links), `windowing.js` (the drawer and the phone sheet), `ui.js` (the views' shared pieces), one module per view (`overview-`, `schools-`, `eng-`, `school-`, `stall-`, `subsidy-`, `items-`, `savings-`, `feb-`, `playback-window.js`), `compare.js`, `tour.js`, `shortcuts.js`, `roles.js`, `sam/` (the chat: client, panel, Markdown) and `solace/` (the broker session) |
| `src/styles/` | `tokens.css` (every colour, size and radius — the one place they are defined), `base.css`, `shell.css` (the frame), `views.css` (the views), `chat.css` |
| `scripts/` | `mesh-tests.mjs` + `mesh-tests.json`: the five tests that check the agent mesh answers the chat by its contract (`DEPLOY.md` "The chat"); not part of the build |
| `nginx.conf` | same-origin routing to the read API (`/smartbuddy-api/`, not token-checked: decision 0003), the login's token proxy (`/auth/token`) and the SPA |
| `docker/40-keycloak-token-proxy.sh` | writes the `/auth/token` include from the container's runtime environment (the client secret) |
| `Dockerfile`, `.dockerignore` | Vite build → nginx; the `VITE_*` build args. The build context is this root, so `.dockerignore` keeps every `.env*` out |
| `vite.config.js`, `package.json` | the dev server (port 5188) and the dependencies |
| `docker-compose.yml` | `smartbuddy-frontend` only (compose project `smartbuddy`, shared with backend — never `--remove-orphans`) |
| `bootstrap-env.sh`, `.env.example` | the env: one `.env` for compose and `npm run dev`, plus `.env.development.local` for dev |

## The dashboard

**The frame** (central-specs capability `dashboard-shell`), three frames from one grid:

- **Wide (1100 px and more):** the top bar, a rail of the eight views on the left, the map, and the details
  drawer on the right (440 px; 600 px for a dense view). The map pads itself for the drawer, so a place it flies
  to lands in the visible part.
- **Compact (720–1099 px):** the rail shows icons (the name on hover and focus); the drawer is a card over the
  map's right part, at most 420 px wide.
- **Phone (under 720 px):** a short top bar, the map, and a tab bar — Map, Overview, Schools, Terminals and More
  (Subsidies, Purchases, Savings, Wearables, Playback). Views open in a bottom sheet with a handle and three
  heights (peek, half, full): drag it, or ↑ ↓ on the handle; dragging down past peek closes it. The Map key is a
  sheet behind the Map key button; the chat opens full screen. Nothing scrolls sideways from 360 px; touch
  targets are 44 px.

**The top bar:** the brand; the month (a segmented control for up to four months, a select otherwise and on
phones); search (Ctrl/⌘ K or "/": schools, stalls and machines, grouped; ↑ ↓ Enter Esc; full screen on phones);
**Ask** (the chat); and the menu: the workspace (All, F&B / Operations, Engineering, Management), Tours,
Keyboard & mouse, who is signed in, Sign out. A view whose bundle the month lacks stays in the list, dimmed,
"Not in ‹Month Year›". A first visit opens the map and Overview with no dialog; the workspace is kept on the
device, and `#role=` still picks one (Engineering colours the map by error rate).

**The views** (capability `dashboard-views`) share one anatomy, built from `src/ui.js`: the month, the title,
the source chip and the actions (Compare, Tour); up to four KPI cards; then sections, each a title, a one-line
takeaway and a chart or a table. Every chart has "Numbers" (its table, from the chart's own data); tables scroll
inside their card with the first column kept in view.

- **Overview** opens on the month in one paragraph built only from the bundles (a figure they lack drops its
  clause), then Network health, Speed, Food and School spending.
- **Schools** ranks the month's schools — spend per card per day, revenue, taps, errors, median speed — sorted
  by any column (a school without the figure last, "–"), filtered by level, zone and type, searched by name or
  code; 50 rows, then "Show more". A row opens the school and flies the map to it.
- **Terminals** opens on health cards (Healthy, Needs attention, Machine fault, Site issue with its schools) that
  filter the list. Ticked machines gather in a sticky bar: **Plan route (n)** opens the service route — one stop
  per school, nearest-next from the STYL Service Center (3015A Ubi Road 1), straight-line km; PBS and stamp
  machines are listed as "Not routed". The same rows SAM reads from `terminal_health`.
- **A school** leads with its level and MOE chips (Independent · IP · GEP · SAP), four cards (spend per card per
  day, taps, error rate, median speed) and Compare; "More numbers" holds the rest; then the topics Spending and
  Terminals (every machine with its machine-vs-site verdict).
- **Subsidies**, **Purchases**, **Savings**, **Wearables** and **Playback** in the same anatomy. Purchases shows
  the menu's healthier flag only as "Marked healthier on the menu (unverified)" — the menu sets it on most items,
  books and sweet drinks included — and states how few items carry a calorie value.

**Compare:** "＋ Compare" on a school, stall or terminal (or Shift-click a school dot) pins it to a tray over the
map (on phones a bar above the tab bar, or above the sheet): up to 4, one kind at a time, lettered A–D with a
matching badge on the map. "Compare n" opens one topic at a time (Spend / Errors / Speed / Network / Food &
menu) as graphs, the exact numbers behind "Show numbers"; the topic and the map's "Colour by" follow each other.

**The map:** 332 schools (MOE-directory-matched + OneMap-geocoded; incl. 12 special-education schools). Dot size
= spend per student-day; colour = level, error rate or speed. Status colours are colour-blind-safe (Okabe-Ito)
and the worst dots also get a dark ring. The Map key is also the layer filter: Primary · Secondary · Junior
College · Other · PBS Bookstores (squares) · Stamp points (diamonds), with counts, kept in the URL
(`#layers=…`). PBS and Self Serve Stamps are vendors, placed beside their host school only when the placement is
evidenced (`backend/ingestion-service/pbs_hosts.csv`, `stamp_hosts.csv`); "list" shows every bookshop. Hovering
or focusing a row that names a school outlines its dot, and the reverse.

**The basemap** (capability `basemap`) is OneMap Grey, washed to grey, over the washed sea's grey. From 720 px it
is limited to zoom 11–19 and OneMap's tiled area; below 720 px to zoom 9.5–19 and wider bounds (lon
103.40–104.35, lat 0.95–1.70), with the first view fitted to the schools — re-applied when the width crosses
720 px. OneMap draws a "South China Sea / Pedra Branca" inset box — a territorial-claim mark, not geography — in
its z12 tiles (map zoom 10.5–11.5) and, further south-east, in its z11 tiles (map zoom 9.5–10.5, phones only). A
sea-coloured cover per tile zoom (`inset-z12` and `inset-z11` in `src/main.js`) hides each exactly while its own
tiles are on screen. On phones the attribution starts folded to its ⓘ. `SB.map` in the console is the MapLibre
instance.

**Deep links:** `#school=TKGS` opens that school and flies to it; `#schools`, `#stall=`, `#terminal=`, `#feb`,
`#items`, `#savings`, `#subsidy` and `#playback` open their view; `#role=eng` picks a workspace; `#layers=…`
keeps the Map key's layers; `#pins=school:MGSP,TKGS` restores a comparison (copy the URL after pinning).

**Help:** tours never start by themselves — menu → Tours (the chapters for the workspace) or "Tour" on a view
(`src/tour.js`); a getting-started checklist on screens 720 px and wider; menu → Keyboard & mouse (or `?`) lists
every key (`src/shortcuts.js`): Esc goes Back, Shift-click compares, Ctrl/⌘ K or "/" searches, ↑ ↓ on the
sheet's handle. The map is 2D only (no rotate or tilt). Under reduced motion nothing slides or fades.

### The chat

**Ask** opens one card over the map's lower right, left of the drawer (Expand widens it for reports); below
1100 px the chat and the drawer replace each other, each keeping its state; on phones it fills the screen. Esc
or ✕ closes it; the conversation stays until **New** or a reload. While a question waits it shows Sent →
Received → Answered with the seconds, until the routing card names the agents. An answer renders a safe
Markdown subset as elements (never HTML), a brief visual (up to three tiles and one chart or table) inside the
bubble or the full report card, "How it worked · N steps", and the agent that answered; a school named exactly in
a table cell, a tile label or bold opens on the map. The wire and the reply contract: `DEPLOY.md` "The chat".
To render a captured exchange without the broker, in the browser console:
`SB.chatReplay({ question, progress, reply })` (examples in `DEPLOY.md`).

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
