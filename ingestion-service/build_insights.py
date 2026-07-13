#!/usr/bin/env python3
"""build_insights.py — (re)build ONE month's precomputed insight bundles into `smartbuddy.insights`.

The dashboard reads these bundles at runtime (via api-service) instead of shipping baked-in JSON, so
data always comes from ClickHouse and switching months is just picking a different row. Each bundle is
one row: (month, kind, json). Kinds:
    global   network overview + terminal speed/network + food mix          (any month w/ transactions)
    schools  per-school aggregates + map dots                              (any month w/ transactions)
    stalls   per-stall + per-terminal (machine-vs-site verdict)            (any month w/ transactions)
    items    purchase line items: nutrition / healthy-choice / top items   (months w/ an items table)
    savings  student saving vs spending                                    (months w/ saving_spending)
    wearable activity + heart-rate  — built by build_insights_wearable (deferred; Feb only)

Method: pull the month's transaction facts from ClickHouse as Arrow, register them in DuckDB, and run
the SAME battle-tested SQL as the analysis pipeline (build_app_data / build_stalls_data) — only the
Feb-hardcoded date predicates are dropped (the data is already scoped to the month). items/savings are
aggregated in ClickHouse directly (they can be many rows). Run:  SB_MONTH=2026-03 python build_insights.py
"""
from __future__ import annotations

import json
import os
import calendar
import sys
from pathlib import Path
from urllib.parse import urlparse

import duckdb
import pandas as pd
import clickhouse_connect

from taxonomy import STALLCAT_SQL, CATS as TAX_CATS

HERE = Path(__file__).resolve().parent
CH_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_DB = os.environ.get("CLICKHOUSE_DB", "smartbuddy")
CH_USER = os.environ.get("CLICKHOUSE_USER", "smartbuddy_rw")
CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")
GEO = json.loads((HERE / "school_geo.json").read_text(encoding="utf-8"))

LEVEL = """CASE
 WHEN schoolId = 'NYP' OR schoolId = 'SOTA' THEN 'Other'
 WHEN schoolId LIKE '%JC' THEN 'Junior College'
 WHEN schoolId LIKE '%PS' OR schoolId LIKE '%P' THEN 'Primary'
 WHEN schoolId LIKE '%SS' OR schoolId LIKE '%GS' OR schoolId LIKE '%HS' THEN 'Secondary'
 ELSE 'Other' END"""


def ch_client():
    u = urlparse(CH_URL)
    return clickhouse_connect.get_client(host=u.hostname, port=u.port or 8123, username=CH_USER,
                                         password=CH_PASSWORD, secure=(u.scheme == "https"), database=CH_DB)


def table_has_month(client, table: str, month: str) -> bool:
    try:
        return bool(client.command(
            f"SELECT count() FROM {CH_DB}.{table} WHERE month = %(m)s", parameters={"m": month}))
    except Exception:
        return False


def put(client, month: str, kind: str, obj: dict) -> int:
    js = json.dumps(obj, ensure_ascii=False, allow_nan=False)
    client.insert(f"{CH_DB}.insights", [[month, kind, js]], column_names=["month", "kind", "json"])
    return len(js)


# ── transaction bundles (DuckDB, reusing the analysis SQL) ───────────────────────
def register_facts(con, client, month: str) -> None:
    """Pull the month's txn + txn_perf as Arrow and register them + the tx/stallcat/txm views."""
    con.execute("SET timezone='Asia/Singapore'")
    con.execute(f"SET memory_limit='{os.environ.get('SB_DUCKDB_MEMORY', '1GB')}'")   # bound + spill to disk
    con.execute("SET temp_directory='/work'")   # /work volume (mounted in both ingest + ch-insights)
    keep_txn = ("id, schoolId, storeId, storeName, terminalId, amount, txn_date, txn_time, cardId, "
                "paymentMode, paymentType, errorCode")
    # query_df (pandas) → DuckDB register. Avoids the optional pyarrow dep; DuckDB queries the frame.
    txn = client.query_df(f"SELECT {keep_txn} FROM {CH_DB}.txn WHERE month = %(m)s", parameters={"m": month})
    perf = client.query_df(f"SELECT * FROM {CH_DB}.txn_perf WHERE month = %(m)s", parameters={"m": month})
    # shrink pandas memory: repeated-value string columns → category (skip high-cardinality ids)
    for df in (txn, perf):
        for col in df.select_dtypes(include=["object"]).columns:
            if col in ("cardId", "id"):
                continue
            try:
                if df[col].nunique(dropna=True) * 3 < len(df):
                    df[col] = df[col].astype("category")
            except Exception:
                pass
    con.register("txn", txn)
    con.register("txn_perf", perf)
    # tx: student-traffic working set + derived cols both build sections use
    con.execute(f"""CREATE OR REPLACE VIEW tx AS
        SELECT *, {LEVEL} AS level, extract(hour FROM CAST(txn_time AS TIME)) AS hh,
               txn_date AS d, date_trunc('week', txn_date) AS wk,
               CASE WHEN dayofweek(txn_date) IN (0,6) THEN 'Weekend' ELSE 'School' END AS daytype
        FROM txn
        WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000""")
    con.execute(STALLCAT_SQL)                                     # → view stallcat over tx
    con.execute("CREATE OR REPLACE VIEW txm AS SELECT tx.*, sc.mcat FROM tx JOIN stallcat sc USING (schoolId, storeId)")


def q(con, s):
    return con.sql(s).df()


