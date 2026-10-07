# PIPELINE — SMART Buddy analysis pipeline (offline, Python/DuckDB)

> **This file documents the ORIGINAL offline analysis pipeline** (raw CSV → parquet → JSON bundles →
> HTML/PDF reports). The **deployed** dashboard no longer uses it: data is now **uploaded through the
> dashboard into ClickHouse** (two months, Feb + March), and each month's insight bundles are
> precomputed there by `ingestion-service/build_insights.py` + `build_insights_wearable.py` (which
> reuse the same `taxonomy.py` + the SQL logic ported from the scripts below). See **DEPLOY.md** for
> the live pipeline. The scripts here remain the reference for how each metric is computed + the
> historical local artifacts.
>
> **6 Oct 2026:** this pipeline's inputs/outputs (`txn/`, `analysis/parquet/`, `analysis/appdata/`) were moved to
> `need to delete manually/`, so nothing below is runnable any more, and the app no longer reads `client/src/data/`
> (§6's `client/` rows describe the pre-ClickHouse app). Live map flow: `MAP_DATA_FLOW.png`.

**Analysis scope (this file): February 2026.** March/April transactions and the May health drop were
removed from disk on 8 Jul 2026 (see the purge note at the end). Historical quarter/May steps are
noted where they used to run but can no longer be re-executed without re-downloading the source drops.

Engineer-facing reference for the **offline analysis pipeline**: how the raw Feb CSVs become the
JSON bundle, the app data, and the reports, and how every headline metric is computed.

- **Data dictionary, units & established data facts** → see [README.md](README.md) "Key data facts &
  caveats". This doc covers **where it runs**, **architecture / scripts / run order**, **output
  catalog**, and **metric logic / data-quality handling** only, to avoid duplicating that.
- This pipeline is **entirely separate** from the deployed ClickHouse stack (dashboard / Playback /
  SAM agent) — for that, see [DEPLOY.md](DEPLOY.md). The pipeline runs offline and produces the
  bundled JSON + parquets those services are later loaded from.

All scripts live in [analysis/](analysis/). Engine: **DuckDB** over **Parquet** (converted once from
the raw CSVs), plus **scikit-learn** KMeans for clustering. Timezone is pinned to `Asia/Singapore` in
every script.

---

## 1 · Where these tasks run (offline, on the analysis workstation)

**Ingestion → Cleaning → Transformation → Analysis Outputs all happen locally on the analyst's
machine, *before* deployment — one-off Python scripts, not a deployed service.**

| Aspect | Reality |
|--------|---------|
| **Machine** | The analyst's Windows PC. Run by hand from the terminal. |
| **Engine** | Python 3.12 + **DuckDB** (SQL over Parquet) + scikit-learn (clustering only). No pandas-based ETL. |
| **Server / DB / cloud** | **None.** This pipeline runs on no server, database, scheduler, or cloud. It is distinct from the deployed ClickHouse services in DEPLOY.md — those are loaded *from* this pipeline's parquet output, but nothing here runs in production. |
| **What the team sees** | The finished JSON is baked into the app at build time and served by nginx; the reports are self-contained HTML/PDF. There is no live pipeline behind the static dashboard. |
| **Refreshing data** | Means re-running these local scripts (and, for the deployed stack, re-running the ClickHouse `ch-ingest` one-shot over the refreshed parquets — see DEPLOY.md). |

---

## 2 · Architecture

```
 RAW CSVs (source of truth, Feb-2026 only, ~1.4 GB, gitignored — real IDs)
 ├─ txn/txn_*.csv .................. 5 files (part001–005), comma-sep, Feb 2026, 'NULL' strings
 │                                   ⚠ filename still says "…to_Apr…"; parts 006–016 removed
 └─ health data/*_202602_part*.csv  6+6 files, comma fully-quoted, Feb 2026, 'NULL' strings
        │                            (the May TAB-sep drop was removed — see the purge note)
        │  convert_parquet_feb.py + convert_txn_perf.py 2026-02
        ▼
 PARQUET (fast columnar working set, in analysis/parquet/)
 ├─ feb_txn.parquet ............... transactions (typed)          3,977,666 rows
 ├─ feb_health.parquet ........... activity intervals (steps/cal/distance + raw JSON extract)
 ├─ feb_heart_rate.parquet ....... hourly HR summaries (bpm_number + raw JSON: low/high/avg)
 └─ txn_perf_202602.parquet ...... per-txn speed components + signal/network (Feb)
   (txn.parquet / txn_perf.parquet also present, rebuilt Feb-only = same rows as the feb_* pair)
        │
        ├───────────────┬────────────────────┬───────────────────┐
        ▼               ▼                    ▼                   ▼
  analyze_feb.py   analyze_feb_service  analyze_purchases   build_feb_app_data.py
        │              .py                  .py              build_stalls_data.py
        ▼               │                    │                   │  (+ school_geo.json
  feb_insights.json     ▼                    ▼                   │     from geocode_retry.py)
        │        feb_service.json    purchase_insights.json      ▼
        │              │                    │            appdata/{feb,stalls}.json
        ▼              ▼                    ▼                    │
 SMART_Buddy_    SMART_Buddy_Feb2026_  SMART_Buddy_Purchase_    ▼
 Feb2026_        Service_Report        Insights.html      client/ (Vite + MapLibre)
 Insights.html   .{html,pdf}
```

**Stages**

1. **Convert** — `convert_parquet_feb.py` reads the raw Feb CSVs and writes typed, ZSTD-compressed
   Parquet; `convert_txn_perf.py 2026-02` builds the speed components. JSON fields are extracted from
   the `raw` column at this stage (HR `date/hour/lowest_bpm/highest_bpm/avg_bpm` incl.
   `firmware_version`; health `active_time`) so downstream SQL never re-parses JSON.
2. **Analyse** — independent DuckDB scripts each read Parquet and emit one JSON payload (aggregates
   only; no row-level PII beyond IDs that already exist in the data).
3. **Build app data** — `build_feb_app_data.py` + `build_stalls_data.py` produce the per-school /
   per-terminal / stall JSON for the map app, joining in `school_geo.json` (MOE identity +
   coordinates).
4. **Render** — JSON payloads are spliced into HTML templates (Chart.js embedded) to make the
   self-contained reports; `appdata/*.json` is bundled into the Vite app (`client/src/data/`).

---

## 3 · Source data specifications

### 3.1 Transactions
| Property | Value |
|----------|-------|
| **Files** | `txn/txn_Feb2026_to_Apr2026_part001-005.csv` (5 parts) |
| **Rows** | 3,977,666 (raw Feb); 3,959,550 after cleaning (~$7.57M SGD) |
| **Date range** | 2026-02-01 → 2026-02-28 |
| **Delimiter** | Comma · **NULL** = literal string `NULL` |
| **Columns** | 45 (see header of any part file) |

Key columns: `txn_date`, `txn_time`, `amount` (**cents SGD**, ÷100 for dollars),
`storeId`/`storeName`/`schoolId`, `terminalId`, `cardId`/`cardType`, `paymentType`, `errorCode`,
`paymentMode` (ONLINE/OFFLINE), plus timing fields (`checkSignal, openSocket, handshake,
sendToReceiveData, tapCardToFinish, startToFinish`, ms) and network fields (`posSignalStrength`,
`posNetworkType`, `readerSignalStrength`, …). `studentId`/`studentName` are 100% NULL (PII stripped)
— **no per-student linkage exists.**

### 3.2 Health — activity (February drop)
| Property | Value |
|----------|-------|
| **Files** | `health data/health_data_202602_part1-6.csv` |
| **Rows / users** | 2,948,308 / 13,613 |
| **Delimiter** | Comma, fully quoted (the May drop was TAB — May is now removed) |
| **Columns (15)** | `id, calories, distances, steps, recorded_time, uploaded_time, data_type, user_id, raw, sync_id, wearable_name, calculate_time, tz, migrate_id, health_profile_id` |

Units: `calories` = **millical** (÷1000 → kcal); `distances` = **cm** (÷100000 → km); rows are
**30-min incremental intervals** → daily totals are **sums**.

### 3.3 Health — heart rate (February drop)
| Property | Value |
|----------|-------|
| **Files** | `health data/heart_rate_202602_part1-6.csv` |
| **Rows** | 2,393,845 (includes pre-Feb backfill) |
| **Columns (10)** | `id, user_id, bpm_number, recorded_time, uploaded_time, raw, sync_id, wearable_name, calculate_time, tz` |

`bpm_number` equals the device's `avg_bpm` (hourly summary). **`bpm_number = 255` is a firmware error
sentinel** (firmware `1.1.9.0.0` — recommend retiring that firmware), excluded from every average. The
table is **keyed by sync time**, so ~40% of rows are historical backfill — filter the payload date
(`hr_date`) to February for real curves.

---

## 4 · Scripts

**Active (Feb-only) scripts — these run against the data on disk today:**

| Script | Reads | Writes | Purpose |
|---|---|---|---|
| `convert_parquet_feb.py` | `health data/*_202602_part*.csv` + raw Feb `txn/` | `parquet/feb_{health,heart_rate,txn}.parquet` | Feb drop (comma fully-quoted CSVs); txn filtered to Feb; extracts JSON incl. `firmware_version` |
| `convert_txn_perf.py 2026-02` | raw Feb `txn/` CSVs | `parquet/txn_perf_202602.parquet` | per-txn speed components + signal/network (Feb) |
| `analyze_feb.py` | feb_health, feb_heart_rate, feb_txn | `feb_insights.json` | day-aligned Feb health×txn insights (the overlap month) |
| `analyze_feb_service.py` | feb_txn, txn_perf_202602, `school_geo.json` | `feb_service.json` | Feb service-report data: network health + fault verdicts, speed, food, spending-per-school, CNY windows |
| `analyze_purchases.py` | feb_txn (now Feb-only) | `purchase_insights.json` | food taxonomy, price points, school/time/habit differentiators |
| `build_feb_app_data.py` | feb parquets + `school_geo.json` | `appdata/feb.json` | precomputed filter slices for the app's February Insights window |
| `build_stalls_data.py` | feb_txn, txn_perf_202602, `school_geo.json` | `appdata/stalls.json` | per-stall + per-machine data (incl. machine-vs-site verdicts) |
| `splice_feb_service.py` | `feb_service.json` + `chart.umd.min.js` + `feb_service_report.html` | `../SMART_Buddy_Feb2026_Service_Report.html` | splices the self-contained report; then print to PDF |
| `splice_purchase_insights.py` | `purchase_insights.json` + template | `../SMART_Buddy_Purchase_Insights.html` | splices the self-contained report |
| `geocode_retry.py` | `moe_schools.json` | `school_geo.json` | OneMap postal→lat/lng with backoff (rate-limited); reuse `school_geo.json`, don't regenerate |

**Historical scripts — kept on disk but NOT runnable** (their source data was removed in the Feb-only
purge): `convert_parquet.py` (needed the May health drop + Feb–Apr txn), `analyze.py` →
`insights.json`, `analyze_anomalies.py` → `anomaly_patterns.json` (needed `hr_fw.parquet` from the May
HR file), `build_app_data.py` (Feb-app + `--quarter` PDF dataset). The reports they produced still
exist as shipped files; only regeneration is blocked.

`taxonomy.py` is the **shared classification module** imported by every analyze/build script — edit
the rules **only there**, never copy them into a script.

---

## 5 · Run order / regeneration

```bash
pip install duckdb scikit-learn pillow          # pandas already present
cd analysis
python convert_parquet_feb.py                    # ~12 s; → parquet/feb_*.parquet
python convert_txn_perf.py 2026-02               # ~5 s;  → parquet/txn_perf_202602.parquet
python build_feb_app_data.py                     # → appdata/feb.json
python build_stalls_data.py                      # → appdata/stalls.json
python analyze_feb.py                            # → feb_insights.json (static Feb report data)
python analyze_feb_service.py                    # → feb_service.json (Feb service-report data)
python analyze_purchases.py                      # → purchase_insights.json (verified-name categories)
python splice_feb_service.py                     # → ../SMART_Buddy_Feb2026_Service_Report.html
python splice_purchase_insights.py               # → ../SMART_Buddy_Purchase_Insights.html
cp appdata/*.json ../client/src/data/            # refresh the app bundle (Feb scope)
# Feb Insights HTML: splice chart.umd.min.js + feb_insights.json into feb_report_template.html.
#   chart.umd.min.js source: client/node_modules/chart.js/dist/ (the splice_*.py scripts read it there)
# PDFs: chrome --headless=new --no-pdf-header-footer --print-to-pdf=<ABS path> --virtual-time-budget=15000 file:///...
#   NB --print-to-pdf needs an ABSOLUTE output path (relative paths fail silently, old file untouched)
```

**⧗ Dead after the Feb-only purge (source data removed — do NOT run):** `convert_parquet.py`,
`analyze.py` → `insights.json` (Dashboard), `analyze_anomalies.py` → `anomaly_patterns.json` (needed
May `hr_fw.parquet`), `build_app_data.py --quarter` + `splice_pdf_report.py` (the Feb–Apr Findings
PDF — `appdata_quarter/` is gone). Their shipped reports remain as frozen files in the project root.

Parquet files are session-temporary and must be regenerated from the raw CSVs (steps above). Headless
Chrome renders the PDFs (charts flatten to images).

---

## 6 · Output catalog

**Current Feb-only deliverables — regenerable from the data on disk:**

| Deliverable | Emitting script → data | Notes |
|---|---|---|
| `SMART_Buddy_Feb2026_Service_Report.{html,pdf}` | `analyze_feb_service.py` → `feb_service.json` → `feb_service_report.html` (splice) | Feb service-team report: network health w/ machine-vs-location verdicts, speed, food items, spending-per-school, food-type trends, CNY impact |
| `SMART_Buddy_Feb2026_Insights.html` | `analyze_feb.py` → `feb_insights.json` → `feb_report_template.html` | static Feb report (health×txn overlap month) |
| `SMART_Buddy_Purchase_Insights.{html,pdf}` | `analyze_purchases.py` → `purchase_insights.json` → `purchase_insights_template.html` (`splice_purchase_insights.py`) | what students buy — verified-name categories only; Feb-only now that txn is Feb-only |
| `client/` (interactive map app) | `build_feb_app_data.py` + `build_stalls_data.py` → `appdata/{feb,stalls}.json` (bundled to `src/data/`) | interactive map app (Feb scope) |
| map app "February Insights" window | `build_feb_app_data.py` → `appdata/feb.json` → `src/data/feb.json` | clickable filters (day-type × segment, firmware × day-type, level × category) + CNY story; deep link `#feb` or `#feb=hr` |
| map app "Terminal Health" window | `build_stalls_data.py` → `appdata/stalls.json` → `src/data/stalls.json` | fleet diagnostics (machine-vs-site verdicts vs school peers); role hub `#role=fnb\|eng\|mgmt`, deep links `#stall=`, `#terminal=` (Stall Explorer shelved from nav — no SKU data) |

Feb deliverables build from templates in `analysis/` (`feb_report_template.html`,
`feb_service_report.html`, `purchase_insights_template.html`) — edit the **template** + its
`splice_*.py`, never the shipped HTML. PDFs are headless-Chrome prints of the HTML.

**Shipped but NO LONGER regenerable** (frozen files remain; source data removed in the purge —
regeneration would need re-downloading the Feb–Apr txn / May health drops):

| Frozen deliverable | Was built from | Why frozen |
|---|---|---|
| `SMART_Buddy_Dashboard.html` | `analyze.py` → `insights.json` | main insights + 26-type quality report — needed May health + Feb–Apr txn |
| `SMART_Buddy_Anomaly_Patterns.html` (+ `Health_` subset / `.pdf`) | `analyze_anomalies.py` → `anomaly_patterns.json` | needed `hr_fw.parquet` from the May HR file |
| `SMART_Buddy_Findings_Report.pdf` | `build_app_data.py --quarter` → `appdata_quarter/*.json` → `pdf_report.html` | whole Feb–Apr quarter network/speed/food/atas print report |

The Dashboard and Anomaly HTML files were their own source of truth (no template); since they can't be
regenerated, treat them as read-only historical artifacts.

---

## 7 · Metric logic

### 7.1 Transaction base view & exclusions
Every behavioural/spend metric is computed on a filtered view that removes non-student traffic:

```sql
WHERE schoolId != 'STYL'                 -- vendor bench-test terminals
  AND storeName NOT ILIKE '%retrieve%'   -- 'Retrieve…' = stall relabelled when its machine was pulled (real sales; kept in the terminal view)
  AND amount <= 20000                     -- cents → drop > $200 outliers
```
`amount` is **cents SGD**; divide by 100 for dollars. Error rate = share of rows with
`errorCode IS NOT NULL AND errorCode != '0'`. Offline share = `paymentMode = 'OFFLINE'`.

### 7.2 Transaction speed
From `txn_perf_202602.parquet`, always guarded by `startToFinish > 0` (0/NULL = no timing captured):
- **Median / p95** of `startToFinish` (ms) overall, by `posNetworkType`, by signal bucket, per school,
  per terminal.
- **Weekly by payment stack** — restricted to full Feb weeks `txn_date BETWEEN '2026-02-02' AND
  '2026-02-28'` (drops the single-day `2026-01-26` week bucket; see §8).
- **Components** (`checkSignal, openSocket, handshake, sendToReceiveData, tapCardToFinish`) — median,
  ONLINE only (Feb).

The **3.0 ASCAN reader stack is ~2× slower** than 2.0 (~4.3 s vs ~2.1 s median), every week.

### 7.3 Food categories (no SKU data) — VERIFIED-NAME ONLY (v2)
**Policy (supervisor-mandated 7 Jul 2026; tightened to v2 after auditing name-vs-behavior agreement —
applied to every deliverable):** the classification lives in ONE place, **`analysis/taxonomy.py`**
(`STALLCAT_SQL`, a per-stall view all five scripts import — never copy the rules into a script). Rules:
1. A stall gets a food category **only if its registered name says what it sells** — food-word regex
   groups on `storeName` → Drinks / Snacks & Desserts / Cooked Food (+ Bookshop & Supplies from real
   book/stationery/uniform words).
2. **Corporate suffixes are not evidence**: `pte ltd / enterprise / trading / marketing` no longer
   imply Bookshop. Bare company names (BL Marketing ×19, Overseas Associates ×17, …44 stalls) are
   Unclassified until STYL confirms the vendor list.
3. Names hitting **2+ food-word groups** ("Hot Drinks and Snacks", "Fruits and Drinks") = **Mixed**
   (23 stalls). All former Fruits stalls are combos, so **pure Fruits no longer exists**.
4. **Behavior veto** (n≥100): a single food category is dropped to Unclassified when the stall's modal
   price strongly contradicts it — Drinks >$2.00, Snacks >$3.50, Fruits >$3.00, Cooked <$1.00 or
   >$8.00. Calibrated to fire on contradiction ("Hot Stall 5" modal $0.60 = a drinks counter), not on
   premium pricing ($5 café at an independent school stays Cooked Food). Price can veto a name; it
   never assigns one. 9 stalls vetoed in Feb.

Validation: name-vs-modal-price agreement 93–97% per food category. Coverage (Feb): 493 stalls / 17.5%
of txns / 18.5% of revenue (Mixed 23, vetoed 9). Everything else is **`Unclassified`** — price
bands/statistics only, never a food type. (The 7 Jul v1 was name-keywords with a one-line
Generic→Unclassified CASE; the original KMeans price-archetype tier was removed a step earlier.)

Consequences to respect downstream:
- Category shares must use **verified-only denominators** (exclude Unclassified) and be labelled
  "within name-verified volume"; the verified sample **skews toward stall types that register real
  names** (bookshops especially) — it is not a random sample of the network.
- **Low-sample guard**: weekly/day-type category charts blank out slices with too little verified
  volume (e.g. Feb weekends n=183). Without the guard, single stalls dominate and averages become
  artifacts (a 2-txn $41 cafe can make a day-type "cooked food avg" look like $22).
- Two old findings did NOT survive the switch (they were artifacts of price-inferred categories): "JC
  canteens are priced lower" (verified says the opposite) and "afternoon is snack o'clock" (only 15
  named snack stalls exist).

