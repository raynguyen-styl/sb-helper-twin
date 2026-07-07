"""Smart Buddy Dashboard — full aggregation pipeline.
Reads parquet, writes insights.json with quality audit, per-dataset insights,
clusters, and cross-dataset patterns.
"""
import duckdb, json, os, time
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect()
con.sql("SET timezone='Asia/Singapore'")
t0 = time.time()
OUT = {}

def q(sql):
    return con.sql(sql).df()

def recs(df):
    return json.loads(df.to_json(orient="records"))

H = f"'{PQ}/health.parquet'"
R = f"'{PQ}/heart_rate.parquet'"
T = f"'{PQ}/txn.parquet'"

# =====================================================================
# META
# =====================================================================
OUT["meta"] = {
    "txn": recs(q(f"""SELECT count(*) AS rows, count(DISTINCT schoolId) AS schools,
        count(DISTINCT storeId) AS stores, count(DISTINCT terminalId) AS terminals,
        count(DISTINCT cardId) AS cards, min(txn_date)::VARCHAR AS from_date, max(txn_date)::VARCHAR AS to_date,
        round(sum(amount)/100.0,0) AS total_sgd FROM {T}"""))[0],
    "health": recs(q(f"""SELECT count(*) AS rows, count(DISTINCT user_id) AS users,
        count(DISTINCT wearable_name) AS wearables,
        min(to_timestamp(recorded_time))::VARCHAR AS from_ts, max(to_timestamp(recorded_time))::VARCHAR AS to_ts FROM {H}"""))[0],
    "hr": recs(q(f"""SELECT count(*) AS rows, count(DISTINCT user_id) AS users,
        min(to_timestamp(recorded_time))::VARCHAR AS from_ts, max(to_timestamp(recorded_time))::VARCHAR AS to_ts FROM {R}"""))[0],
}
print("meta", time.time()-t0, flush=True)

# =====================================================================
# QUALITY AUDIT
# =====================================================================
quality = {}

quality["txn"] = recs(q(f"""SELECT
  count(*) AS n_rows,
  count(*) - count(DISTINCT id) AS dup_ids,
  count(*) FILTER (cardId IS NULL) AS null_cardId,
  count(*) FILTER (paymentType='UNKNOWN') AS unknown_paymentType,
  count(*) FILTER (paymentStatus='PENDING') AS pending_status,
  count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0') AS nonzero_errorCode,
  count(*) FILTER (amount > 5000) AS amount_over_50sgd,
  count(*) FILTER (amount > 20000) AS amount_over_200sgd,
  max(amount) AS max_amount_cents,
  count(*) FILTER (amount <= 10) AS amount_10cents_or_less,
  count(*) FILTER (startToFinish IS NULL OR startToFinish <= 0) AS bad_duration,
  count(*) FILTER (startToFinish > 60000) AS duration_over_60s,
  count(*) FILTER (txn_date < '2026-02-01' OR txn_date > '2026-04-30') AS date_out_of_range,
  count(*) FILTER (readerSignalStrength IS NULL) AS null_reader_signal
FROM {T}"""))[0]

quality["txn_error_codes"] = recs(q(f"""SELECT errorCode, count(*) AS n FROM {T}
  WHERE errorCode IS NOT NULL AND errorCode != '0' GROUP BY 1 ORDER BY n DESC LIMIT 10"""))

quality["health"] = recs(q(f"""SELECT
  count(*) AS n_rows,
  count(*) - count(DISTINCT user_id||'_'||recorded_time) AS dup_user_time,
  count(*) FILTER (data_type NOT IN (0,1)) AS weird_data_type,
  count(DISTINCT data_type) - 2 AS n_weird_type_values,
  count(*) FILTER (raw_is_json=0 AND data_type=1) AS type1_missing_json,
  count(*) FILTER (calories > 500000) AS calories_over_500kcal_interval,
  max(calories) AS max_calories_raw,
  count(*) FILTER (steps > 4000) AS steps_over_4000_interval,
  max(steps) AS max_steps_interval,
  count(*) FILTER (distances > 500000) AS distance_over_5km_interval,
  max(distances) AS max_distance_raw,
  count(*) FILTER (distances > 0 AND steps = 0) AS distance_no_steps,
  count(*) FILTER (uploaded_time < recorded_time) AS uploaded_before_recorded,
  count(*) FILTER (to_timestamp(recorded_time) >= TIMESTAMPTZ '2026-06-01 00:00:00+08') AS recorded_outside_may,
  count(*) FILTER (tz != 480) AS tz_not_sgt
FROM {H}"""))[0]

