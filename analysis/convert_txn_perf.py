"""Build txn_perf.parquet — per-transaction speed components + signal/network.

Closes the documented reproducibility gap (PIPELINE.md §5): this parquet was previously
produced by an ad-hoc session snippet. Timing columns are milliseconds.

Usage:  python convert_txn_perf.py            # full Feb-Apr period
        python convert_txn_perf.py 2026-02    # one month only (writes txn_perf_<tag>.parquet)
"""
import duckdb, os, sys, time

BASE = r"c:\Users\STYLSG\Downloads\Smart Buddy Dashboard"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "parquet")
os.makedirs(OUT, exist_ok=True)

month = sys.argv[1] if len(sys.argv) > 1 else None
where = f"WHERE strftime(txn_date,'%Y-%m') = '{month}'" if month else ""
name = f"txn_perf_{month.replace('-','')}" if month else "txn_perf"

con = duckdb.connect()
con.sql("SET timezone='Asia/Singapore'")
t0 = time.time()
con.sql(f"""
COPY (
  SELECT id, terminalId, schoolId, storeId, txn_date, txn_time, paymentType, paymentMode,
         TRY_CAST(tapCardToFinish AS BIGINT)   AS tapCardToFinish,
         TRY_CAST(checkSignal AS BIGINT)       AS checkSignal,
         TRY_CAST(openSocket AS BIGINT)        AS openSocket,
         TRY_CAST(handshake AS BIGINT)         AS handshake,
         TRY_CAST(sendToReceiveData AS BIGINT) AS sendToReceiveData,
         TRY_CAST(startToFinish AS BIGINT)     AS startToFinish,
         TRY_CAST(posSignalStrength AS INTEGER) AS posSignalStrength,
         posNetworkType,
         TRY_CAST(readerSignalStrength AS INTEGER) AS readerSignalStrength
  FROM read_csv('{BASE}/txn/txn_*.csv', header=true, nullstr='NULL',
                types={{'txn_date':'DATE','txn_time':'TIME','amount':'BIGINT',
                        'timestamp':'BIGINT','errorCode':'VARCHAR','netsErrorCode':'VARCHAR',
                        'cardId':'VARCHAR','stampValue':'BIGINT'}})
  {where}
) TO '{OUT}/{name}.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
n = con.sql(f"SELECT count(*) FROM '{OUT}/{name}.parquet'").fetchall()[0][0]
print(f"WROTE {name}.parquet  {n:,} rows  {time.time()-t0:.0f}s")
