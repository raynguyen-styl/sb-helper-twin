#!/usr/bin/env python3
"""Build small, ANONYMISED aggregate CSVs for the SAM "Data Analysis" toolset.

Path A: SAM cannot reach our DuckDB via a connector, so the agent instead queries
an uploaded artifact. We upload only SUMMARY tables — no card ids, no individuals,
no raw transactions — so nothing customer-level ever leaves the VM. Money is
pre-converted to SGD dollars so the agent never has to remember the cents rule.

Reads the read-only feb.duckdb built by build_feb_duckdb.py; writes CSVs to ./artifacts/.
Run:  python build_feb_aggregates.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
DB = HERE / "data" / "feb.duckdb"
OUT = HERE / "artifacts"

# Each entry: filename -> SELECT. All money already ÷100 → *_sgd. All Feb-2026.
QUERIES = {
    # 1) one row per school — spend, ticket, quality, speed, distinct cards (hashed tokens)
    "schools_summary.csv": """
        SELECT t.schoolId,
               any_value(s.name)  AS name,
               any_value(s.type)  AS moe_type,
               any_value(s.level) AS level,
               any_value(s.zone)  AS zone,
               count(*)                                              AS txns,
               round(sum(t.amount)/100.0, 2)                         AS total_sgd,
               round(avg(t.amount)/100.0, 2)                         AS avg_ticket_sgd,
               count(DISTINCT t.cardId)                              AS distinct_cards,
               round(100.0*count(*) FILTER (WHERE t.errorCode IS NOT NULL AND t.errorCode <> '0')/count(*), 1) AS err_pct,
               round(100.0*count(*) FILTER (WHERE t.paymentMode = 'OFFLINE')/count(*), 1)                       AS offline_pct,
               round(median(t.startToFinish) FILTER (WHERE t.startToFinish > 0))                                AS median_speed_ms
        FROM tx t LEFT JOIN schools s USING (schoolId)
        GROUP BY t.schoolId
        ORDER BY total_sgd DESC
    """,
    # 2) one row per verified-name food category (incl. Unclassified) — coverage + shares
    "category_coverage.csv": """
        SELECT sc.mcat,
               count(DISTINCT sc.storeId)                            AS n_stalls,
               count(*)                                              AS txns,
               round(100.0*count(*)/sum(count(*)) OVER (), 1)        AS pct_txns,
               round(sum(t.amount)/100.0, 2)                         AS revenue_sgd,
               round(100.0*sum(t.amount)/sum(sum(t.amount)) OVER (), 1) AS pct_revenue
        FROM tx t JOIN stallcat sc USING (schoolId, storeId)
        GROUP BY sc.mcat
        ORDER BY txns DESC
    """,
    # 3) one row per day — revenue series incl. the CNY window (16-18 Feb)
    "daily.csv": """
        SELECT txn_date,
               dayname(txn_date)                                     AS day_of_week,
               count(*)                                              AS txns,
               round(sum(amount)/100.0, 2)                           AS revenue_sgd,
               round(avg(amount)/100.0, 2)                           AS avg_ticket_sgd,
               count(DISTINCT cardId)                                AS distinct_cards,
               (txn_date BETWEEN DATE '2026-02-16' AND DATE '2026-02-18') AS is_cny_window
        FROM tx
        GROUP BY txn_date
        ORDER BY txn_date
    """,
    # 4) one row per terminal — error/offline/speed + a simple heuristic flag (NOT the full verdict)
    "terminal_summary.csv": """
        SELECT terminalId,
               any_value(schoolId)                                   AS schoolId,
               count(*)                                              AS txns,
               round(100.0*count(*) FILTER (WHERE errorCode IS NOT NULL AND errorCode <> '0')/count(*), 1) AS err_pct,
               round(100.0*count(*) FILTER (WHERE paymentMode = 'OFFLINE')/count(*), 1)                     AS offline_pct,
               round(median(startToFinish) FILTER (WHERE startToFinish > 0))                                AS median_speed_ms,
               round(quantile_cont(startToFinish, 0.95) FILTER (WHERE startToFinish > 0))                   AS p95_speed_ms,
               mode(posNetworkType)                                  AS network_type,
               CASE
                 WHEN count(*) >= 300 AND 100.0*count(*) FILTER (WHERE errorCode IS NOT NULL AND errorCode <> '0')/count(*) >= 10 THEN 'high_error'
                 WHEN median(startToFinish) FILTER (WHERE startToFinish > 0) >= 4000 THEN 'slow'
                 ELSE 'ok'
               END                                                   AS flag
        FROM tx
        GROUP BY terminalId
        ORDER BY txns DESC
    """,
    # 5) one row per day — heart rate (exclude 255 sentinel; Feb dates only)
    "hr_daily.csv": """
        SELECT TRY_CAST(hr_date AS DATE)                             AS hr_date,
               count(*)                                              AS readings,
               round(avg(bpm_number), 1)                             AS mean_bpm,
               count(DISTINCT user_id)                               AS users
        FROM feb_heart_rate
        WHERE bpm_number BETWEEN 30 AND 220
          AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
        GROUP BY 1 ORDER BY 1
    """,
    # 6) one row per day — activity (steps summed per user-day, then averaged)
    "activity_daily.csv": """
        WITH per_user AS (
          -- recorded_time is epoch SECONDS; +8h → Singapore wall-clock day
          SELECT CAST(epoch_ms((recorded_time + 28800) * 1000) AS DATE) AS day, user_id, sum(steps) AS steps
          FROM feb_health
          WHERE data_type IN (0, 1)
            AND CAST(epoch_ms((recorded_time + 28800) * 1000) AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
          GROUP BY 1, 2
        )
        SELECT day,
               count(*)                    AS active_users,
               round(avg(steps))           AS avg_steps_per_user,
               sum(steps)                  AS total_steps
        FROM per_user GROUP BY day ORDER BY day
    """,
}


def main() -> int:
    if not DB.exists():
        print(f"ERROR: {DB} not found — run build_feb_duckdb.py first.", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB), read_only=True)
    for fname, sql in QUERIES.items():
        path = OUT / fname
        lit = str(path.as_posix()).replace("'", "''")
        con.execute(f"COPY ({sql}) TO '{lit}' (HEADER, DELIMITER ',')")
        n = con.execute(f"SELECT count(*) FROM ({sql})").fetchone()[0]
        kb = path.stat().st_size / 1024
        print(f"  {fname:24s} {n:>6,} rows  ({kb:,.1f} KB)")
    con.close()
    total_kb = sum((OUT / f).stat().st_size for f in QUERIES) / 1024
    print(f"\nOK -> {OUT}  ({len(QUERIES)} files, {total_kb:,.1f} KB total)")
    print("These are ANONYMISED aggregates (no card ids, no individuals, no raw rows). Money is SGD.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
