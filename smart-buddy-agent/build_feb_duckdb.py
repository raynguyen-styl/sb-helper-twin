#!/usr/bin/env python3
"""Build the read-only DuckDB store the SMART Buddy SAM agent queries.

One-shot: turns the Feb-2026 Parquet working set into a single `feb.duckdb` file.
The agent (via the smartbuddy-mcp adapter) opens this file READ_ONLY and runs
NL->SQL over it. See PLAN_SAM_AGENT.md §3.1.

Tables (full raw Feb rows — real cardId/terminalId/user_id are present):
  feb_txn            3,977,666 canteen transactions (Feb 2026)
  feb_health         activity intervals (steps/calories/distances, 30-min)
  feb_heart_rate     hourly HR summaries (bpm_number/avg_bpm + firmware_version)
  txn_perf_202602    per-txn speed components + signal/network
  schools            158 MOE-matched schools (name/type/level/zone/lat/lng)
Views / derived:
  tx                 feb_txn filtered to student traffic (the analysis base view)
  stallcat           per-stall verified-name food category (taxonomy v2) — materialized

Run:  python build_feb_duckdb.py            (writes ./data/feb.duckdb)
Idempotent: the output file is rebuilt from scratch each run.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

import duckdb
import pandas as pd

# ── paths (script lives in <repo>/smart-buddy-agent/) ────────────────────────
HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PARQUET = REPO / "analysis" / "parquet"
SCHOOL_GEO = REPO / "analysis" / "school_geo.json"
OUT_DIR = HERE / "data"
OUT_DB = OUT_DIR / "feb.duckdb"

# taxonomy.py is the single source of truth for the stall classification (v2)
sys.path.insert(0, str(REPO / "analysis"))
from taxonomy import STALLCAT_SQL  # noqa: E402

# ── transaction base filter (must match analyze_*/build_* — the analysis gate) ─
TX_FILTER = (
    "schoolId != 'STYL' "                    # vendor bench-test terminals
    "AND storeName NOT ILIKE '%retrieve%' "  # card-retrieval / maintenance flows
    "AND amount <= 20000"                     # cents -> drop > $200 outliers
)

# ── PII anonymisation ─────────────────────────────────────────────────────────
# The agent must never be able to emit a real customer identifier. We replace the
# personal ids (cardId, user_id, sync_id) with a one-way salted-hash TOKEN before
# they ever enter feb.duckdb. Grouping/counting still works (distinct tokens ⇔
# distinct cards/users) but the real 16-digit CEPAS card / wearable id is gone.
#
# The salt is EPHEMERAL by default (a fresh random value per build, never stored),
# so the tokens are irreversible even to us — you cannot brute-force a card number
# without the salt. Set SB_ID_SALT to pin a stable salt if you ever need tokens to
# match across rebuilds (they still never reveal the source id).
_SALT_FROM_ENV = bool(os.environ.get("SB_ID_SALT"))
SALT = os.environ.get("SB_ID_SALT") or secrets.token_hex(16)

def _hash(col: str) -> str:
    """SQL expression: NULL-safe salted-hash token for an id column (any type)."""
    return (
        f"CASE WHEN {col} IS NULL THEN NULL "
        f"ELSE 'sb_' || substr(sha256(concat('{SALT}', CAST({col} AS VARCHAR))), 1, 16) END"
    )

# name -> (parquet path, SELECT projection). REPLACE swaps only the id columns;
# every other column passes through untouched.
SOURCES = {
    "feb_txn": (PARQUET / "feb_txn.parquet", f"* REPLACE ({_hash('cardId')} AS cardId)"),
    "feb_health": (PARQUET / "feb_health.parquet", f"* REPLACE ({_hash('user_id')} AS user_id)"),
    "feb_heart_rate": (PARQUET / "feb_heart_rate.parquet",
                       f"* REPLACE ({_hash('user_id')} AS user_id, {_hash('sync_id')} AS sync_id)"),
    "txn_perf_202602": (PARQUET / "txn_perf_202602.parquet", "*"),  # no personal ids
}


def main() -> int:
    # preflight: every source must exist (fail loud, don't build a half DB)
    src_paths = [path for (path, _) in SOURCES.values()]
    missing = [str(p) for p in [*src_paths, SCHOOL_GEO] if not p.exists()]
    if missing:
        print("ERROR: missing inputs:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if OUT_DB.exists():
        OUT_DB.unlink()  # rebuild from scratch
    # also clear the WAL if a crashed run left one
    wal = OUT_DB.with_suffix(".duckdb.wal")
    if wal.exists():
        wal.unlink()

    # Build in memory, then COPY FROM DATABASE into a fresh on-disk file. This
    # avoids the free-block churn a direct on-disk build leaves behind (which
    # otherwise ~doubles the file), so feb.duckdb lands compact (~300 MB).
    con = duckdb.connect()

    # 1) Feb tables from Parquet, with personal ids replaced by salted-hash tokens
    #    at load time (cardId/user_id/sync_id) — see _hash / SOURCES above.
    print(f"  (personal ids hashed with {'SB_ID_SALT' if _SALT_FROM_ENV else 'an ephemeral per-build salt'})")
    for name, (path, proj) in SOURCES.items():
        con.execute(
            f"CREATE TABLE {name} AS SELECT {proj} FROM read_parquet(?)", [str(path)]
        )
        print(f"  {name:18s} {con.table(name).shape[0]:>10,} rows")

    # 2) schools dimension from the geocoded MOE match (dict keyed by schoolId)
    geo = json.loads(SCHOOL_GEO.read_text(encoding="utf-8"))
    schools_df = pd.DataFrame([{"schoolId": k, **v} for k, v in geo.items()])
    con.register("schools_df", schools_df)
    con.execute("CREATE TABLE schools AS SELECT * FROM schools_df")
    con.unregister("schools_df")
    print(f"  {'schools':18s} {con.table('schools').shape[0]:>10,} rows")

    # 3) the analysis base view (student traffic only) + the stall taxonomy
    con.execute(f"CREATE VIEW tx AS SELECT * FROM feb_txn WHERE {TX_FILTER}")
    con.execute(STALLCAT_SQL)  # CREATE VIEW stallcat AS ... (reads `tx`)
    # materialize the taxonomy so the agent joins a fast table, not a regex view,
    # and it shows up in list_tables. Then drop the transient view.
    con.execute("CREATE TABLE stall_category AS SELECT * FROM stallcat")
    con.execute("DROP VIEW stallcat")
    con.execute("CREATE VIEW stallcat AS SELECT * FROM stall_category")
    print(f"  {'stallcat (view)':18s} {con.table('stall_category').shape[0]:>10,} stalls")

    # flush the fully-built in-memory database into a compact on-disk file
    # (ATTACH takes no bind params; use a quoted posix path — safe with spaces)
    out_lit = str(OUT_DB.as_posix()).replace("'", "''")
    con.execute(f"ATTACH '{out_lit}' AS feb")
    con.execute("COPY FROM DATABASE memory TO feb")
    con.execute("DETACH feb")
    con.close()
    verify()
    return 0


def verify() -> None:
    """Reopen READ_ONLY (exactly as the MCP will) and sanity-check."""
    con = duckdb.connect(str(OUT_DB), read_only=True)
    print("\n=== verification (opened READ_ONLY, as the MCP will) ===")
    tables = con.execute(
        "SELECT table_name, table_type FROM information_schema.tables "
        "WHERE table_schema='main' ORDER BY table_name"
    ).fetchall()
    print("objects:", ", ".join(f"{t[0]}" for t in tables))

    # row counts
    for t in ["feb_txn", "feb_health", "feb_heart_rate", "txn_perf_202602",
              "schools", "stall_category"]:
        n = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"  {t:18s} {n:>10,}")

    # sample analysis queries (prove the joins + taxonomy work)
    print("\n--- sample: verified-name category coverage (Feb) ---")
    q = """
      SELECT sc.mcat,
             count(*)                             AS txns,
             round(100.0*count(*)/sum(count(*)) OVER (), 1) AS pct,
             round(sum(t.amount)/100.0, 0)        AS revenue_sgd
      FROM tx t JOIN stallcat sc USING (schoolId, storeId)
      GROUP BY sc.mcat ORDER BY txns DESC
    """
    for row in con.execute(q).fetchall():
        print(f"  {row[0]:22s} {row[1]:>9,}  {row[2]:>5}%  ${row[3]:>12,.0f}")

    print("\n--- sample: top 5 schools by txn volume (with MOE type) ---")
    q2 = """
      SELECT t.schoolId, any_value(s.name) AS name, any_value(s.type) AS moe_type,
             count(*) AS txns
      FROM tx t LEFT JOIN schools s USING (schoolId)
      GROUP BY t.schoolId ORDER BY txns DESC LIMIT 5
    """
    for row in con.execute(q2).fetchall():
        print(f"  {row[0]:8s} {str(row[1])[:34]:34s} {str(row[2])[:20]:20s} {row[3]:>8,}")

    print("\n--- sample: heart-rate mean (Feb, 30<=bpm<=220, excludes 255 sentinel) ---")
    q3 = """
      SELECT count(*) AS readings, round(avg(bpm_number), 1) AS mean_bpm,
             count(DISTINCT user_id) AS users
      FROM feb_heart_rate
      WHERE bpm_number BETWEEN 30 AND 220
        AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
    """
    r = con.execute(q3).fetchone()
    print(f"  readings={r[0]:,}  mean={r[1]} bpm  users={r[2]:,}")

    print("\n--- PII check: personal ids are salted-hash tokens (no real card/user id in the DB) ---")
    sample = con.execute("SELECT cardId FROM feb_txn WHERE cardId IS NOT NULL LIMIT 1").fetchone()
    print(f"  feb_txn.cardId sample token: {sample[0]}")
    ncard = con.execute("SELECT count(DISTINCT cardId) FROM feb_txn").fetchone()[0]
    nuser = con.execute("SELECT count(DISTINCT user_id) FROM feb_heart_rate").fetchone()[0]
    print(f"  distinct cardId tokens: {ncard:,}  |  distinct HR user_id tokens: {nuser:,}  (grouping preserved)")
    xover = con.execute(
        "SELECT count(*) FROM (SELECT DISTINCT user_id FROM feb_health "
        "INTERSECT SELECT DISTINCT user_id FROM feb_heart_rate)"
    ).fetchone()[0]
    print(f"  user_id tokens shared by health & heart_rate: {xover:,}  (cross-table user linkage preserved)")

    con.close()
    size_mb = OUT_DB.stat().st_size / 1e6
    print(f"\nOK -> {OUT_DB}  ({size_mb:.0f} MB)")


if __name__ == "__main__":
    raise SystemExit(main())
