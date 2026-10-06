# UAT deploy — terminal service view + service route (dashboard + SAM)

Session 1 Oct 2026. **No raw data reload.** Same images as `VENDOR_LAYERS_DEPLOY.md`, so do both in one pass
(this builds on that working tree). Verified locally on the raw Feb + Mar CSVs with the real `build_insights.run`
and the real `mcp-service` server (see "Local verification"). **Committed 6 Oct; not yet on UAT.**

## What changes

| Change | Files | Needs |
|---|---|---|
| **A terminal is shown where it LAST transacted that month** (`arg_max` by date+time). It used to be `any_value`, which is arbitrary for machines moved/swapped mid-month (e.g. `ISP-20260114-0001-M`: 5 txns at ASPS, then 5,467 at ASPA). Same fix in the Overview's worst-terminals list. | `ingestion-service/build_insights.py` | rebuild ingest image + both months' bundles |
| **"Retrieve…" stalls are real sales, not maintenance flows** — the store is relabelled when its machine is pulled ("Retrieved 0526 Stall 1" = May 2026; "Pending WO TID" = work order). Their machines are now **in** the Terminals view, tagged `retrieved` (Mar +14, Feb +17). Spend/stall figures unchanged (still excluded there). README fact 5 + PIPELINE corrected. | `build_insights.py`, `README.md`, `PIPELINE.md` | same |
| **Problem tags per machine:** `machine` · `site` · `check` (the unchanged verdict rule) + `slow` (median ≥ 4s) + `stopped` (no txns on ≥ 3 days its school still traded) + `offline` (≥ 50% offline taps) + `retrieved`. **`stopped` / `offline` thresholds are PLACEHOLDERS** for the service team (`STOPPED_DAYS`, `OFFLINE_PCT` at the top of `build_insights.py`). Each machine also carries first/last day, sites, and the school's name/postal/zone/coords. | `build_insights.py` | same |
| **New table `smartbuddy.terminal_health`** (one row per month × machine) — the same rows the dashboard shows, written by `build_insights` (`CREATE TABLE IF NOT EXISTS` + `DROP PARTITION` + insert). SAM reads it, so SAM and the dashboard always agree. Existing grants cover it (rw: CREATE TABLE/ALTER/INSERT; ro: SELECT on `smartbuddy.*`). | `build_insights.py` | same |
| **Dashboard Terminals window:** Problem filter (Needs attention · Machine fault · Site issue · Slow · Stopped · High offline · Retrieved · Healthy · All), problem chips, tick boxes + "Select all matching" → **Plan route** → **Service route** window: one stop per school, nearest-next from the **STYL Service Center (3015A Ubi Road 1, #06-02, S408705)**, postal, leg km, full machine serials. PBS/SSSTM machines are listed as "Not routed" (no confirmed service location). Terminal detail shows last transaction / days silent / moved. Feed text is HTML-escaped in these views. | `client/src/eng-window.js` | rebuild frontend |
| **SAM:** `terminal_health` in the data dictionary + service rule; new read-only tool **`plan_service_route`** (month + terminalIds and/or schoolIds → ordered stops). Values are bound as ClickHouse query params, never interpolated. Old bundles without tags still render (falls back to the verdict). | `mcp-service/src/{index,db,config,schema}.js`, `agent-prompt.md`, `agent-setup.md`, `README.md` | rebuild `smartbuddy-mcp` + re-paste instructions |

## Steps (UAT VM, repo root) — after / together with VENDOR_LAYERS_DEPLOY.md

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  build smartbuddy-frontend ch-insights smartbuddy-ingest smartbuddy-mcp
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  up -d smartbuddy-frontend smartbuddy-ingest smartbuddy-mcp

# rebuild BOTH months' bundles — this also creates/fills smartbuddy.terminal_health
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
SB_MONTH=2026-02 $CC     # log: "-> terminal_health[2026-02]  2621 machines"
SB_MONTH=2026-03 $CC     # log: "-> terminal_health[2026-03]  2633 machines" + linkage 99.7%
# GATE: if the log says "(terminal_health skipped: …)", stop — the bundles are fine but SAM has no table.

# SAM: re-paste the ```text block from mcp-service/agent-prompt.md § "Copy For AI Agent"
```

## Verify (expected values from the local run on the same raw files)

1. `SELECT month, count(), countIf(notEmpty(problems)) FROM smartbuddy.terminal_health GROUP BY month ORDER BY month`
   → `2026-02 2621 733`, `2026-03 2633 691`.
2. **Terminals window (March):** 2,633 machines · 159 machine faults · 206 site issues · "Needs attention" = 691.
   Tag counts: offline 371 · stopped 65 · retrieved 14 · slow 10 · check 10.
3. **Route:** filter Machine fault, tick the TKGS, RSYS, SCGSP and FHPS machines → Plan route → stops in order
   **TKGS (2.3 km) → RSYS → SCGSP → FHPS**, ~28 km straight-line. Add a "Pacific Bookstores - …" machine → listed under "Not routed".
4. **SAM:** "which terminals have machine faults in March and where are they?" → uses `terminal_health`; then
   "plan a route to TKGS, RSYS, SCGSP and FHPS" → calls `plan_service_route`, same order as (3).
5. **No regressions:** stall list, spend, linkage unchanged (local diff: 0 verdict changes; stall differences were only
   list-order / tied-price order / the known <1% linkage wobble).

## Rollback

`git checkout <previous commit> -- ingestion-service client mcp-service`, rebuild the same images, rerun both months'
bundles, and `DROP TABLE IF EXISTS smartbuddy.terminal_health` (as an admin/rw user).

## Local verification

- Bundles: the real `build_insights.run` via the DuckDB stand-in from VENDOR_LAYERS_DEPLOY.md (+ a DDL shim for the
  new table). Before/after diff of both months' stalls bundles as above.
- SAM tool: the real `mcp-service` server driven over MCP, against a fake ClickHouse HTTP endpoint answering from the
  same table. Checked: ordering, school grouping, vendor machine → `not_routable`, unknown and injection-shaped ids →
  `not_found`, empty input / bad month rejected.
- Dashboard: headless Chrome screenshots of the Terminals and Service route windows, no JS errors.

## Known, open

- **Who services PBS / SSSTM machines?** Same STYL `ISP-` hardware (PBS: 57 of 158 over the fault rule in March), but
  routing them needs that answer + loading the reviewed host placements. Until then: listed, not routed.
- **Service team to set:** `STOPPED_DAYS` (3) and `OFFLINE_PCT` (50). Also worth asking: the existing `slow` rule has no
  minimum volume, so a machine with 5 txns can rank top by error rate.
- **Straight-line distances, greedy nearest-next order.** Real driving routes = OneMap routing API (token + the same
  licensing check as the basemap).
- **Real-time:** `terminal_health` refreshes whenever `build_insights` runs (per upload today). A live feed would need it
  run on a schedule, or the logic moved into a ClickHouse view.
