"""Build the SMART Buddy map-app dataset: per-school, per-terminal, and global JSON.

CLASSIFICATION POLICY (supervisor-mandated, 7 Jul 2026): food categories come ONLY
from descriptive stall names; generic-named stalls are 'Unclassified' (k-means
price-archetype guessing removed)."""
import duckdb, json, os, time
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect(); con.sql("SET timezone='Asia/Singapore'")
t0 = time.time()
def q(s): return con.sql(s).df()
def recs(df): return json.loads(df.to_json(orient="records"))

geo = json.load(open(os.path.join(HERE, "school_geo.json")))

NAMECAT = """CASE
 WHEN lower(storeName) ~ '.*(book|education|supply|supplies|marketing|stationer|uniform|pte ltd|enterprise|trading).*' THEN 'Bookshop & Supplies'
 WHEN lower(storeName) ~ '.*(fruit).*' THEN 'Fruits'
 WHEN lower(storeName) ~ '.*(drink|cool |cups|cans|juice|avalanche|beverage|bubble|milk|tea |coffee|kopi|quench|thirst|arctic|antartic|freez|expresso|espresso|chill|sip|refreshing).*' THEN 'Drinks'
 WHEN lower(storeName) ~ '.*(snack|dessert|bites|waffle|ice cream|ice-cream|icecream|muffin|bakery|bread|toast|cookie|pastr|donut|popcorn|sweet).*' THEN 'Snacks & Desserts'
 WHEN lower(storeName) ~ '.*(food|rice|noodle|mee |sushi|western|chicken|nasi|pasta|cuisine|medley|kitchen|delight|malay|halal|japanese|korean|soup|porridge|economy|vegetarian|duck|fish|laksa|wanton|ban mian|delicious|cafe|deli |wok|bowl|dim sum|grill|bento|curry|hot stall|rib).*' THEN 'Cooked Food'
 ELSE 'Generic' END"""
LEVEL = """CASE
 WHEN schoolId = 'NYP' OR schoolId = 'SOTA' THEN 'Other'
 WHEN schoolId LIKE '%JC' THEN 'Junior College'
 WHEN schoolId LIKE '%PS' OR schoolId LIKE '%P' THEN 'Primary'
 WHEN schoolId LIKE '%SS' OR schoolId LIKE '%GS' OR schoolId LIKE '%HS' THEN 'Secondary'
 ELSE 'Other' END"""

con.sql(f"""CREATE OR REPLACE VIEW tx AS
SELECT *, {NAMECAT} AS namecat, {LEVEL} AS level, extract(hour FROM txn_time) AS hh,
  date_trunc('week', txn_date) AS wk
FROM '{PQ}/txn.parquet'
WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000""")

# ---- category = verified stall name ONLY; generic names stay Unclassified ----
con.sql("""CREATE OR REPLACE VIEW txm AS
  SELECT tx.*, CASE WHEN namecat = 'Generic' THEN 'Unclassified' ELSE namecat END AS mcat FROM tx""")
print("taxonomy", time.time()-t0, flush=True)

OUT = {}

# ================= GLOBAL =================
OUT["daily"] = recs(q(f"""
SELECT t.txn_date::VARCHAR AS date, count(*) AS n, round(sum(t.amount)/100.0,0) AS sgd,
  round(100.0*count(*) FILTER (t.paymentMode='OFFLINE')/count(*),1) AS offline_pct,
  round(100.0*count(*) FILTER (t.errorCode IS NOT NULL AND t.errorCode != '0')/count(*),1) AS err_pct,
  round(median(p.startToFinish),0) AS med_ms, round(quantile_cont(p.startToFinish,0.95),0) AS p95_ms
FROM '{PQ}/txn.parquet' t JOIN '{PQ}/txn_perf.parquet' p USING (id)
WHERE t.schoolId != 'STYL' AND p.startToFinish > 0
GROUP BY 1 ORDER BY 1"""))

OUT["speed_weekly_by_stack"] = recs(q(f"""
SELECT date_trunc('week', txn_date)::VARCHAR AS week, paymentType,
  round(median(startToFinish),0) AS med_ms, count(*) AS n
FROM '{PQ}/txn_perf.parquet' WHERE startToFinish > 0
  AND txn_date BETWEEN '2026-02-02' AND '2026-04-26'
  AND paymentType IN ('SSS','CONCESSION 2.0 ASCAN','Smart Buddy/ATM','CONCESSION 3.0 ASCAN','EZLINK 2.0 ASCAN','NETS FlashPay')
GROUP BY 1,2 ORDER BY 1,2"""))

