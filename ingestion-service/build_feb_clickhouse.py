#!/usr/bin/env python3
"""Load the Feb-2026 working set into the SHARED ClickHouse, database `smartbuddy`.

Replaces the old DuckDB build: the SAM agent (via smartbuddy-mcp) now runs NL->SQL over ClickHouse
instead of a shipped .duckdb file. Runs as a CONTAINER on the platform `backend` network — the
shared `clickhouse` instance is internal-only, so this cannot run from a workstation.

Flow: transform the Feb parquets in DuckDB IN-MEMORY (reusing analysis/taxonomy.py + the same PII
hashing + student-traffic filter as the analysis pipeline), then push each table into ClickHouse.
It also (as the ClickHouse admin) creates the `smartbuddy` database and a DEDICATED READ-ONLY user
that the MCP connects as — so the agent's arbitrary SQL can only SELECT from `smartbuddy`, never
touch the other demos' raw UWB/camera tables on the shared instance.

Tables (MergeTree, NO TTL — this is a permanent historical month):
  feb_txn feb_health feb_heart_rate txn_perf_202602 schools stall_category
Views: tx (student-traffic filter over feb_txn), stallcat (over stall_category).

Env:
  CLICKHOUSE_URL            http://clickhouse:8123
  CLICKHOUSE_ADMIN_USER     superuser that can CREATE DATABASE/USER (the shared instance's admin)
  CLICKHOUSE_ADMIN_PASSWORD
  CLICKHOUSE_DB             smartbuddy
  CLICKHOUSE_RO_USER        smartbuddy_ro   (created here; the MCP connects as this)
  CLICKHOUSE_RO_PASSWORD    (created here)
  SB_ID_SALT                optional (pin hashed tokens across rebuilds; else ephemeral)
  SB_PARQUET_DIR            default /data/analysis/parquet
  SB_SCHOOL_GEO             default /data/analysis/school_geo.json
  SB_ANALYSIS_DIR           default /data/analysis  (for taxonomy.py import)
"""
from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

import duckdb
import pandas as pd
import clickhouse_connect

# ── config ───────────────────────────────────────────────────────────────────
ANALYSIS_DIR = Path(os.environ.get("SB_ANALYSIS_DIR", "/data/analysis"))
PARQUET = Path(os.environ.get("SB_PARQUET_DIR", str(ANALYSIS_DIR / "parquet")))
SCHOOL_GEO = Path(os.environ.get("SB_SCHOOL_GEO", str(ANALYSIS_DIR / "school_geo.json")))

CH_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_ADMIN_USER = os.environ.get("CLICKHOUSE_ADMIN_USER", "")
CH_ADMIN_PASSWORD = os.environ.get("CLICKHOUSE_ADMIN_PASSWORD", "")
CH_DB = os.environ.get("CLICKHOUSE_DB", "smartbuddy")
RO_USER = os.environ.get("CLICKHOUSE_RO_USER", "smartbuddy_ro")
RO_PASSWORD = os.environ.get("CLICKHOUSE_RO_PASSWORD", "")

# taxonomy.py is the single source of truth for stall classification (v2)
sys.path.insert(0, str(ANALYSIS_DIR))
from taxonomy import STALLCAT_SQL  # noqa: E402

# student-traffic gate (must match analyze_*/build_* — same as the DuckDB build)
TX_FILTER = "schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000"

# PII: replace personal ids with one-way salted-hash tokens BEFORE they reach ClickHouse.
_SALT_FROM_ENV = bool(os.environ.get("SB_ID_SALT"))
SALT = os.environ.get("SB_ID_SALT") or secrets.token_hex(16)

def _hash(col: str) -> str:
    return (
        f"CASE WHEN {col} IS NULL THEN NULL "
        f"ELSE 'sb_' || substr(sha256(concat('{SALT}', CAST({col} AS VARCHAR))), 1, 16) END"
    )

SOURCES = {
    "feb_txn": (PARQUET / "feb_txn.parquet", f"* REPLACE ({_hash('cardId')} AS cardId)"),
    "feb_health": (PARQUET / "feb_health.parquet", f"* REPLACE ({_hash('user_id')} AS user_id)"),
    "feb_heart_rate": (PARQUET / "feb_heart_rate.parquet",
                       f"* REPLACE ({_hash('user_id')} AS user_id, {_hash('sync_id')} AS sync_id)"),
    "txn_perf_202602": (PARQUET / "txn_perf_202602.parquet", "*"),
}
# Raw/analytical tables (for the SAM agent) + small playback-aggregate tables (for sb-api).
DATA_TABLES = [*SOURCES.keys(), "schools", "stall_category",
               "pb_schools", "pb_school_daily", "pb_wearable_daily"]
