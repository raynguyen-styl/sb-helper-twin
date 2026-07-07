# PIPELINE — SMART Buddy Dashboard data pipeline

Engineer-facing reference for the analysis pipeline: how raw CSVs become the
dashboards, reports, PDF, and map app, and how every headline metric is computed.

- **Run instructions & environment** → see [HANDOVER.md](HANDOVER.md) §4.
- **Data dictionary, units & established data facts** → see [README.md](README.md)
  "Key data facts & caveats" and [HANDOVER.md](HANDOVER.md) §6.
- This document covers **architecture / output catalog** and **metric logic /
  data-quality handling** only, to avoid duplicating the above.

All scripts live in [analysis/](analysis/). Engine: **DuckDB** over **Parquet**
(converted once from the raw CSVs), plus **scikit-learn** KMeans for clustering.
Timezone is pinned to `Asia/Singapore` in every script.

---

## 1 · Architecture

```
 RAW CSVs (source of truth, ~4.5 GB)
 ├─ txn/txn_*.csv .................. 16 files, comma-sep,  Feb–Apr 2026, 'NULL' strings
 └─ health data/*.csv ............. 2 files,  TAB-sep,    May 2026,     'NULL' strings
        │
        │  convert_parquet.py           (+ two supplementary builds — see §5 gotcha)
        ▼
 PARQUET (fast columnar working set, in analysis/parquet/)
 ├─ txn.parquet ................... transactions (typed)
 ├─ health.parquet ............... activity intervals (steps/cal/distance + raw JSON extract)
 ├─ heart_rate.parquet ........... hourly HR summaries (bpm_number + raw JSON: low/high/avg)
 ├─ txn_perf.parquet ⚠ ........... per-txn speed components (built by ad-hoc snippet)
 └─ hr_fw.parquet    ⚠ ........... HR rows + firmware_version (built by ad-hoc snippet)
        │
        ├──────────────┬───────────────┬────────────────────┐
        ▼              ▼               ▼                    ▼
   analyze.py   analyze_anomalies  analyze_purchases   build_app_data.py
        │            .py                 .py                 │  (+ school_geo.json
        ▼             │                   │                  │     from geocode_retry.py)
  insights.json       ▼                   ▼                  ▼
        │       anomaly_patterns    purchase_insights   appdata/global.json
        │            .json               .json          appdata/schools.json
        │             │                   │                  │
        │  ┌──────────┘                   │        ┌─────────┴──────────┐
        ▼  ▼                              ▼        ▼                    ▼
  SMART_Buddy_Dashboard   SMART_Buddy_Anomaly_    smart-buddy-app/    pdf_report.html
       .html              Patterns.html           (Vite + MapLibre)         │
                          + _Health_ subset       SMART_Buddy_Purchase_     ▼
                                                  Insights.html      SMART_Buddy_
                                                                     Findings_Report.pdf
```

**Stages**

1. **Convert** — `convert_parquet.py` reads the raw CSVs and writes typed, ZSTD-compressed
   Parquet. It extracts nested JSON fields from the `raw` column at this stage
   (HR `date/hour/lowest_bpm/highest_bpm/avg_bpm`; health `active_time`) so downstream SQL
   never re-parses JSON. **Two extra parquets (`txn_perf`, `hr_fw`) are required by
   downstream scripts but are NOT produced here** — see §5.
2. **Analyse** — three independent DuckDB scripts each read Parquet and emit one JSON
   payload (aggregates only; no row-level PII beyond IDs that already exist in the data).
3. **Build app data** — `build_app_data.py` produces the per-school / per-terminal / global
   JSON for the map app and the PDF, joining in `school_geo.json` (MOE identity + coordinates).
4. **Render** — JSON payloads are spliced into HTML templates (Chart.js embedded) to make the
   self-contained reports; `appdata/*.json` is bundled into the Vite app; `pdf_report.html`
   is printed to PDF via headless Chrome. See [HANDOVER.md](HANDOVER.md) §4–5 for the exact
   render/splice commands.

---

## 2 · Scripts

