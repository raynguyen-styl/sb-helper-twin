# Data Pipeline Documentation

**Last Updated:** July 8, 2026
**Scope:** **February 2026 only** (the project was narrowed to Feb; March/April
transactions and the May health drop have been removed — see §7).

> **This is the overview / task-map doc.** For the deep engineer reference (every
> script, every metric formula, all data-quality gates) see **`PIPELINE.md`**, which
> is the single source of truth. This file is kept aligned with it.

---

## Where these tasks run  ⟵ (answer to "where do those tasks happen?")

**All four stages below run locally and offline, on the analysis workstation — they
are one-off Python scripts, not a deployed service.**

| Aspect | Reality |
|--------|---------|
| **Machine** | The analyst's Windows PC (`C:\Users\STYLSG\Downloads\Smart Buddy Dashboard`). Run by hand from the terminal. |
| **Engine** | Python 3.12 + **DuckDB** (SQL over Parquet) + scikit-learn (clustering only). No pandas-based ETL. |
| **Server / DB / cloud** | **None.** Nothing runs on a server, database, scheduler, or cloud. It does **not** touch the shared STYL platform (InfluxDB, Ditto, Solace, Keycloak) and has **no connection to `tree-twin-uat`**. |
| **What the team sees** | A **static site**: the finished JSON is baked into the app at build time and served by nginx. There is no live pipeline behind the dashboard. |
| **Refreshing data** | Means re-running these local scripts and rebuilding the app — not a running job. |

So: **Ingestion → Cleaning → Transformation → Analysis Outputs all happen on the
analyst's machine, *before* deployment.** The deployed artifact carries only the
pre-computed output. Nothing in the diagram executes in production.

---

## Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       DATA PIPELINE  (local, DuckDB, Feb-2026 only)            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  [SOURCE FILES]  (raw, gitignored — contain real card/device/user IDs)         │
│       │                                                                        │
│       ├── Transactions (comma-sep, 'NULL' strings)                             │
│       │     txn/txn_Feb2026_to_Apr2026_part001-005.csv   (Feb only, 3.98M rows)│
│       │     ⚠ filename still says "to_Apr" but only Feb parts remain           │
│       │                                                                        │
│       └── Health wearables — February drop (comma-sep, fully quoted)           │
│             health data/health_data_202602_part1-6.csv   (2.95M rows)          │
│             health data/heart_rate_202602_part1-6.csv    (2.39M rows)          │
│       │                                                                        │
│       ▼                                                                        │
│  [INGESTION & VALIDATION]                                                      │
│       ├── DuckDB read_csv → typed, ZSTD Parquet (analysis/parquet/)            │
│       │     convert_parquet_feb.py  → feb_txn / feb_health / feb_heart_rate    │
│       │     convert_txn_perf.py 2026-02 → txn_perf_202602 (speed components)    │
│       ├── JSON fields extracted from `raw` column at convert time              │
│       └── Validate row counts, column types, null handling ('NULL' → NULL)     │
│       ▼                                                                        │
│  [DATA CLEANING]  (validity gates applied before every aggregation)            │
│       ├── Transactions: exclude schoolId 'STYL' (test rigs),                   │
│       │     storeName ILIKE '%retrieve%' (maintenance), amount > 20000c ($200) │
│       ├── Heart rate:  bpm 30–220 only (drops 255 sentinel);                   │
│       │     filter to hr_date in Feb (≈40% of rows are pre-Feb sync backfill)  │
│       └── Activity:    data_type IN (0,1), calories ≤ 500000, steps ≤ 4000/int │
│       ▼                                                                        │
│  [TRANSFORMATION]                                                              │
│       ├── Stall food category — VERIFIED-NAME ONLY (taxonomy.py, see §5.2)      │
│       ├── Map each terminal → stall → school; machine-vs-site fault verdicts    │
│       ├── School level (ID suffix) + MOE "atas" type (matched schools)          │
│       └── Day-aligned health × txn aggregates (no per-user linkage possible)    │
│       ▼                                                                        │
│  [ANALYSIS OUTPUTS]  (JSON → bundled into app / spliced into reports)           │
│       ├── build_feb_app_data.py / build_stalls_data.py → app JSON               │
│       ├── analyze_feb_service.py → feb_service.json → Service Report (html/pdf) │
│       ├── analyze_feb.py → feb_insights.json → Feb Insights report              │
│       └── analyze_purchases.py → purchase_insights.json → Purchase Insights      │
│                                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1 · Source Data Specifications

### 1.1 Transactions