def recs(df):
    return json.loads(df.to_json(orient="records"))


def build_global(con) -> dict:
    OUT = {}
    OUT["daily"] = recs(q(con, """
        SELECT t.txn_date::VARCHAR AS date, count(*) AS n, round(sum(t.amount)/100.0,0) AS sgd,
          round(100.0*count(*) FILTER (t.paymentMode='OFFLINE')/count(*),1) AS offline_pct,
          round(100.0*count(*) FILTER (t.errorCode IS NOT NULL AND t.errorCode != '0')/count(*),1) AS err_pct,
          round(median(p.startToFinish),0) AS med_ms, round(quantile_cont(p.startToFinish,0.95),0) AS p95_ms
        FROM txn t JOIN txn_perf p USING (id)
        WHERE t.schoolId != 'STYL' AND p.startToFinish > 0 GROUP BY 1 ORDER BY 1"""))
    OUT["speed_weekly_by_stack"] = recs(q(con, """
        SELECT date_trunc('week', txn_date)::VARCHAR AS week, paymentType,
          round(median(startToFinish),0) AS med_ms, count(*) AS n
        FROM txn_perf WHERE startToFinish > 0
          AND paymentType IN ('SSS','CONCESSION 2.0 ASCAN','Smart Buddy/ATM','CONCESSION 3.0 ASCAN','EZLINK 2.0 ASCAN','NETS FlashPay')
        GROUP BY 1,2 ORDER BY 1,2"""))
    OUT["speed_components_weekly"] = recs(q(con, """
        SELECT date_trunc('week', txn_date)::VARCHAR AS week,
          round(median(checkSignal),0) AS checkSignal, round(median(openSocket),0) AS openSocket,
          round(median(handshake),0) AS handshake, round(median(sendToReceiveData),0) AS transfer,
          round(median(tapCardToFinish),0) AS tapToFinish, round(median(startToFinish),0) AS total, count(*) AS n
        FROM txn_perf WHERE startToFinish > 0 AND paymentMode='ONLINE' GROUP BY 1 ORDER BY 1"""))
    OUT["speed_hist"] = recs(q(con, """SELECT CASE
          WHEN startToFinish<1000 THEN '<1s' WHEN startToFinish<2000 THEN '1-2s' WHEN startToFinish<3000 THEN '2-3s'
          WHEN startToFinish<5000 THEN '3-5s' WHEN startToFinish<10000 THEN '5-10s' ELSE '>10s' END AS bucket,
          min(startToFinish) AS ord, count(*) AS n
        FROM txn_perf WHERE startToFinish>0 GROUP BY 1 ORDER BY min(startToFinish)"""))
    OUT["network_mix"] = recs(q(con, """SELECT posNetworkType, count(DISTINCT terminalId) AS terminals, count(*) AS n,
          round(median(startToFinish),0) AS med_ms, round(quantile_cont(startToFinish,0.95),0) AS p95_ms
        FROM txn_perf WHERE startToFinish>0 AND posNetworkType IN ('4G','WIFI','ETHERNET')
        GROUP BY 1 ORDER BY n DESC"""))
    OUT["signal_dist"] = recs(q(con, """SELECT posSignalStrength AS sig, count(*) AS n
        FROM txn_perf WHERE posSignalStrength BETWEEN 0 AND 31 AND posNetworkType='4G' GROUP BY 1 ORDER BY 1"""))
    OUT["food_weekly"] = recs(q(con, """SELECT wk::VARCHAR AS week, mcat, count(*) AS n,
          round(sum(amount)/100.0,0) AS sgd, round(avg(amount),1) AS avg_cents FROM txm GROUP BY 1,2 ORDER BY 1,2"""))
    OUT["food_mix"] = recs(q(con, """SELECT mcat, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
          round(avg(amount)/100.0,2) AS avg_sgd FROM txm GROUP BY 1 ORDER BY n DESC"""))
    OUT["food_hour"] = recs(q(con, """SELECT hh AS hour, mcat, count(*) AS n FROM txm
          WHERE hh BETWEEN 6 AND 17 GROUP BY 1,2 ORDER BY 1,2"""))
    return OUT


