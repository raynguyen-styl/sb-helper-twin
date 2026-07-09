#!/usr/bin/env python3
"""sb_backfill.py — ingest SMART Buddy Feb data into InfluxDB (history) + Ditto (state).

Modelled on tree-digital-twin/ingestion/src/backfill.py: compute everything up front
(here with DuckDB SQL + the shared taxonomy.py), then write finished numbers to the
stores — history as downsampled Influx points, latest-state as one Ditto Thing per entity.

Source: feb_data/*.csv (RAW ids). Personal ids (cardId, user_id, sync_id) are HASHED at
ingest (salted, ephemeral salt) so the shared stores never see real ids — plan §8.

DRY-RUN by default: computes + validates the Influx line-protocol and Ditto Thing JSON and
writes samples to ./out/, WITHOUT touching any store. `--write` (Influx/Ditto creds) is the
live path and is intentionally gated off until those creds exist.

Run:  python sb_backfill.py            # dry-run, writes ./out/
      python sb_backfill.py --full     # dry-run but emit every line (large files)
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from pathlib import Path

import duckdb
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
# Input paths default to the repo layout; override via env when running in a container
# (the ingestion image mounts feb_data + analysis and points these at the mount).
FEB = Path(os.environ.get("SB_FEB_DIR", REPO / "feb_data"))
SCHOOL_GEO = Path(os.environ.get("SB_SCHOOL_GEO", REPO / "analysis" / "school_geo.json"))
ANALYSIS_DIR = os.environ.get("SB_ANALYSIS_DIR", str(REPO / "analysis"))
OUT = HERE / "out"
SAMPLE_N = 40  # lines per measurement written in dry-run (unless --full)

sys.path.insert(0, ANALYSIS_DIR)
from taxonomy import STALLCAT_SQL  # noqa: E402  (creates view `stallcat` over `tx`)

# ── PII hashing (ephemeral salt → irreversible; set SB_ID_SALT to pin) ──────────
SALT = os.environ.get("SB_ID_SALT") or secrets.token_hex(16)
def _hash(col: str) -> str:
    return (f"CASE WHEN {col} IS NULL THEN NULL "
            f"ELSE 'sb_' || substr(sha256(concat('{SALT}', CAST({col} AS VARCHAR))), 1, 16) END")

# transaction base filter (the analysis gate — must match the pipeline)
TX_FILTER = "schoolId <> 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000"

# ── InfluxDB line-protocol formatting ───────────────────────────────────────────
def _esc_tag(v) -> str:
    return str(v).replace("\\", "\\\\").replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")
def _esc_meas(v) -> str:
    return str(v).replace(" ", "\\ ").replace(",", "\\,")
def _fmt_fields(fields: dict) -> str:
    parts = []
    for k, val in fields.items():
        if val is None:
            continue
        if isinstance(val, bool):
            parts.append(f"{k}={'true' if val else 'false'}")
        elif isinstance(val, int):
            parts.append(f"{k}={val}i")          # integer field
        elif isinstance(val, float):
            parts.append(f"{k}={val}")
        else:
            s = str(val).replace("\\", "\\\\").replace('"', '\\"')
            parts.append(f'{k}="{s}"')            # string field
    return ",".join(parts)
def line(meas: str, tags: dict, fields: dict, ts_ns: int) -> str:
    tagstr = "".join(f",{_esc_tag(k)}={_esc_tag(v)}" for k, v in tags.items() if v is not None and str(v) != "")
    return f"{_esc_meas(meas)}{tagstr} {_fmt_fields(fields)} {int(ts_ns)}"


def build(con: duckdb.DuckDBPyConnection) -> None:
    """Load the raw CSVs and derive the analysis views (hashed ids, tx filter, taxonomy, schools)."""
    txn_csv = str((FEB / "feb_transactions.csv").as_posix())
    health_csv = str((FEB / "feb_health_data.csv").as_posix())
    hr_csv = str((FEB / "feb_heart_rate.csv").as_posix())

    # transactions — force cardId VARCHAR (16-digit id must not become a BIGINT)
    con.execute(f"""
        CREATE TABLE txn AS
        SELECT * FROM read_csv('{txn_csv}', nullstr='NULL', auto_detect=true,
                               types={{'cardId':'VARCHAR','netsErrorCode':'VARCHAR'}})
    """)
    # student-traffic view with hashed cardId; SGT hour-bucket epoch (ns) from date+time.
    # Convention: bucket = date + hour(SGT wall clock) treated as the point instant, so the
    # playback timeline reads in SGT (consistent between ingest and query).
    con.execute(f"""
        CREATE VIEW tx AS
        SELECT * REPLACE ({_hash('cardId')} AS cardId),
               CAST(epoch(CAST(txn_date AS TIMESTAMP) + INTERVAL (hour(txn_time)) HOUR) AS BIGINT) * 1000000000 AS hour_ns,
               CAST(txn_date AS TIMESTAMP) AS day_ts,
               CAST(epoch(CAST(txn_date AS TIMESTAMP)) AS BIGINT) * 1000000000 AS day_ns,
               (errorCode IS NOT NULL AND errorCode <> 0) AS is_err,
               (paymentMode = 'OFFLINE') AS is_offline
        FROM txn WHERE {TX_FILTER}
    """)
    con.execute(STALLCAT_SQL)  # view stallcat over tx (schoolId, storeId, mcat)
    con.execute("CREATE VIEW txm AS SELECT t.*, sc.mcat FROM tx t LEFT JOIN stallcat sc USING (schoolId, storeId)")

    # schools dimension from the geocoded MOE match
    geo = json.loads(SCHOOL_GEO.read_text(encoding="utf-8"))
    sdf = pd.DataFrame([{"schoolId": k, **v} for k, v in geo.items()])
    con.register("sdf", sdf)
    con.execute("CREATE TABLE schools AS SELECT * FROM sdf")
    con.unregister("sdf")

    # health activity — hashed user_id, SGT day from recorded_time(secs)+tz(min); Feb only
    con.execute(f"""
        CREATE TABLE health AS
        SELECT {_hash('user_id')} AS user_id, steps, calories, distances,
               CAST(epoch_ms((recorded_time + tz*60) * 1000) AS DATE) AS day
        FROM read_csv('{health_csv}', nullstr='NULL', auto_detect=true)
        WHERE data_type IN (0,1)
          AND CAST(epoch_ms((recorded_time + tz*60) * 1000) AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
    """)
    # heart rate — parse raw JSON for date/avg/lowest; exclude 255 sentinel; Feb only
    con.execute(f"""
        CREATE TABLE hr AS
        SELECT {_hash('user_id')} AS user_id,
               TRY_CAST(json_extract_string(raw, '$.date') AS DATE) AS day,
               bpm_number AS avg_bpm,
               TRY_CAST(json_extract_string(raw, '$.lowest_bpm') AS INT) AS lowest_bpm
        FROM read_csv('{hr_csv}', nullstr='NULL', auto_detect=true)
        WHERE bpm_number BETWEEN 30 AND 220
          AND TRY_CAST(json_extract_string(raw, '$.date') AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
    """)


# ── measurement queries (return rows the Python layer formats into line protocol) ──
# Each returns columns; a lambda maps a row → line(...). day/hour epochs are precomputed in SQL.
MEAS = {
    # per terminal per hour — the spend/health/speed series that shows recess + CNY
    "sb_txn": ("""
        SELECT schoolId, terminalId, any_value(posNetworkType) AS network_type, any_value(mcat) AS mcat,
               hour_ns,
               count(*) AS txns, sum(amount) AS revenue_cents,
               count(*) FILTER (WHERE is_err) AS err_count,
               count(*) FILTER (WHERE is_offline) AS offline_count,
               CAST(median(startToFinish) FILTER (WHERE startToFinish > 0) AS BIGINT) AS median_speed_ms
        FROM txm GROUP BY schoolId, terminalId, hour_ns
    """, lambda r: line("sb_txn",
            {"schoolId": r[0], "terminalId": r[1], "network_type": r[2], "mcat": r[3]},
            {"txns": int(r[5]), "revenue_cents": int(r[6]), "err_count": int(r[7]),
             "offline_count": int(r[8]), "median_speed_ms": (int(r[9]) if r[9] is not None else None)},
            r[4])),

    # per school per hour — school-level timeline (recess spikes, CNY drop)
    "sb_school_hr": ("""
        SELECT schoolId, hour_ns,
               count(*) AS txns, sum(amount) AS revenue_cents,
               count(*) FILTER (WHERE is_err) AS err_count,
               count(*) FILTER (WHERE is_offline) AS offline_count
        FROM tx GROUP BY schoolId, hour_ns
    """, lambda r: line("sb_school_hr",
            {"schoolId": r[0]},
            {"txns": int(r[2]), "revenue_cents": int(r[3]),
             "err_count": int(r[4]), "offline_count": int(r[5])}, r[1])),

    # per stall per day
    "sb_stall": ("""
        SELECT schoolId, storeId, any_value(mcat) AS mcat, day_ns,
               count(*) AS txns, sum(amount) AS revenue_cents
        FROM txm GROUP BY schoolId, storeId, day_ns
    """, lambda r: line("sb_stall",
            {"schoolId": r[0], "storeId": r[1], "mcat": r[2]},
            {"txns": int(r[4]), "revenue_cents": int(r[5])}, r[3])),

    # per school per day
    "sb_school": ("""
        SELECT t.schoolId, any_value(s.type) AS moe_type, any_value(s.level) AS level, t.day_ns,
               count(*) AS txns, sum(t.amount) AS revenue_cents,
               round(100.0*count(*) FILTER (WHERE t.is_err)/count(*), 2) AS err_pct,
               count(DISTINCT t.cardId) AS distinct_cards
        FROM tx t LEFT JOIN schools s USING (schoolId)
        GROUP BY t.schoolId, t.day_ns
    """, lambda r: line("sb_school",
            {"schoolId": r[0], "moe_type": r[1], "level": r[2]},
            {"txns": int(r[4]), "revenue_cents": int(r[5]),
             "err_pct": float(r[6] or 0), "distinct_cards": int(r[7])}, r[3])),

    # per user per day — steps + heart rate (borderline cardinality; user_id token is a tag)
    "sb_wearable": ("""
        WITH s AS (SELECT user_id, day, sum(steps) AS steps FROM health GROUP BY 1,2),
             h AS (SELECT user_id, day, round(avg(avg_bpm),1) AS mean_bpm, min(lowest_bpm) AS resting_bpm
                   FROM hr GROUP BY 1,2)
        SELECT coalesce(s.user_id,h.user_id) AS user_id, coalesce(s.day,h.day) AS day,
               CAST(epoch(CAST(coalesce(s.day,h.day) AS TIMESTAMP)) AS BIGINT)*1000000000 AS day_ns,
               s.steps, h.mean_bpm, h.resting_bpm
        FROM s FULL OUTER JOIN h ON s.user_id=h.user_id AND s.day=h.day
    """, lambda r: line("sb_wearable",
            {"user_id": r[0]},
            {"steps": (int(r[3]) if r[3] is not None else None),
             "mean_bpm": (float(r[4]) if r[4] is not None else None),
             "resting_bpm": (int(r[5]) if r[5] is not None else None)}, r[2])),

    # cohort per day — the wearable window (steps + heart rate across all users)
    "sb_wearable_cohort": ("""
        WITH s AS (SELECT user_id, day, sum(steps) AS steps FROM health GROUP BY 1,2),
             h AS (SELECT user_id, day, avg(avg_bpm) AS mbpm, min(lowest_bpm) AS rbpm FROM hr GROUP BY 1,2),
             u AS (SELECT coalesce(s.user_id,h.user_id) AS user_id, coalesce(s.day,h.day) AS day,
                          s.steps AS steps, h.mbpm AS mbpm, h.rbpm AS rbpm
                   FROM s FULL OUTER JOIN h ON s.user_id=h.user_id AND s.day=h.day)
        SELECT day, CAST(epoch(CAST(day AS TIMESTAMP)) AS BIGINT)*1000000000 AS day_ns,
               count(*) AS active_users, CAST(round(avg(steps)) AS BIGINT) AS avg_steps,
               round(avg(mbpm),1) AS mean_bpm, CAST(round(avg(rbpm)) AS BIGINT) AS resting_bpm
        FROM u GROUP BY day
    """, lambda r: line("sb_wearable_cohort", {},
            {"active_users": int(r[2]),
             "avg_steps": (int(r[3]) if r[3] is not None else None),
             "mean_bpm": (float(r[4]) if r[4] is not None else None),
             "resting_bpm": (int(r[5]) if r[5] is not None else None)}, r[1])),

    # per card per day — ON-DEMAND measurement: cardId is a FIELD (never a tag → no 179K series)
    "sb_card": ("""
        SELECT day_ns, cardId, count(*) AS txns, sum(amount) AS spend_cents
        FROM tx WHERE cardId IS NOT NULL GROUP BY day_ns, cardId
    """, lambda r: line("sb_card", {},
            {"cardId": r[1], "txns": int(r[2]), "spend_cents": int(r[3])}, r[0])),
}


def ditto_things(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Latest-state twins: one per school, one per terminal (namespace org.smartbuddy)."""
    things = []
    for r in con.execute("""
        SELECT t.schoolId AS sid, any_value(s.name) AS s_name, any_value(s.type) AS s_type,
               any_value(s.level) AS s_level, any_value(s.zone) AS s_zone,
               any_value(s.lat) AS s_lat, any_value(s.lng) AS s_lng,
               round(sum(t.amount)/100.0,2) AS total_sgd, round(avg(t.amount)/100.0,2) AS avg_ticket,
               count(DISTINCT t.cardId) AS distinct_cards,
               round(100.0*count(*) FILTER (WHERE t.is_err)/count(*),2) AS err_pct,
               round(100.0*count(*) FILTER (WHERE t.is_offline)/count(*),2) AS offline_pct,
               CAST(median(t.startToFinish) FILTER (WHERE t.startToFinish>0) AS BIGINT) AS median_speed
        FROM tx t LEFT JOIN schools s USING (schoolId) GROUP BY t.schoolId
    """).fetchall():
        things.append({"thingId": f"org.smartbuddy:school-{r[0]}",
            "attributes": {"schoolId": r[0], "name": r[1], "moe_type": r[2], "level": r[3],
                           "zone": r[4], "lat": r[5], "lng": r[6]},
            "features": {"spend": {"properties": {"total_sgd": r[7], "avg_ticket": r[8], "distinct_cards": int(r[9])}},
                         "network": {"properties": {"err_pct": r[10], "offline_pct": r[11], "median_speed_ms": r[12]}}}})
    for r in con.execute("""
        SELECT terminalId AS tid, any_value(schoolId) AS sid, any_value(posNetworkType) AS net,
               count(*) AS txns, round(100.0*count(*) FILTER (WHERE is_err)/count(*),2) AS err_pct,
               CAST(median(startToFinish) FILTER (WHERE startToFinish>0) AS BIGINT) AS median_speed,
               CAST(quantile_cont(startToFinish,0.95) FILTER (WHERE startToFinish>0) AS BIGINT) AS p95_speed,
               CASE WHEN count(*)>=300 AND 100.0*count(*) FILTER (WHERE is_err)/count(*)>=10 THEN 'high_error'
                    WHEN median(startToFinish) FILTER (WHERE startToFinish>0)>=4000 THEN 'slow' ELSE 'ok' END AS flag
        FROM tx GROUP BY terminalId
    """).fetchall():
        things.append({"thingId": f"org.smartbuddy:terminal-{r[0]}",
            "attributes": {"terminalId": r[0], "schoolId": r[1], "network_type": r[2]},
            "features": {"health": {"properties": {"txns": int(r[3]), "err_pct": r[4],
                          "median_speed_ms": r[5], "p95_speed_ms": r[6], "flag": r[7]}}}})
    return things


# ── live write path (mirrors tree-digital-twin/ingestion/src/backfill.py) ───────
def write_stores(con: duckdb.DuckDBPyConnection) -> None:
    """Write history → InfluxDB (line protocol, 1000/batch) and latest-state → Ditto (PUT)."""
    influx_url = os.environ.get("INFLUX_URL", "").rstrip("/")
    token = os.environ.get("INFLUX_TOKEN", "")
    org = os.environ.get("INFLUX_ORG", "styl")
    bucket = os.environ.get("INFLUX_BUCKET", "rtls")
    if not influx_url or not token:
        raise SystemExit("--write needs INFLUX_URL + INFLUX_TOKEN (see sb-api/.env.example)")

    from influxdb_client import InfluxDBClient          # lazy — only needed for --write
    from influxdb_client.client.write_api import SYNCHRONOUS

    total = 0
    with InfluxDBClient(url=influx_url, token=token, org=org) as client:
        wapi = client.write_api(write_options=SYNCHRONOUS)
        for meas, (sql, fmt) in MEAS.items():
            lp = [fmt(r) for r in con.execute(sql).fetchall()]
            for i in range(0, len(lp), 1000):
                wapi.write(bucket=bucket, org=org, record=lp[i:i + 1000])
            total += len(lp)
            print(f"  influx {meas:18s} {len(lp):>10,} points")
    print(f"[write] InfluxDB done — {total:,} points into bucket '{bucket}'.")

    dbase = os.environ.get("DITTO_BASE_URL", "").rstrip("/")
    duser = os.environ.get("DITTO_USERNAME", "ditto")
    dpass = os.environ.get("DITTO_PASSWORD", "")
    dpolicy = os.environ.get("DITTO_POLICY_ID", "")
    things = ditto_things(con)
    if dbase and dpass:
        import httpx
        from urllib.parse import quote
        ok = err = 0
        with httpx.Client(auth=(duser, dpass), timeout=30) as dc:
            for t in things:
                body = {"attributes": {k: v for k, v in t["attributes"].items() if v is not None},
                        "features": t["features"]}
                if dpolicy:
                    body["policyId"] = dpolicy
                url = f"{dbase}/api/2/things/{quote(t['thingId'], safe='')}"
                try:
                    r = dc.put(url, json=body)
                    if r.status_code in (200, 201, 204):
                        ok += 1
                    else:
                        err += 1
                        print(f"  Ditto PUT {t['thingId']} -> HTTP {r.status_code} {r.text[:90]}")
                except httpx.HTTPError as e:
                    err += 1
                    print(f"  Ditto error {t['thingId']}: {e}")
        print(f"[write] Ditto done — {ok} things seeded, {err} errors.")
    else:
        print("[write] Ditto skipped (set DITTO_BASE_URL + DITTO_PASSWORD to seed twins).")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="push to Influx/Ditto (needs INFLUX_URL/TOKEN [+ DITTO_* ] env)")
    ap.add_argument("--full", action="store_true", help="emit every line (large files) instead of a sample")
    args = ap.parse_args()

    for p in [FEB / "feb_transactions.csv", FEB / "feb_health_data.csv", FEB / "feb_heart_rate.csv", SCHOOL_GEO]:
        if not p.exists():
            print(f"ERROR: missing input {p}", file=sys.stderr)
            return 1
    print(f"(personal ids hashed with {'SB_ID_SALT' if os.environ.get('SB_ID_SALT') else 'an ephemeral salt'})")

    con = duckdb.connect()
    build(con)

    if args.write:
        write_stores(con)
        con.close()
        print("[write] backfill complete.")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)

    print(f"\n{'measurement':14s} {'points':>12s}   sample line")
    print("-" * 100)
    for meas, (sql, fmt) in MEAS.items():
        n = con.execute(f"SELECT count(*) FROM ({sql})").fetchone()[0]
        rows = con.execute(f"{sql} ORDER BY 1 LIMIT {'999999999' if args.full else SAMPLE_N}").fetchall()
        lines = [fmt(r) for r in rows]
        (OUT / f"{meas}.lp").write_text("\n".join(lines) + "\n", encoding="utf-8")
        sample = lines[0] if lines else "(none)"
        print(f"{meas:14s} {n:>12,}   {sample[:64]}")

    things = ditto_things(con)
    (OUT / "ditto_things.json").write_text(json.dumps(things, indent=2, default=str), encoding="utf-8")
    n_school = sum(1 for t in things if t["thingId"].startswith("org.smartbuddy:school-"))
    n_term = sum(1 for t in things if t["thingId"].startswith("org.smartbuddy:terminal-"))
    print(f"\nDitto twins: {n_school} schools + {n_term} terminals = {len(things)} things -> out/ditto_things.json")
    print(f"Line-protocol samples ({'FULL' if args.full else f'first {SAMPLE_N}'} each) -> out/*.lp")
    print("\nDRY-RUN OK -- no store was written. Enable --write once Influx/Ditto creds exist (plan sec.10).")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
