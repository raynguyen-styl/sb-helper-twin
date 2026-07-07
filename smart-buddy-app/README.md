# SMART Buddy — Network & Spending Intelligence (map app)

An interactive Singapore-map dashboard in the style of the tree-digital-twin frontend:
school markers on a MapLibre map, click a school to open a draggable detail window.

## Run it

```
cd smart-buddy-app
npm install     # first time only
npm run dev     # then open http://localhost:5188
```

Requires Node (tested on v24). Internet is needed for the basemap tiles (Carto Positron);
all data is bundled locally in `src/data/`.

## What's in it

- **Map** — 158 schools with markers (MOE-matched + OneMap-geocoded). Dot **size** = spend per
  student-day; dot **colour** switches between School Level / Error rate / Transaction speed
  (legend, bottom-left). The remaining 176 schools have no confident MOE match — click
  "unmapped" in the legend to browse and open them.
- **Search** (top bar) — by school ID or name; works for unmapped schools too.
- **School window** (click a marker) — spend/ticket/cards/error/speed stats, MOE badges
  (Independent · IP · GEP · SAP), and three tabs:
  - *Spending & Food* — weekly revenue, category mix vs the network
  - *Network* — per-terminal table (signal, errors, offline share)
  - *Speed* — weekly median vs network baseline
- **Network Overview window** (opens on load) — four tabs: Network Health, Speed Trends,
  Food Trends, School Spending (the "atas" comparison).
- Deep link: `http://localhost:5188/#school=TKGS` opens that school on load.

## Data

Precomputed from the Feb–Apr 2026 transaction CSVs (13.4M rows) — see
`SMART_Buddy_Findings_Report.pdf` (project root) for the findings and full method/caveats.
Exclusions: STYL vendor test terminals, "Retrieve…" maintenance flows, amounts >$200.
School names/types: MOE School Directory (data.gov.sg), acronym-matched (158/334, 4 hand-verified);
coordinates via OneMap postal-code geocoding. Food categories inferred from stall names +
price profiles (no item-level SKU data exists).

To regenerate `src/data/*.json`, rerun `build_app_data.py` (analysis pipeline; ask Gideon).