OUT["speed_components_monthly"] = recs(q(f"""
SELECT strftime(txn_date,'%Y-%m') AS month,
  round(median(checkSignal),0) AS checkSignal, round(median(openSocket),0) AS openSocket,
  round(median(handshake),0) AS handshake, round(median(sendToReceiveData),0) AS transfer,
  round(median(tapCardToFinish),0) AS tapToFinish, round(median(startToFinish),0) AS total,
  count(*) AS n
FROM '{PQ}/txn_perf.parquet' WHERE startToFinish > 0 AND paymentMode='ONLINE'
GROUP BY 1 ORDER BY 1"""))

OUT["speed_hist"] = recs(q(f"""SELECT CASE
  WHEN startToFinish<1000 THEN '<1s' WHEN startToFinish<2000 THEN '1-2s' WHEN startToFinish<3000 THEN '2-3s'
  WHEN startToFinish<5000 THEN '3-5s' WHEN startToFinish<10000 THEN '5-10s' ELSE '>10s' END AS bucket,
  min(startToFinish) AS ord, count(*) AS n
FROM '{PQ}/txn_perf.parquet' WHERE startToFinish>0 GROUP BY 1 ORDER BY min(startToFinish)"""))

OUT["network_mix"] = recs(q(f"""SELECT posNetworkType, count(DISTINCT terminalId) AS terminals, count(*) AS n,
  round(median(startToFinish),0) AS med_ms, round(quantile_cont(startToFinish,0.95),0) AS p95_ms
FROM '{PQ}/txn_perf.parquet' WHERE startToFinish>0 AND posNetworkType IN ('4G','WIFI','ETHERNET')
GROUP BY 1 ORDER BY n DESC"""))

OUT["signal_dist"] = recs(q(f"""SELECT posSignalStrength AS sig, count(*) AS n
FROM '{PQ}/txn_perf.parquet' WHERE posSignalStrength BETWEEN 0 AND 31 AND posNetworkType='4G'
GROUP BY 1 ORDER BY 1"""))

OUT["food_weekly"] = recs(q("""SELECT wk::VARCHAR AS week, mcat, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
  round(avg(amount),1) AS avg_cents
FROM txm WHERE txn_date BETWEEN '2026-02-02' AND '2026-04-26' GROUP BY 1,2 ORDER BY 1,2"""))

OUT["food_mix"] = recs(q("""SELECT mcat, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
  round(avg(amount)/100.0,2) AS avg_sgd FROM txm GROUP BY 1 ORDER BY n DESC"""))

OUT["food_hour"] = recs(q("""SELECT hh AS hour, mcat, count(*) AS n FROM txm
WHERE hh BETWEEN 6 AND 17 GROUP BY 1,2 ORDER BY 1,2"""))
print("global", time.time()-t0, flush=True)

# ================= PER SCHOOL =================
base = q("""
WITH c AS (SELECT schoolId, cardId, count(*) AS n, sum(amount) AS amt, count(DISTINCT txn_date) AS days
  FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2)
SELECT schoolId, count(*) AS cards, round(avg(amt/days)/100.0,2) AS spend_day,
  round(avg(n*1.0/days),2) AS txns_day FROM c GROUP BY 1""")
tots = q(f"""
SELECT t.schoolId, any_value({LEVEL.replace('schoolId','t.schoolId')}) AS level, count(*) AS n,
  round(sum(t.amount)/100.0,0) AS sgd, round(avg(t.amount)/100.0,2) AS avg_ticket,
  count(DISTINCT t.terminalId) AS terminals, count(DISTINCT t.storeId) AS stores,
  round(100.0*count(*) FILTER (t.paymentMode='OFFLINE')/count(*),1) AS offline_pct,
  round(100.0*count(*) FILTER (t.errorCode IS NOT NULL AND t.errorCode != '0')/count(*),1) AS err_pct
FROM '{PQ}/txn.parquet' t WHERE t.schoolId != 'STYL' GROUP BY 1""")
spd = q(f"""SELECT schoolId, round(median(startToFinish),0) AS med_ms,
  round(quantile_cont(startToFinish,0.95),0) AS p95_ms,
  round(median(posSignalStrength) FILTER (posSignalStrength BETWEEN 0 AND 31),0) AS med_sig,
  count(DISTINCT terminalId) FILTER (posNetworkType='WIFI') AS wifi_terms
FROM '{PQ}/txn_perf.parquet' WHERE startToFinish>0 AND schoolId != 'STYL' GROUP BY 1""")
mix = q("""SELECT schoolId, mcat, count(*) AS n FROM txm GROUP BY 1,2""")
mixp = mix.pivot_table(index="schoolId", columns="mcat", values="n", fill_value=0)
mixp = mixp.div(mixp.sum(axis=1), axis=0).round(3)
wkspd = q(f"""SELECT schoolId, date_trunc('week',txn_date)::VARCHAR AS week,
  round(median(startToFinish),0) AS med_ms FROM '{PQ}/txn_perf.parquet'
WHERE startToFinish>0 AND schoolId!='STYL'
  AND txn_date BETWEEN '2026-02-02' AND '2026-04-26' GROUP BY 1,2""")
