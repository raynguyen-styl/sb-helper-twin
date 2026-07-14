#!/usr/bin/env python3
"""build_insights_wearable.py — the 'wearable' insight bundle (activity + heart-rate + a per-month
calendar story + level×category spend), written to smartbuddy.insights(month, kind='wearable', json).

Reads the RAW ClickHouse tables (health, heart_rate, txn) via query_df→DuckDB. Works for ANY month that
has wearable data (Feb 2026 launched it; March 2026 added). Month-specific pieces are derived, not
hardcoded:
  • the day list comes from the calendar (28 vs 31 days);
  • recorded_time is a UNIX epoch → to_timestamp() in SGT;
  • txn_date is normalised with CAST(... AS DATE) — via query_df a ClickHouse Date arrives as a
    datetime64, so `txn_date::VARCHAR` would be '2026-03-01 00:00:00' and every date-keyed lookup would
    miss (same failure the linkage hit); CAST→DATE fixes it for both CSV and query_df inputs;
  • the "calendar story" adapts: February = Chinese New Year (16–18 Feb); other months = the school
    holiday week + return, DETECTED from the collapse in canteen transactions (school canteens go
    near-zero on holidays), so no calendar dates are hardcoded.
Run:  python build_insights_wearable.py [YYYY-MM]   (defaults to 2026-02)
"""
from __future__ import annotations

import calendar
import json
import os
import sys
import time
from datetime import date, timedelta

import duckdb
import numpy as np
import pandas as pd

from build_insights import ch_client, put, CH_DB, table_has_month
from taxonomy import STALLCAT_SQL, CATS as TAX_CATS

MONTH = "2026-02"
KEEP_TXN = "schoolId, storeId, storeName, amount, txn_date, txn_time, cardId"


def _df(client, sql):
    return client.query_df(sql)


def _month_days(month: str) -> list[str]:
    y, mo = int(month[:4]), int(month[5:])
    return [f"{month}-{d:02d}" for d in range(1, calendar.monthrange(y, mo)[1] + 1)]


def _detect_special(con, q, month: str) -> dict | None:
    """Return the per-month 'calendar story' spec, or None. February = fixed CNY window; any other month
    = the school-holiday break DETECTED from the canteen-txn collapse (school canteens near-zero on
    holidays), framed as Before break / Holidays / Term-2 return. `tx` (with a DATE `d`) must exist."""
    if month == "2026-02":
        return {
            "code": "cny", "label": "CNY story", "daytype": "CNY", "daytype_label": "CNY 16–18",
            "marked_days": [16, 17, 18],
            "intro": "Four weekday windows around Chinese New Year (17–18 Feb public holidays; 16 Feb a "
                     "half-day) — how students spent their time and money before, during and after.",
            "periods": [("Before (9–13 Feb)", "d BETWEEN DATE '2026-02-09' AND DATE '2026-02-13'"),
                        ("CNY break (16–18)", "d BETWEEN DATE '2026-02-16' AND DATE '2026-02-18'"),
                        ("Return (19–20)", "d BETWEEN DATE '2026-02-19' AND DATE '2026-02-20'"),
                        ("Normal (23–27)", "d BETWEEN DATE '2026-02-23' AND DATE '2026-02-27'")],
        }
    # generic: detect the school-holiday weekdays as those with canteen txns far below the weekday median
    dc = q("SELECT d, dayofweek(d) AS dow, count(*) AS n FROM tx GROUP BY 1,2")
    if dc.empty:
        return None
    wk = dc[~dc["dow"].isin([0, 6])].sort_values("d")
    if wk.empty:
        return None
    med = float(wk["n"].median())
    hol = [d for d, n in zip(wk["d"], wk["n"]) if n < 0.25 * med]   # low-traffic weekdays = holiday
    hol = [d if isinstance(d, date) else pd.Timestamp(d).date() for d in hol]
    if not hol:
        return None
    first, last = min(hol), max(hol)
    bstart = first - timedelta(days=7)
    t2end = last + timedelta(days=7)
    fmtd = lambda x: x.strftime("%Y-%m-%d")
    mon_name = date(int(month[:4]), int(month[5:]), 1).strftime("%B")
    return {
        "code": "break", "label": f"{mon_name} break", "daytype": "Holiday",
        "daytype_label": "School holidays",
        "marked_days": sorted({d.day for d in hol}),
        "intro": f"The {mon_name} school-holiday week, detected from the canteen-transaction collapse "
                 f"(school canteens go near-zero when school's out) — activity and spend before the "
                 f"break, during it, and as Term 2 resumes.",
        "periods": [("Before break", f"d BETWEEN DATE '{fmtd(bstart)}' AND DATE '{fmtd(first - timedelta(days=1))}'"),
                    (f"{mon_name} holidays", f"d BETWEEN DATE '{fmtd(first)}' AND DATE '{fmtd(last)}'"),
                    ("Term 2 return", f"d BETWEEN DATE '{fmtd(last + timedelta(days=1))}' AND DATE '{fmtd(t2end)}'")],
    }


