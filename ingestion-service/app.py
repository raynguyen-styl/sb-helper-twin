#!/usr/bin/env python3
"""smartbuddy-ingest — HTTP ingest service for the dashboard "Upload data" tab.

Accepts a Parquet/CSV upload, transforms it in DuckDB (PII ids -> salted-hash tokens), REPLACES the
target table in the shared ClickHouse `smartbuddy` database, and rebuilds the affected Playback
aggregate tables. Connects as the dedicated WRITE user smartbuddy_rw (SELECT/INSERT/CREATE/DROP on
`smartbuddy.*` only — never admin, never other demos' tables). Gated by Keycloak at the client nginx
(/smartbuddy-ingest/ auth_request); optionally restricted to admin roles via SB_INGEST_ALLOWED_ROLES.

Shares the ingestion-service image with the one-shot builder (build_feb_clickhouse.py); the compose
`smartbuddy-ingest` service overrides CMD to run this via uvicorn.
"""
from __future__ import annotations

import os
import secrets
import tempfile
from urllib.parse import urlparse

import duckdb
import clickhouse_connect
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request

CH_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_DB = os.environ.get("CLICKHOUSE_DB", "smartbuddy")
CH_USER = os.environ.get("CLICKHOUSE_USER", "smartbuddy_rw")
CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")
SALT = os.environ.get("SB_ID_SALT") or secrets.token_hex(16)
MAX_MB = int(os.environ.get("SB_INGEST_MAX_MB", "512"))
# Optional: comma-separated Keycloak roles allowed to ingest (matched against X-Auth-Roles from the
# proxy). Empty = allow any request the nginx Keycloak gate let through.
ALLOWED_ROLES = {r.strip().lower() for r in os.environ.get("SB_INGEST_ALLOWED_ROLES", "").split(",") if r.strip()}

TX_FILTER = "schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000"

# Per-dataset: PII id columns to hash · minimal required columns (validation) · pb_* to rebuild.
DATASETS = {
    "feb_txn":         {"pii": ["cardId"],            "keys": ["schoolId", "amount", "txn_date"], "rebuild": ["tx", "pb_school_daily", "pb_schools"]},
    "feb_health":      {"pii": ["user_id"],           "keys": ["user_id", "steps", "recorded_time"], "rebuild": ["pb_wearable_daily"]},
    "feb_heart_rate":  {"pii": ["user_id", "sync_id"], "keys": ["user_id", "bpm_number"], "rebuild": []},
    "txn_perf_202602": {"pii": [],                    "keys": [], "rebuild": []},
    "schools":         {"pii": [],                    "keys": ["schoolId"], "rebuild": []},
}
BATCH = 50_000

app = FastAPI(title="smartbuddy-ingest")


def _hash(col: str) -> str:
    return (f"CASE WHEN {col} IS NULL THEN NULL "
            f"ELSE 'sb_' || substr(sha256(concat('{SALT}', CAST({col} AS VARCHAR))), 1, 16) END")


def ch_type(t: str) -> str:
    t = t.upper()
    if "TIMESTAMP" in t: return "Nullable(DateTime64(3))"
    if "DATE" in t and "TIME" not in t: return "Nullable(Date)"
    if t.startswith("TIME"): return "Nullable(String)"
    if "BOOL" in t: return "Nullable(UInt8)"
    if any(k in t for k in ("BIGINT", "HUGEINT", "INT64", "UBIGINT")): return "Nullable(Int64)"
    if any(k in t for k in ("INT", "SMALLINT", "TINYINT")): return "Nullable(Int64)"
    if any(k in t for k in ("DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC")): return "Nullable(Float64)"
    return "Nullable(String)"


def coerce(v, t: str):
    if v is None: return None
    if "String" in t: return str(v)
    if "Int" in t or "UInt" in t: return int(v)
    if "Float" in t: return float(v)
    return v


def ch_client():
    u = urlparse(CH_URL)
    return clickhouse_connect.get_client(host=u.hostname, port=u.port or 8123, username=CH_USER,
                                         password=CH_PASSWORD, secure=(u.scheme == "https"), database=CH_DB)