| Script | Reads | Writes | Purpose |
|---|---|---|---|
| `convert_parquet.py` | raw `txn/` + `health data/` CSVs | `parquet/{txn,health,heart_rate}.parquet` | one-time CSV→Parquet + JSON field extraction |
| `convert_txn_perf.py` | raw `txn/` CSVs | `parquet/txn_perf[_YYYYMM].parquet` | per-txn speed components + signal/network (optional month arg) |
| *(ad-hoc snippet)* ⚠ | raw HR CSV | `parquet/hr_fw.parquet` | HR rows + `firmware_version` from raw JSON |
| `analyze.py` | txn, health, heart_rate | `insights.json` | KPIs, quality audit, txn/activity/HR insights, clusters, correlations |
| `analyze_anomalies.py` | txn, health, hr_fw | `anomaly_patterns.json` | anomaly root-cause drill-down (payments + wearables + HR) |
| `analyze_purchases.py` | txn | `purchase_insights.json` | food taxonomy, price points, school/time/habit differentiators |
| `build_app_data.py` | txn, txn_perf, + `school_geo.json` | `appdata/{global,schools}.json` | map-app + PDF dataset (per-school, per-terminal, atas) |
| `geocode_retry.py` | `moe_schools.json` | `school_geo.json` | OneMap postal→lat/lng with backoff (rate-limited) |
| `convert_parquet_feb.py` | `health data/{health_data,heart_rate}_202602_part*.csv` + raw `txn/` | `parquet/feb_{health,heart_rate,txn}.parquet` | Feb-2026 drop (comma-quoted CSVs, unlike May's TABs); txn filtered to Feb |
| `analyze_feb.py` | feb_health, feb_heart_rate, feb_txn | `feb_insights.json` | day-aligned Feb health×txn insights (first overlap month) |
| `build_feb_app_data.py` | feb parquets + `school_geo.json` | `appdata/feb.json` | precomputed filter slices for the app's February Insights window |
| `build_stalls_data.py` | feb_txn, txn_perf_202602, `school_geo.json` | `appdata/stalls.json` | per-stall + per-machine data for Stall Explorer & Terminal Health (incl. machine-vs-site verdicts) |
| `analyze_feb_service.py` | feb_txn, txn_perf_202602, `school_geo.json` | `feb_service.json` | Feb-only service-report data: network health + fault verdicts, speed, food, spending-per-school, CNY windows |
| `splice_feb_service.py` | `feb_service.json` + `chart.umd.min.js` + `feb_service_report.html` | `../SMART_Buddy_Feb2026_Service_Report.html` | splices the self-contained report; then print to PDF via headless Chrome |

⚠ = reproducibility gap, see §5.

---

## 3 · Output catalog

| Deliverable | Emitting script → data | Notes |
|---|---|---|
| `SMART_Buddy_Dashboard.html` | `analyze.py` → `insights.json` | main insights + 26-type data-quality report |
| `SMART_Buddy_Anomaly_Patterns.html` | `analyze_anomalies.py` → `anomaly_patterns.json` | full root-cause report (payments + health) |
| `SMART_Buddy_Health_Anomaly_Patterns.html` / `.pdf` | hand-derived **subset** of the above | wearable + HR sections only (payment content stripped) |
| `SMART_Buddy_Purchase_Insights.html` | `analyze_purchases.py` → `purchase_insights.json` → `purchase_insights_template.html` (splice_purchase_insights.py) | what students buy — verified-name categories only |
| `SMART_Buddy_Findings_Report.pdf` | `build_app_data.py` → `appdata/*.json` → `pdf_report.html` | network/speed/food/atas print report (whole Feb–Apr quarter) |
| `SMART_Buddy_Feb2026_Service_Report.{html,pdf}` | `analyze_feb_service.py` → `feb_service.json` → `feb_service_report.html` (splice) | **Feb-only** service-team report: network health w/ machine-vs-location verdicts, speed, food items, spending-per-school, food-type trends, CNY impact |
| `smart-buddy-app/` | `build_app_data.py` → `appdata/*.json` (bundled to `src/data/`) | interactive map app |
| `SMART_Buddy_Feb2026_Insights.html` | `analyze_feb.py` → `feb_insights.json` → `feb_report_template.html` | static Feb report (health×txn overlap month) |
| map app "February Insights" window | `build_feb_app_data.py` → `appdata/feb.json` → `src/data/feb.json` | clickable filters (day-type × segment, firmware × day-type, level × category) + CNY story; deep link `#feb` or `#feb=hr` |
| map app "Stall Explorer" + "Terminal Health" windows | `build_stalls_data.py` → `appdata/stalls.json` → `src/data/stalls.json` | stall/machine browser (category + price-band filters) & fleet diagnostics (machine-vs-site verdicts vs school peers); role hub `#role=fnb\|eng\|mgmt`, deep links `#stall=`, `#terminal=` |
| `*.pdf` of the three HTML reports | headless-Chrome print of the HTML | for email sharing; charts flatten to images |

The Dashboard and Anomaly report HTML files are the **source of truth** for those two reports
(templates were session-temporary) — edit in place. **Purchase Insights has a template again**
(`purchase_insights_template.html`, recreated 7 Jul 2026 during the verified-only rework):
edit the template + `splice_purchase_insights.py`, never the shipped HTML. The Feb reports and
the quarter PDF also build from templates (`feb_report_template.html`, `feb_service_report.html`,
`pdf_report.html` + `splice_pdf_report.py`).

---

## 4 · Metric logic

### 4.1 Transaction base view & exclusions
Every behavioural/spend metric is computed on a filtered view that removes non-student traffic
(`analyze_purchases.py`, `build_app_data.py`):

```sql
WHERE schoolId != 'STYL'                 -- vendor bench-test terminals
  AND storeName NOT ILIKE '%retrieve%'   -- card-retrieval / maintenance flows
  AND amount <= 20000                     -- cents → drop > $200 outliers
```
`amount` is **cents SGD**; divide by 100 for dollars. Error rate = share of rows with
`errorCode IS NOT NULL AND errorCode != '0'`. Offline share = `paymentMode = 'OFFLINE'`.

### 4.2 Transaction speed
From `txn_perf.parquet`, always guarded by `startToFinish > 0` (0/NULL = no timing captured):
- **Median / p95** of `startToFinish` (ms) overall, by `posNetworkType`, by signal bucket, per school, per terminal.
- **Weekly by payment stack** — restricted to full weeks `txn_date BETWEEN '2026-02-02' AND '2026-04-26'` (see §5).
- **Components** (`checkSignal, openSocket, handshake, sendToReceiveData, tapCardToFinish`) — median, ONLINE only, monthly.

### 4.3 Food categories (no SKU data) — VERIFIED-NAME ONLY (v2)
**Policy (supervisor-mandated 7 Jul 2026; tightened to v2 the same evening after auditing
name-vs-behavior agreement — applied to every deliverable):** the classification lives in ONE
place, **`analysis/taxonomy.py`** (`STALLCAT_SQL`, a per-stall view all five scripts import —
never copy the rules into a script). Rules:
1. A stall gets a food category **only if its registered name says what it sells** — food-word
   regex groups on `storeName` → Drinks / Snacks & Desserts / Cooked Food (+ Bookshop & Supplies
   from real book/stationery/uniform words).
2. **Corporate suffixes are not evidence**: `pte ltd / enterprise / trading / marketing` no longer
   imply Bookshop. Bare company names (BL Marketing ×19, Overseas Associates ×17, …44 stalls) are
   Unclassified until STYL confirms the vendor list.
3. Names hitting **2+ food-word groups** ("Hot Drinks and Snacks", "Fruits and Drinks") = **Mixed**
   (23 stalls). All former Fruits stalls are combos, so **pure Fruits no longer exists**.
4. **Behavior veto** (n≥100): a single food category is dropped to Unclassified when the stall's
   modal price strongly contradicts it — Drinks >$2.00, Snacks >$3.50, Fruits >$3.00, Cooked
   <$1.00 or >$8.00. Calibrated to fire on contradiction ("Hot Stall 5" modal $0.60 = a drinks
   counter), not on premium pricing ($5 café at an independent school stays Cooked Food). Price
   can veto a name; it never assigns one. 9 stalls vetoed in Feb.
Validation: name-vs-modal-price agreement 93–97% per food category. Coverage: Feb 493 stalls /
17.5% txns / 18.5% rev; quarter 498 / 17.2% / 18.1%. Everything else is **`Unclassified`** —
price bands/statistics only, never a food type. (The 7 Jul v1 was name-keywords with a one-line
Generic→Unclassified CASE; the original KMeans price-archetype tier was removed a step earlier.)
Consequences to respect downstream:
- Category shares must use **verified-only denominators** (exclude Unclassified) and be labelled
  "within name-verified volume"; the verified sample **skews toward stall types that register
  real names** (bookshops especially) — it is not a random sample of the network.
- **Low-sample guard**: weekly/day-type category charts blank out slices with too little verified
  volume (e.g. the March-holiday week has n=494 verified txns; Feb weekends n=183). Without the
  guard, single stalls dominate and averages are artifacts (a 2-txn $41 cafe made "holiday cooked
  food" look like $22).
- Two old findings did NOT survive the switch (they were artifacts of price-inferred categories):
  "JC canteens are priced lower" (verified says the opposite) and "afternoon is snack o'clock"
  (only 15 named snack stalls exist).

### 4.4 School level & "atas" (MOE type)
- **Level** inferred from the ID suffix (`%JC`→Junior College, `%PS`/`%P`→Primary,
  `%SS`/`%GS`/`%HS`→Secondary, else Other/Tertiary). In `build_app_data.py`, `eff_level()`
  lets a **clean MOE `mainlevel`** (from `school_geo.json`) override the suffix guess.
- **Atas** (`build_app_data.py` `OUT["atas"]`) is computed **only over MOE-matched schools**
  (those with a `moe_type`): mean `spend_day` and `avg_ticket` grouped by `type_code`
  (Independent / Government-Aided / Government), by level×type, by IP (sec/JC), and by GEP (primary).
  `coverage` records matched vs total so the sample size is never hidden.
- **spend_day** = per card, `total_amount / distinct_active_days`, averaged across cards
  (cards with ≥ some floor per aggregate). This is spend per *active* student-day, not per calendar day.

### 4.5 Card & user clusters (`analyze.py`)
- **Cards** (spending segments): KMeans(k=4) on
  `[log(n_txns), log1p(avg_sgd), morning_ratio, log1p(active_days)]` for cards with ≥ 3 txns
  (single-touch cards excluded). Persona names ("Morning Snackers" etc.) assigned by cluster
  *profile* (e.g. highest before-10am ratio), not index.
- **Users** (fitness segments): KMeans on `[log1p(avg_steps), resting_hr, avg_hr]` for users
  with both step and HR data (~6,561). Same profile-based labelling.

### 4.6 Activity (health) metrics
Cleaned view `hclean` (`analyze.py`):
```sql
WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000
  AND recorded_time < 2026-06-01   -- drop post-May stragglers
```
Units: `calories` is **millical** → `/1000` = kcal; `distances` is **cm** → `/100000` = km;
health rows are **30-min incremental intervals** so daily totals are **sums** (`hdaily`).
Daily step curves additionally cap `steps <= 80000` per user-day to drop implausible days.

### 4.7 Heart-rate averages  ← (the supplier-Q&A metric)
Each HR row is an **hourly summary the wearable itself produced**; the table's `bpm_number`
column **equals** the device's `avg_bpm` in the raw JSON (verified: 0 mismatches in 1,771,398 rows).
The reported average HR is the mean of `bpm_number` over the cleaned set (`analyze.py` `rclean`,
mirrored in `analyze_anomalies.py`):
```sql
WHERE bpm_number BETWEEN 30 AND 220                       -- valid physiological range
  AND TRY_CAST(hr_date AS DATE) BETWEEN '2026-05-01' AND '2026-05-31'  -- real May dates only
```
→ 1,050,510 readings from 8,273 users, mean **81.8 bpm**. Consequences:
- **255 is excluded** (255 > 220). All 381 `bpm_number = 255` rows are whole-record sensor
  errors (`lowest = highest = avg = 255`); they never enter any average. Avg with them left in
  would be 81.83 vs 81.78.
- **Resting HR** uses a different field: per user-day `min(lowest_bpm)` (range 30–150), averaged.
- Per-day / per-hour / per-weekday HR curves use the same `rclean` gate.
- The 255 value is used **only** as an error *count* in `analyze_anomalies.py` (rate per 10k, to
  attribute the fault to firmware 1.1.9.0.0), never as a heart rate.

### 4.8 Correlations
Pearson `r` on per-user aggregates: steps↔resting HR (r = −0.36), steps↔avg HR (r = −0.24),
txn frequency↔avg ticket. Computed in `analyze.py` over users present in both step and HR data.

---

## 5 · Data-quality handling & reproducibility gotchas

**Validity gates (applied before aggregation)**

| Domain | Gate | Why |
|---|---|---|
| Transactions | exclude `STYL`, `%retrieve%`, `amount > 20000c` | vendor test rigs, maintenance flows, $200+ outliers |
| Txn speed | `startToFinish > 0` | 0/NULL = timing not captured |
| Weekly series | `txn_date BETWEEN 2026-02-02 AND 2026-04-26` | quarter starts Sun 1 Feb → the `date_trunc('week')` bucket `2026-01-26` holds a single day; also trims a partial tail week |
| Activity | `data_type IN (0,1)`, `calories ≤ 500000`, `steps ≤ 4000/interval`, pre-June | drops sentinel/corrupt packets and post-period stragglers |
| Heart rate | `bpm_number BETWEEN 30 AND 220`, `hr_date` in May | drops 255 sentinel + <30 lows + 41% backfill |

**Anomaly root-causes the pipeline accounts for** (detailed in the anomaly report):
firmware `1.1.9.0.0` → 100% of 255-bpm + 88% of <40-bpm; `UNKNOWN` paymentType ≈ error path
(type never written when a txn fails early); night 1¢ txns = `STYL` test terminals; `$9,999.90`
= maintenance flows; negative `posSignalStrength` = WiFi **RSSI in dBm** (unit mix vs the 0–31
cellular scale); 18 gen-0 wearables emit power-of-two sentinel calories/distances; HR file is
**keyed by sync time** (41% backfill, dedup by latest `sync_id`).

**Reproducibility gotchas**

1. ✅→⚠ **`txn_perf.parquet` now has a proper script** — `convert_txn_perf.py` (full period, or
   `python convert_txn_perf.py 2026-02` for one month → `txn_perf_202602.parquet`). `hr_fw.parquet`
   is still ad-hoc (`analyze_anomalies.py` needs HR fields + `firmware_version` from the raw JSON;
   note `convert_parquet_feb.py` DOES extract firmware for the Feb HR drop). **Remaining TODO:
   script `hr_fw` for the May file.**
2. **Health CSVs are TAB-separated**, txn CSVs comma — always pass `nullstr='NULL'`.
3. DuckDB `read_csv` on txn needs explicit `types=` for `errorCode`/`cardId`/`amount`/… (16-file
   sampling otherwise mistypes columns).
4. **KMeans cluster indices are unstable across refits** — always assign persona labels by cluster
   *profile*, never by the raw index.
5. `pandas.to_json` emits epoch-ms for date columns — cast dates to `VARCHAR` in SQL before export.
6. **OneMap geocoding rate-limits hard** (≥1.4 s/call). `school_geo.json` is complete (158/334
   confident matches); reuse it, don't regenerate casually. 176 IDs are unmatched **by design**
   (ambiguous acronyms — not guessed).
7. Parquet files are session-temporary and must be regenerated from the raw CSVs (see HANDOVER §4).

---

*Companion docs: [README.md](README.md) (deliverables + data facts) ·
[HANDOVER.md](HANDOVER.md) (run order, decisions, full gotcha list). Last updated 6 Jul 2026.*
