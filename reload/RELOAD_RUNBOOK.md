# Full wipe + reload — SMART Buddy ClickHouse (Feb + March 2026)

Clean, from-scratch reload of the `smartbuddy` database from **verified single-month source files**.
Purpose: remove "was the data even loaded correctly?" as a variable while we chase the March linkage.

> ⚠️ **Read this first.** This reload uses the **same ingest code** on the **same source bytes**. If the
> March items↔txn linkage failure is a code/build issue (our leading theory — the source CSVs are proven
> second-aligned and match prod row counts exactly), **this reload will NOT fix the linkage on its own.**
> It IS worth doing to guarantee a clean, uniform load — but pair it with the code fix, don't expect it to
> be the fix. It is **destructive** and takes the demo offline during the reload.

---

## 0 · Inputs

- **Data bundle** `SMARTBUDDY_RELOAD_DATA.zip` (delivered out-of-band — too large for git). Unzips to:
  ```
  schools.csv
  feb/feb_transactions.csv
  feb/feb_health_data.csv
  feb/feb_heart_rate.csv
  march/march2026_transactions.csv
  march/march2026_student_items.csv
  march/march2026_student_saving_spending.csv
  MANIFEST.md
  ```
  `schools.csv` is also committed here in `reload/` (it's small) as the canonical copy.
- This repo pulled on the VM at the commit that includes the linkage fix (`build_insights.py`).

**Every source file is verified single-month** (this matters — `month` is a manual ingest arg):

| file | dataset | month | rows | verified |
|---|---|---|---|---|
| `schools.csv` | `schools` | (dimension) | 332 | schoolId + lat/lng/level/flags (was 158; +173 geocoded & 7 corrected 15 Jul; + APSNK 1 Oct) |
| `feb/feb_transactions.csv` | `transactions` | `2026-02` | 3,977,666 | all 2026-02, speed cols present (auto-splits `txn`+`txn_perf`) |
| `feb/feb_health_data.csv` | `health` | `2026-02` | 2,948,308 | Feb-SGT (0.10% tail on Mar 1 — negligible) |
| `feb/feb_heart_rate.csv` | `heart_rate` | `2026-02` | 2,393,845 | Feb-SGT (0.07% tail) |
| `march/march2026_transactions.csv` | `transactions` | `2026-03` | 3,714,169 | all 2026-03, matches prod count exactly |
| `march/march2026_student_items.csv` | `items` | `2026-03` | 4,286,976 | all 2026-03 |
| `march/march2026_student_saving_spending.csv` | `saving_spending` | `2026-03` | 145,348 | year-month 2026-3 |

---

## 1 · Pull + rebuild images (get the current code onto the VM)

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.agent.yml build ch-insights smartbuddy-ingest
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d smartbuddy-ingest
```

## 2 · Wipe + re-init the database (DESTRUCTIVE)

```bash
# Drop the whole smartbuddy DB (does NOT touch other demos — own db + own users). Needs ADMIN creds.
docker exec -e ... smartbuddy-ch-init  # or run a clickhouse-client:
#   clickhouse-client --host clickhouse --user <admin> --password <pw> -q "DROP DATABASE IF EXISTS smartbuddy"

# Recreate db + insights table + ro/rw users (idempotent):
docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-init
```

## 3 · Load the data (ORDER MATTERS — schools before transactions, since pb_schools rebuilds off txn+schools)

Uses `scripts/vm-load.sh <file> <dataset> <month> <replace|append> <rebuild>` (scp → docker cp → `ingest_core.py`).
Point the paths at the unzipped bundle. `replace` wipes that month partition first; `rebuild 1` refreshes the
derived views/rollups after the load.

```bash
B=/path/to/unzipped/bundle     # e.g. /tmp/smartbuddy_reload

bash scripts/vm-load.sh $B/schools.csv                                 schools          2026-02 replace 1
bash scripts/vm-load.sh $B/feb/feb_transactions.csv                    transactions     2026-02 replace 1
bash scripts/vm-load.sh $B/feb/feb_health_data.csv                     health           2026-02 replace 1
bash scripts/vm-load.sh $B/feb/feb_heart_rate.csv                      heart_rate       2026-02 replace 1
bash scripts/vm-load.sh $B/march/march2026_transactions.csv            transactions     2026-03 replace 1
bash scripts/vm-load.sh $B/march/march2026_student_items.csv           items            2026-03 replace 1
bash scripts/vm-load.sh $B/march/march2026_student_saving_spending.csv saving_spending  2026-03 replace 1
```

(Or run `bash reload/load-all.sh $B` which executes exactly the seven commands above.)

## 4 · Build the insight bundles

```bash
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
SB_MONTH=2026-03 $CC
SB_MONTH=2026-02 $CC
$CC python build_insights_wearable.py 2026-02      # Feb wearable tab
```

## 5 · Verify

- Row counts: `SELECT count() FROM smartbuddy.txn WHERE month='2026-02'` → 3,977,666; `'2026-03'` → 3,714,169;
  `items 2026-03` → 4,286,976; `saving_spending 2026-03` → 145,348; `schools` → 332.
- **March linkage** (the thing we're chasing): the `SB_MONTH=2026-03` insights run must print
  `linkage: …/… baskets matched (99.x%) …`. **If it still says `0/… skipping linkage`, the reload did NOT fix
  it — report back**; that confirms the fault is in code, not the data, and we fix `build_insights.py`.
- Dashboard: Feb (Network / Terminal / Wearables / Playback) and March (… / Purchases / Saving / Playback)
  all populate; month picker shows both.

---

## Notes
- `feb_transactions.csv` carries the speed columns, so the `transactions` load fills **both** `txn` and
  `txn_perf` — no separate Feb `txn_perf` file needed.
- `schools` is loaded once (as `2026-02`); it's joined `USING(schoolId)` so the month value is irrelevant.
- The Feb wearable files have a ~0.1% tail of readings on Mar 1 (SGT midnight roll-over); they load into the
  `2026-02` partition as before — immaterial to any aggregate.