def build_schools(con) -> dict:
    base = q(con, """
        WITH c AS (SELECT schoolId, cardId, count(*) AS n, sum(amount) AS amt, count(DISTINCT txn_date) AS days
          FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2)
        SELECT schoolId, count(*) AS cards, round(avg(amt/days)/100.0,2) AS spend_day,
          round(avg(n*1.0/days),2) AS txns_day FROM c GROUP BY 1""")
    tots = q(con, f"""
        SELECT t.schoolId, any_value({LEVEL.replace('schoolId','t.schoolId')}) AS level, count(*) AS n,
          round(sum(t.amount)/100.0,0) AS sgd, round(avg(t.amount)/100.0,2) AS avg_ticket,
          count(DISTINCT t.terminalId) AS terminals, count(DISTINCT t.storeId) AS stores,
          round(100.0*count(*) FILTER (t.paymentMode='OFFLINE')/count(*),1) AS offline_pct,
          round(100.0*count(*) FILTER (t.errorCode IS NOT NULL AND t.errorCode != '0')/count(*),1) AS err_pct
        FROM txn t WHERE t.schoolId != 'STYL' AND t.storeName NOT ILIKE '%retrieve%' AND t.amount <= 20000 GROUP BY 1""")
    spd = q(con, """SELECT schoolId, round(median(startToFinish),0) AS med_ms,
          round(quantile_cont(startToFinish,0.95),0) AS p95_ms,
          round(median(posSignalStrength) FILTER (posSignalStrength BETWEEN 0 AND 31),0) AS med_sig,
          count(DISTINCT terminalId) FILTER (posNetworkType='WIFI') AS wifi_terms
        FROM txn_perf WHERE startToFinish>0 AND schoolId != 'STYL' GROUP BY 1""")
    mix = q(con, "SELECT schoolId, mcat, count(*) AS n FROM txm GROUP BY 1,2")
    mixp = mix.pivot_table(index="schoolId", columns="mcat", values="n", fill_value=0)
    mixp = mixp.div(mixp.sum(axis=1), axis=0).round(3)
    wkspd = q(con, """SELECT schoolId, date_trunc('week',txn_date)::VARCHAR AS week,
          round(median(startToFinish),0) AS med_ms FROM txn_perf
        WHERE startToFinish>0 AND schoolId!='STYL' GROUP BY 1,2""")
    wkspend = q(con, """SELECT schoolId, wk::VARCHAR AS week, round(sum(amount)/100.0,0) AS sgd, count(*) AS n
        FROM txm GROUP BY 1,2""")

    def eff_level(inferred, moe_level):
        ml = (moe_level or "").upper()
        if ml.startswith("PRIMARY"):
            return "Primary"
        if ml.startswith("SECONDARY"):
            return "Secondary"
        if ml.startswith("JUNIOR COLLEGE"):
            return "Junior College"
        return inferred

    schools = {}
    for _, r in tots.iterrows():
        sid = r["schoolId"]
        g = GEO.get(sid, {})
        b = base[base["schoolId"] == sid]
        s = spd[spd["schoolId"] == sid]
        schools[sid] = {
            "id": sid, "level": eff_level(r["level"], g.get("level")), "n": int(r["n"]), "sgd": float(r["sgd"]),
            "avg_ticket": float(r["avg_ticket"]), "terminals": int(r["terminals"]), "stores": int(r["stores"]),
            "offline_pct": float(r["offline_pct"]), "err_pct": float(r["err_pct"]),
            "cards": int(b["cards"].iloc[0]) if len(b) else None,
            "spend_day": float(b["spend_day"].iloc[0]) if len(b) else None,
            "txns_day": float(b["txns_day"].iloc[0]) if len(b) else None,
            "med_ms": float(s["med_ms"].iloc[0]) if len(s) else None,
            "p95_ms": float(s["p95_ms"].iloc[0]) if len(s) else None,
            "med_sig": (None if not len(s) or pd.isna(s["med_sig"].iloc[0]) else float(s["med_sig"].iloc[0])),
            "wifi_terms": int(s["wifi_terms"].iloc[0]) if len(s) else 0,
            "name": g.get("name"), "lat": g.get("lat"), "lng": g.get("lng"),
            "moe_type": g.get("type"), "moe_level": g.get("level"), "zone": g.get("zone"), "area": g.get("area"),
            "sap": g.get("sap"), "autonomous": g.get("autonomous"), "gifted": g.get("gifted"), "ip": g.get("ip"),
            "mix": (mixp.loc[sid].to_dict() if sid in mixp.index else {}),
            "wk_spend": recs(wkspend[wkspend["schoolId"] == sid][["week", "sgd", "n"]]),
            "wk_speed": recs(wkspd[wkspd["schoolId"] == sid][["week", "med_ms"]]),
        }
    return {"schools": schools, "tots": tots}


def build_atas(schools: dict) -> dict:
    rows = [{"sid": sid, "type": s["moe_type"], "ip": s["ip"], "gifted": s["gifted"], "level": s["level"],
             "spend_day": s["spend_day"], "avg_ticket": s["avg_ticket"]}
            for sid, s in schools.items() if s["moe_type"] and s["spend_day"]]
    at = pd.DataFrame(rows)
    if at.empty:
        return {"by_type": [], "by_type_level": [], "by_ip": [], "by_gep": [], "coverage": {"matched": 0, "total": len(schools)}}

    def grp(df, col):
        g = df.groupby(col).agg(schools=("sid", "count"), spend_day=("spend_day", "mean"),
                                avg_ticket=("avg_ticket", "mean")).round(2).reset_index()
        return recs(g)

    return {
        "by_type": grp(at, "type"),
        "by_type_level": recs(at.groupby(["level", "type"]).agg(
            schools=("sid", "count"), spend_day=("spend_day", "mean")).round(2).reset_index()),
        "by_ip": grp(at[at["level"].isin(["Secondary", "Junior College"])], "ip"),
        "by_gep": grp(at[at["level"] == "Primary"], "gifted"),
        "coverage": {"matched": len(rows), "total": len(schools)},
    }


def build_terminals_global(con) -> list:
    return recs(q(con, """
        SELECT p.terminalId, any_value(p.schoolId) AS school, count(*) AS n,
          round(median(p.startToFinish),0) AS med_ms, round(quantile_cont(p.startToFinish,0.95),0) AS p95_ms,
          any_value(p.posNetworkType) AS net,
          round(median(p.posSignalStrength) FILTER (p.posSignalStrength BETWEEN 0 AND 31),0) AS med_sig,
          round(median(p.posSignalStrength) FILTER (p.posSignalStrength < 0),0) AS med_rssi,
          round(100.0*count(*) FILTER (t.errorCode IS NOT NULL AND t.errorCode!='0')/count(*),1) AS err_pct,
          round(100.0*count(*) FILTER (t.paymentMode='OFFLINE')/count(*),1) AS offline_pct
        FROM txn_perf p JOIN txn t USING (id)
        WHERE p.schoolId != 'STYL' AND p.startToFinish > 0
        GROUP BY p.terminalId HAVING count(*) >= 200"""))


