# UAT deploy — vendor layers (PBS Bookstores + Stamp points), dashboard filter fix, daily-chart fix, APSN Katong

Session 1 Oct 2026. **No raw data reload.** Only images, the `schools` table and the insight bundles change.
Everything was verified locally first (raw Feb + Mar CSVs, then the ingest rules, then the real `build_insights.run`, see
"Local verification" below). Committed 6 Oct; **not yet on UAT**.
**Deploy together with `SERVICE_ROUTE_DEPLOY.md`** (later the same day: terminal service view, `terminal_health`,
`plan_service_route`). Same images and the same bundle rebuild, so run these steps once and then add its verify checks.

## What changes

| Change | Files | Needs |
|---|---|---|
| **Dashboard still showed PBS/SSSTM as "schools".** `79a3a82` fixed only `ingest_core.TX_FILTER`, but `build_insights.py` (which builds the bundles the dashboard draws) had its own `schoolId != 'STYL'` copies. School-level aggregates now exclude `NON_SCHOOL` (shared constant in `ingest_core.py`). Vendor stalls stay as stalls. | `ingestion-service/ingest_core.py`, `ingestion-service/build_insights.py` | rebuild ingest image + both months' bundles |
| **Every stall's "Daily revenue" chart and every terminal's daily error/speed series were empty.** `query_df` returns a ClickHouse `Date` as datetime64, so `d::VARCHAR` = `'2026-03-02 00:00:00'`, which never matched the `'2026-03-02'` day keys. Now `strftime(d, '%Y-%m-%d')`. | `build_insights.py` | same |
| **Stalls bundle crashed with current library versions.** `requirements.txt` only sets minimums (`duckdb>=1.1`, `pandas>=2.0`). With duckdb 1.5.4 + pandas 3.0.3, `list(DISTINCT terminalId)` over a pandas category column returned int16 codes, so `json.dumps` failed. Fixed with `CAST(terminalId AS VARCHAR)`. **An image rebuild pulls current versions, so this fix must ship with it.** | `build_insights.py` | same |
| **PBS shop → school** and **Stamp point → school** placement, each from a reviewed decision with evidence. (PBS directory emails were read from a staging mirror, `pacificbookshop.testing.uno`; every placement also has independent evidence.) | `ingestion-service/pbs_hosts.csv`, `ingestion-service/stamp_hosts.csv`, `build_insights.py` | same |
| **Stamp purchases** (POSB Smiley Stamps, from the feed's own `stampValue`) in the March `savings` bundle. Receipt mix gains `stamp_sh`. | `build_insights.py` | same |
| **APSN Katong (APSNK) mapped.** Address from apsn.org.sg (900 New Upper Changi Rd, S467354). Coordinates from OneMap postal search, which lists it as "KATONG SCHOOL" (why the earlier name search failed). | `ingestion-service/school_geo.json`, `analysis/school_geo.json`, `reload/schools.csv` (331 → 332 rows) | reload `schools` table |
| **Map filter pills** (Super App POC pattern): All · Primary · Secondary · Junior College · Other · PBS Bookstores · Stamp points. Multi-select, never zero, kept in the URL hash (`#layers=…`). Bookstores window (needs-decision list first). School panel "Bookshop here" / "Unconfirmed" notes. Stall/terminal "Open school" links go to the host school for vendor stalls. | `client/index.html`, `client/src/*.js`, `client/src/theme.css` | rebuild frontend |
| **Copy pass:** captions are one line + an ⓘ tip (native `title` + `aria-label`, keyboard-focusable). **Removed hard-coded February conclusions that were shown for every month** ("Errors hold a flat 6–9%", "Stable ~2.3s median", "3.0 ASCAN ~2× slower", "9–11am carries about half", "CNY dip", "Days worn in February", "Firmware fleet — February", "45 WiFi terminals"). Figures in captions are now computed from the bundle. | `client/src/*.js` | rebuild frontend |
| **SAM text corrected:** SSSTM is 13 (Mar) / 17 (Feb) Self Serve Stamps points, not "~156+ schools"; schools 331 → 332 (320 MOE + 12 SPED); wallet reconcile ~92% incl. vendor stalls / ~88% on `tx`. | `mcp-service/src/schema.js`, `mcp-service/agent-prompt.md` | rebuild `smartbuddy-mcp` + re-paste instructions |

## Steps (UAT VM, repo root)

```bash
# 0) prerequisite from the 23 Jul PBS fix: make sure the ClickHouse `tx` view / pb_* tables exclude vendors.
#    If this returns rows, run step 3 "Option A" of reload/PBS_SCHOOLID_FIX_DEPLOY.md first.
#    SELECT DISTINCT school_id FROM smartbuddy.pb_schools WHERE school_id IN ('PBS','SSSTM');

# 1) code
git pull

# 2) rebuild + restart the changed images (the ingestion image carries build_insights.py, school_geo.json,
#    pbs_hosts.csv, stamp_hosts.csv)
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  build smartbuddy-frontend ch-insights smartbuddy-ingest smartbuddy-mcp
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  up -d smartbuddy-frontend smartbuddy-ingest smartbuddy-mcp

# 3) reload the schools dimension (331 → 332 rows: + APSNK)
bash scripts/vm-load.sh reload/schools.csv schools 2026-02 replace 1

# 4) rebuild the base bundles for BOTH months (global / schools / stalls, + items / savings for March).
#    The wearable bundles are unchanged, so no build_insights_wearable.py run is needed.
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
SB_MONTH=2026-02 $CC
SB_MONTH=2026-03 $CC     # log must print: linkage: 3,700,936/3,712,897 baskets matched (99.7%) — if 0/…, stop

# 5) SAM: re-paste the ```text block from mcp-service/agent-prompt.md § "Copy For AI Agent" (see agent-setup.md §4)
```

## Verify (expected values from the local run on the same raw files)

1. **Legend:** "332 schools mapped · 0 unmapped" (March), "331 … · 0 unmapped" (February). PBS/SSSTM/APSNK no longer listed as unmapped.
2. **Filter pills (March):** Primary 173 · Secondary 139 · Junior College 5 · Other 15 · **PBS Bookstores 152** · **Stamp points 13**. February: Other 14 · Stamp points **17**.
3. **Bookstores window** ("Lists: PBS bookstores"): March 157 shops, **152 placed**, "Needs a decision (5)": MGS, SCGS (primary/secondary conflict), RPS, CHKL (not identified), FHPS (not confirmed). February: 156 shops, 152 placed, 4 to decide (no FHPS).
4. **Daily revenue chart** on any stall (e.g. search "Pacific Bookstores - MGS") shows bars. Before: empty, with a y-axis of repeated "$1".
5. **MGSP panel unchanged:** March $3.54 spend/card-day · $1.93 ticket · 46,768 txns · 1,502 cards · 8.2% errors · 2.5s median. February top school by spend = MGSP $101,474.
6. **Saving view (March) → Smiley Stamps:** Pacific Bookstores 67 points / 623 txns / $1,160.50 · Self Serve Stamps 13 / 348 / $598.00 · Other school stores 20 / 264 / $446.00.
7. **SAM:** "how many schools have map coordinates?" → 332.

## Rollback

`git checkout <previous commit> -- ingestion-service client reload/schools.csv analysis/school_geo.json mcp-service`, then rebuild the same
images and rerun steps 3–4. The bundles are ReplacingMergeTree (newest row wins), so a rebuild fully restores them.

## Local verification (how the numbers above were produced)

No Docker or WSL on the dev laptop and no local ClickHouse, so a DuckDB stand-in was used:
- Raw `Feb-Mar_Data/*.csv` were loaded into tables named like ClickHouse, using `ingest_core`'s own reader settings,
  `ch_type`, `_hash_sql` and `DROP_COLS`.
- The **unmodified** `build_insights.run` and `build_insights_wearable.run` were run through a small client adapter
  (DuckDB macros for `countIf` / `multiIf` / `toFloat64OrNull`, …).
- A tiny local API mirrored `api-service` routes; the dashboard ran at localhost:5188.

Fidelity check: the March linkage printed **3,700,936 / 3,712,897 (99.7%)**, the same as live UAT on 15 Jul, and MGSP
matched the UAT screenshot exactly. The scripts lived in the session scratchpad, not the repo.

## Known, not changed (open)

- **Wallet ↔ savings cross-check now reads 88.4% (was ~92%).** `build_savings` reconciles against ClickHouse `tx`, which
  (since `79a3a82`) excludes PBS/SSSTM. But the savings ledger's `total_spending` counts all wallet spending, including
  bookshop and stamp purchases. March, verified locally: wallet rail **$1,716,119 incl. vendors = 92.4%** vs
  **$1,642,786 on `tx` = 88.4%** of ledger $1,857,347. Fix (not applied, needs a decision): reconcile on `txn` with only the
  STYL / retrieve / >$200 filter.
- `requirements.txt` is unpinned (`>=`). Consider pinning duckdb/pandas to the versions the image is verified with.
