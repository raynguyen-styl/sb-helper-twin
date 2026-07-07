"""Anomaly PATTERN mining — where do the anomalies concentrate, and why."""
import duckdb, json, os, time
HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect(); con.sql("SET timezone='Asia/Singapore'")
t0 = time.time(); OUT = {}
T = f"'{PQ}/txn.parquet'"; H = f"'{PQ}/health.parquet'"; R = f"'{PQ}/hr_fw.parquet'"
def q(s): return con.sql(s).df()
def recs(df): return json.loads(df.to_json(orient="records"))

# ================= T1: ERROR CODES =================
t1 = {}
t1["daily_rate"] = recs(q(f"""SELECT txn_date::VARCHAR AS date,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode!='0')/count(*),2) AS err_pct,
  count(*) FILTER (errorCode IS NOT NULL AND errorCode!='0') AS errors
FROM {T} GROUP BY 1 ORDER BY 1"""))
t1["hourly_rate"] = recs(q(f"""SELECT extract(hour FROM txn_time) AS hour,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode!='0')/count(*),2) AS err_pct, count(*) AS n
FROM {T} WHERE extract(hour FROM txn_time) BETWEEN 6 AND 17 GROUP BY 1 ORDER BY 1"""))
t1["code_by_paytype"] = recs(q(f"""
WITH e AS (SELECT errorCode, paymentType, count(*) AS n FROM {T}
  WHERE errorCode IS NOT NULL AND errorCode!='0' GROUP BY 1,2)
SELECT errorCode, paymentType, n FROM e
WHERE errorCode IN (SELECT errorCode FROM e GROUP BY 1 ORDER BY sum(n) DESC LIMIT 6)
  AND paymentType IN (SELECT paymentType FROM e GROUP BY 1 ORDER BY sum(n) DESC LIMIT 6)
ORDER BY errorCode, n DESC"""))
t1["terminal_concentration"] = recs(q(f"""
WITH t AS (SELECT terminalId, count(*) AS n,
    count(*) FILTER (errorCode IS NOT NULL AND errorCode!='0') AS errs FROM {T} GROUP BY 1)
SELECT count(*) AS n_terminals, sum(errs) AS total_errs,
  sum(errs) FILTER (rk <= ceil(0.05*(SELECT count(*) FROM t))) AS errs_top5pct_terminals,
  sum(errs) FILTER (rk <= ceil(0.01*(SELECT count(*) FROM t))) AS errs_top1pct_terminals
FROM (SELECT *, row_number() OVER (ORDER BY errs DESC) AS rk FROM t)"""))[0]
t1["worst_terminals"] = recs(q(f"""
SELECT terminalId, any_value(schoolId) AS school, count(*) AS n,
  count(*) FILTER (errorCode IS NOT NULL AND errorCode!='0') AS errs,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode!='0')/count(*),1) AS err_pct
FROM {T} GROUP BY 1 HAVING count(*)>=2000 ORDER BY err_pct DESC LIMIT 12"""))
t1["code_by_mode"] = recs(q(f"""SELECT errorCode, paymentMode, count(*) AS n FROM {T}
  WHERE errorCode IN ('240','130','253','147','34','37') GROUP BY 1,2 ORDER BY 1,2"""))
OUT["t1_errors"] = t1; print("t1", time.time()-t0, flush=True)