def build_stalls(con, days: list) -> dict:
    ndays = len(days)
    base = q(con, """SELECT storeId, any_value(storeName) AS name, any_value(schoolId) AS school,
          any_value(level) AS lvl_sfx, any_value(mcat) AS cat,
          count(*) AS n, round(sum(amount)/100.0) AS rev, round(avg(amount)/100.0,2) AS ticket,
          round(100.0*count(*) FILTER (amount<=100)/count(*)) AS b1,
          round(100.0*count(*) FILTER (amount>100 AND amount<=200)/count(*)) AS b2,
          round(100.0*count(*) FILTER (amount>200 AND amount<=300)/count(*)) AS b3,
          round(100.0*count(*) FILTER (amount>300)/count(*)) AS b4
        FROM txm GROUP BY storeId""")
    terms_of = q(con, "SELECT storeId, list(DISTINCT terminalId) AS terms FROM txm GROUP BY 1")
    daily = q(con, "SELECT storeId, d::VARCHAR AS d, round(sum(amount)/100.0) AS v FROM txm GROUP BY 1,2")
    hourly = q(con, """SELECT storeId, hh, round(sum(amount)/100.0) AS v FROM txm
          WHERE daytype='School' AND hh BETWEEN 5 AND 19 GROUP BY 1,2""")
    prices = q(con, """SELECT storeId, amount, count(*) AS n,
          row_number() OVER (PARTITION BY storeId ORDER BY count(*) DESC) AS rk
        FROM txm GROUP BY 1,2 QUALIFY rk <= 3 ORDER BY storeId, rk""")

    dmap, hmap, pmap, tmap = {}, {}, {}, {}
    for sid, g in daily.groupby("storeId"):
        m = dict(zip(g.d, g.v)); dmap[sid] = [int(m.get(x, 0)) for x in days]
    for sid, g in hourly.groupby("storeId"):
        m = dict(zip(g.hh, g.v)); hmap[sid] = [int(m.get(x, 0)) for x in range(5, 20)]
    for sid, g in prices.groupby("storeId"):
        pmap[sid] = [[int(a), int(n)] for a, n in zip(g.amount, g.n)]
    for _, r in terms_of.iterrows():
        tmap[r.storeId] = list(r.terms)

    lvl_geo = {sid: (g.get("level") or "").upper() for sid, g in GEO.items()}

    def eff(sid, sfx):
        ml = lvl_geo.get(sid, "")
        if ml.startswith("PRIMARY"):
            return "Primary"
        if ml.startswith("SECONDARY"):
            return "Secondary"
        if ml.startswith("JUNIOR COLLEGE"):
            return "Junior College"
        return sfx

    stalls = []
    for _, r in base.iterrows():
        stalls.append({"id": r.storeId, "name": r["name"], "school": r.school,
                       "level": eff(r.school, r.lvl_sfx), "cat": r["cat"],
                       "terms": tmap.get(r.storeId, []), "n": int(r.n), "rev": int(r.rev),
                       "ticket": float(r.ticket), "bands": [int(r.b1), int(r.b2), int(r.b3), int(r.b4)],
                       "daily": dmap.get(r.storeId, [0] * ndays), "hourly": hmap.get(r.storeId, [0] * 15),
                       "prices": pmap.get(r.storeId, [])})

    # per-terminal (machine) with the machine-vs-site verdict
    con.execute("CREATE OR REPLACE VIEW pf AS SELECT * FROM txn_perf WHERE schoolId != 'STYL' AND startToFinish > 0")
    tbase = q(con, """
        WITH t AS (SELECT terminalId, any_value(schoolId) AS school, any_value(storeId) AS store, count(*) AS n,
            round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),1) AS err_pct,
            round(100.0*count(*) FILTER (paymentMode='OFFLINE')/count(*),1) AS off_pct FROM txm GROUP BY 1),
        p AS (SELECT terminalId, round(median(startToFinish)) AS med_ms, round(quantile_cont(startToFinish,0.95)) AS p95_ms,
            round(median(checkSignal)) AS c_sig, round(median(openSocket)) AS c_sock, round(median(handshake)) AS c_hs,
            round(median(sendToReceiveData)) AS c_xfer, round(median(tapCardToFinish)) AS c_tap,
            any_value(posNetworkType) AS net,
            round(median(posSignalStrength) FILTER (posSignalStrength BETWEEN 0 AND 31)) AS sig,
            round(median(posSignalStrength) FILTER (posSignalStrength < 0)) AS rssi FROM pf GROUP BY 1)
        SELECT t.*, p.med_ms, p.p95_ms, p.c_sig, p.c_sock, p.c_hs, p.c_xfer, p.c_tap, p.net, p.sig, p.rssi
        FROM t LEFT JOIN p USING (terminalId)""")
    tdaily = q(con, """SELECT terminalId, d::VARCHAR AS d,
          round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),1) AS err, count(*) AS n
        FROM txm GROUP BY 1,2""")
    pdaily = q(con, "SELECT terminalId, txn_date::VARCHAR AS d, round(median(startToFinish)) AS ms FROM pf GROUP BY 1,2")

    temap, tsmap = {}, {}
    for tid, g in tdaily.groupby("terminalId"):
        m = dict(zip(g.d, g.err)); temap[tid] = [(None if x not in m else float(m[x])) for x in days]
    for tid, g in pdaily.groupby("terminalId"):
        m = dict(zip(g.d, g.ms)); tsmap[tid] = [(None if x not in m else int(m[x])) for x in days]

    peers = {sch: g[["terminalId", "err_pct", "med_ms"]] for sch, g in tbase[tbase.n >= 300].groupby("school")}
    name_of = {s["id"]: s["name"] for s in stalls}
    terminals = []
    for _, r in tbase.iterrows():
        pg = peers.get(r.school)
        peer_err = peer_ms = None
        if pg is not None:
            others = pg[pg.terminalId != r.terminalId]
            if len(others) >= 2:
                peer_err = round(float(others.err_pct.median()), 1)
                peer_ms = (None if others.med_ms.isna().all() else int(others.med_ms.median()))
        verdict = "ok"
        bad_err = r.err_pct >= 10 and r.n >= 300
        slow = (not pd.isna(r.med_ms)) and r.med_ms >= 4000
        if bad_err or slow:
            peer_bad = (peer_err is not None and peer_err >= 8) or (peer_ms is not None and peer_ms >= 4000)
            verdict = "check" if (peer_err is None and peer_ms is None) else ("site" if peer_bad else "machine")
        terminals.append({"id": r.terminalId, "school": r.school, "store": r.store,
                          "storeName": name_of.get(r.store, r.store), "n": int(r.n),
                          "err_pct": float(r.err_pct), "off_pct": float(r.off_pct),
                          "med_ms": (None if pd.isna(r.med_ms) else int(r.med_ms)),
                          "p95_ms": (None if pd.isna(r.p95_ms) else int(r.p95_ms)),
                          "comp": {k: (None if pd.isna(v) else int(v)) for k, v in
                                   [("sigck", r.c_sig), ("sock", r.c_sock), ("hshake", r.c_hs),
                                    ("xfer", r.c_xfer), ("tap", r.c_tap)]},
                          "net": (None if pd.isna(r.net) else r.net),
                          "sig": (None if pd.isna(r.sig) else int(r.sig)),
                          "rssi": (None if pd.isna(r.rssi) else int(r.rssi)),
                          "daily_err": temap.get(r.terminalId, [None] * ndays),
                          "daily_ms": tsmap.get(r.terminalId, [None] * ndays),
                          "peer_err": peer_err, "peer_ms": peer_ms, "verdict": verdict})

    m = q(con, "SELECT count(*) AS n, round(sum(amount)/100.0) AS rev, count(DISTINCT schoolId) AS sch FROM txm").iloc[0]
    return {"meta": {"txns": int(m.n), "rev": int(m.rev), "schools": int(m.sch),
                     "stalls": len(stalls), "terminals": len(terminals)},
            "cats": list(TAX_CATS), "bands": ["≤$1", "$1–2", "$2–3", ">$3"],
            "stalls": stalls, "terminals": terminals}