quality["hr"] = recs(q(f"""SELECT
  count(*) AS n_rows,
  count(*) FILTER (bpm_number < 40) AS bpm_under_40,
  count(*) FILTER (bpm_number <= 10) AS bpm_10_or_less,
  count(*) FILTER (bpm_number > 200) AS bpm_over_200,
  count(*) FILTER (bpm_number = 255) AS bpm_255,
  count(*) FILTER (raw_is_json = 0) AS missing_json,
  count(*) FILTER (avg_bpm IS NOT NULL AND bpm_number != avg_bpm) AS bpm_vs_avg_mismatch,
  count(*) FILTER (lowest_bpm > highest_bpm) AS lowest_gt_highest,
  count(*) FILTER (lowest_bpm < 30) AS lowest_under_30,
  count(*) FILTER (highest_bpm > 220) AS highest_over_220,
  count(*) - count(DISTINCT user_id||'_'||coalesce(hr_date,'')||'_'||coalesce(hr_hour,-1)) AS dup_user_date_hour,
  count(*) FILTER (TRY_CAST(hr_date AS DATE) BETWEEN DATE '2000-01-01' AND DATE '2026-04-30') AS backfill_pre_may,
  count(*) FILTER (TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-04-01' AND DATE '2026-04-30') AS backfill_april,
  count(*) FILTER (hr_date IS NULL OR TRY_CAST(hr_date AS DATE) < DATE '2000-01-01'
                   OR TRY_CAST(hr_date AS DATE) > DATE '2026-05-31') AS impossible_dates,
  strftime(min(TRY_CAST(hr_date AS DATE)), '%Y-%m-%d') AS min_hr_date,
  strftime(max(TRY_CAST(hr_date AS DATE)), '%Y-%m-%d') AS max_hr_date
FROM {R}"""))[0]

# daily user-day step totals > 40k (physiologically implausible for a school day)
quality["health_extreme_days"] = recs(q(f"""
WITH d AS (SELECT user_id, date_trunc('day', to_timestamp(recorded_time)) AS d, sum(steps) AS day_steps
  FROM {H} GROUP BY 1,2)
SELECT count(*) FILTER (day_steps > 40000) AS days_over_40k_steps,
       count(*) FILTER (day_steps > 80000) AS days_over_80k_steps,
       max(day_steps) AS max_day_steps, count(*) AS total_user_days FROM d"""))[0]
print("quality", time.time()-t0, flush=True)
OUT["quality"] = quality

# =====================================================================
# TRANSACTIONS
# =====================================================================
tx = {}
tx["daily"] = recs(q(f"""SELECT txn_date::VARCHAR AS date, count(*) AS n,
  round(sum(amount)/100.0,0) AS sgd,
  count(*) FILTER (paymentMode='OFFLINE') AS offline_n
FROM {T} GROUP BY 1 ORDER BY 1"""))

tx["hourly"] = recs(q(f"""SELECT extract(hour FROM txn_time) AS hour, count(*) AS n,
  round(avg(amount)/100.0,2) AS avg_sgd FROM {T} GROUP BY 1 ORDER BY 1"""))

tx["weekday"] = recs(q(f"""SELECT dayofweek(txn_date) AS dow, count(*) AS n,
  round(sum(amount)/100.0,0) AS sgd,
  count(DISTINCT txn_date) AS n_days FROM {T} GROUP BY 1 ORDER BY 1"""))

