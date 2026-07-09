#!/usr/bin/env python3
"""Bundle the anonymised aggregates into ONE SQLite artifact for SAM's Data Analysis tool.

SAM's SQL query tool reads a CSV *or SQLite* artifact. A single SQLite file is one
attachment (vs six CSVs) and lets the agent JOIN across the tables. Same anonymised,
aggregate-only data as build_feb_aggregates.py — no card ids, no individuals, no raw rows.

Run:  python build_feb_sqlite.py   ->  artifacts/smartbuddy_feb.sqlite
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import duckdb

from build_feb_aggregates import DB, OUT, QUERIES  # reuse the exact aggregate SQL

OUT_SQLITE = OUT / "smartbuddy_feb.sqlite"


def main() -> int:
    if not DB.exists():
        print(f"ERROR: {DB} not found — run build_feb_duckdb.py first.", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    if OUT_SQLITE.exists():
        OUT_SQLITE.unlink()

    d = duckdb.connect(str(DB), read_only=True)
    s = sqlite3.connect(str(OUT_SQLITE))
    try:
        for fname, sql in QUERIES.items():
            table = fname[:-4] if fname.endswith(".csv") else fname
            df = d.execute(sql).df()
            # dates -> ISO strings so SQLite stores them readably
            for col in df.columns:
                if str(df[col].dtype).startswith(("datetime", "date")):
                    df[col] = df[col].astype(str)
            df.to_sql(table, s, if_exists="replace", index=False)
            print(f"  {table:22s} {len(df):>6,} rows")
        s.commit()
    finally:
        s.close()
        d.close()

    kb = OUT_SQLITE.stat().st_size / 1024
    print(f"\nOK -> {OUT_SQLITE}  ({kb:,.1f} KB, {len(QUERIES)} tables)")
    print("Anonymised aggregates only. Attach this one file in the SAM chat.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