### 7.4 School level & "atas" (MOE type)
- **Level** inferred from the ID suffix (`%JC`→Junior College, `%PS`/`%P`→Primary,
  `%SS`/`%GS`/`%HS`→Secondary, else Other/Tertiary). In `build_app_data.py`, `eff_level()` lets a
  **clean MOE `mainlevel`** (from `school_geo.json`) override the suffix guess.
- **Atas** (`build_app_data.py` `OUT["atas"]`) is computed **only over MOE-matched schools** (those
  with a `moe_type`): mean `spend_day` and `avg_ticket` grouped by `type_code` (Independent /
  Government-Aided / Government), by level×type, by IP (sec/JC), and by GEP (primary). `coverage`
  records matched vs total so the sample size is never hidden.
- **spend_day** = per card, `total_amount / distinct_active_days`, averaged across cards. This is spend
  per *active* student-day, not per calendar day.

### 7.5 Card & user clusters
*(Method reference. The card/user clusters below ran in the now-frozen `analyze.py`; `analyze_feb.py`
applies the same profile-labelled KMeans to Feb wearer segments — School-day actives / Everyday /
Occasional / Barely used.)*
- **Cards** (spending segments): KMeans(k=4) on `[log(n_txns), log1p(avg_sgd), morning_ratio,
  log1p(active_days)]` for cards with ≥ 3 txns (single-touch cards excluded). Persona names ("Morning
  Snackers" etc.) assigned by cluster *profile* (e.g. highest before-10am ratio), not index.
- **Users** (fitness segments): KMeans on `[log1p(avg_steps), resting_hr, avg_hr]` for users with both
  step and HR data (~6,561). Same profile-based labelling.

### 7.6 Activity (health) metrics
Feb activity comes from `feb_health.parquet` (`analyze_feb.py`); the cleaning gate is:
```sql
WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000
  AND recorded_time IN February 2026   -- Feb drop only
```
Units: `calories` is **millical** → `/1000` = kcal; `distances` is **cm** → `/100000` = km; health
rows are **30-min incremental intervals** so daily totals are **sums** (`hdaily`). Daily step curves
additionally cap `steps <= 80000` per user-day to drop implausible days.

### 7.7 Heart-rate averages  ← (the supplier-Q&A metric)
Each HR row is an **hourly summary the wearable itself produced**; the table's `bpm_number` column
**equals** the device's `avg_bpm` in the raw JSON (verified). The reported average HR is the mean of
`bpm_number` over the cleaned set. For Feb (`analyze_feb.py`, `feb_heart_rate`) the gate is:
```sql
WHERE bpm_number BETWEEN 30 AND 220                       -- valid physiological range
  AND TRY_CAST(hr_date AS DATE) IN February 2026          -- real Feb dates only (drops ~40% backfill)
```
Consequences:
- **255 is excluded** (255 > 220). `bpm_number = 255` rows are whole-record sensor errors
  (`lowest = highest = avg = 255`); they never enter any average.
- **Resting HR** uses a different field: per user-day `min(lowest_bpm)` (range 30–150), averaged.
- Per-day / per-hour / per-weekday HR curves use the same gate; the 23:00 spike is a sparse-sampling
  artifact (reproduces in Feb: 90.3 bpm).
- The 255 value is used **only** as an error *count* (rate per 10k, to attribute the fault to firmware
  1.1.9.0.0), never as a heart rate.

*Historical (May, now frozen — computed by `analyze.py`/`analyze_anomalies.py` before the purge):* the
May window `hr_date BETWEEN '2026-05-01' AND '2026-05-31'` gave 1,050,510 readings from 8,273 users,
mean **81.8 bpm**. Feb replicates the same firmware signature.

### 7.8 Correlations
Pearson `r` on per-user aggregates over users present in both step and HR data. **Feb
(`analyze_feb.py`): steps↔HR r = −0.297 (n=6,991).** *(Historical May, frozen `analyze.py`: steps↔
resting HR r = −0.36, steps↔avg HR r = −0.24 — the negative fitness signal replicates across both
months.)*

---

## 8 · Data-quality handling & reproducibility gotchas

**Validity gates (applied before aggregation)**

| Domain | Gate | Why |
|---|---|---|
| Transactions | exclude `STYL`, `%retrieve%`, `amount > 20000c` | vendor test rigs, stalls whose machine was later pulled (real sales — see README fact 5), $200+ outliers |
| Txn speed | `startToFinish > 0` | 0/NULL = timing not captured |
| Weekly series | `txn_date BETWEEN 2026-02-02 AND 2026-02-28` | Feb starts Sun 1 Feb → the `date_trunc('week')` bucket `2026-01-26` holds a single day; this drops it |
| Activity | `data_type IN (0,1)`, `calories ≤ 500000`, `steps ≤ 4000/interval`, Feb dates | drops sentinel/corrupt packets and non-Feb stragglers |
| Heart rate | `bpm_number BETWEEN 30 AND 220`, `hr_date` in Feb | drops 255 sentinel + <30 lows + ~40% pre-Feb backfill |

**Known issues & recommendations**

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| HR = 255 sentinel | Firmware `1.1.9.0.0` produces 100% of them | Exclude from averages; **retire the firmware** |
| HR file keyed by sync time | ~40% pre-Feb backfill | Filter `hr_date` to February |
| No item/SKU data | Food categories can't be derived for most stalls | Verified-name-only (taxonomy v2); rest Unclassified |
| STYL test terminals / 'Retrieve…' stalls / >$200 | Out of spend (retrieved stalls stay in the terminal view) | Excluded by the base gate |
| 3.0 ASCAN reader stack | ~2× slower than 2.0 every week | Investigate the 3.0 stack |
| No per-student linkage | `studentId` 100% NULL; cardId ≠ health user_id | Only day-aligned *aggregate* comparison is valid |

**Anomaly root-causes the pipeline accounts for** (Feb data; the same signatures were detailed in the
now-frozen anomaly report from the May drop): firmware `1.1.9.0.0` → 100% of 255-bpm + 88% of
<40-bpm (Feb: 373 err-255 + 176 sub-40, all from 1.1.9.0.0 → fault predates May); `UNKNOWN`
paymentType ≈ error path (type never written when a txn fails early); night 1¢ txns = `STYL` test
terminals; `$9,999.90` = maintenance flows; negative `posSignalStrength` = WiFi **RSSI in dBm** (unit
mix vs the 0–31 cellular scale); 18 gen-0 wearables emit power-of-two sentinel calories/distances; HR
file is **keyed by sync time** (40.3% backfill in Feb, dedup by latest `sync_id`).

**Reproducibility gotchas**

1. **`txn_perf` has a proper script** — `python convert_txn_perf.py 2026-02` →
   `txn_perf_202602.parquet`. The old ad-hoc `hr_fw.parquet` is moot — the May HR file was removed in
   the purge; `convert_parquet_feb.py` already extracts `firmware_version` for the Feb HR drop.
2. **Feb health CSVs are comma-separated, fully quoted** (6 part files each; the removed May drop was
   TAB-separated); txn CSVs comma — always pass `nullstr='NULL'`.
3. DuckDB `read_csv` on txn needs explicit `types=` for `errorCode`/`cardId`/`amount`/… (16-file
   sampling otherwise mistypes columns).
4. **KMeans cluster indices are unstable across refits** — always assign persona labels by cluster
   *profile*, never by the raw index.
5. `pandas.to_json` emits epoch-ms for date columns — cast dates to `VARCHAR` in SQL before export.
6. **OneMap geocoding rate-limits hard** (≥1.4 s/call). `school_geo.json` now holds **332** (every school ID)
   (rebuilt 15 Jul from the receipt-verified `schoolId→school` mapping: +173 new markers by postal/name,
   and **7 base-geo errors corrected** — the acronyms mislead, e.g. RLPS=Rivervale not Rulang, CHS=Chongfu
   not Catholic High; verified against the raw feed at 99.68% linkage). Reuse it, don't regenerate casually.
   APSN Katong was added 1 Oct 2026 (OneMap postal 467354, listed as "KATONG SCHOOL"). The 2 remaining feed IDs,
   PBS and SSSTM, are vendors, not schools — placed per stall via `pbs_hosts.csv` / `stamp_hosts.csv`.
7. Parquet files are session-temporary and must be regenerated from the raw CSVs (§5).

---

**Feb-only purge (8 Jul 2026):** March/April `txn` parts 006–016, the May health drop
(`*_May2026.csv`), the May `health.parquet`/`heart_rate.parquet`, and `analysis/appdata_quarter/` were
deleted from disk. Consequence: the Dashboard, anomaly/health reports, and the quarter Findings PDF
can no longer be regenerated (shipped files unaffected). Everything Feb-scoped — the app and the Feb
reports — is fully rebuildable from the data on disk.

*Companion docs: [README.md](README.md) (deliverables + data facts) · [DEPLOY.md](DEPLOY.md) (the
deployed ClickHouse stack — dashboard / Playback / SAM agent). Feb-only scope.*