def run(month: str = MONTH, client=None):
    client = client or ch_client()
    if not table_has_month(client, "health", month):
        print(f"  (no wearable/health data for {month}; skipping)")
        return []
    con = duckdb.connect()
    con.execute("SET timezone='Asia/Singapore'")
    con.execute(f"SET memory_limit='{os.environ.get('SB_DUCKDB_MEMORY', '1GB')}'")
    con.execute("SET temp_directory='/work'")

    DAYS = _month_days(month)
    LO, HI = DAYS[0], DAYS[-1]

    t0 = time.time()
    con.register("src_health", _df(client,
        f"SELECT user_id, steps, calories, distances, data_type, recorded_time FROM {CH_DB}.health WHERE month='{month}'"))
    con.register("src_hr", _df(client,
        f"SELECT user_id, bpm_number, recorded_time FROM {CH_DB}.heart_rate WHERE month='{month}'"))
    con.register("src_txn", _df(client,
        f"SELECT {KEEP_TXN} FROM {CH_DB}.txn WHERE month='{month}'"))
    print(f"  pulled rows in {round(time.time()-t0)}s", flush=True)

    def q(s):
        return con.sql(s).df()

    def recs(df):
        return json.loads(df.to_json(orient="records"))

    # ── txn working set (needed early: the holiday detection reads it). CAST txn_date→DATE so the date
    #    keys line up whether txn_date arrives as a DuckDB DATE (CSV) or a datetime64 (query_df).
    LEVEL = """CASE WHEN schoolId = 'NYP' OR schoolId = 'SOTA' THEN 'Other'
     WHEN schoolId LIKE '%JC' THEN 'Junior College'
     WHEN schoolId LIKE '%PS' OR schoolId LIKE '%P' THEN 'Primary'
     WHEN schoolId LIKE '%SS' OR schoolId LIKE '%GS' OR schoolId LIKE '%HS' THEN 'Secondary' ELSE 'Other' END"""
    con.sql(f"""CREATE OR REPLACE VIEW tx AS
      SELECT *, {LEVEL} AS lvl, extract(hour FROM CAST(txn_time AS TIME)) AS hh, CAST(txn_date AS DATE) AS d
      FROM src_txn WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000""")

    special = _detect_special(con, q, month)
    SPECIAL_DT = special["daytype"] if special else None
    if special and special["marked_days"]:
        marked = ",".join(f"DATE '{month}-{d:02d}'" for d in special["marked_days"])
        DAYTYPE = f"""CASE WHEN d IN ({marked}) THEN '{SPECIAL_DT}'
         WHEN dayofweek(d) IN (0,6) THEN 'Weekend' ELSE 'School' END"""
    else:
        DAYTYPE = "CASE WHEN dayofweek(d) IN (0,6) THEN 'Weekend' ELSE 'School' END"

    # daytype buckets the activity/HR slices are cut by
    DTS = [("All", "TRUE"), ("School", "daytype='School'"), ("Weekend", "daytype='Weekend'")]
    if SPECIAL_DT:
        DTS.append((SPECIAL_DT, f"daytype='{SPECIAL_DT}'"))

    # ── clean health view (recorded_time epoch → SGT date + 30-min slot) ───────────
    con.sql("""CREATE OR REPLACE VIEW h AS
      SELECT *, CAST(to_timestamp(recorded_time) AS DATE) AS d,
             (hour(to_timestamp(recorded_time))*2 + minute(to_timestamp(recorded_time))//30) AS slot
      FROM src_health
      WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000""")
    con.sql(f"CREATE OR REPLACE VIEW hd AS SELECT *, {DAYTYPE} AS daytype FROM h")

    # ── user features + KMeans segments (labelled by rank, never by index) ─────────
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler
    uf = q("""SELECT user_id, count(DISTINCT d) AS wear_days, sum(steps)*1.0/count(DISTINCT d) AS steps_pd,
        count(DISTINCT CASE WHEN dayofweek(d) IN (0,6) THEN d END) AS wk_days FROM h GROUP BY 1""")
    rhr = q("""SELECT user_id, avg(r) AS rhr FROM (
        SELECT user_id, CAST(to_timestamp(recorded_time) AS DATE) AS d, min(bpm_number) AS r
        FROM src_hr WHERE bpm_number BETWEEN 30 AND 150 GROUP BY 1,2) GROUP BY 1""")
    uf = uf.merge(rhr, on="user_id", how="left")
    wk_weeks = max(1.0, len([d for d in DAYS if date.fromisoformat(d).weekday() >= 5]) / 2.0)  # weekend-day pairs
    X = np.column_stack([np.log1p(uf["steps_pd"]), uf["wear_days"], uf["wk_days"] / wk_weeks])
    km = KMeans(n_clusters=4, n_init=10, random_state=42).fit(StandardScaler().fit_transform(X))
    uf["seg"] = km.labels_
    prof = uf.groupby("seg").agg(steps=("steps_pd", "median"), n=("user_id", "count"))
    order = prof.sort_values("steps", ascending=False).index.tolist()
    SEGNAMES = ["School-day actives", "Everyday wearers", "Occasional users", "Barely used"]
    uf["seg"] = uf["seg"].map({old: i for i, old in enumerate(order)})
    prof = uf.groupby("seg").agg(steps=("steps_pd", "median"), wear=("wear_days", "median"),
                                 wk=("wk_days", "median"), n=("user_id", "count"), rhr=("rhr", "median"))
    segments = [{"id": int(i), "name": SEGNAMES[i], "users": int(r.n), "steps": int(r.steps),
                 "wear_days": round(float(r.wear), 1), "wk_days": round(float(r.wk), 1),
                 "rhr": (None if pd.isna(r.rhr) else round(float(r.rhr), 1))} for i, r in prof.iterrows()]
    con.register("useg", uf[["user_id", "seg"]])
    con.sql("CREATE OR REPLACE VIEW hs AS SELECT hd.*, useg.seg FROM hd JOIN useg USING (user_id)")
    OUT = {"segments": segments}

    # ── activity slices: daytype × segment ─────────────────────────────────────────
    def act_slice(where):
        intr = q(f"""SELECT slot, sum(steps)*1.0 /
            (SELECT count(DISTINCT (user_id, d)) FROM hs WHERE {where}) AS v
            FROM hs WHERE {where} GROUP BY 1 ORDER BY 1""")
        k = q(f"""SELECT sum(steps)*1.0/count(DISTINCT (user_id,d)) AS steps,
            sum(calories)/1000.0/count(DISTINCT (user_id,d)) AS kcal,
            count(DISTINCT user_id) AS users, count(DISTINCT (user_id,d)) AS user_days
            FROM hs WHERE {where}""").iloc[0]
        tb = q(f"""SELECT CASE WHEN steps < 25 THEN 'sed' WHEN steps < 250 THEN 'light' ELSE 'active' END AS z,
            count(*)*0.5/(SELECT count(DISTINCT (user_id,d)) FROM hs WHERE {where}) AS hrs
            FROM hs WHERE {where} GROUP BY 1""")
        full = [0.0] * 48
        for _, r in intr.iterrows():
            full[int(r.slot)] = round(float(r.v), 1)
        return {"intraday": full, "steps": int(k.steps or 0), "kcal": int(k.kcal or 0),
                "users": int(k.users or 0), "user_days": int(k.user_days or 0),
                "budget": {r.z: round(float(r.hrs), 2) for _, r in tb.iterrows()}}

    activity = {}
    for dt, dtw in DTS:
        for sg, sgw in [("All", "TRUE")] + [(str(s["id"]), f"seg={s['id']}") for s in segments]:
            activity[f"{dt}|{sg}"] = act_slice(f"({dtw}) AND ({sgw})")
    OUT["activity"] = activity

    OUT["daily"] = recs(q(f"""
        WITH ud AS (SELECT user_id, d, {DAYTYPE} AS daytype, sum(steps) AS st FROM h GROUP BY 1,2)
        SELECT d::VARCHAR AS d, strftime(d,'%a') AS dow, any_value(daytype) AS daytype,
          round(avg(st)) AS steps, count(*) AS users,
          round(quantile_cont(st,0.10)) AS p10, round(quantile_cont(st,0.25)) AS p25,
          round(quantile_cont(st,0.50)) AS p50, round(quantile_cont(st,0.75)) AS p75,
          round(quantile_cont(st,0.90)) AS p90
        FROM ud GROUP BY d ORDER BY d"""))
    OUT["user_hist"] = recs(q("""WITH u AS (SELECT user_id, sum(steps)*1.0/count(DISTINCT d) AS spd FROM h GROUP BY 1)
        SELECT least(floor(spd/2000)*2000, 20000)::INT AS lo, count(*) AS n FROM u GROUP BY 1 ORDER BY 1"""))
    OUT["wkend_contrast"] = recs(q("""
        WITH ud AS (SELECT user_id, d, dayofweek(d) IN (0,6) AS wkend, sum(steps) AS st FROM h GROUP BY 1,2,3),
        u AS (SELECT user_id, avg(st) FILTER (NOT wkend) AS school_st, avg(st) FILTER (wkend) AS wk_st,
                count(*) FILTER (NOT wkend) AS nd, count(*) FILTER (wkend) AS nw FROM ud GROUP BY 1)
        SELECT round(least(greatest(wk_st/school_st, 0), 2)/0.2)*0.2 AS ratio, count(*) AS n
        FROM u WHERE nd >= 3 AND nw >= 2 AND school_st > 500 GROUP BY 1 ORDER BY 1"""))

    OUT["wear"] = {
        "days_hist": recs(q("""SELECT wear_days AS days, count(*) AS n FROM
            (SELECT user_id, count(DISTINCT d) AS wear_days FROM h GROUP BY 1) GROUP BY 1 ORDER BY 1""")),
        "cohorts": recs(q("""WITH u AS (SELECT user_id, count(DISTINCT d) AS wd,
              sum(steps)*1.0/count(DISTINCT d) AS spd,
              count(DISTINCT CASE WHEN dayofweek(d) IN (0,6) THEN d END) AS wkd FROM h GROUP BY 1)
            SELECT CASE WHEN wd >= 25 THEN 'Daily wearers (25d+)' WHEN wd >= 15 THEN 'Regular (15-24d)'
                        WHEN wd >= 5 THEN 'Occasional (5-14d)' ELSE 'Tried it (1-4d)' END AS cohort,
              count(*) AS users, round(avg(spd)) AS steps, round(avg(wkd*1.0/8)*100) AS weekend_pct
            FROM u GROUP BY 1 ORDER BY min(wd) DESC""")),
        "daily_active": recs(q("""WITH first AS (SELECT user_id, min(d) AS fd FROM h GROUP BY 1)
            SELECT h.d::VARCHAR AS d, count(DISTINCT h.user_id) AS users,
              count(DISTINCT CASE WHEN f.fd = h.d THEN h.user_id END) AS new_users
            FROM h JOIN first f USING (user_id) GROUP BY h.d ORDER BY h.d""")),
    }

    # ── heart rate: NO firmware in raw → single "All"; hour + resting derived from bpm ─────────────
    con.sql(f"""CREATE OR REPLACE VIEW rv AS
      SELECT *, {DAYTYPE} AS daytype FROM (
        SELECT bpm_number, user_id, CAST(to_timestamp(recorded_time) AS DATE) AS d,
               hour(to_timestamp(recorded_time)) AS hr_hour
        FROM src_hr WHERE bpm_number BETWEEN 30 AND 220
          AND CAST(to_timestamp(recorded_time) AS DATE) BETWEEN DATE '{LO}' AND DATE '{HI}')""")
    curves = {}
    for dt, dtw in DTS:
        cur = q(f"SELECT hr_hour AS hh, avg(bpm_number) AS bpm, count(*) AS n FROM rv WHERE {dtw} GROUP BY 1 ORDER BY 1")
        full = [None] * 24; ns = [0] * 24
        for _, rr in cur.iterrows():
            full[int(rr.hh)] = round(float(rr.bpm), 1); ns[int(rr.hh)] = int(rr.n)
        curves[f"All|{dt}"] = {"bpm": full, "n": ns}
    zones_hourly = {}
    for dt, dtw in DTS[1:]:   # skip "All"
        zh = q(f"""SELECT hr_hour AS hh, 100.0*count(*) FILTER (bpm_number >= 100)/count(*) AS mod,
            100.0*count(*) FILTER (bpm_number >= 120)/count(*) AS vig FROM rv WHERE {dtw} GROUP BY 1 ORDER BY 1""")
        zones_hourly[dt] = [{"hh": int(r.hh), "mod": round(float(r["mod"]), 1), "vig": round(float(r.vig), 1)} for _, r in zh.iterrows()]
    zones_daily = recs(q("""SELECT daytype,
        round(count(*) FILTER (bpm_number < 80)*1.0/count(DISTINCT (user_id,d)), 2) AS rest,
        round(count(*) FILTER (bpm_number >= 80 AND bpm_number < 100)*1.0/count(DISTINCT (user_id,d)), 2) AS light,
        round(count(*) FILTER (bpm_number >= 100 AND bpm_number < 120)*1.0/count(DISTINCT (user_id,d)), 2) AS mod,
        round(count(*) FILTER (bpm_number >= 120)*1.0/count(DISTINCT (user_id,d)), 2) AS vig FROM rv GROUP BY 1"""))
    OUT["hr"] = {
        "firmwares": ["All"], "curves": curves, "zones_hourly": zones_hourly, "zones_daily": zones_daily,
        "resting": recs(q("""WITH ud AS (SELECT user_id, d, min(bpm_number) AS r FROM rv GROUP BY 1,2),
            u AS (SELECT user_id, avg(r) AS r FROM ud GROUP BY 1)
            SELECT (floor(r/5)*5)::INT AS lo, count(*) AS n FROM u WHERE r BETWEEN 40 AND 120 GROUP BY 1 ORDER BY 1""")),
        "fw_table": [],
    }

    # ── spending: level × category (txn-based) ──────────────────────────────────────
    con.sql(STALLCAT_SQL)
    con.sql("""CREATE OR REPLACE VIEW txm AS
      SELECT tx.*, sc.mcat FROM tx JOIN stallcat sc USING (schoolId, storeId)""")
    CATS = list(TAX_CATS); LVLS = ["Primary", "Secondary", "Junior College", "Other"]
    spend = {"levels": ["All"] + LVLS, "cats": ["All"] + CATS, "daily": {}, "hourly": {}, "kpis": {}}
    for lvn, lvw in [("All", "TRUE")] + [(l, f"lvl='{l}'") for l in LVLS]:
        for ct, ctw in [("All", "TRUE")] + [(c, f"mcat='{c}'") for c in CATS]:
            key = f"{lvn}|{ct}"
            dd = q(f"SELECT d::VARCHAR AS d, round(sum(amount)/100.0) AS v FROM txm WHERE ({lvw}) AND ({ctw}) GROUP BY 1")
            dmap = {r.d: float(r.v) for _, r in dd.iterrows()}
            spend["daily"][key] = [dmap.get(x, 0) for x in DAYS]
            hh = q(f"""SELECT hh, round(sum(amount)/100.0) AS v FROM txm
                WHERE ({lvw}) AND ({ctw}) AND {DAYTYPE}='School' AND hh BETWEEN 5 AND 19 GROUP BY 1""")
            hmap = {int(r.hh): float(r.v) for _, r in hh.iterrows()}
            spend["hourly"][key] = [hmap.get(x, 0) for x in range(5, 20)]
            k = q(f"""SELECT count(*) AS n, round(sum(amount)/100.0) AS rev, round(avg(amount)/100.0,2) AS ticket,
                count(DISTINCT cardId) AS cards FROM txm WHERE ({lvw}) AND ({ctw})""").iloc[0]
            spend["kpis"][key] = {"n": int(k.n), "rev": (0.0 if pd.isna(k.rev) else float(k.rev)),
                                  "ticket": (None if pd.isna(k.ticket) else float(k.ticket)), "cards": int(k.cards)}
    spend["mix"] = {lvn: recs(q(f"""SELECT mcat, count(*) AS n, round(sum(amount)/100.0) AS sgd
        FROM txm WHERE {'TRUE' if lvn=='All' else f"lvl='{lvn}'"} GROUP BY 1 ORDER BY 2 DESC"""))
        for lvn in ["All"] + LVLS}
    OUT["spend"] = spend

    # ── calendar story (CNY for Feb, detected school-break for others) ───────────────
    if special:
        st = {k: special[k] for k in ("code", "label", "daytype", "daytype_label", "marked_days", "intro")}
        st["periods"] = [p for p, _ in special["periods"]]
        st.update({"intraday": {}, "budget": {}, "hr": {}, "catmix": {}, "kpis": {}})
        for name, w in special["periods"]:
            a = act_slice(w)
            st["intraday"][name] = a["intraday"]; st["budget"][name] = a["budget"]
            st["kpis"][name] = {"steps": a["steps"], "kcal": a["kcal"], "users": a["users"]}
            hrc = q(f"SELECT hr_hour AS hh, avg(bpm_number) AS bpm FROM rv WHERE {w} GROUP BY 1 ORDER BY 1")
            full = [None] * 24
            for _, rr in hrc.iterrows():
                full[int(rr.hh)] = round(float(rr.bpm), 1)
            st["hr"][name] = full
            cm = q(f"SELECT mcat, round(sum(amount)/100.0) AS sgd FROM txm WHERE {w} GROUP BY 1")
            tot = cm["sgd"].sum()
            st["catmix"][name] = ({r.mcat: round(100.0 * float(r.sgd) / tot, 1) for _, r in cm.iterrows()} if tot > 0 else {})
            rev = q(f"SELECT round(sum(amount)/100.0) AS rev, count(*) AS n FROM txm WHERE {w}").iloc[0]
            st["kpis"][name]["rev"] = (0.0 if pd.isna(rev.rev) else float(rev.rev)); st["kpis"][name]["txns"] = int(rev.n)
        OUT["special"] = st
    else:
        OUT["special"] = None

    # ── meta ─────────────────────────────────────────────────────────────────────────
    mh = con.sql("SELECT count(*), count(DISTINCT user_id) FROM src_health").fetchall()[0]
    mr = con.sql("SELECT count(*), count(DISTINCT user_id) FROM src_hr").fetchall()[0]
    mt = con.sql("SELECT count(*), round(sum(amount)/100.0), count(DISTINCT schoolId), count(DISTINCT cardId) FROM txm").fetchall()[0]
    OUT["meta"] = {"month": month, "days": len(DAYS), "h_rows": mh[0], "h_users": mh[1],
                   "r_rows": mr[0], "r_users": mr[1],
                   "t_rows": mt[0], "t_rev": mt[1], "t_schools": mt[2], "t_cards": mt[3]}
    con.close()

    size = put(client, month, "wearable", OUT)
    print(f"  -> insights[{month}/wearable]  {size//1024} KB ({round(time.time()-t0)}s total)")
    return [("wearable", size)]


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else MONTH)