| Property | Value |
|----------|-------|
| **Files** | `txn/txn_Feb2026_to_Apr2026_part001-005.csv` (5 parts) |
| **Rows** | 3,977,666 (raw Feb); 3,959,550 after cleaning (~$7.57M SGD) |
| **Date range** | 2026-02-01 → 2026-02-28 |
| **Delimiter** | Comma · **NULL** = literal string `NULL` |
| **Columns** | 45 (see header of any part file) |

Key columns: `txn_date`, `txn_time`, `amount` (**cents SGD**, ÷100 for dollars),
`storeId`/`storeName`/`schoolId`, `terminalId`, `cardId`/`cardType`, `paymentType`,
`errorCode`, `paymentMode` (ONLINE/OFFLINE), plus timing fields
(`checkSignal, openSocket, handshake, sendToReceiveData, tapCardToFinish, startToFinish`, ms)
and network fields (`posSignalStrength`, `posNetworkType`, `readerSignalStrength`, …).
`studentId`/`studentName` are 100% NULL (PII stripped) — **no per-student linkage exists.**

### 1.2 Health — activity (February drop)

| Property | Value |
|----------|-------|
| **Files** | `health data/health_data_202602_part1-6.csv` |
| **Rows / users** | 2,948,308 / 13,613 |
| **Delimiter** | Comma, fully quoted (the May drop was TAB — May is now removed) |
| **Columns (15)** | `id, calories, distances, steps, recorded_time, uploaded_time, data_type, user_id, raw, sync_id, wearable_name, calculate_time, tz, migrate_id, health_profile_id` |

Units: `calories` = **millical** (÷1000 → kcal); `distances` = **cm** (÷100000 → km);
rows are **30-min incremental intervals** → daily totals are **sums**.

### 1.3 Health — heart rate (February drop)

| Property | Value |
|----------|-------|
| **Files** | `health data/heart_rate_202602_part1-6.csv` |
| **Rows** | 2,393,845 (includes pre-Feb backfill) |
| **Columns (10)** | `id, user_id, bpm_number, recorded_time, uploaded_time, raw, sync_id, wearable_name, calculate_time, tz` |

`bpm_number` equals the device's `avg_bpm` (hourly summary). **`bpm_number = 255` is a
firmware error sentinel** (firmware `1.1.9.0.0` — recommend retiring that firmware), excluded
from every average. The table is **keyed by sync time**, so ~40% of rows are historical
backfill — filter the payload date (`hr_date`) to February for real curves.

---

## 2 · Processing Rules (summary — full formulas in `PIPELINE.md` §4)

### 2.1 Non-student traffic exclusion (every spend/behaviour metric)
```sql
WHERE schoolId != 'STYL'                 -- vendor bench-test terminals
  AND storeName NOT ILIKE '%retrieve%'   -- card-retrieval / maintenance flows
  AND amount <= 20000                     -- cents → drop > $200 outliers
```
Error rate = share of rows with `errorCode IS NOT NULL AND errorCode != '0'`.
Offline share = `paymentMode = 'OFFLINE'`.

### 2.2 Food categories — VERIFIED-NAME ONLY (taxonomy v2)
No item/SKU data exists, so a stall gets a food category **only from its registered
name, and only if its own prices don't contradict it.** The rules live in ONE place,
`analysis/taxonomy.py` (imported by all analysis scripts — never copied inline):

1. Category from name keywords only → Drinks / Snacks & Desserts / Cooked Food /
   Bookshop & Supplies.
2. **Corporate suffixes are not evidence** (`pte ltd`, `trading`, `marketing`); bare
   company names (BL Marketing, Overseas Associates, …) are **Unclassified until STYL
   confirms the vendor list.**
3. A name covering **2+ food groups** ("Hot Drinks and Snacks") = **Mixed**.
4. **Behaviour veto** (n≥100): a category is dropped to Unclassified when the modal
   price strongly contradicts the name (price can veto, never assign).

**Feb coverage:** 493 verified stalls = 17.5% of txns / 18.5% of revenue (Mixed 23,
vetoed 9). The other 2,053 stalls are **Unclassified** — reported by price bands only,
never assigned a food type. ⚠ An earlier price-based / k-means category-guessing step was
**removed** at the service team's request.

### 2.3 Network performance & fault verdicts
Speed uses **`startToFinish`** (guarded `> 0`). Each terminal is compared to its school
peers to produce a **machine-vs-site verdict**:
**165 machine faults** (service the unit) · **190 site issues** (52 schools; peers also bad)
· 14 to check · 2,235 OK. The **3.0 ASCAN reader stack is ~2× slower** than 2.0
(~4.3 s vs ~2.1 s median), every week. WiFi terminals report **RSSI in dBm** in the same
column cellular uses for a 0–31 scale (unit mix).