# ── March bundles: items + savings (aggregated in ClickHouse) ────────────────────
def _rows(client, sql: str, params: dict) -> list:
    return list(client.query(sql, parameters=params).named_results())


def build_items(client, month: str) -> dict:
    m = {"m": month}
    # robust numeric casts — the raw CSV mixes types on a few malformed rows
    P = "toFloat64OrNull(toString(itemPrice))"
    Q = "toFloat64OrNull(toString(quantity))"
    C = "toFloat64OrNull(toString(calories))"
    H = "toInt32OrNull(toString(healthyChoice))"
    rev = f"sum({P}*{Q})/100.0"
    OUT = {}
    OUT["by_type"] = _rows(client,
        f"SELECT itemType AS type, count() AS n, round(sum({Q})) AS qty, round({rev}) AS rev, "
        f"  round(avg({C})) AS avg_cal, round(100.0*countIf({H}=1)/nullIf(countIf({H} IN (0,1)),0),1) AS healthy_pct "
        f"FROM {CH_DB}.items WHERE month=%(m)s AND itemType IN ('FOOD','DRINK','BOOK','STAMP','OTHER') "
        f"GROUP BY type ORDER BY n DESC", m)
    OUT["by_category"] = _rows(client,
        f"SELECT itemCategory AS category, count() AS n, round(sum({Q})) AS qty, round({rev}) AS rev, "
        f"  round(100.0*countIf({H}=1)/nullIf(countIf({H} IN (0,1)),0),1) AS healthy_pct "
        f"FROM {CH_DB}.items WHERE month=%(m)s AND itemCategory != '' "
        f"GROUP BY category ORDER BY n DESC LIMIT 25", m)
    OUT["top_items"] = _rows(client,
        f"SELECT itemName AS name, count() AS n, round(sum({Q})) AS qty, round({rev}) AS rev, "
        f"  round(avg({C})) AS avg_cal, max({H}) AS healthy "
        f"FROM {CH_DB}.items WHERE month=%(m)s AND itemName != '' "
        f"GROUP BY name ORDER BY qty DESC LIMIT 40", m)
    OUT["healthy"] = _rows(client,
        f"SELECT if({H}=1,'Healthier choice','Everyday') AS bucket, count() AS n, round(sum({Q})) AS qty, "
        f"  round({rev}) AS rev FROM {CH_DB}.items WHERE month=%(m)s AND {H} IN (0,1) "
        f"GROUP BY bucket ORDER BY n DESC", m)
    OUT["calories"] = _rows(client,
        f"SELECT multiIf({C}<50,'0-50',{C}<150,'50-150',{C}<300,'150-300',{C}<500,'300-500','500+') AS band, "
        f"  min({C}) AS ord, count() AS n FROM {CH_DB}.items WHERE month=%(m)s AND {C}>0 "
        f"GROUP BY band ORDER BY ord", m)
    meta = client.query(
        f"SELECT count() AS rows, round(sum({Q})) AS qty, round({rev}) AS rev, "
        f"  count(DISTINCT schoolName) AS schools FROM {CH_DB}.items WHERE month=%(m)s",
        parameters=m).first_row
    OUT["meta"] = {"rows": int(meta[0]), "qty": float(meta[1] or 0), "rev": float(meta[2] or 0), "schools": int(meta[3])}
    return OUT