BATCH = 50_000


def ch_type(duck_type: str) -> str:
    """Map a DuckDB column type to a Nullable ClickHouse type."""
    t = duck_type.upper()
    if "TIMESTAMP" in t:
        return "Nullable(DateTime64(3))"
    if "DATE" in t and "TIME" not in t:
        return "Nullable(Date)"
    if t.startswith("TIME"):                     # DuckDB TIME → no CH TIME type → String
        return "Nullable(String)"
    if "BOOL" in t:
        return "Nullable(UInt8)"
    if any(k in t for k in ("BIGINT", "HUGEINT", "INT64", "UBIGINT")):
        return "Nullable(Int64)"
    if any(k in t for k in ("INT", "SMALLINT", "TINYINT")):
        return "Nullable(Int64)"
    if any(k in t for k in ("DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC")):
        return "Nullable(Float64)"
    return "Nullable(String)"                     # VARCHAR/TEXT/UUID/BLOB/...


def coerce(value, ch_col_type: str):
    """Coerce a DuckDB Python value to what clickhouse-connect expects for the column type."""
    if value is None:
        return None
    if "String" in ch_col_type:
        return str(value)
    if "Int" in ch_col_type or "UInt" in ch_col_type:
        return int(value)
    if "Float" in ch_col_type:
        return float(value)
    return value  # Date / DateTime64 → keep native date/datetime