# ================= T2: WEEKEND / NIGHT =================
t2 = {}
t2["weekend_by_date"] = recs(q(f"""SELECT txn_date::VARCHAR AS date, count(*) AS n,
  count(DISTINCT schoolId) AS schools, round(sum(amount)/100.0,0) AS sgd
FROM {T} WHERE dayofweek(txn_date) IN (0,6) GROUP BY 1 HAVING count(*)>0 ORDER BY 1"""))
t2["weekend_top_schools"] = recs(q(f"""SELECT schoolId, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
  count(DISTINCT txn_date) AS days FROM {T} WHERE dayofweek(txn_date) IN (0,6)
GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
t2["night"] = recs(q(f"""SELECT extract(hour FROM txn_time) AS hour, count(*) AS n,
  round(avg(amount),1) AS avg_cents, count(DISTINCT terminalId) AS terminals,
  count(*) FILTER (amount<=10) AS micro
FROM {T} WHERE extract(hour FROM txn_time)>=20 OR extract(hour FROM txn_time)<5 GROUP BY 1 ORDER BY 1"""))
t2["night_terminals"] = recs(q(f"""SELECT terminalId, any_value(schoolId) AS school, count(*) AS n,
  round(avg(amount),1) AS avg_cents, min(txn_date)::VARCHAR AS first, max(txn_date)::VARCHAR AS last
FROM {T} WHERE extract(hour FROM txn_time)>=20 OR extract(hour FROM txn_time)<5
GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
OUT["t2_offhours"] = t2; print("t2", time.time()-t0, flush=True)

# ================= T3: HUGE AMOUNTS =================
t3 = {}
t3["top_txns"] = recs(q(f"""SELECT round(amount/100.0,2) AS sgd, storeName, schoolId,
  txn_date::VARCHAR AS date, txn_time::VARCHAR AS time, paymentType, cardType, paymentMode
FROM {T} ORDER BY amount DESC LIMIT 20"""))
t3["big_by_store"] = recs(q(f"""SELECT storeName, any_value(schoolId) AS school, count(*) AS n,
  round(max(amount)/100.0,0) AS max_sgd, round(sum(amount)/100.0,0) AS total_sgd
FROM {T} WHERE amount>20000 GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
t3["big_by_paytype"] = recs(q(f"""SELECT paymentType, count(*) AS n FROM {T} WHERE amount>20000 GROUP BY 1 ORDER BY n DESC"""))
t3["big_stats"] = recs(q(f"""SELECT count(*) AS n, count(DISTINCT storeName) AS stores,
  count(DISTINCT schoolId) AS schools, count(*) FILTER (paymentMode='OFFLINE') AS offline_n
FROM {T} WHERE amount>20000"""))[0]
OUT["t3_big"] = t3; print("t3", time.time()-t0, flush=True)

# ================= T4: MICRO AMOUNTS =================
t4 = {}
t4["by_value"] = recs(q(f"""SELECT amount AS cents, count(*) AS n FROM {T} WHERE amount<=10 GROUP BY 1 ORDER BY 1"""))
t4["by_store"] = recs(q(f"""SELECT storeName, any_value(schoolId) AS school, count(*) AS n, round(avg(amount),1) AS avg_cents
FROM {T} WHERE amount<=10 GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
t4["day_night"] = recs(q(f"""SELECT CASE WHEN extract(hour FROM txn_time)>=20 OR extract(hour FROM txn_time)<5
  THEN 'night' ELSE 'day' END AS period, count(*) AS n, round(avg(amount),2) AS avg_cents
FROM {T} WHERE amount<=10 GROUP BY 1"""))
OUT["t4_micro"] = t4; print("t4", time.time()-t0, flush=True)

# ================= T5: PENDING =================
OUT["t5_pending"] = {
 "by_date": recs(q(f"""SELECT txn_date::VARCHAR AS date, count(*) AS n, count(DISTINCT schoolId) AS schools
   FROM {T} WHERE paymentStatus='PENDING' GROUP BY 1 ORDER BY 1""")),
 "by_school": recs(q(f"""SELECT schoolId, count(*) AS n, round(sum(amount)/100.0,2) AS sgd
   FROM {T} WHERE paymentStatus='PENDING' GROUP BY 1 ORDER BY n DESC LIMIT 10"""))}
print("t5", time.time()-t0, flush=True)

# ================= T6: NULL cardId by payment type =================
OUT["t6_nullcard"] = recs(q(f"""SELECT paymentType, count(*) AS n,
  count(*) FILTER (cardId IS NULL) AS null_n,
  round(100.0*count(*) FILTER (cardId IS NULL)/count(*),1) AS null_pct
FROM {T} GROUP BY 1 HAVING count(*)>1000 ORDER BY null_pct DESC"""))
print("t6", time.time()-t0, flush=True)

# ================= T7: NEGATIVE SIGNAL =================
t7 = {}
t7["stats"] = recs(q(f"""SELECT count(*) AS neg_txns, count(DISTINCT terminalId) AS neg_terminals,
  (SELECT count(DISTINCT terminalId) FROM {T}) AS all_terminals,
  min(posSignalStrength) AS min_val, max(posSignalStrength) FILTER (posSignalStrength<0) AS max_neg
FROM {T} WHERE posSignalStrength < 0"""))[0]
t7["value_dist"] = recs(q(f"""SELECT posSignalStrength AS val, count(*) AS n FROM {T}
  WHERE posSignalStrength<0 GROUP BY 1 ORDER BY n DESC LIMIT 8"""))
t7["always_neg"] = recs(q(f"""
WITH t AS (SELECT terminalId, count(*) AS n, count(*) FILTER (posSignalStrength<0) AS neg,
  any_value(posNetworkType) AS net FROM {T} WHERE posSignalStrength IS NOT NULL GROUP BY 1)
SELECT count(*) FILTER (neg>0) AS terminals_with_neg,
  count(*) FILTER (neg>=0.95*n) AS terminals_always_neg,
  count(*) FILTER (neg>0 AND neg<0.95*n) AS terminals_sometimes_neg FROM t"""))[0]
t7["neg_by_net"] = recs(q(f"""SELECT posNetworkType, count(*) AS n FROM {T} WHERE posSignalStrength<0 GROUP BY 1 ORDER BY n DESC"""))
OUT["t7_signal"] = t7; print("t7", time.time()-t0, flush=True)

# ================= T8: SLOW TXNS =================
OUT["t8_slow"] = {
 "by_type": recs(q(f"""SELECT paymentType, paymentMode, count(*) AS n, round(max(startToFinish)/1000.0,0) AS max_s
   FROM {T} WHERE startToFinish>60000 GROUP BY 1,2 ORDER BY n DESC LIMIT 10""")),
 "by_school": recs(q(f"""SELECT schoolId, count(*) AS n FROM {T} WHERE startToFinish>60000 GROUP BY 1 ORDER BY n DESC LIMIT 8"""))}
print("t8", time.time()-t0, flush=True)

# ================= H1/H2: SENTINEL CALORIES & DISTANCES =================
h1 = {}
h1["cal_values"] = recs(q(f"""SELECT calories, count(*) AS n FROM {H} WHERE calories>500000 GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
h1["dist_values"] = recs(q(f"""SELECT distances, count(*) AS n FROM {H} WHERE distances>500000 GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
h1["overlap"] = recs(q(f"""SELECT count(*) FILTER (calories>500000) AS cal_rows,
  count(*) FILTER (distances>500000) AS dist_rows,
  count(*) FILTER (calories>500000 AND distances>500000) AS both_rows,
  count(DISTINCT wearable_name) FILTER (calories>500000 OR distances>500000) AS devices,
  count(DISTINCT user_id) FILTER (calories>500000 OR distances>500000) AS users
FROM {H}"""))[0]
h1["by_device"] = recs(q(f"""SELECT wearable_name, any_value(user_id) AS user_id, any_value(data_type) AS dt,
  count(*) AS anom_rows, min(to_timestamp(recorded_time))::DATE::VARCHAR AS first, max(to_timestamp(recorded_time))::DATE::VARCHAR AS last
FROM {H} WHERE calories>500000 OR distances>500000 GROUP BY 1 ORDER BY anom_rows DESC LIMIT 12"""))
h1["by_datatype"] = recs(q(f"""SELECT data_type, count(*) AS n FROM {H} WHERE calories>500000 OR distances>500000 GROUP BY 1 ORDER BY n DESC LIMIT 5"""))
h1["by_date"] = recs(q(f"""SELECT to_timestamp(recorded_time)::DATE::VARCHAR AS date, count(*) AS n
FROM {H} WHERE calories>500000 OR distances>500000 GROUP BY 1 ORDER BY 1"""))
OUT["h1_sentinels"] = h1; print("h1", time.time()-t0, flush=True)

# ================= H3: GARBAGE data_type =================
OUT["h3_datatype"] = {
 "rows": recs(q(f"""SELECT data_type, count(*) AS n, count(DISTINCT user_id) AS users FROM {H}
   WHERE data_type NOT IN (0,1) GROUP BY 1 ORDER BY n DESC LIMIT 15""")),
 "stats": recs(q(f"""SELECT count(*) AS n, count(DISTINCT user_id) AS users, count(DISTINCT wearable_name) AS devices,
   count(*) FILTER (raw_is_json=1) AS json_rows,
   count(*) FILTER (steps=0 AND calories=0 AND distances=0) AS all_zero
 FROM {H} WHERE data_type NOT IN (0,1)"""))[0]}
print("h3", time.time()-t0, flush=True)

# ================= H4: CLOCK SKEW =================
OUT["h4_skew"] = {
 "magnitude": recs(q(f"""SELECT CASE WHEN lag_h < 1 THEN '<1h' WHEN lag_h < 24 THEN '1-24h'
    WHEN lag_h < 24*7 THEN '1-7d' WHEN lag_h < 24*30 THEN '7-30d' ELSE '>30d' END AS bucket,
    count(*) AS n FROM (SELECT (recorded_time-uploaded_time)/3600.0 AS lag_h FROM {H}
    WHERE uploaded_time < recorded_time) GROUP BY 1 ORDER BY min(lag_h)""")),
 "stats": recs(q(f"""SELECT count(*) AS n, count(DISTINCT user_id) AS users,
    count(DISTINCT wearable_name) AS devices,
    count(*) FILTER (data_type=1) AS gen1, count(*) FILTER (data_type=0) AS gen0,
    round(max(recorded_time-uploaded_time)/86400.0,1) AS max_days
  FROM {H} WHERE uploaded_time < recorded_time"""))[0]}
print("h4", time.time()-t0, flush=True)

# ================= H5: TZ outliers =================
OUT["h5_tz"] = recs(q(f"""SELECT tz, count(*) AS n, count(DISTINCT user_id) AS users FROM {H}
  WHERE tz != 480 GROUP BY 1 ORDER BY n DESC LIMIT 10"""))
print("h5", time.time()-t0, flush=True)

# ================= H6: EXTREME STEP DAYS =================
OUT["h6_extreme"] = recs(q(f"""
SELECT user_id, d::VARCHAR AS date, day_steps, n_intervals, devices FROM (
  SELECT user_id, date_trunc('day', to_timestamp(recorded_time)) AS d, sum(steps) AS day_steps,
    count(*) AS n_intervals, count(DISTINCT wearable_name) AS devices
  FROM {H} GROUP BY 1,2) WHERE day_steps > 40000 ORDER BY day_steps DESC"""))
print("h6", time.time()-t0, flush=True)

# ================= R1/R2: HR SENSOR ERRORS by firmware/device =================
r1 = {}
r1["fw_rates"] = recs(q(f"""SELECT firmware, count(*) AS n,
  count(*) FILTER (bpm_number=255) AS bpm255,
  count(*) FILTER (bpm_number>200 AND bpm_number!=255) AS over200,
  count(*) FILTER (bpm_number<40) AS under40,
  count(DISTINCT wearable_name) AS devices,
  round(1e4*count(*) FILTER (bpm_number=255)/count(*),2) AS rate255_per10k,
  round(1e4*count(*) FILTER (bpm_number<40)/count(*),2) AS rate_under40_per10k
FROM {R} GROUP BY 1 ORDER BY n DESC"""))
r1["bad_devices"] = recs(q(f"""SELECT wearable_name, any_value(firmware) AS firmware, any_value(user_id) AS user_id,
  count(*) FILTER (bpm_number=255) AS bpm255, count(*) FILTER (bpm_number<40) AS under40, count(*) AS total
FROM {R} GROUP BY 1 HAVING count(*) FILTER (bpm_number=255 OR bpm_number<40) > 0
ORDER BY (count(*) FILTER (bpm_number=255)+count(*) FILTER (bpm_number<40)) DESC LIMIT 12"""))
r1["stats"] = recs(q(f"""SELECT count(DISTINCT wearable_name) FILTER (bpm_number=255) AS dev255,
  count(DISTINCT wearable_name) FILTER (bpm_number<40) AS dev_under40,
  count(DISTINCT wearable_name) AS all_devices FROM {R}"""))[0]
r1["by_hour"] = recs(q(f"""SELECT hr_hour AS hour, count(*) FILTER (bpm_number=255) AS bpm255,
  count(*) FILTER (bpm_number<40) AS under40, count(*) AS n
FROM {R} WHERE hr_hour IS NOT NULL GROUP BY 1 ORDER BY 1"""))
OUT["r1_sensor"] = r1; print("r1", time.time()-t0, flush=True)

# ================= R3: HR DUPLICATES =================
OUT["r3_dups"] = recs(q(f"""
WITH g AS (SELECT user_id, hr_date, hr_hour, count(*) AS c,
    count(DISTINCT bpm_number) AS distinct_bpm, count(DISTINCT sync_id) AS syncs
  FROM {R} GROUP BY 1,2,3 HAVING count(*)>1)
SELECT count(*) AS dup_groups, sum(c)-count(*) AS extra_rows,
  count(*) FILTER (distinct_bpm=1) AS identical_value_groups,
  count(*) FILTER (syncs>1) AS multi_sync_groups,
  count(DISTINCT user_id) AS users FROM g"""))[0]
print("r3", time.time()-t0, flush=True)

# ================= R4: BACKFILL STRUCTURE =================
r4 = {}
r4["lag_dist"] = recs(q(f"""SELECT CASE WHEN lag_d<=0 THEN 'same day' WHEN lag_d<=2 THEN '1-2 d'
   WHEN lag_d<=7 THEN '3-7 d' WHEN lag_d<=30 THEN '8-30 d' WHEN lag_d<=365 THEN '31-365 d'
   ELSE '>1 year' END AS bucket, count(*) AS n, min(lag_d) AS ord
FROM (SELECT date_diff('day', TRY_CAST(hr_date AS DATE), to_timestamp(recorded_time)::DATE) AS lag_d
  FROM {R} WHERE TRY_CAST(hr_date AS DATE) BETWEEN DATE '2000-01-01' AND DATE '2026-06-01')
GROUP BY 1 ORDER BY min(lag_d)"""))
r4["user_concentration"] = recs(q(f"""
WITH b AS (SELECT user_id, count(*) AS n FROM {R}
  WHERE TRY_CAST(hr_date AS DATE) < DATE '2026-04-01'
    AND TRY_CAST(hr_date AS DATE) >= DATE '2000-01-01' GROUP BY 1)
SELECT count(*) AS users_with_old_backfill, sum(n) AS old_rows,
  (SELECT sum(n) FROM (SELECT n FROM b ORDER BY n DESC LIMIT 100)) AS top100_rows FROM b"""))[0]
r4["flush_by_syncdate"] = recs(q(f"""SELECT to_timestamp(recorded_time)::DATE::VARCHAR AS sync_date, count(*) AS n
FROM {R} WHERE TRY_CAST(hr_date AS DATE) < DATE '2026-04-01' AND TRY_CAST(hr_date AS DATE) >= DATE '2000-01-01'
GROUP BY 1 ORDER BY 1"""))
OUT["r4_backfill"] = r4; print("r4", time.time()-t0, flush=True)

# ================= R5: IMPOSSIBLE DATES =================
OUT["r5_dates"] = recs(q(f"""SELECT hr_date, count(*) AS n, count(DISTINCT wearable_name) AS devices,
  any_value(firmware) AS firmware FROM {R}
WHERE hr_date IS NULL OR TRY_CAST(hr_date AS DATE) < DATE '2000-01-01' OR TRY_CAST(hr_date AS DATE) > DATE '2026-05-31'
GROUP BY 1 ORDER BY n DESC LIMIT 12"""))
print("r5", time.time()-t0, flush=True)

# ================= R6: 23:00 SPIKE =================
OUT["r6_hour23"] = recs(q(f"""SELECT hr_hour AS hour, count(*) AS n, round(avg(bpm_number),1) AS avg_bpm
FROM {R} WHERE bpm_number BETWEEN 30 AND 220 AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
  AND hr_hour IS NOT NULL GROUP BY 1 ORDER BY 1"""))
print("r6", time.time()-t0, flush=True)

# ================= X: CROSS-CUTTING =================
x = {}
x["repeat_offenders"] = recs(q(f"""
WITH hdev AS (SELECT wearable_name, count(*) AS health_sentinels FROM {H}
   WHERE calories>500000 OR distances>500000 GROUP BY 1),
 rdev AS (SELECT wearable_name, count(*) FILTER (bpm_number=255) AS hr255,
   count(*) FILTER (bpm_number<40) AS hr_low FROM {R}
   WHERE bpm_number=255 OR bpm_number<40 GROUP BY 1)
SELECT coalesce(h.wearable_name, r.wearable_name) AS device,
  coalesce(health_sentinels,0) AS health_sentinels, coalesce(hr255,0) AS hr255, coalesce(hr_low,0) AS hr_low
FROM hdev h FULL OUTER JOIN rdev r USING (wearable_name)
ORDER BY (coalesce(health_sentinels,0)+coalesce(hr255,0)+coalesce(hr_low,0)) DESC LIMIT 15"""))
x["overlap_counts"] = recs(q(f"""
WITH hdev AS (SELECT DISTINCT wearable_name FROM {H} WHERE calories>500000 OR distances>500000),
 rdev AS (SELECT DISTINCT wearable_name FROM {R} WHERE bpm_number=255 OR bpm_number<40)
SELECT (SELECT count(*) FROM hdev) AS health_devices, (SELECT count(*) FROM rdev) AS hr_devices,
  (SELECT count(*) FROM hdev JOIN rdev USING (wearable_name)) AS both_devices"""))[0]
# do users with >=1 extreme-high HR reading have higher resting HR? (sensor vs physiology)
x["elevated_link"] = recs(q(f"""
WITH rest AS (SELECT user_id, avg(day_low) AS resting FROM (
    SELECT user_id, TRY_CAST(hr_date AS DATE) AS d, min(lowest_bpm) AS day_low FROM {R}
    WHERE bpm_number BETWEEN 30 AND 220 AND lowest_bpm BETWEEN 30 AND 150
      AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-05-01' AND DATE '2026-05-31' GROUP BY 1,2) GROUP BY 1),
 bad AS (SELECT DISTINCT user_id FROM {R} WHERE bpm_number>200)
SELECT count(*) FILTER (b.user_id IS NOT NULL) AS users_with_spikes,
  round(avg(resting) FILTER (b.user_id IS NOT NULL),1) AS resting_spike_users,
  round(avg(resting) FILTER (b.user_id IS NULL),1) AS resting_others
FROM rest r LEFT JOIN bad b USING (user_id)"""))[0]
x["timeline"] = {
 "txn_err": recs(q(f"""SELECT txn_date::VARCHAR AS date, count(*) AS n FROM {T}
    WHERE errorCode IS NOT NULL AND errorCode!='0' GROUP BY 1 ORDER BY 1""")),
 "hr255_may": recs(q(f"""SELECT TRY_CAST(hr_date AS DATE)::VARCHAR AS date, count(*) AS n FROM {R}
    WHERE bpm_number=255 AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
    GROUP BY 1 ORDER BY 1"""))}
OUT["x_cross"] = x; print("x", time.time()-t0, flush=True)

with open(os.path.join(HERE, "anomaly_patterns.json"), "w") as f:
    json.dump(OUT, f, default=str)
print("WROTE anomaly_patterns.json", time.time()-t0)
