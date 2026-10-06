#!/usr/bin/env python3
"""Shared, month-aware loader for the SMART Buddy ClickHouse `smartbuddy` database.

Used by BOTH the chunked upload HTTP service (app.py) and any one-shot/CLI load. A single dataset
file (Parquet/CSV) is transformed IN DUCKDB (streamed from disk — never fully in RAM), personal ids
are replaced with salted-hash tokens (`sb_…`) and free-text names are dropped, then the rows are
loaded into a STAGING table and swapped into the live table's month partition with an atomic
`ALTER TABLE … REPLACE PARTITION` — so re-loading a month never disturbs the other months.

Design choices (deliberate, for a shared VM):
  • Every fact table carries a `month` String column ('2026-02') and is `PARTITION BY month`.
    Replacing a month is O(that month) and atomic; querying all months is one table.
  • Schema is inferred from the file and reconciled onto the table (new columns added Nullable),
    so Feb and March files that differ in shape both load without a hand-written schema.
  • Aggregates the dashboard/agent read (`tx`, `stallcat`, `pb_*`) are rebuilt from ALL months.
  • Connects as a WRITE user scoped to `smartbuddy.*` (never admin, never other demos' tables).

PII policy (must match analysis pipeline): hash id columns one-way; drop personal NAME columns.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import duckdb
import clickhouse_connect

# ── config ───────────────────────────────────────────────────────────────────
CH_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_DB = os.environ.get("CLICKHOUSE_DB", "smartbuddy")
CH_USER = os.environ.get("CLICKHOUSE_USER", "smartbuddy_rw")
CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")
SB_ID_SALT = os.environ.get("SB_ID_SALT", "")   # pin to keep tokens stable across loads/months
BATCH = 50_000
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

# student-traffic gate — identical to analyze_*/build_* (keeps `tx` == the analysis working set).
# schoolId exclusions: 'STYL' (test terminal), 'PBS' (Pacific Bookstores — a ~156-school bookshop
# concessionaire, not a school), 'SSSTM' (Self-Serve-Stamps — same pattern) — see
# analysis/school_moe_map.csv (category='non_school') and reload/MAP_EXPANSION_DEPLOY.md. Without
# this, GROUP BY schoolId sums a vendor's revenue across every school it operates in into one fake
# "school", which outranks any real school in spend rankings (root cause of the PBS-on-top bug).
# NON_SCHOOL is shared with build_insights.py so the dashboard bundles can't drift from `tx` again.
NON_SCHOOL = "('STYL', 'PBS', 'SSSTM')"
TX_FILTER = f"schoolId NOT IN {NON_SCHOOL} AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000"

# one-way hash these pseudonymous id columns wherever they appear (needed for aggregate analysis);
# DROP these direct student-identity columns entirely — never loaded, not even as a token.
HASH_COLS = {"cardId", "user_id", "sync_id"}
DROP_COLS = {"studentName", "studentId"}

# per-txn network-speed columns — split out of a wide transactions file into `txn_perf`
PERF_COLS = [
    "tapCardToFinish", "checkSignal", "openSocket", "handshake", "sendToReceiveData",
    "startToFinish", "posSignalStrength", "posNetworkType", "posCellBand", "posAccessTech",
    "readerSignalStrength", "readerCellBand", "readerAccessTech",
]

# ── dataset registry ─────────────────────────────────────────────────────────
# Each dataset maps ONE uploaded file to one or more target tables via a column selector:
#   include: 'all' | list of columns to KEEP        exclude: columns to DROP
#   require: columns that MUST be present (validation)   skip_unless: keep target only if ≥1 present
# `months` documents which months carry it (informational; the loader doesn't enforce it).
DATASETS: dict[str, dict] = {
    "transactions": {
        "label": "Canteen transactions",
        "months": "Feb + March",
        "hint": "card/student ids hashed, names dropped; also fills txn_perf; rebuilds tx + Playback.",
        "targets": [
            {"table": "txn", "exclude": PERF_COLS, "require": ["schoolId", "amount", "txn_date"]},
            # txn_perf carries the dimensions it's queried by (so speed views need no join back to txn)
            {"table": "txn_perf", "skip_unless": PERF_COLS,
             "include": ["id", "schoolId", "terminalId", "txn_date", "paymentMode", "paymentType",
                         "errorCode", *PERF_COLS]},
        ],
        "rebuild": ["stall_category", "tx", "stallcat", "pb_school_daily", "pb_schools"],
    },
    "txn_perf": {                                  # Feb ships network speed as its own file
        "label": "Transaction network speed",
        "months": "Feb",
        "hint": "no personal ids; per-transaction speed components (ms).",
        "targets": [{"table": "txn_perf", "include": "all", "require": ["id"]}],
        "rebuild": [],
    },
    "health": {
        "label": "Wearable activity (30-min)",
        "months": "Feb",
        "hint": "user ids hashed; rebuilds wearable Playback.",
        "targets": [{"table": "health", "include": "all", "require": ["user_id", "recorded_time"]}],
        "rebuild": ["pb_wearable_daily"],
    },
    "heart_rate": {
        "label": "Heart rate (hourly)",
        "months": "Feb",
        "hint": "user_id + sync_id hashed.",
        "targets": [{"table": "heart_rate", "include": "all", "require": ["user_id", "bpm_number"]}],
        "rebuild": [],
    },
    "items": {
        "label": "Student purchase items",
        "months": "March",
        "hint": "student id hashed, name dropped; line-item nutrition (calories, healthyChoice).",
        "targets": [{"table": "items", "include": "all", "require": ["itemName"]}],
        "rebuild": [],
    },
    "saving_spending": {
        "label": "Student saving vs spending",
        "months": "March",
        "hint": "user id hashed; monthly saving + spending totals per student.",
        "targets": [{"table": "saving_spending", "include": "all", "require": ["user_id"]}],
        "rebuild": [],
    },
    "schools": {
        "label": "School dimension (MOE)",
        "months": "dimension (shared)",
        "hint": "no personal ids; school metadata (level/zone/lat/lng).",
        "targets": [{"table": "schools", "include": "all", "require": ["schoolId"]}],
        "rebuild": [],
    },
}


def dataset_info() -> list[dict]:
    return [{"id": k, "label": v["label"], "months": v["months"], "hint": v["hint"]}
            for k, v in DATASETS.items()]


# ── ClickHouse helpers ─────────────────────────────────────────────────────────
def get_client(user: str | None = None, password: str | None = None):
    u = urlparse(CH_URL)
    return clickhouse_connect.get_client(
        host=u.hostname, port=u.port or 8123, username=user or CH_USER,
        password=password if password is not None else CH_PASSWORD,
        secure=(u.scheme == "https"), database=CH_DB,
    )


def ch_type(duck_type: str) -> str:
    """DuckDB column type → Nullable ClickHouse type (same mapping as the original builder)."""
    t = duck_type.upper()
    if "TIMESTAMP" in t:
        return "Nullable(DateTime64(3))"
    if "DATE" in t and "TIME" not in t:
        return "Nullable(Date)"
    if t.startswith("TIME"):
        return "Nullable(String)"
    if "BOOL" in t:
        return "Nullable(UInt8)"
    if any(k in t for k in ("BIGINT", "HUGEINT", "INT64", "UBIGINT")):
        return "Nullable(Int64)"
    if any(k in t for k in ("INT", "SMALLINT", "TINYINT")):
        return "Nullable(Int64)"
    if any(k in t for k in ("DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC")):
        return "Nullable(Float64)"
    return "Nullable(String)"


def coerce(value, ch_col_type: str):
    if value is None:
        return None
    if "String" in ch_col_type:
        return str(value)
    if "Int" in ch_col_type or "UInt" in ch_col_type:
        return int(value)
    if "Float" in ch_col_type:
        return float(value)
    return value


def _hash_sql(col: str, salt: str) -> str:
    # DuckDB sha256 of salt||value → short token. NULL stays NULL. Matches build_feb_clickhouse.py.
    s = salt.replace("'", "''")
    return (f"CASE WHEN \"{col}\" IS NULL THEN NULL "
            f"ELSE 'sb_' || substr(sha256(concat('{s}', CAST(\"{col}\" AS VARCHAR))), 1, 16) END")


def _existing_columns(client, table: str) -> dict[str, str]:
    rows = client.query(
        "SELECT name, type FROM system.columns WHERE database=%(d)s AND table=%(t)s",
        parameters={"d": CH_DB, "t": table},
    ).result_rows
    return {r[0]: r[1] for r in rows}


def _table_exists(client, table: str) -> bool:
    return bool(client.command(
        "SELECT count() FROM system.tables WHERE database=%(d)s AND name=%(t)s",
        parameters={"d": CH_DB, "t": table},
    ))


# ── the loader ─────────────────────────────────────────────────────────────────
def load_dataset(file_path: str, dataset: str, month: str, *, client=None,
                 salt: str | None = None, on_progress=None, mode: str = "replace",
                 rebuild: bool = True) -> dict:
    """Load one dataset file into `month`'s partition of its target table(s). Returns a summary.

    mode='replace' (default) atomically swaps the month partition (wiping any prior rows for that
    month); mode='append' adds the file's rows to the month partition — used to load a dataset that
    ships as several source files (e.g. Feb health/heart_rate come in 6 parts each): upload the first
    with 'replace' and the rest with 'append'. Set rebuild=False on all-but-the-last file of a batch
    to skip the (repeated) aggregate rebuild until the final file.
    """
    if mode not in ("replace", "append"):
        raise ValueError("mode must be 'replace' or 'append'.")
    if dataset not in DATASETS:
        raise ValueError(f"Unknown dataset '{dataset}'. One of: {', '.join(DATASETS)}.")
    if not MONTH_RE.match(month or ""):
        raise ValueError(f"Bad month '{month}'. Expected YYYY-MM, e.g. 2026-03.")
    salt = salt if salt is not None else SB_ID_SALT
    client = client or get_client()
    spec = DATASETS[dataset]
    ext = Path(file_path).suffix.lower()
    if ext not in (".parquet", ".csv"):
        raise ValueError("File must be .parquet or .csv.")

    def prog(phase, **kw):
        if on_progress:
            on_progress({"phase": phase, **kw})

    con = duckdb.connect()
    con.execute("SET timezone='Asia/Singapore'")
    # Bound RAM and spill to the same (volume) disk as the file — a multi-GB CSV must not blow up
    # memory on the shared VM. temp_directory sits next to the assembled upload.
    con.execute(f"SET memory_limit='{os.environ.get('SB_DUCKDB_MEMORY', '512MB')}'")
    con.execute(f"SET temp_directory='{Path(file_path).resolve().parent.as_posix()}'")
    # inline the path (DuckDB can't bind a parameter inside CREATE VIEW / a table function in DDL)
    fp = str(file_path).replace("'", "''")
    reader = f"read_parquet('{fp}')" if ext == ".parquet" else f"read_csv_auto('{fp}', sample_size=-1)"
    con.execute(f"CREATE OR REPLACE VIEW src AS SELECT * FROM {reader}")
    src_cols = [r[0] for r in con.execute("DESCRIBE src").fetchall()]

    loaded = []
    for tgt in spec["targets"]:
        table = tgt["table"]
        # 1) resolve which source columns go into this target
        if tgt.get("include", "all") == "all":
            cols = [c for c in src_cols if c not in tgt.get("exclude", [])]
        else:
            cols = [c for c in tgt["include"] if c in src_cols]
        cols = [c for c in cols if c not in DROP_COLS]
        # skip a target that has no meaningful column present (e.g. txn_perf split from a Feb file)
        gate = tgt.get("skip_unless")
        if gate and not any(c in src_cols for c in gate):
            continue
        missing = [c for c in tgt.get("require", []) if c not in src_cols]
        if missing:
            raise ValueError(
                f"File for '{dataset}' is missing required columns {missing} for table {table}. "
                f"Found: {', '.join(src_cols[:25])}{'…' if len(src_cols) > 25 else ''}.")

        # 2) projection: hash id cols, add the month literal
        m = month.replace("'", "")
        select_items = [f"'{m}' AS month"]
        for c in cols:
            select_items.append(f'{_hash_sql(c, salt)} AS "{c}"' if c in HASH_COLS else f'"{c}"')
        con.execute(f"CREATE OR REPLACE VIEW proj AS SELECT {', '.join(select_items)} FROM src")
        schema = con.execute("DESCRIBE proj").fetchall()          # [(col, ducktype, ...), ...]
        out_cols = [r[0] for r in schema]
        types = {r[0]: ch_type(r[1]) for r in schema}
        types["month"] = "String"

        rows = _load_projection(con, client, table, out_cols, types, m, prog, mode=mode)
        loaded.append({"table": table, "rows": rows})

        # 3) transactions also derive the per-stall food category (taxonomy) for this month
        if dataset == "transactions" and table == "txn":
            _load_stall_category(con, client, m, prog, mode=mode)

    con.close()

    rebuilt = _rebuild(client, spec.get("rebuild", []), prog) if rebuild else []
    return {"dataset": dataset, "month": month,
            "tables": loaded, "rebuilt": rebuilt,
            "rows": sum(t["rows"] for t in loaded)}


def _load_projection(con, client, table, out_cols, types, month, prog, *, view="proj",
                     mode="replace") -> int:
    """Create/reconcile `table`, stage the projected rows, then swap into `month`'s partition.

    mode='replace' → atomic ALTER … REPLACE PARTITION (wipes the month first);
    mode='append'  → INSERT the staged rows into the month partition (adds to it).
    """
    quoted = ",\n  ".join(f"`{c}` {types[c]}" for c in out_cols)
    if not _table_exists(client, table):
        client.command(
            f"CREATE TABLE {CH_DB}.{table} (\n  {quoted}\n) "
            f"ENGINE = MergeTree PARTITION BY month ORDER BY tuple()")
    else:
        have = _existing_columns(client, table)
        for c in out_cols:
            if c not in have:
                client.command(f"ALTER TABLE {CH_DB}.{table} ADD COLUMN IF NOT EXISTS `{c}` {types[c]}")

    stg = f"_stg_{table}_{month.replace('-', '')}"
    client.command(f"DROP TABLE IF EXISTS {CH_DB}.{stg}")
    client.command(f"CREATE TABLE {CH_DB}.{stg} AS {CH_DB}.{table}")   # identical structure + partition
    try:
        prog("loading", table=table, rows=0)
        cur = con.execute(f"SELECT {', '.join(out_cols)} FROM {view}")
        total = 0
        while True:
            batch = cur.fetchmany(BATCH)
            if not batch:
                break
            data = [[coerce(v, types[out_cols[i]]) for i, v in enumerate(row)] for row in batch]
            client.insert(f"{CH_DB}.{stg}", data, column_names=out_cols)
            total += len(batch)
            prog("loading", table=table, rows=total)
        if mode == "append":
            client.command(f"INSERT INTO {CH_DB}.{table} SELECT * FROM {CH_DB}.{stg}")
        else:
            client.command(f"ALTER TABLE {CH_DB}.{table} REPLACE PARTITION '{month}' FROM {CH_DB}.{stg}")
        return total
    finally:
        client.command(f"DROP TABLE IF EXISTS {CH_DB}.{stg}")


def _load_stall_category(con, client, month, prog, *, mode="replace"):
    """Derive stall food-category (shared taxonomy v2) from the just-loaded transactions file."""
    from taxonomy import STALLCAT_SQL
    con.execute(f"CREATE OR REPLACE VIEW tx AS SELECT * FROM src WHERE {TX_FILTER}")
    con.execute(STALLCAT_SQL)                                      # → view stallcat over tx
    con.execute(f"CREATE OR REPLACE VIEW sc_proj AS SELECT '{month}' AS month, * FROM stallcat")
    schema = con.execute("DESCRIBE sc_proj").fetchall()
    out_cols = [r[0] for r in schema]
    types = {r[0]: ch_type(r[1]) for r in schema}
    types["month"] = "String"
    _load_projection(con, client, "stall_category", out_cols, types, month, prog,
                     view="sc_proj", mode=mode)


# ── aggregate rebuilds (recomputed across ALL months; small tables/views) ────────
def _rebuild(client, names, prog) -> list[str]:
    done = []
    for name in names:
        prog("rebuilding", table=name)
        try:
            for stmt in REBUILD[name]:
                client.command(stmt.format(db=CH_DB, flt=TX_FILTER))
            done.append(name)
        except Exception as e:                         # best-effort: the raw load already succeeded
            prog("rebuild_warn", table=name, error=str(e).splitlines()[0])
    return done


REBUILD: dict[str, list[str]] = {
    "tx": ["CREATE OR REPLACE VIEW {db}.tx AS SELECT * FROM {db}.txn WHERE {flt}"],
    "stallcat": ["CREATE OR REPLACE VIEW {db}.stallcat AS SELECT * FROM {db}.stall_category"],
    "stall_category": [],  # loaded per-month inside the transactions path; nothing to rebuild here
    "pb_school_daily": [
        "DROP TABLE IF EXISTS {db}.pb_school_daily",
        "CREATE TABLE {db}.pb_school_daily (month String, school_id String, date Date, "
        "  txns Int32, revenue_sgd Float64) ENGINE=MergeTree PARTITION BY month ORDER BY tuple()",
        "INSERT INTO {db}.pb_school_daily SELECT month, schoolId, txn_date, toInt32(count()), "
        "  round(sum(amount)/100.0,2) FROM {db}.tx GROUP BY month, schoolId, txn_date",
    ],
    "pb_schools": [
        "DROP TABLE IF EXISTS {db}.pb_schools",
        "CREATE TABLE {db}.pb_schools (month String, school_id String, name Nullable(String), "
        "  sgd Int64) ENGINE=MergeTree PARTITION BY month ORDER BY tuple()",
        "INSERT INTO {db}.pb_schools SELECT t.month, t.schoolId, any(s.name), "
        "  toInt64(round(sum(t.amount)/100.0)) FROM {db}.tx t "
        "  LEFT JOIN {db}.schools s USING (schoolId) GROUP BY t.month, t.schoolId",
    ],
    "pb_wearable_daily": [
        "DROP TABLE IF EXISTS {db}.pb_wearable_daily",
        "CREATE TABLE {db}.pb_wearable_daily (month String, date Date, active_users Int32, "
        "  avg_steps Int32, med_steps Int32) ENGINE=MergeTree PARTITION BY month ORDER BY tuple()",
        ("INSERT INTO {db}.pb_wearable_daily WITH ud AS ("
         "  SELECT month, user_id, toDate(toDateTime(recorded_time)) AS d, sum(steps) AS st "
         "  FROM {db}.health WHERE data_type IN (0,1) AND calories<=500000 AND steps<=4000 "
         "  GROUP BY month, user_id, d) "
         "SELECT month, d, toInt32(count()), toInt32(round(avg(st))), toInt32(round(quantile(0.5)(st))) "
         "FROM ud GROUP BY month, d"),
    ],
}


if __name__ == "__main__":   # CLI: python ingest_core.py <dataset> <month> <file> [mode] [rebuild]
    if len(sys.argv) < 4:
        print("usage: ingest_core.py <dataset> <YYYY-MM> <file.parquet|csv> [replace|append] [rebuild 0/1]",
              file=sys.stderr)
        raise SystemExit(2)
    _md = sys.argv[4] if len(sys.argv) > 4 else "replace"
    _rb = (sys.argv[5] != "0") if len(sys.argv) > 5 else True   # NOT _rebuild — that's a module fn
    out = load_dataset(sys.argv[3], sys.argv[1], sys.argv[2], mode=_md, rebuild=_rb)
    print(out)