tx["payment_types"] = recs(q(f"""SELECT paymentType, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
  round(avg(amount)/100.0,2) AS avg_sgd,
  round(median(startToFinish),0) AS median_ms,
  round(quantile_cont(startToFinish, 0.95),0) AS p95_ms
FROM {T} GROUP BY 1 ORDER BY n DESC"""))

tx["payment_mode"] = recs(q(f"""SELECT paymentMode, paymentStatus, count(*) AS n FROM {T} GROUP BY 1,2 ORDER BY n DESC"""))

tx["top_schools"] = recs(q(f"""SELECT schoolId, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
  round(avg(amount)/100.0,2) AS avg_sgd, count(DISTINCT cardId) AS cards,
  count(DISTINCT storeId) AS stores
FROM {T} GROUP BY 1 ORDER BY n DESC LIMIT 15"""))

tx["top_stores"] = recs(q(f"""SELECT storeName, schoolId, count(*) AS n,
  round(sum(amount)/100.0,0) AS sgd, round(avg(amount)/100.0,2) AS avg_sgd
FROM {T} GROUP BY 1,2 ORDER BY sgd DESC LIMIT 15"""))

tx["amount_hist"] = recs(q(f"""SELECT
  CASE WHEN amount<50 THEN '<$0.50' WHEN amount<100 THEN '$0.50-1'
       WHEN amount<150 THEN '$1-1.50' WHEN amount<200 THEN '$1.50-2'
       WHEN amount<300 THEN '$2-3' WHEN amount<500 THEN '$3-5'
       WHEN amount<1000 THEN '$5-10' WHEN amount<5000 THEN '$10-50'
       ELSE '>$50' END AS bucket,
  min(amount) AS ord, count(*) AS n FROM {T} GROUP BY 1 ORDER BY min(amount)"""))

tx["card_freq"] = recs(q(f"""WITH c AS (SELECT cardId, count(*) AS n FROM {T} WHERE cardId IS NOT NULL GROUP BY 1)
SELECT CASE WHEN n<=5 THEN '1-5' WHEN n<=20 THEN '6-20' WHEN n<=50 THEN '21-50'
  WHEN n<=100 THEN '51-100' WHEN n<=200 THEN '101-200' ELSE '>200' END AS bucket,
  min(n) AS ord, count(*) AS cards, sum(n) AS txns FROM c GROUP BY 1 ORDER BY min(n)"""))

tx["perf_by_network"] = recs(q(f"""SELECT posNetworkType, count(*) AS n,
  round(median(startToFinish),0) AS median_ms, round(quantile_cont(startToFinish,0.95),0) AS p95_ms
FROM {T} WHERE startToFinish > 0 GROUP BY 1 ORDER BY n DESC"""))

tx["perf_by_signal"] = recs(q(f"""SELECT
  CASE WHEN posSignalStrength < 15 THEN '<15' WHEN posSignalStrength < 20 THEN '15-19'
       WHEN posSignalStrength < 25 THEN '20-24' WHEN posSignalStrength < 30 THEN '25-29'
       ELSE '30+' END AS signal_bucket, min(posSignalStrength) AS ord,
  count(*) AS n, round(median(startToFinish),0) AS median_ms,
  round(quantile_cont(startToFinish,0.95),0) AS p95_ms
FROM {T} WHERE startToFinish > 0 AND posSignalStrength IS NOT NULL
GROUP BY 1 ORDER BY min(posSignalStrength)"""))

tx["school_error_rates"] = recs(q(f"""SELECT schoolId, count(*) AS n,
  count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0') AS errors,
  round(100.0 * count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0') / count(*), 2) AS err_pct
FROM {T} GROUP BY 1 HAVING count(*) > 10000 ORDER BY err_pct DESC LIMIT 10"""))

tx["offline_daily_share"] = recs(q(f"""SELECT txn_date::VARCHAR AS date,
  round(100.0*count(*) FILTER (paymentMode='OFFLINE')/count(*),2) AS offline_pct
FROM {T} GROUP BY 1 ORDER BY 1"""))
OUT["txn"] = tx
print("txn", time.time()-t0, flush=True)