def build_savings(client, month: str) -> dict:
    m = {"m": month}
    S = "toFloat64OrNull(toString(total_saving))/100.0"
    P = "toFloat64OrNull(toString(total_spending))/100.0"
    OUT = {}
    tot = client.query(
        f"SELECT count(DISTINCT user_id) AS students, round(sum({S}),0) AS saving, round(sum({P}),0) AS spending, "
        f"  round(avg({S}),2) AS avg_saving, round(avg({P}),2) AS avg_spending "
        f"FROM {CH_DB}.saving_spending WHERE month=%(m)s", parameters=m).first_row
    OUT["totals"] = {"students": int(tot[0]), "saving": float(tot[1] or 0), "spending": float(tot[2] or 0),
                     "avg_saving": float(tot[3] or 0), "avg_spending": float(tot[4] or 0)}
    OUT["saving_hist"] = _rows(client,
        f"SELECT least(floor({S}/10)*10, 200) AS lo, count() AS n FROM {CH_DB}.saving_spending "
        f"WHERE month=%(m)s AND {S} IS NOT NULL GROUP BY lo ORDER BY lo", m)
    OUT["spending_hist"] = _rows(client,
        f"SELECT least(floor({P}/10)*10, 200) AS lo, count() AS n FROM {CH_DB}.saving_spending "
        f"WHERE month=%(m)s AND {P} IS NOT NULL GROUP BY lo ORDER BY lo", m)
    OUT["rate_hist"] = _rows(client,
        f"SELECT round(least(greatest({S}/nullIf({S}+{P},0),0),1)/0.1)*0.1 AS rate, count() AS n "
        f"FROM {CH_DB}.saving_spending WHERE month=%(m)s AND ({S}+{P})>0 GROUP BY rate ORDER BY rate", m)

    # Wallet-rail reconciliation (aggregate only): the 'Smart Buddy/ATM' payment rail is the wearable
    # wallet; its canteen spend should ≈ this feed's total_spending — two INDEPENDENT feeds agreeing.
    # (cardId is NOT null on this rail; identify it by paymentType, not a null card.) No per-user join.
    try:
        rec = client.query(
            f"SELECT round(sum(amount)/100.0,0) AS all_canteen, "
            f"  round(sum(amount * (paymentType='Smart Buddy/ATM'))/100.0,0) AS wallet_rail "
            f"FROM {CH_DB}.tx WHERE month=%(m)s", parameters=m).first_row
        all_c, wallet = float(rec[0] or 0), float(rec[1] or 0)
        sav_spend = OUT["totals"]["spending"]
        OUT["reconcile"] = {
            "wallet_rail": wallet, "savings_spending": sav_spend, "all_canteen": all_c,
            "wallet_vs_savings_pct": round(100.0 * wallet / sav_spend, 1) if sav_spend else None,
            "wallet_share_of_canteen_pct": round(100.0 * wallet / all_c, 1) if all_c else None,
        }
    except Exception as e:
        print(f"  (savings reconciliation skipped: {str(e).splitlines()[0]})")
    return OUT


# ── linkage: items ⟷ transactions ⟷ cards (the school-aware 99% basket match) ────
# Turns receipt line-items into "what each STALL actually sells" + per-CARD habits. Aggregate and
# hashed-token only — this never builds a card⟷user bridge and never emits a raw id. Runs only when a
# month has BOTH transactions (registered as `tx`) and an `items` table.
def build_linkage(con, client, month: str):
    """Pull the month's items into DuckDB and match them to `tx`. Returns a dict with per-stall
    receipt contents, top stalls, and per-card habits — or None if there are no items to match."""
    cols = "schoolName, storeName, txn_datetime, quantity, itemPrice, itemType, healthyChoice"
    it = client.query_df(f"SELECT {cols} FROM {CH_DB}.items WHERE month = %(m)s", parameters={"m": month})
    if it is None or len(it) == 0:
        return None
    con.register("items_raw", it)
    con.execute("""CREATE OR REPLACE VIEW items_v AS
      SELECT schoolName, storeName, TRY_CAST(txn_datetime AS TIMESTAMP) AS dt,
             TRY_CAST(quantity AS INTEGER) AS qty, TRY_CAST(itemPrice AS INTEGER) AS price_c,
             upper(itemType) AS itemType, TRY_CAST(healthyChoice AS INTEGER) AS healthy
      FROM items_raw""")
    return _linkage_core(con)


