# SMART Buddy — Network & Spending Intelligence (map app)

An interactive Singapore-map dashboard in the style of the tree-digital-twin frontend:
school markers on a MapLibre map, click a school to open its details in a drawer docked beside the map
(one view at a time; Back + breadcrumbs return to the previous view at the same tab and scroll).
**Compare:** "＋ Compare" on a school, stall or terminal (or Shift-click a school dot) pins it to a slim tray at the top
of the map (up to 4, one type at a time, lettered A–D with a matching badge on the map; hover a chip to peek its
numbers). The map zooms to fit the pinned items. "Compare ▸" opens one topic at a time (Spend / Errors / Speed /
Network / Food & menu) as graphs — a bar chart per measure, lines over time, 100% bars for shares — with the exact
numbers behind "Show numbers". The topic and the map key's "Colour by" follow each other.
**Top bar:** a Demo | Live toggle (Demo = the uploaded extract, every view below, Upload, the demo agent; Live = the
Live overview, a live map coloured by spend and the live agent, all from the last **Sync**, with the Demo views and
tools hidden — `src/live.js`; kept per browser, `#mode=live` in a link forces it), views +
month + search; the workspace menu (role ▾) holds Switch workspace, Upload data (Demo only), Sign out. A
"Not this month: …" chip appears only when a dataset is missing. **New viewers:** role picker (with Skip), then a
3-step getting-started checklist that ticks itself off; one-time tip on the drawer's Back. **Tour:** an opt-in
6-step spotlight tour (`src/tour.js`) — offered in the role picker, the checklist and the ▾ menu, never auto-started.
**Controls:** ▾ menu → "Keyboard & mouse" (or press `?`) lists them all (`src/shortcuts.js`). Highlights: Shift-click a
dot = add to Compare · Esc = Back in the drawer · search ↑ ↓ Enter · compare topics ← → · the map is 2D only (no
rotate / tilt).

## Run it

```
cd client
npm install     # first time only
npm run dev     # then open http://localhost:5188
```

Requires Node (tested on v24). Internet is needed for the basemap tiles (OneMap Grey, SLA — keyless).
No data is bundled: every view fetches its month's insight bundles from api-service (`VITE_SB_API_URL`).
Without a reachable API the basemap renders but the map is empty — run against the local harness
(`central-specs/HANDOVER.md` "Run the dashboard locally") or the deployed stack.

## What's in it

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

## Data

Read live per month (**Feb + March 2026**) from ClickHouse via api-service: uploads land in the
`smartbuddy` db and `backend/ingestion-service/build_insights.py` precomputes each month's bundles
(`global`, `schools`, `stalls`, + `wearable` / `items` / `savings` where present). How the map view is
built: `central-specs/design/MAP_DATA_FLOW.png`; runbooks: `../DEPLOY.md` (this frontend) and
`backend/DEPLOY.md` (the whole stack).
Exclusions from spend: STYL vendor test terminals, "Retrieve…" stalls (real sales at machines later pulled —
kept in the Terminals view, tagged *retrieved*), amounts >$200.
School names/types: MOE School Directory (data.gov.sg), receipt-verified (all 332 school IDs geocoded);
coordinates via OneMap postal-code geocoding. **Food categories use verified stall names only**
(taxonomy v2) — a stall is classified only when its registered name says what it sells and its
own prices don't contradict it; generic-named stalls are **Unclassified** (price bands only).
No price-based category guessing. March receipts show what each stall actually sells, but never
assign a food category.

To refresh the data: upload through the dashboard (rebuilds that month's bundles), or rerun the
`ch-insights` one-shot with `SB_MONTH=YYYY-MM` (`backend/DEPLOY.md` §4).