# =====================================================================
# HEALTH  (steps in raw counts; calories raw = millical -> /1000 kcal; distance cm)
# Filter: exclude interval rows with calories>500000 or steps>4000 from behavioural aggregates
# =====================================================================
hh = {}
con.sql(f"""CREATE OR REPLACE VIEW hclean AS
  SELECT user_id, steps, calories/1000.0 AS kcal, distances/100000.0 AS km,
    recorded_time, to_timestamp(recorded_time) AS ts, active_time, data_type
  FROM {H}
  WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000
    AND to_timestamp(recorded_time) < TIMESTAMPTZ '2026-06-01 00:00:00+08'""")

con.sql("""CREATE OR REPLACE VIEW hdaily AS
  SELECT user_id, date_trunc('day', ts) AS d, sum(steps) AS steps, sum(kcal) AS kcal,
    sum(km) AS km, sum(active_time) AS active_min
  FROM hclean GROUP BY 1,2""")

hh["daily"] = recs(q("""SELECT strftime(d, '%Y-%m-%d') AS date, count(*) AS active_users,
  round(avg(steps),0) AS avg_steps, round(median(steps),0) AS median_steps
FROM hdaily WHERE steps <= 80000 GROUP BY d ORDER BY d"""))

hh["hourly_steps"] = recs(q("""SELECT extract(hour FROM ts) AS hour,
  CASE WHEN dayofweek(ts) IN (0,6) THEN 'weekend' ELSE 'weekday' END AS daytype,
  round(sum(steps)/count(DISTINCT user_id||'_'||date_trunc('day',ts)),1) AS steps_per_userday
FROM hclean GROUP BY 1,2 ORDER BY 1"""))

hh["weekday_steps"] = recs(q("""SELECT dayofweek(d) AS dow, round(avg(steps),0) AS avg_steps,
  count(*) AS user_days FROM hdaily WHERE steps <= 80000 GROUP BY 1 ORDER BY 1"""))

hh["user_avg_steps_hist"] = recs(q("""WITH u AS (
  SELECT user_id, avg(steps) AS avg_daily FROM hdaily WHERE steps <= 80000 GROUP BY 1)
SELECT CASE WHEN avg_daily<2000 THEN '<2k' WHEN avg_daily<4000 THEN '2-4k'
  WHEN avg_daily<6000 THEN '4-6k' WHEN avg_daily<8000 THEN '6-8k'
  WHEN avg_daily<10000 THEN '8-10k' WHEN avg_daily<12500 THEN '10-12.5k'
  WHEN avg_daily<15000 THEN '12.5-15k' ELSE '>15k' END AS bucket,
  min(avg_daily) AS ord, count(*) AS users FROM u GROUP BY 1 ORDER BY min(avg_daily)"""))

hh["summary"] = recs(q("""SELECT round(avg(steps),0) AS avg_daily_steps,
  round(median(steps),0) AS median_daily_steps,
  round(avg(kcal),0) AS avg_daily_kcal, round(avg(km),2) AS avg_daily_km,
  round(avg(active_min),0) AS avg_daily_active_min,
  count(DISTINCT user_id) AS users, count(*) AS user_days
FROM hdaily WHERE steps <= 80000"""))[0]

hh["device_mix"] = recs(q(f"""SELECT data_type, count(DISTINCT user_id) AS users, count(*) AS rows_
FROM {H} WHERE data_type IN (0,1) GROUP BY 1"""))
OUT["health"] = hh
print("health", time.time()-t0, flush=True)

# =====================================================================
# HEART RATE (valid range filter 30-220 for curves)
# =====================================================================
hr = {}
con.sql(f"""CREATE OR REPLACE VIEW rclean AS
  SELECT user_id, bpm_number, lowest_bpm, highest_bpm, TRY_CAST(hr_date AS DATE) AS d, hr_hour AS hour
  FROM {R} WHERE bpm_number BETWEEN 30 AND 220
    AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'""")

