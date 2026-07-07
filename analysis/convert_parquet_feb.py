"""Convert the February 2026 Smart Buddy CSVs to Parquet.

Feb health/HR files differ from the May drops: comma-separated, fully quoted
(May files are TAB-separated) — same columns, same 'NULL' strings.
Also cuts a Feb-only transaction parquet so the dashboard compares the same days.
"""
import duckdb, os, time

BASE = r"c:\Users\STYLSG\Downloads\Smart Buddy Dashboard"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "parquet")
os.makedirs(OUT, exist_ok=True)

con = duckdb.connect()
con.sql("SET timezone='Asia/Singapore'")

t0 = time.time()

# ---------------- Health (activity intervals) ----------------
con.sql(f"""
COPY (
  SELECT id, user_id, steps, calories, distances, recorded_time, uploaded_time,
         data_type, wearable_name, tz,
         CASE WHEN raw LIKE '{{%' THEN 1 ELSE 0 END AS raw_is_json,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.active_time') AS INTEGER) AS active_time
  FROM read_csv('{BASE}/health data/health_data_202602_part*.csv',
                header=true, nullstr='NULL')
) TO '{OUT}/feb_health.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(f"feb_health done {time.time()-t0:.0f}s", flush=True)

# ---------------- Heart rate (hourly summaries, sync-keyed) ----------------
con.sql(f"""
COPY (
  SELECT id, user_id, bpm_number, recorded_time, uploaded_time, wearable_name, tz, sync_id,
         CASE WHEN raw LIKE '{{%' THEN 1 ELSE 0 END AS raw_is_json,
         json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.date') AS hr_date,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.hour') AS INTEGER) AS hr_hour,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.lowest_bpm') AS INTEGER) AS lowest_bpm,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.highest_bpm') AS INTEGER) AS highest_bpm,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.avg_bpm') AS INTEGER) AS avg_bpm,
         json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.firmware_version') AS firmware_version
  FROM read_csv('{BASE}/health data/heart_rate_202602_part*.csv',
                header=true, nullstr='NULL')
) TO '{OUT}/feb_heart_rate.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(f"feb_heart_rate done {time.time()-t0:.0f}s", flush=True)

# ---------------- Transactions, February only ----------------
con.sql(f"""
COPY (
  SELECT id, terminalId, type, txn_date, txn_time, timestamp, amount,
         storeId, storeName, schoolId, readerId, cardId, cardType,
         stampValue, sofType, paymentType, errorCode, netsErrorCode,
         paymentMode, paymentStatus,
         TRY_CAST(startToFinish AS BIGINT) AS startToFinish,
         TRY_CAST(posSignalStrength AS INTEGER) AS posSignalStrength,
         posNetworkType,
         TRY_CAST(readerSignalStrength AS INTEGER) AS readerSignalStrength
  FROM read_csv('{BASE}/txn/txn_*.csv', header=true, nullstr='NULL',
                types={{'txn_date':'DATE','txn_time':'TIME','amount':'BIGINT',
                        'timestamp':'BIGINT','errorCode':'VARCHAR','netsErrorCode':'VARCHAR',
                        'cardId':'VARCHAR','stampValue':'BIGINT'}})
  WHERE txn_date BETWEEN '2026-02-01' AND '2026-02-28'
) TO '{OUT}/feb_txn.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(f"feb_txn done {time.time()-t0:.0f}s", flush=True)
print("ALL DONE")