def _linkage_core(con) -> dict:
    """The DuckDB half — assumes views `items_v` (schoolName,storeName,dt,qty,price_c,itemType,healthy)
    and `tx` (schoolId,storeId,storeName,txn_date,txn_time,amount,cardId) exist. Split out so it can be
    unit-tested off CSVs without a ClickHouse connection. Basket = (schoolName,storeName,exact-second)
    with Σqty×price = the transaction `amount`; the join is school-aware (storeNames collide across
    schools) via a majority-vote schoolName→schoolId map."""
    con.execute("""CREATE OR REPLACE TABLE lk_baskets AS
      SELECT schoolName, storeName, dt, sum(qty*price_c) AS amt_c, sum(qty) AS units
      FROM items_v WHERE dt IS NOT NULL GROUP BY 1,2,3""")   # drop rows with a malformed txn_datetime
    con.execute("""CREATE OR REPLACE VIEW lk_tx AS
      SELECT schoolId, storeId, storeName,
             TRY_CAST(CAST(txn_date AS VARCHAR) || ' ' || CAST(txn_time AS VARCHAR) AS TIMESTAMP) AS dt,
             CAST(amount AS BIGINT) AS amt_c, cardId
      FROM tx""")
    con.execute("""CREATE OR REPLACE TABLE lk_school_map AS
      SELECT schoolName, schoolId FROM (
        SELECT b.schoolName, t.schoolId,
               row_number() OVER (PARTITION BY b.schoolName ORDER BY count(*) DESC) AS rk
        FROM lk_baskets b JOIN lk_tx t
          ON t.storeName=b.storeName AND t.dt=b.dt AND t.amt_c=b.amt_c
        GROUP BY 1,2) WHERE rk=1""")
    con.execute("""CREATE OR REPLACE TABLE lk_matched AS
      SELECT b.schoolName, b.storeName, b.dt, b.units, m.schoolId,
             any_value(t.storeId) AS storeId, count(*) AS n_cand,
             count(DISTINCT t.cardId) AS n_cards, any_value(t.cardId) AS cardId
      FROM lk_baskets b JOIN lk_school_map m USING (schoolName)
      JOIN lk_tx t ON t.schoolId=m.schoolId AND t.storeName=b.storeName
                  AND t.dt=b.dt AND t.amt_c=b.amt_c
      GROUP BY 1,2,3,4,5""")
    # one materialised item×match join feeds both the per-stall and per-card rollups
    con.execute("""CREATE OR REPLACE TABLE lk_mi AS
      SELECT m.schoolId, m.storeId, m.storeName, m.cardId, m.n_cards,
             i.itemType, i.qty, i.price_c, i.healthy
      FROM lk_matched m JOIN items_v i
        ON i.schoolName=m.schoolName AND i.storeName=m.storeName AND i.dt=m.dt""")

    nb = con.execute("SELECT count(*) FROM lk_baskets").fetchone()[0] or 1
    nm = con.execute("SELECT count(*) FROM lk_matched").fetchone()[0]
    n1c = con.execute("SELECT count(*) FROM lk_matched WHERE n_cards=1").fetchone()[0]
    if nm == 0:
        # No basket matched a transaction — the items feed and the txn feed use different storeName
        # vocabularies ("Stall 10" vs "Fruits and Drinks - Stall 1"), so the storeName join finds
        # nothing on this data. Skip the linkage cleanly (empty aggregates would be NaN → invalid JSON).
        print(f"  linkage: 0/{nb:,} baskets matched — items↔txn storeName vocab differs; skipping linkage")
        return None

    # per-stall receipt contents — item-type mix + healthy share (NOT itemName: ~2/3 are generic POS
    # buttons like "Food Set Meal", so type/health are the trustworthy signal)
    stalls = q(con, """SELECT storeId, schoolId, any_value(storeName) AS name, sum(qty) AS units,
        round(sum(qty*price_c)/100.0) AS rev,
        round(100.0*sum(CASE WHEN itemType='DRINK' THEN qty ELSE 0 END)/sum(qty),1) AS drink_sh,
        round(100.0*sum(CASE WHEN itemType='FOOD'  THEN qty ELSE 0 END)/sum(qty),1) AS food_sh,
        round(100.0*sum(CASE WHEN itemType='BOOK'  THEN qty ELSE 0 END)/sum(qty),1) AS book_sh,
        round(100.0*sum(CASE WHEN healthy=1 THEN qty ELSE 0 END)/
              nullif(sum(CASE WHEN healthy IN (0,1) THEN qty ELSE 0 END),0),1) AS healthy_sh
      FROM lk_mi GROUP BY storeId, schoolId""")
    receipts = {r["storeId"]: {"units": int(r["units"]), "rev": int(r["rev"] or 0),
                               "drink_sh": r["drink_sh"], "food_sh": r["food_sh"],
                               "book_sh": r["book_sh"], "healthy_sh": r["healthy_sh"]}
                for _, r in stalls.iterrows()}
    top_stalls = recs(stalls.sort_values("units", ascending=False).head(30)
                      [["storeId", "schoolId", "name", "units", "rev",
                        "drink_sh", "food_sh", "book_sh", "healthy_sh"]])

    # per-card habits (single-card baskets only) — baskets, stall loyalty, healthy cohort
    con.execute("""CREATE OR REPLACE TABLE lk_cardstore AS
      SELECT cardId, storeId, count(*) AS b FROM lk_matched
      WHERE n_cards=1 AND cardId IS NOT NULL GROUP BY 1,2""")
    con.execute("""CREATE OR REPLACE TABLE lk_card AS
      SELECT cardId, sum(b) AS baskets, count(*) AS stalls, round(100.0*max(b)/sum(b)) AS loyalty
      FROM lk_cardstore GROUP BY 1""")
    con.execute("""CREATE OR REPLACE TABLE lk_cardh AS
      SELECT cardId, sum(CASE WHEN healthy=1 THEN qty ELSE 0 END) AS hu,
             sum(CASE WHEN healthy IN (0,1) THEN qty ELSE 0 END) AS ru
      FROM lk_mi WHERE n_cards=1 AND cardId IS NOT NULL GROUP BY 1""")
    hb = q(con, """SELECT count(*) AS cards, round(median(baskets),1) AS med_baskets,
        round(median(stalls),1) AS med_stalls, round(avg(loyalty)) AS avg_loyalty FROM lk_card""").iloc[0]
    coh = q(con, """SELECT
        round(100.0*sum(CASE WHEN hu*1.0/ru >= 0.8 THEN 1 ELSE 0 END)/count(*),1) AS mostly_healthy,
        round(100.0*sum(CASE WHEN hu*1.0/ru <  0.5 THEN 1 ELSE 0 END)/count(*),1) AS mostly_unhealthy
      FROM lk_cardh WHERE ru>0""").iloc[0]
    _n = lambda x: (float(x) if pd.notna(x) else 0.0)   # NaN/None → 0.0 (invalid JSON otherwise)
    habits = {"cards": int(hb["cards"]), "med_baskets": _n(hb["med_baskets"]),
              "med_stalls": _n(hb["med_stalls"]), "avg_loyalty": _n(hb["avg_loyalty"]),
              "mostly_healthy_pct": _n(coh["mostly_healthy"]),
              "mostly_unhealthy_pct": _n(coh["mostly_unhealthy"]),
              "match_pct": round(100.0 * nm / nb, 1), "single_card_pct": round(100.0 * n1c / nb, 1),
              "stalls_with_receipts": len(receipts)}
    print(f"  linkage: {nm:,}/{nb:,} baskets matched ({habits['match_pct']}%), "
          f"{len(receipts):,} stalls, {habits['cards']:,} cards")
    return {"receipts": receipts, "top_stalls": top_stalls, "habits": habits}