hr["hourly_curve"] = recs(q("""SELECT hour,
  CASE WHEN dayofweek(d) IN (0,6) THEN 'weekend' ELSE 'weekday' END AS daytype,
  round(avg(bpm_number),1) AS avg_bpm,
  round(quantile_cont(bpm_number,0.25),0) AS p25, round(quantile_cont(bpm_number,0.75),0) AS p75,
  count(*) AS n
FROM rclean GROUP BY 1,2 ORDER BY 1"""))

hr["user_avg_hist"] = recs(q("""WITH u AS (SELECT user_id, avg(bpm_number) AS avg_bpm FROM rclean GROUP BY 1)
SELECT CASE WHEN avg_bpm<70 THEN '<70' WHEN avg_bpm<80 THEN '70-79' WHEN avg_bpm<90 THEN '80-89'
  WHEN avg_bpm<100 THEN '90-99' WHEN avg_bpm<110 THEN '100-109' ELSE '110+' END AS bucket,
  min(avg_bpm) AS ord, count(*) AS users FROM u GROUP BY 1 ORDER BY min(avg_bpm)"""))

hr["resting_hist"] = recs(q("""WITH rest AS (
  SELECT user_id, d, min(lowest_bpm) AS day_low FROM rclean
  WHERE lowest_bpm BETWEEN 30 AND 150 GROUP BY 1,2),
 u AS (SELECT user_id, avg(day_low) AS resting FROM rest GROUP BY 1)
SELECT CASE WHEN resting<50 THEN '<50' WHEN resting<60 THEN '50-59' WHEN resting<70 THEN '60-69'
  WHEN resting<80 THEN '70-79' WHEN resting<90 THEN '80-89' ELSE '90+' END AS bucket,
  min(resting) AS ord, count(*) AS users FROM u GROUP BY 1 ORDER BY min(resting)"""))

hr["daily"] = recs(q("""SELECT strftime(d,'%Y-%m-%d') AS date, round(avg(bpm_number),1) AS avg_bpm,
  count(DISTINCT user_id) AS users FROM rclean GROUP BY d ORDER BY d"""))
OUT["hr"] = hr
print("hr", time.time()-t0, flush=True)

# =====================================================================
# CLUSTERS
# =====================================================================
clusters = {}

# ---- Card spending clusters ----
cards = q(f"""SELECT cardId, count(*) AS n_txns, count(DISTINCT txn_date) AS active_days,
  sum(amount)/100.0 AS total_sgd, avg(amount)/100.0 AS avg_sgd,
  avg(CASE WHEN extract(hour FROM txn_time) < 10 THEN 1.0 ELSE 0.0 END) AS morning_ratio
FROM {T} WHERE cardId IS NOT NULL GROUP BY 1 HAVING count(*) >= 3""")
feat = np.column_stack([
    np.log1p(cards["n_txns"]), np.log1p(cards["total_sgd"]),
    np.log1p(cards["avg_sgd"]), cards["morning_ratio"], np.log1p(cards["active_days"])])
Xs = StandardScaler().fit_transform(feat)
km = KMeans(n_clusters=4, n_init=10, random_state=42).fit(Xs)
cards["cluster"] = km.labels_
summ = cards.groupby("cluster").agg(
    cards=("cardId","count"), avg_txns=("n_txns","mean"), avg_days=("active_days","mean"),
    avg_total=("total_sgd","mean"), avg_ticket=("avg_sgd","mean"), morning=("morning_ratio","mean")).reset_index()
clusters["cards_summary"] = recs(summ.round(2))
samp = cards.sample(n=min(3000,len(cards)), random_state=1)
clusters["cards_scatter"] = recs(samp[["n_txns","total_sgd","cluster"]].round(2))
clusters["cards_excluded"] = int(q(f"SELECT count(*) FROM (SELECT cardId FROM {T} WHERE cardId IS NOT NULL GROUP BY 1 HAVING count(*) < 3)").iloc[0,0])

