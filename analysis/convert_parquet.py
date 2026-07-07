"""Convert Smart Buddy CSVs to Parquet for fast repeated querying."""
import duckdb, os, time

BASE = r"c:\Users\STYLSG\Downloads\Smart Buddy Dashboard"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "parquet")
os.makedirs(OUT, exist_ok=True)

con = duckdb.connect()
con.sql("SET timezone='Asia/Singapore'")

t0 = time.time()

# ---------------- Health ----------------
con.sql(f"""
COPY (
  SELECT id, user_id, steps, calories, distances, recorded_time, uploaded_time,
         data_type, wearable_name, tz,
         CASE WHEN raw LIKE '{{%' THEN 1 ELSE 0 END AS raw_is_json,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.active_time') AS INTEGER) AS active_time
  FROM read_csv('{BASE}/health data/20260629_tbl_health_data_May2026.csv',
                delim='\\t', header=true, nullstr='NULL')
) TO '{OUT}/health.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(f"health done {time.time()-t0:.0f}s", flush=True)

# ---------------- Heart rate ----------------
con.sql(f"""
COPY (
  SELECT id, user_id, bpm_number, recorded_time, uploaded_time, wearable_name, tz,
         CASE WHEN raw LIKE '{{%' THEN 1 ELSE 0 END AS raw_is_json,
         json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.date') AS hr_date,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.hour') AS INTEGER) AS hr_hour,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.lowest_bpm') AS INTEGER) AS lowest_bpm,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.highest_bpm') AS INTEGER) AS highest_bpm,
         TRY_CAST(json_extract_string(CASE WHEN raw LIKE '{{%' THEN raw END, '$.avg_bpm') AS INTEGER) AS avg_bpm
  FROM read_csv('{BASE}/health data/20260629_tbl_heart_rate_May2026.csv',
                delim='\\t', header=true, nullstr='NULL')
) TO '{OUT}/heart_rate.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(f"heart_rate done {time.time()-t0:.0f}s", flush=True)

# ---------------- Transactions ----------------
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
) TO '{OUT}/txn.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(f"txn done {time.time()-t0:.0f}s", flush=True)
print("ALL DONE")