### 2.4 School level & "atas"
Level inferred from ID suffix (`…JC`→JC, `…PS`/`…P`→Primary, `…SS`/`…GS`/`…HS`→Secondary),
overridden by a clean MOE `mainlevel` where matched. "Atas" (Independent / Gov-Aided /
Government) computed **only over MOE-matched schools** (158 of ~334; coverage recorded so
the sample size is never hidden). `spend_day` = per card `total / active days`, averaged.

### 2.5 Clusters (scikit-learn KMeans)
Card spending segments and user fitness segments are KMeans clusters, always **labelled by
cluster profile, not raw index** (indices are unstable across refits).

---

## 3 · Output Catalog (current deliverables)

| Deliverable | Built by → data | Scope |
|-------------|-----------------|-------|
| `smart-buddy-app/` (interactive map app) | `build_feb_app_data.py` + `build_stalls_data.py` → `appdata/*.json` (bundled to `src/data/`) | Feb |
| `SMART_Buddy_Feb2026_Service_Report.{html,pdf}` | `analyze_feb_service.py` → `feb_service.json` → template splice | Feb |
| `SMART_Buddy_Feb2026_Insights.html` | `analyze_feb.py` → `feb_insights.json` → template | Feb |
| `SMART_Buddy_Purchase_Insights.{html,pdf}` | `analyze_purchases.py` → `purchase_insights.json` → template splice | Feb (now that txn is Feb-only) |

> **No longer regenerable after the Feb-only purge** (the shipped files remain, but their
> source data is gone): `SMART_Buddy_Findings_Report.pdf` (was Feb–Apr quarter),
> `SMART_Buddy_Dashboard.html` and the anomaly / health reports (were built on the
> May health drop). See §7.

---

## 4 · Technical Implementation

- **Platform:** Windows PowerShell · Python 3.12 · DuckDB 1.5 · scikit-learn
- **Base directory:** `C:\Users\STYLSG\Downloads\Smart Buddy Dashboard`
- **Scripts:** all in `analysis/` (run order in `HANDOVER.md` §4)

**Convert raw CSVs → Parquet (DuckDB, not pandas):**
```python
import duckdb
con = duckdb.connect()
con.execute("""
  CREATE TABLE txn AS
  SELECT * FROM read_csv('txn/txn_*.csv', header=true, nullstr='NULL',
                         types={'cardId':'VARCHAR','errorCode':'VARCHAR'})
""")   # explicit types: 16-file sampling otherwise mistypes ID/code columns
```

---

## 5 · Known Issues & Recommendations

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| HR = 255 sentinel | Firmware `1.1.9.0.0` produces 100% of them | Exclude from averages; **retire the firmware** |
| HR file keyed by sync time | ~40% pre-Feb backfill | Filter `hr_date` to February |
| No item/SKU data | Food categories can't be derived for most stalls | Verified-name-only (taxonomy v2); rest Unclassified |
| STYL test terminals / 'retrieve' flows / >$200 | Non-student traffic | Excluded by the base gate |
| 3.0 ASCAN reader stack | ~2× slower than 2.0 every week | Investigate the 3.0 stack |
| No per-student linkage | `studentId` 100% NULL; cardId ≠ health user_id | Only day-aligned *aggregate* comparison is valid |

---

## 6 · References

- `PIPELINE.md` — deep engineer reference (single source of truth for scripts + metrics)
- `README.md` — deliverables + data-fact caveats
- `HANDOVER.md` — run order, decisions, session context
- `DEPLOY.md` — how the static app is containerized & deployed

---

## 7 · February-only scope (what was removed, 8 Jul 2026)

The project was narrowed to February 2026. Removed (irreversibly — would require
re-downloading the source drops to restore):

- **Raw March/April transactions** — `txn` parts 006–016 (~2.8 GB). Parts 001–005 (pure
  Feb) remain, despite the `…to_Apr…` filename (kept so the pipeline glob still matches).
- **Raw May 2026 health drop** — `20260629_tbl_{health_data,heart_rate}_May2026.csv` (~0.8 GB).
- **Quarter/May Parquet** — `txn.parquet` and `txn_perf.parquet` rebuilt to Feb-only;
  `health.parquet` / `heart_rate.parquet` (May) deleted.
- **`analysis/appdata_quarter/`** — the Feb–Apr dataset that fed the quarter Findings PDF.

**Consequence:** the Findings PDF, the main Dashboard, and the anomaly/health reports can
no longer be regenerated (their shipped files are unaffected). Everything Feb-scoped —
the app and the Feb reports — is unaffected and fully rebuildable.

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-07-06 | Initial pipeline documentation (opencode-era pandas draft) | opencode |
| 2026-07-08 | Rewritten to match the real DuckDB pipeline: Feb-only scope, taxonomy v2, machine-vs-site verdicts, correct scripts/outputs/paths; added "where these tasks run"; documented the Feb-only purge | Claude |
