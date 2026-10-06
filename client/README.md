# SMART Buddy — Network & Spending Intelligence (map app)

An interactive Singapore-map dashboard in the style of the tree-digital-twin frontend:
school markers on a MapLibre map, click a school to open a draggable detail window.

## Run it

```
cd client
npm install     # first time only
npm run dev     # then open http://localhost:5188
```

Requires Node (tested on v24). Internet is needed for the basemap tiles (OneMap Grey, SLA — keyless);
all data is bundled locally in `src/data/`.

## What's in it

- **Map** — 332 schools with markers (MOE-directory-matched + OneMap-geocoded; incl. 12 special-education
  schools). Dot **size** = spend per student-day; dot **colour** switches between School Level / Error rate /
  Transaction speed (legend, bottom-left). **Filter pills** (top-left): All · Primary · Secondary · Junior College ·
  Other · **PBS Bookstores** (violet squares) · **Stamp points** (pink diamonds) — any combination, kept in the URL
  (`#layers=…`). PBS and Self Serve Stamps are vendors, not schools: their shops/points sit beside the host school
  only when the placement is evidenced (`ingestion-service/pbs_hosts.csv`, `stamp_hosts.csv`); "Lists: PBS
  bookstores" in the legend shows every shop, unplaced ones first.
- **Search** (top bar) — by school ID or name; works for unmapped schools too.
- **School window** (click a marker) — spend/ticket/cards/error/speed stats, MOE badges
  (Independent · IP · GEP · SAP), and three tabs:
  - *Spending & Food* — weekly revenue, category mix vs the network
  - *Network* — per-terminal table (signal, errors, offline share)
  - *Speed* — weekly median vs network baseline
- **Terminals window** (Engineering) — every machine at the site where it **last** transacted that month, with
  problem tags (machine fault · site issue · no peers · slow · stopped · offline · retrieved). Tick machines →
  **Plan route** → **Service route** window: one stop per school, nearest-next from the STYL Service Center
  (3015A Ubi Road 1), straight-line km. PBS/stamp machines are listed as "Not routed" (no confirmed service
  location yet). Same rows SAM reads from `terminal_health`.
- **Network Overview window** (opens on load) — four tabs: Network Health, Speed Trends,
  Food Trends, School Spending (the "atas" comparison).
- Deep link: `http://localhost:5188/#school=TKGS` opens that school on load.

## Data

Precomputed from the **February 2026** transaction CSVs (~4.0M rows) — the project was
narrowed to Feb only (March/April + the May health drop were removed 8 Jul 2026; see
`../PIPELINE.md`). For findings and full method/caveats see the Feb reports in the
project root (`SMART_Buddy_Feb2026_Service_Report.pdf`, `SMART_Buddy_Feb2026_Insights.html`).
Exclusions from spend: STYL vendor test terminals, "Retrieve…" stalls (real sales at machines later pulled —
kept in the Terminals view, tagged *retrieved*), amounts >$200.
School names/types: MOE School Directory (data.gov.sg), receipt-verified (all 332 school IDs geocoded);
coordinates via OneMap postal-code geocoding. **Food categories use verified stall names only**
(taxonomy v2) — a stall is classified only when its registered name says what it sells and its
own prices don't contradict it; generic-named stalls are **Unclassified** (price bands only).
No price-based category guessing, and no item-level SKU data exists.

To regenerate `src/data/*.json`, rerun `build_feb_app_data.py` + `build_stalls_data.py`
(analysis pipeline; ask Gideon).
