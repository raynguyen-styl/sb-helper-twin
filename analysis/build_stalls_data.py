"""Build stalls.json — per-stall and per-machine (terminal) data for the map app's
Stall Explorer and Engineering windows. February 2026.

Everything is precomputed per entity (2.5K stalls / 2.6K machines) and filtered
client-side — the app stays static, no backend.

CLASSIFICATION POLICY (supervisor-mandated, 7 Jul 2026): categories come ONLY from
descriptive stall names. Generic-named stalls ("Stall 1"...) are 'Unclassified' —
described by price bands, never assigned a food type (k-means guessing removed).

Verdict logic (machine vs location): a terminal is compared to its school peers
(other terminals in the same school). Bad terminal + healthy peers => the machine;
bad terminal + bad peers => the site (location/network).

Reads  parquet/feb_txn.parquet, parquet/txn_perf_202602.parquet, school_geo.json
Writes appdata/stalls.json   (copy to smart-buddy-app/src/data/)
"""
import duckdb, json, os, time
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect(); con.sql("SET timezone='Asia/Singapore'")
t0 = time.time()
def q(s): return con.sql(s).df()

geo = json.load(open(os.path.join(HERE, "school_geo.json")))
FEB_DAYS = [f"2026-02-{i:02d}" for i in range(1, 29)]

# ---------------- taxonomy: shared module (v2: Mixed + behavior veto) ----------------
from taxonomy import STALLCAT_SQL, CATS as TAX_CATS
LEVEL = """CASE
 WHEN schoolId = 'NYP' OR schoolId = 'SOTA' THEN 'Other'
 WHEN schoolId LIKE '%JC' THEN 'Junior College'
 WHEN schoolId LIKE '%PS' OR schoolId LIKE '%P' THEN 'Primary'
 WHEN schoolId LIKE '%SS' OR schoolId LIKE '%GS' OR schoolId LIKE '%HS' THEN 'Secondary'
 ELSE 'Other' END"""

con.sql(f"""CREATE OR REPLACE VIEW tx AS
SELECT *, {LEVEL} AS lvl_sfx, extract(hour FROM txn_time) AS hh,
  txn_date AS d,
  CASE WHEN txn_date BETWEEN DATE '2026-02-16' AND DATE '2026-02-18' THEN 'CNY'
       WHEN dayofweek(txn_date) IN (0,6) THEN 'Weekend' ELSE 'School' END AS daytype
FROM '{PQ}/feb_txn.parquet'
WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000""")

# category per STALL from taxonomy.py (name evidence + behavior veto, Mixed for combos)
con.sql(STALLCAT_SQL)
con.sql("""CREATE OR REPLACE VIEW txm AS
SELECT tx.*, sc.mcat FROM tx JOIN stallcat sc USING (schoolId, storeId)""")
print("taxonomy", round(time.time()-t0), "s", flush=True)

lvl_geo = {sid: (g.get("level") or "").upper() for sid, g in geo.items()}
def eff(sid, sfx):
    ml = lvl_geo.get(sid, "")
    if ml.startswith("PRIMARY"): return "Primary"
    if ml.startswith("SECONDARY"): return "Secondary"
    if ml.startswith("JUNIOR COLLEGE"): return "Junior College"
    return sfx

# ---------------- per-stall ----------------
base = q("""SELECT storeId, any_value(storeName) AS name, any_value(schoolId) AS school,
  any_value(lvl_sfx) AS lvl_sfx, any_value(mcat) AS cat,
  count(*) AS n, round(sum(amount)/100.0) AS rev, round(avg(amount)/100.0,2) AS ticket,
  round(100.0*count(*) FILTER (amount<=100)/count(*)) AS b1,
  round(100.0*count(*) FILTER (amount>100 AND amount<=200)/count(*)) AS b2,
  round(100.0*count(*) FILTER (amount>200 AND amount<=300)/count(*)) AS b3,
  round(100.0*count(*) FILTER (amount>300)/count(*)) AS b4
FROM txm GROUP BY storeId""")
terms_of = q("SELECT storeId, list(DISTINCT terminalId) AS terms FROM txm GROUP BY 1")
daily = q("SELECT storeId, d::VARCHAR AS d, round(sum(amount)/100.0) AS v FROM txm GROUP BY 1,2")
hourly = q("""SELECT storeId, hh, round(sum(amount)/100.0) AS v FROM txm
WHERE daytype='School' AND hh BETWEEN 5 AND 19 GROUP BY 1,2""")
prices = q("""SELECT storeId, amount, count(*) AS n,
  row_number() OVER (PARTITION BY storeId ORDER BY count(*) DESC) AS rk
FROM txm GROUP BY 1,2 QUALIFY rk <= 3 ORDER BY storeId, rk""")

dmap, hmap, pmap, tmap = {}, {}, {}, {}
for sid, g in daily.groupby("storeId"):
    m = dict(zip(g.d, g.v)); dmap[sid] = [int(m.get(x, 0)) for x in FEB_DAYS]
for sid, g in hourly.groupby("storeId"):
    m = dict(zip(g.hh, g.v)); hmap[sid] = [int(m.get(x, 0)) for x in range(5, 20)]
for sid, g in prices.groupby("storeId"):
    pmap[sid] = [[int(a), int(n)] for a, n in zip(g.amount, g.n)]
for _, r in terms_of.iterrows():
    tmap[r.storeId] = list(r.terms)

