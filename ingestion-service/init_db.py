#!/usr/bin/env python3
"""One-shot ADMIN bootstrap for the SMART Buddy `smartbuddy` ClickHouse database.

Creates the database, the `insights` bundle table, and the two scoped users the rest of the stack
connects as — WITHOUT needing any data file (all data now arrives through the chunked upload
service). Run once (as the shared instance's admin) before the first upload.

  • smartbuddy_ro  — SELECT only on smartbuddy.* (the MCP/agent + read API connect as this)
  • smartbuddy_rw  — SELECT/INSERT/ALTER/CREATE/DROP/TRUNCATE on smartbuddy.* ONLY (upload service).
                     Never admin, never other databases, never the other demos' raw tables.

Fact tables + aggregate views (txn, txn_perf, health, …, tx, stallcat, pb_*) are created lazily by
the loader (ingest_core.py) on first upload, so nothing here needs the data shape up front.

Env: CLICKHOUSE_URL, CLICKHOUSE_ADMIN_USER, CLICKHOUSE_ADMIN_PASSWORD, CLICKHOUSE_DB,
     CLICKHOUSE_RO_USER, CLICKHOUSE_RO_PASSWORD, CLICKHOUSE_RW_USER, CLICKHOUSE_RW_PASSWORD.
"""
from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

import clickhouse_connect

CH_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_DB = os.environ.get("CLICKHOUSE_DB", "smartbuddy")
ADMIN_USER = os.environ.get("CLICKHOUSE_ADMIN_USER", "")
ADMIN_PASSWORD = os.environ.get("CLICKHOUSE_ADMIN_PASSWORD", "")
RO_USER = os.environ.get("CLICKHOUSE_RO_USER", "smartbuddy_ro")
RO_PASSWORD = os.environ.get("CLICKHOUSE_RO_PASSWORD", "")
RW_USER = os.environ.get("CLICKHOUSE_RW_USER", "smartbuddy_rw")
RW_PASSWORD = os.environ.get("CLICKHOUSE_RW_PASSWORD", "")

RW_GRANTS = "SELECT, INSERT, ALTER, CREATE TABLE, DROP TABLE, CREATE VIEW, DROP VIEW, TRUNCATE"


def main() -> int:
    if not (ADMIN_USER and ADMIN_PASSWORD):
        print("ERROR: set CLICKHOUSE_ADMIN_USER / CLICKHOUSE_ADMIN_PASSWORD.", file=sys.stderr)
        return 1
    if not RO_PASSWORD or not RW_PASSWORD:
        print("ERROR: set CLICKHOUSE_RO_PASSWORD and CLICKHOUSE_RW_PASSWORD.", file=sys.stderr)
        return 1

    u = urlparse(CH_URL)
    admin = clickhouse_connect.get_client(
        host=u.hostname, port=u.port or 8123, username=ADMIN_USER, password=ADMIN_PASSWORD,
        secure=(u.scheme == "https"))

    admin.command(f"CREATE DATABASE IF NOT EXISTS {CH_DB}")

    # Precomputed per-month insight bundles (built by build_insights.py). One row per (month, kind);
    # ReplacingMergeTree keeps the newest by updated_at — readers take the latest version.
    admin.command(
        f"CREATE TABLE IF NOT EXISTS {CH_DB}.insights ("
        "  month String, kind String, json String, updated_at DateTime DEFAULT now()"
        ") ENGINE = ReplacingMergeTree(updated_at) ORDER BY (month, kind)")

    admin.command(f"CREATE USER IF NOT EXISTS {RO_USER} IDENTIFIED BY '{RO_PASSWORD}'")
    admin.command(f"GRANT SELECT ON {CH_DB}.* TO {RO_USER}")
    print(f"  -> {RO_USER}: SELECT on {CH_DB}.* (read-only; no other grants)")

    admin.command(f"CREATE USER IF NOT EXISTS {RW_USER} IDENTIFIED BY '{RW_PASSWORD}'")
    admin.command(f"GRANT {RW_GRANTS} ON {CH_DB}.* TO {RW_USER}")
    print(f"  -> {RW_USER}: write on {CH_DB}.* only (upload service; NOT admin, NOT other demos)")

    print(f"OK -> database {CH_DB} ready (fact tables are created on first upload).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