def main() -> int:
    missing = [str(p) for p in [*[s for s, _ in SOURCES.values()], SCHOOL_GEO] if not p.exists()]
    if missing:
        print("ERROR: missing inputs:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1
    if not CH_ADMIN_USER or not RO_PASSWORD:
        print("ERROR: set CLICKHOUSE_ADMIN_USER/PASSWORD (to create db+user) and CLICKHOUSE_RO_PASSWORD.",
              file=sys.stderr)
        return 1

    # 1) Build the working set in DuckDB in-memory (hash PII at load, exactly like the old build).
    print(f"  (personal ids hashed with {'SB_ID_SALT' if _SALT_FROM_ENV else 'an ephemeral per-build salt'})")
    con = duckdb.connect()
    for name, (path, proj) in SOURCES.items():
        con.execute(f"CREATE TABLE {name} AS SELECT {proj} FROM read_parquet(?)", [str(path)])
        print(f"  {name:18s} {con.table(name).shape[0]:>10,} rows")
    geo = json.loads(SCHOOL_GEO.read_text(encoding="utf-8"))
    schools_df = pd.DataFrame([{"schoolId": k, **v} for k, v in geo.items()])
    con.register("schools_df", schools_df)
    con.execute("CREATE TABLE schools AS SELECT * FROM schools_df")
    con.unregister("schools_df")
    con.execute(f"CREATE VIEW tx AS SELECT * FROM feb_txn WHERE {TX_FILTER}")
    con.execute(STALLCAT_SQL)                       # CREATE VIEW stallcat AS ... (reads tx)
    con.execute("CREATE TABLE stall_category AS SELECT * FROM stallcat")
    print(f"  {'schools':18s} {con.table('schools').shape[0]:>10,} rows")
    print(f"  {'stall_category':18s} {con.table('stall_category').shape[0]:>10,} rows")

    # Small PLAYBACK aggregate tables — the sb-api read API serves the dashboard's Playback window
    # from these (trivial SELECTs) so it never runs heavy aggregation on the shared instance. Same
    # source + logic as the analysis pipeline (build_feb_app_data.py), computed here in DuckDB.
    con.execute("""CREATE TABLE pb_schools AS
      SELECT t.schoolId AS school_id, any_value(s.name) AS name, CAST(round(sum(t.amount)/100.0,0) AS BIGINT) AS sgd
      FROM tx t LEFT JOIN schools s USING (schoolId) GROUP BY t.schoolId""")
    con.execute("""CREATE TABLE pb_school_daily AS
      SELECT schoolId AS school_id, txn_date AS date, CAST(count(*) AS INTEGER) AS txns,
             round(sum(amount)/100.0, 2) AS revenue_sgd
      FROM tx GROUP BY schoolId, txn_date""")
    con.execute("""CREATE TABLE pb_wearable_daily AS
      WITH h AS (SELECT user_id, steps, CAST(to_timestamp(recorded_time) AS DATE) AS d
                 FROM feb_health WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000),
           ud AS (SELECT user_id, d, sum(steps) AS st FROM h GROUP BY user_id, d)
      SELECT d AS date, CAST(count(*) AS INTEGER) AS active_users,
             CAST(round(avg(st)) AS INTEGER) AS avg_steps, CAST(round(median(st)) AS INTEGER) AS med_steps
      FROM ud WHERE d BETWEEN DATE '2026-02-01' AND DATE '2026-02-28' GROUP BY d""")
    for pb in ("pb_schools", "pb_school_daily", "pb_wearable_daily"):
        print(f"  {pb:18s} {con.table(pb).shape[0]:>10,} rows")

    # 2) Connect to ClickHouse as ADMIN and (re)create the database.
    u = urlparse(CH_URL)
    admin = clickhouse_connect.get_client(
        host=u.hostname, port=u.port or 8123, username=CH_ADMIN_USER, password=CH_ADMIN_PASSWORD,
        secure=(u.scheme == "https"),
    )
    admin.command(f"CREATE DATABASE IF NOT EXISTS {CH_DB}")

    # 3) Recreate + load each table (MergeTree, NO TTL — permanent history).
    for name in DATA_TABLES:
        schema = con.execute(f"DESCRIBE {name}").fetchall()   # (col, type, ...)
        cols = [r[0] for r in schema]
        types = {r[0]: ch_type(r[1]) for r in schema}
        ddl_cols = ",\n  ".join(f"`{c}` {types[c]}" for c in cols)
        admin.command(f"DROP TABLE IF EXISTS {CH_DB}.{name}")
        admin.command(f"CREATE TABLE {CH_DB}.{name} (\n  {ddl_cols}\n) ENGINE = MergeTree ORDER BY tuple()")
        cur = con.execute(f"SELECT * FROM {name}")
        total = 0
        while True:
            rows = cur.fetchmany(BATCH)
            if not rows:
                break
            data = [[coerce(v, types[cols[i]]) for i, v in enumerate(row)] for row in rows]
            admin.insert(f"{CH_DB}.{name}", data, column_names=cols)
            total += len(rows)
        print(f"  -> ClickHouse {CH_DB}.{name:18s} {total:>10,} rows")

    # 4) Views: tx (student-traffic filter) + stallcat (alias of stall_category).
    admin.command(f"CREATE OR REPLACE VIEW {CH_DB}.tx AS SELECT * FROM {CH_DB}.feb_txn WHERE {TX_FILTER}")
    admin.command(f"CREATE OR REPLACE VIEW {CH_DB}.stallcat AS SELECT * FROM {CH_DB}.stall_category")

    # 5) Dedicated READ-ONLY user for the MCP. The SELECT-only grant (and NO other grant) is the real
    #    enforcement: this user can only SELECT from `smartbuddy` — no writes/DDL anywhere, no access
    #    to other databases or the raw UWB/camera tables, no table functions (url/file). We do NOT pin
    #    `readonly=1` on the user (that would forbid the MCP from setting its per-query time/memory
    #    caps); the MCP raises readonly=2 itself (read-only data + tunable limits).
    admin.command(f"CREATE USER IF NOT EXISTS {RO_USER} IDENTIFIED BY '{RO_PASSWORD}'")
    admin.command(f"GRANT SELECT ON {CH_DB}.* TO {RO_USER}")
    print(f"  -> read-only user {RO_USER} granted SELECT on {CH_DB}.* (SELECT-only; no other grants)")

    verify(admin)
    con.close()
    return 0


def verify(client) -> None:
    print("\n=== verification (as the MCP read-only user will see it) ===")
    for t in DATA_TABLES:
        n = client.command(f"SELECT count() FROM {CH_DB}.{t}")
        print(f"  {t:18s} {int(n):>10,}")
    cov = client.query(
        f"SELECT sc.mcat AS mcat, count() AS txns, round(sum(t.amount)/100.0,0) AS revenue_sgd "
        f"FROM {CH_DB}.tx t JOIN {CH_DB}.stallcat sc USING (schoolId, storeId) "
        f"GROUP BY sc.mcat ORDER BY txns DESC"
    )
    print("\n--- verified-name category coverage (Feb) ---")
    for row in cov.result_rows:
        print(f"  {str(row[0]):22s} {int(row[1]):>9,}  ${float(row[2]):>12,.0f}")
    print("\nOK -> ClickHouse database", CH_DB)


if __name__ == "__main__":
    raise SystemExit(main())