stalls = []
for _, r in base.iterrows():
    stalls.append({"id": r.storeId, "name": r["name"], "school": r.school,
        "level": eff(r.school, r.lvl_sfx), "cat": r["cat"],   # r.cat hits pandas' .cat accessor
        "terms": tmap.get(r.storeId, []), "n": int(r.n), "rev": int(r.rev),
        "ticket": float(r.ticket), "bands": [int(r.b1), int(r.b2), int(r.b3), int(r.b4)],
        "daily": dmap.get(r.storeId, [0]*28), "hourly": hmap.get(r.storeId, [0]*15),
        "prices": pmap.get(r.storeId, [])})
print("stalls", len(stalls), round(time.time()-t0), "s", flush=True)

# ---------------- per-terminal (machine) ----------------
con.sql(f"""CREATE OR REPLACE VIEW pf AS
SELECT * FROM '{PQ}/txn_perf_202602.parquet' WHERE schoolId != 'STYL' AND startToFinish > 0""")
tbase = q("""
WITH t AS (SELECT terminalId, any_value(schoolId) AS school, any_value(storeId) AS store,
    count(*) AS n,
    round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),1) AS err_pct,
    round(100.0*count(*) FILTER (paymentMode='OFFLINE')/count(*),1) AS off_pct
  FROM txm GROUP BY 1),
p AS (SELECT terminalId, round(median(startToFinish)) AS med_ms, round(quantile_cont(startToFinish,0.95)) AS p95_ms,
    round(median(checkSignal)) AS c_sig, round(median(openSocket)) AS c_sock,
    round(median(handshake)) AS c_hs, round(median(sendToReceiveData)) AS c_xfer,
    round(median(tapCardToFinish)) AS c_tap,
    any_value(posNetworkType) AS net,
    round(median(posSignalStrength) FILTER (posSignalStrength BETWEEN 0 AND 31)) AS sig,
    round(median(posSignalStrength) FILTER (posSignalStrength < 0)) AS rssi
  FROM pf GROUP BY 1)
SELECT t.*, p.med_ms, p.p95_ms, p.c_sig, p.c_sock, p.c_hs, p.c_xfer, p.c_tap, p.net, p.sig, p.rssi
FROM t LEFT JOIN p USING (terminalId)""")
tdaily = q("""SELECT terminalId, d::VARCHAR AS d,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),1) AS err,
  count(*) AS n FROM txm GROUP BY 1,2""")
pdaily = q("""SELECT terminalId, txn_date::VARCHAR AS d, round(median(startToFinish)) AS ms
FROM pf GROUP BY 1,2""")

temap, tsmap = {}, {}
for tid, g in tdaily.groupby("terminalId"):
    m = dict(zip(g.d, g.err)); temap[tid] = [(None if x not in m else float(m[x])) for x in FEB_DAYS]
for tid, g in pdaily.groupby("terminalId"):
    m = dict(zip(g.d, g.ms)); tsmap[tid] = [(None if x not in m else int(m[x])) for x in FEB_DAYS]

# school-peer baselines for the machine-vs-site verdict (terminals with >=300 txns)
tb = tbase[tbase.n >= 1]
peers = {}
for school, g in tb[tb.n >= 300].groupby("school"):
    peers[school] = g[["terminalId", "err_pct", "med_ms"]]

name_of = {s["id"]: s["name"] for s in stalls}
terminals = []
for _, r in tb.iterrows():
    pg = peers.get(r.school)
    peer_err = peer_ms = None
    if pg is not None:
        others = pg[pg.terminalId != r.terminalId]
        if len(others) >= 2:
            peer_err = round(float(others.err_pct.median()), 1)
            peer_ms = (None if others.med_ms.isna().all() else int(others.med_ms.median()))
    # verdict
    verdict = "ok"
    bad_err = r.err_pct >= 10 and r.n >= 300
    slow = (not pd.isna(r.med_ms)) and r.med_ms >= 4000
    if bad_err or slow:
        peer_bad = (peer_err is not None and peer_err >= 8) or (peer_ms is not None and peer_ms >= 4000)
        if peer_err is None and peer_ms is None:
            verdict = "check"          # nothing to compare against
        elif peer_bad:
            verdict = "site"           # peers struggle too -> location/network
        else:
            verdict = "machine"        # peers healthy -> this unit
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
        "daily_err": temap.get(r.terminalId, [None]*28),
        "daily_ms": tsmap.get(r.terminalId, [None]*28),
        "peer_err": peer_err, "peer_ms": peer_ms, "verdict": verdict})
print("terminals", len(terminals), round(time.time()-t0), "s", flush=True)

# ---------------- meta ----------------
m = q("SELECT count(*) AS n, round(sum(amount)/100.0) AS rev, count(DISTINCT schoolId) AS sch FROM txm").iloc[0]
OUT = {"meta": {"period": "February 2026", "txns": int(m.n), "rev": int(m.rev),
                "schools": int(m.sch), "stalls": len(stalls), "terminals": len(terminals),
                "generated": "2026-07-06"},
       "cats": list(TAX_CATS),
       "bands": ["≤$1", "$1–2", "$2–3", ">$3"],
       "stalls": stalls, "terminals": terminals}

os.makedirs(os.path.join(HERE, "appdata"), exist_ok=True)
path = os.path.join(HERE, "appdata", "stalls.json")
json.dump(OUT, open(path, "w", encoding="utf-8"), ensure_ascii=False, allow_nan=False)
print("WROTE", path, os.path.getsize(path)//1024, "KB", round(time.time()-t0), "s")