def run(month: str, client=None) -> list:
    """(Re)build every bundle a month has data for. Returns [(kind, bytes)]. Safe to call in-process
    (e.g. from the upload service after a load) or from the CLI."""
    y, mo = int(month[:4]), int(month[5:])
    days = [f"{month}-{i:02d}" for i in range(1, calendar.monthrange(y, mo)[1] + 1)]
    client = client or ch_client()

    built = []
    link = None                       # items⟷txn⟷card linkage (needs both txn + items this month)
    if table_has_month(client, "txn", month):
        con = duckdb.connect()
        register_facts(con, client, month)
        g = build_global(con)
        sc = build_schools(con)
        g["terminals"] = build_terminals_global(con)
        g["atas"] = build_atas(sc["schools"])
        g["meta"] = {"month": month, "days": days,
                     "schools_total": len(sc["schools"]),
                     "schools_mapped": sum(1 for s in sc["schools"].values() if s["lat"]),
                     "txns": int(sc["tots"]["n"].sum()), "sgd": float(sc["tots"]["sgd"].sum())}
        built.append(("global", put(client, month, "global", g)))
        built.append(("schools", put(client, month, "schools", {"days": days, "schools": sc["schools"]})))
        st = build_stalls(con, days)
        # Where a month has receipts too, attach each stall's real contents (what it actually sells).
        if table_has_month(client, "items", month):
            try:
                link = build_linkage(con, client, month)   # con still holds `tx`
                if link:
                    for s in st["stalls"]:
                        r = link["receipts"].get(s["id"])
                        if r:
                            s["receipt"] = r
            except Exception as e:                          # best-effort — never fail the base bundles
                print(f"  (linkage skipped: {str(e).splitlines()[0]})")
        st["meta"]["month"] = month
        st["days"] = days
        built.append(("stalls", put(client, month, "stalls", st)))
        con.close()
    else:
        print(f"  (no transactions for {month}; skipping global/schools/stalls)")

    if table_has_month(client, "items", month):
        items_bundle = {**build_items(client, month), "month": month}
        if link:                                            # receipt-linked stalls + per-card habits
            items_bundle["top_stalls"] = link["top_stalls"]
            items_bundle["habits"] = link["habits"]
        built.append(("items", put(client, month, "items", items_bundle)))
    if table_has_month(client, "saving_spending", month):
        built.append(("savings", put(client, month, "savings", {**build_savings(client, month), "month": month})))

    # wearable (activity + heart rate) — deferred; built by build_insights_wearable.py (Feb only)
    if table_has_month(client, "health", month):
        print("  (health present — 'wearable' bundle is built separately by build_insights_wearable.py)")

    for kind, size in built:
        print(f"  -> insights[{month}/{kind}]  {size//1024} KB")
    print(f"OK -> {len(built)} bundle(s) written for {month}.")
    return built


def main() -> int:
    month = os.environ.get("SB_MONTH") or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not (len(month) == 7 and month[4] == '-' and month[:4].isdigit() and month[5:].isdigit()):
        print("ERROR: set SB_MONTH=YYYY-MM (e.g. 2026-03).", file=sys.stderr)
        return 1
    run(month)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