REBUILD = {
    "tx": ["CREATE OR REPLACE VIEW {db}.tx AS SELECT * FROM {db}.feb_txn WHERE " + TX_FILTER],
    "pb_school_daily": [
        "DROP TABLE IF EXISTS {db}.pb_school_daily",
        "CREATE TABLE {db}.pb_school_daily (school_id String, date Date, txns Int32, revenue_sgd Float64) ENGINE=MergeTree ORDER BY tuple()",
        "INSERT INTO {db}.pb_school_daily SELECT schoolId, txn_date, toInt32(count()), round(sum(amount)/100.0,2) FROM {db}.tx GROUP BY schoolId, txn_date",
    ],
    "pb_schools": [
        "DROP TABLE IF EXISTS {db}.pb_schools",
        "CREATE TABLE {db}.pb_schools (school_id String, name Nullable(String), sgd Int64) ENGINE=MergeTree ORDER BY tuple()",
        "INSERT INTO {db}.pb_schools SELECT t.schoolId, any(s.name), toInt64(round(sum(t.amount)/100.0)) FROM {db}.tx t LEFT JOIN {db}.schools s USING (schoolId) GROUP BY t.schoolId",
    ],
    "pb_wearable_daily": [
        "DROP TABLE IF EXISTS {db}.pb_wearable_daily",
        "CREATE TABLE {db}.pb_wearable_daily (date Date, active_users Int32, avg_steps Int32, med_steps Int32) ENGINE=MergeTree ORDER BY tuple()",
        ("INSERT INTO {db}.pb_wearable_daily WITH ud AS ("
         "SELECT user_id, toDate(toDateTime(recorded_time)) AS d, sum(steps) AS st FROM {db}.feb_health "
         "WHERE data_type IN (0,1) AND calories<=500000 AND steps<=4000 GROUP BY user_id, d) "
         "SELECT d, toInt32(count()), toInt32(round(avg(st))), toInt32(round(quantile(0.5)(st))) "
         "FROM ud WHERE d BETWEEN toDate('2026-02-01') AND toDate('2026-02-28') GROUP BY d"),
    ],
}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/datasets")
def datasets():
    return {"datasets": [{"id": k, "pii": v["pii"], "required": v["keys"], "rebuilds": v["rebuild"]} for k, v in DATASETS.items()]}


@app.post("/ingest")
async def ingest(request: Request, file: UploadFile = File(...), dataset: str = Form(...), mode: str = Form("replace")):
    if ALLOWED_ROLES:
        roles = {r.strip().lower() for r in (request.headers.get("x-auth-roles", "")).split(",") if r.strip()}
        if not (roles & ALLOWED_ROLES):
            raise HTTPException(403, "Not permitted: this account lacks an ingest role.")
    if dataset not in DATASETS:
        raise HTTPException(400, f"Unknown dataset '{dataset}'. One of: {', '.join(DATASETS)}.")
    spec = DATASETS[dataset]
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".parquet", ".csv"):
        raise HTTPException(400, "File must be .parquet or .csv.")

    # stream to a temp file with a size cap
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    size = 0
    try:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_MB * 1024 * 1024:
                raise HTTPException(413, f"File too large (> {MAX_MB} MB). Use ch-ingest for bulk loads.")
            tmp.write(chunk)
        tmp.close()

        con = duckdb.connect()
        reader = "read_parquet(?)" if ext == ".parquet" else "read_csv_auto(?)"
        con.execute(f"CREATE VIEW src AS SELECT * FROM {reader}", [tmp.name])
        cols = [r[0] for r in con.execute("DESCRIBE src").fetchall()]
        missing = [k for k in spec["keys"] if k not in cols]
        if missing:
            raise HTTPException(400, f"File is missing required columns for '{dataset}': {', '.join(missing)}. Found: {', '.join(cols[:20])}.")

        # project: hash the PII id columns that are present
        pii = [c for c in spec["pii"] if c in cols]
        proj = ("* REPLACE (" + ", ".join(f"{_hash(c)} AS {c}" for c in pii) + ")") if pii else "*"
        con.execute(f"CREATE VIEW proj AS SELECT {proj} FROM src")
        schema = con.execute("DESCRIBE proj").fetchall()
        pcols = [r[0] for r in schema]
        types = {r[0]: ch_type(r[1]) for r in schema}

        client = ch_client()
        client.command(f"CREATE DATABASE IF NOT EXISTS {CH_DB}")
        ddl = ",\n  ".join(f"`{c}` {types[c]}" for c in pcols)
        client.command(f"DROP TABLE IF EXISTS {CH_DB}.{dataset}")
        client.command(f"CREATE TABLE {CH_DB}.{dataset} (\n  {ddl}\n) ENGINE = MergeTree ORDER BY tuple()")

        cur = con.execute("SELECT * FROM proj")
        total = 0
        while rows := cur.fetchmany(BATCH):
            data = [[coerce(v, types[pcols[i]]) for i, v in enumerate(row)] for row in rows]
            client.insert(f"{CH_DB}.{dataset}", data, column_names=pcols)
            total += len(rows)
        con.close()

        rebuilt, warnings = [], []
        for t in spec["rebuild"]:
            try:
                for stmt in REBUILD[t]:
                    client.command(stmt.format(db=CH_DB))
                rebuilt.append(t)
            except Exception as e:  # best-effort; loading the table already succeeded
                warnings.append(f"{t}: {str(e).splitlines()[0]}")

        out = {"status": "ok", "dataset": dataset, "table": f"{CH_DB}.{dataset}", "rows": total, "rebuilt": rebuilt}
        if warnings:
            out["hint"] = "Loaded, but some rebuilds failed (run ch-ingest for a full refresh): " + "; ".join(warnings)
        return out
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