# ---- Health user clusters (steps + HR joined on user_id) ----
users = q("""
WITH s AS (SELECT user_id, avg(steps) AS avg_steps, avg(kcal) AS avg_kcal,
    avg(active_min) AS avg_active_min, count(*) AS active_days
  FROM hdaily WHERE steps <= 80000 GROUP BY 1),
 rest AS (SELECT user_id, avg(day_low) AS resting_hr, avg(avg_b) AS avg_hr FROM (
    SELECT user_id, d, min(lowest_bpm) AS day_low, avg(bpm_number) AS avg_b
    FROM rclean WHERE lowest_bpm BETWEEN 30 AND 150 GROUP BY 1,2) GROUP BY 1)
SELECT s.user_id, s.avg_steps, s.avg_kcal, s.avg_active_min, s.active_days, rest.resting_hr, rest.avg_hr
FROM s JOIN rest USING (user_id)
WHERE s.active_days >= 5""")
OUT["cross_users_joined"] = int(len(users))
uf = users.dropna(subset=["avg_steps","resting_hr","avg_hr"]).copy()
feat2 = np.column_stack([np.log1p(uf["avg_steps"]), uf["resting_hr"], uf["avg_hr"],
                         np.log1p(uf["active_days"])])
Xs2 = StandardScaler().fit_transform(feat2)
km2 = KMeans(n_clusters=4, n_init=10, random_state=42).fit(Xs2)
uf["cluster"] = km2.labels_
summ2 = uf.groupby("cluster").agg(
    users=("user_id","count"), avg_steps=("avg_steps","mean"), resting_hr=("resting_hr","mean"),
    avg_hr=("avg_hr","mean"), active_days=("active_days","mean")).reset_index()
clusters["users_summary"] = recs(summ2.round(1))
samp2 = uf.sample(n=min(3000,len(uf)), random_state=1)
clusters["users_scatter"] = recs(samp2[["avg_steps","resting_hr","cluster"]].round(1))

# correlations
r1 = float(np.corrcoef(uf["avg_steps"], uf["resting_hr"])[0,1])
r2 = float(np.corrcoef(uf["avg_steps"], uf["avg_hr"])[0,1])
r3 = float(np.corrcoef(np.log1p(cards["n_txns"]), cards["avg_sgd"])[0,1])
clusters["correlations"] = {
    "steps_vs_resting_hr": round(r1,3), "steps_vs_avg_hr": round(r2,3),
    "txn_freq_vs_avg_ticket": round(r3,3), "n_users_hr_steps": int(len(uf))}
OUT["clusters"] = clusters
print("clusters", time.time()-t0, flush=True)

# =====================================================================
# CROSS-DATASET (aggregate rhythms)
# =====================================================================
cross = {}
cross["hourly"] = {
    "txn": recs(q(f"SELECT extract(hour FROM txn_time) AS hour, count(*) AS n FROM {T} WHERE dayofweek(txn_date) NOT IN (0,6) GROUP BY 1 ORDER BY 1")),
    "steps": recs(q("SELECT extract(hour FROM ts) AS hour, sum(steps) AS n FROM hclean WHERE dayofweek(ts) NOT IN (0,6) GROUP BY 1 ORDER BY 1")),
    "bpm": recs(q("SELECT hour, round(avg(bpm_number),1) AS bpm FROM rclean WHERE dayofweek(d) NOT IN (0,6) GROUP BY 1 ORDER BY 1")),
}
cross["weekday"] = {
    "txn": recs(q(f"SELECT dayofweek(txn_date) AS dow, count(*)/count(DISTINCT txn_date) AS per_day FROM {T} GROUP BY 1 ORDER BY 1")),
    "steps": recs(q("SELECT dayofweek(d) AS dow, round(avg(steps),0) AS avg_steps FROM hdaily WHERE steps<=80000 GROUP BY 1 ORDER BY 1")),
    "bpm": recs(q("SELECT dayofweek(d) AS dow, round(avg(bpm_number),1) AS avg_bpm FROM rclean GROUP BY 1 ORDER BY 1")),
}
OUT["cross"] = cross
print("cross", time.time()-t0, flush=True)

with open(os.path.join(HERE, "insights.json"), "w") as f:
    json.dump(OUT, f, default=str)
print("WROTE insights.json", time.time()-t0)