wkspend = q("""SELECT schoolId, wk::VARCHAR AS week, round(sum(amount)/100.0,0) AS sgd, count(*) AS n
FROM txm WHERE txn_date BETWEEN '2026-02-02' AND '2026-04-26' GROUP BY 1,2""")

def eff_level(inferred, moe_level):
    """MOE mainlevel wins over suffix inference when it maps cleanly."""
    ml = (moe_level or "").upper()
    if ml.startswith("PRIMARY"): return "Primary"
    if ml.startswith("SECONDARY"): return "Secondary"
    if ml.startswith("JUNIOR COLLEGE"): return "Junior College"
    return inferred

schools = {}
for _, r in tots.iterrows():
    sid = r["schoolId"]
    g = geo.get(sid, {})
    b = base[base["schoolId"]==sid]
    s = spd[spd["schoolId"]==sid]
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
        "wk_spend": recs(wkspend[wkspend["schoolId"]==sid][["week","sgd","n"]]),
        "wk_speed": recs(wkspd[wkspd["schoolId"]==sid][["week","med_ms"]]),
    }
print("schools", time.time()-t0, flush=True)

# ================= TERMINALS =================
terms = q(f"""
SELECT p.terminalId, any_value(p.schoolId) AS school, count(*) AS n,
  round(median(p.startToFinish),0) AS med_ms, round(quantile_cont(p.startToFinish,0.95),0) AS p95_ms,
  any_value(p.posNetworkType) AS net,
  round(median(p.posSignalStrength) FILTER (p.posSignalStrength BETWEEN 0 AND 31),0) AS med_sig,
  round(median(p.posSignalStrength) FILTER (p.posSignalStrength < 0),0) AS med_rssi,
  round(100.0*count(*) FILTER (t.errorCode IS NOT NULL AND t.errorCode!='0')/count(*),1) AS err_pct,
  round(100.0*count(*) FILTER (t.paymentMode='OFFLINE')/count(*),1) AS offline_pct
FROM '{PQ}/txn_perf.parquet' p JOIN '{PQ}/txn.parquet' t USING (id)
WHERE p.schoolId != 'STYL' AND p.startToFinish > 0
GROUP BY p.terminalId HAVING count(*) >= 200""")
OUT["terminals"] = recs(terms)
print("terminals", time.time()-t0, flush=True)

# ================= ATAS (matched schools only) =================
rows = []
for sid, s in schools.items():
    if s["moe_type"] and s["spend_day"]:
        rows.append({"sid": sid, "type": s["moe_type"], "ip": s["ip"], "gifted": s["gifted"],
                     "level": s["level"], "spend_day": s["spend_day"], "avg_ticket": s["avg_ticket"]})
at = pd.DataFrame(rows)
def grp(df, col):
    g = df.groupby(col).agg(schools=("sid","count"), spend_day=("spend_day","mean"),
        avg_ticket=("avg_ticket","mean")).round(2).reset_index()
    return recs(g)
OUT["atas"] = {
    "by_type": grp(at, "type"),
    "by_type_level": recs(at.groupby(["level","type"]).agg(schools=("sid","count"),
        spend_day=("spend_day","mean")).round(2).reset_index()),
    "by_ip": grp(at[at["level"].isin(["Secondary","Junior College"])], "ip"),
    "by_gep": grp(at[at["level"]=="Primary"], "gifted"),
    "coverage": {"matched": len(rows), "total": len(schools)},
}

meta = {"generated": "2026-07-06", "period": "2026-02-01 to 2026-04-30",
        "schools_total": len(schools), "schools_mapped": sum(1 for s in schools.values() if s["lat"]),
        "txns": int(tots["n"].sum()), "sgd": float(tots["sgd"].sum())}
OUT["meta"] = meta

os.makedirs(os.path.join(HERE, "appdata"), exist_ok=True)
json.dump(OUT, open(os.path.join(HERE, "appdata", "global.json"), "w"))
json.dump(schools, open(os.path.join(HERE, "appdata", "schools.json"), "w"))
print("WROTE appdata", time.time()-t0, "| mapped:", meta["schools_mapped"], "/", meta["schools_total"])
