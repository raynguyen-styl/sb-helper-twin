"""Feb 2026 service-team report dataset.
Answers a service supervisor's five asks, February 2026 ONLY:
  1) network health for terminals   2) transaction speed trends
  3) food items (drinks/snacks/meals)   4) spending per school ("atas")
  5) trends in food types
Includes machine-vs-location fault verdicts (same logic as build_stalls_data.py)
and flags the Chinese New Year window (16-18 Feb) everywhere it distorts $/food.

CLASSIFICATION POLICY (supervisor-mandated, 7 Jul 2026): food categories come ONLY
from descriptive stall names (keyword match = verified). Stalls with generic names
("Stall 1"...) are 'Unclassified' and described by factual price bands only —
NO price-based category guessing (the old k-means archetype step is removed).

Reads  parquet/feb_txn.parquet, parquet/txn_perf_202602.parquet, school_geo.json
Writes feb_service.json  (spliced into feb_service_report.html -> PDF)
"""
import duckdb, json, os, time
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect(); con.sql("SET timezone='Asia/Singapore'")
t0 = time.time()
def q(s): return con.sql(s).df()
def recs(df): return json.loads(df.to_json(orient="records"))
def num(v, d=0.0): return d if (v is None or (isinstance(v, float) and pd.isna(v))) else v

geo = json.load(open(os.path.join(HERE, "school_geo.json")))
FEB_DAYS = [f"2026-02-{i:02d}" for i in range(1, 29)]
FTX = f"'{PQ}/feb_txn.parquet'"
FPF = f"'{PQ}/txn_perf_202602.parquet'"
EXCL = "schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000"

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

# CNY window = 16-18 Feb (project convention). Day types: CNY / Weekend / School.
con.sql(f"""CREATE OR REPLACE VIEW tx AS
SELECT *, {NAMECAT} AS namecat, {LEVEL} AS lvl_sfx, extract(hour FROM txn_time) AS hh,
  date_trunc('week', txn_date) AS wk,
  CASE WHEN txn_date BETWEEN DATE '2026-02-16' AND DATE '2026-02-18' THEN 'CNY'
       WHEN dayofweek(txn_date) IN (0,6) THEN 'Weekend' ELSE 'School' END AS daytype
FROM {FTX} WHERE {EXCL}""")

# ----- category = verified stall name ONLY; generic names stay Unclassified -----
con.sql("""CREATE OR REPLACE VIEW txm AS
  SELECT tx.*, CASE WHEN namecat = 'Generic' THEN 'Unclassified' ELSE namecat END AS mcat FROM tx""")
# speed view (perf parquet, only STYL + zero-duration excluded — no storeName/amount there)
con.sql(f"""CREATE OR REPLACE VIEW pf AS
  SELECT * FROM {FPF} WHERE schoolId != 'STYL' AND startToFinish > 0""")
print("taxonomy", round(time.time()-t0), "s", flush=True)

OUT = {}

# =====================================================================
# META / KPIs
# =====================================================================
m = q("""SELECT count(*) AS txns, round(sum(amount)/100.0) AS rev,
  count(DISTINCT schoolId) AS schools, count(DISTINCT terminalId) AS terminals,
  count(DISTINCT storeId) AS stores, count(DISTINCT cardId) AS cards,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),1) AS err_pct,
  round(100.0*count(*) FILTER (paymentMode='OFFLINE')/count(*),1) AS offline_pct
FROM txm""").iloc[0]
sp = q("SELECT round(median(startToFinish)) AS med_ms, round(quantile_cont(startToFinish,0.95)) AS p95_ms FROM pf").iloc[0]
OUT["meta"] = {"period": "February 2026", "generated": "2026-07-06",
    "txns": int(m.txns), "rev": int(m.rev), "schools": int(m.schools),
    "terminals": int(m.terminals), "stores": int(m.stores), "cards": int(m.cards),
    "err_pct": float(m.err_pct), "offline_pct": float(m.offline_pct),
    "med_ms": int(sp.med_ms), "p95_ms": int(sp.p95_ms),
    "cny_days": ["2026-02-16", "2026-02-17", "2026-02-18"]}
print("meta", round(time.time()-t0), "s", flush=True)

# =====================================================================
# 1 · NETWORK HEALTH
# =====================================================================
net = {}
net["daily"] = recs(q("""SELECT txn_date::VARCHAR AS date, count(*) AS n,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),2) AS err_pct,
  round(100.0*count(*) FILTER (paymentMode='OFFLINE')/count(*),2) AS offline_pct,
  any_value(CASE WHEN txn_date BETWEEN DATE '2026-02-16' AND DATE '2026-02-18' THEN 'CNY'
    WHEN dayofweek(txn_date) IN (0,6) THEN 'Weekend' ELSE 'School' END) AS daytype
FROM txm GROUP BY 1 ORDER BY 1"""))
net["signal_dist"] = recs(q(f"""SELECT posSignalStrength AS sig, count(*) AS n
  FROM pf WHERE posSignalStrength BETWEEN 0 AND 31 AND posNetworkType='4G'
  GROUP BY 1 ORDER BY 1"""))
net["by_network"] = recs(q(f"""SELECT posNetworkType AS net, count(DISTINCT terminalId) AS terminals,
  count(*) AS n, round(median(startToFinish)) AS med_ms, round(quantile_cont(startToFinish,0.95)) AS p95_ms
  FROM pf WHERE posNetworkType IN ('4G','WIFI','ETHERNET') GROUP BY 1 ORDER BY n DESC"""))

# per-terminal aggregates (error/offline from txm; speed/signal from pf) for verdicts
tbase = q("""SELECT terminalId, any_value(schoolId) AS school, any_value(storeId) AS store,
  any_value(storeName) AS storeName, count(*) AS n,
  round(100.0*count(*) FILTER (errorCode IS NOT NULL AND errorCode != '0')/count(*),1) AS err_pct,
  round(100.0*count(*) FILTER (paymentMode='OFFLINE')/count(*),1) AS off_pct
FROM txm GROUP BY 1""")
pterm = q(f"""SELECT terminalId, round(median(startToFinish)) AS med_ms,
  any_value(posNetworkType) AS net,
  round(median(posSignalStrength) FILTER (posSignalStrength BETWEEN 0 AND 31)) AS sig,
  round(median(posSignalStrength) FILTER (posSignalStrength < 0)) AS rssi
FROM pf GROUP BY 1""")
tb = tbase.merge(pterm, on="terminalId", how="left")

peers = {sch: g[["terminalId", "err_pct", "med_ms"]] for sch, g in tb[tb.n >= 300].groupby("school")}
def verdict_for(r):
    pg = peers.get(r.school); peer_err = peer_ms = None
    if pg is not None:
        others = pg[pg.terminalId != r.terminalId]
        if len(others) >= 2:
            peer_err = round(float(others.err_pct.median()), 1)
            peer_ms = (None if others.med_ms.isna().all() else int(others.med_ms.median()))
    bad_err = r.err_pct >= 10 and r.n >= 300
    slow = (not pd.isna(r.med_ms)) and r.med_ms >= 4000
    v = "ok"
    if bad_err or slow:
        peer_bad = (peer_err is not None and peer_err >= 8) or (peer_ms is not None and peer_ms >= 4000)
        v = "check" if (peer_err is None and peer_ms is None) else ("site" if peer_bad else "machine")
    return v, peer_err, peer_ms
tb[["verdict", "peer_err", "peer_ms"]] = tb.apply(lambda r: pd.Series(verdict_for(r)), axis=1)

vc = tb["verdict"].value_counts().to_dict()
net["verdict_counts"] = {k: int(vc.get(k, 0)) for k in ["machine", "site", "check", "ok"]}
# schools whose whole site struggles (>=2 site terminals) — a service supervisor's site list
site_schools = (tb[tb.verdict == "site"].groupby("school").size().sort_values(ascending=False))
net["worst_sites"] = [{"school": s, "bad_terms": int(n)} for s, n in site_schools.head(8).items()]

worst = tb[tb.n >= 1000].sort_values("err_pct", ascending=False).head(12)
net["worst_terminals"] = [{
    "terminalId": r.terminalId, "school": r.school, "storeName": r.storeName,
    "n": int(r.n), "err_pct": float(r.err_pct), "off_pct": float(r.off_pct),
    "med_ms": (None if pd.isna(r.med_ms) else int(r.med_ms)),
    "net": (None if pd.isna(r.net) else r.net),
    "sig": (None if pd.isna(r.sig) else int(r.sig)),
    "rssi": (None if pd.isna(r.rssi) else int(r.rssi)),
    "verdict": r.verdict, "peer_err": (None if r.peer_err is None else float(r.peer_err)),
} for _, r in worst.iterrows()]
net["wifi_terms"] = int(tb[tb.net == "WIFI"].shape[0])
OUT["network"] = net
print("network", round(time.time()-t0), "s | verdicts", net["verdict_counts"], flush=True)

# =====================================================================
# 2 · SPEED
# =====================================================================
speed = {}
speed["daily"] = recs(q(f"""SELECT txn_date::VARCHAR AS date,
  round(median(startToFinish)) AS med_ms, round(quantile_cont(startToFinish,0.95)) AS p95_ms
  FROM pf GROUP BY 1 ORDER BY 1"""))
speed["hist"] = recs(q(f"""SELECT CASE
  WHEN startToFinish<1000 THEN '<1s' WHEN startToFinish<2000 THEN '1-2s' WHEN startToFinish<3000 THEN '2-3s'
  WHEN startToFinish<5000 THEN '3-5s' WHEN startToFinish<10000 THEN '5-10s' ELSE '>10s' END AS bucket,
  min(startToFinish) AS ord, count(*) AS n
  FROM pf GROUP BY 1 ORDER BY min(startToFinish)"""))
speed["weekly_by_stack"] = recs(q(f"""SELECT date_trunc('week', txn_date)::VARCHAR AS week, paymentType,
  round(median(startToFinish)) AS med_ms, count(*) AS n
  FROM pf WHERE paymentType IN ('SSS','CONCESSION 2.0 ASCAN','Smart Buddy/ATM',
    'CONCESSION 3.0 ASCAN','EZLINK 2.0 ASCAN','NETS FlashPay')
  GROUP BY 1,2 HAVING count(*) >= 200 ORDER BY 1,2"""))
comp = q(f"""SELECT round(median(checkSignal)) AS checkSignal, round(median(openSocket)) AS openSocket,
  round(median(handshake)) AS handshake, round(median(sendToReceiveData)) AS transfer
  FROM pf WHERE paymentMode='ONLINE'""").iloc[0]
speed["components"] = [{"step": k, "ms": int(num(comp[k]))} for k in
    ["checkSignal", "openSocket", "handshake", "transfer"]]
# stack medians for the callout
speed["stack_summary"] = recs(q(f"""SELECT paymentType, count(*) AS n, round(median(startToFinish)) AS med_ms
  FROM pf GROUP BY 1 HAVING count(*) >= 5000 ORDER BY med_ms DESC"""))
OUT["speed"] = speed
print("speed", round(time.time()-t0), "s", flush=True)

# =====================================================================
# 3 · FOOD  (items = drinks / snacks / meals)
# Categories are computed from NAME-VERIFIED stalls only. Generic-named stalls
# ("Stall 1"...) are reported as 'Unclassified' with factual price bands — no guessing.
# =====================================================================
food = {}
# coverage: how much of the network the verified stalls represent
cov = q("""SELECT
  count(DISTINCT storeId) FILTER (mcat != 'Unclassified') AS named_stalls,
  count(DISTINCT storeId) FILTER (mcat = 'Unclassified') AS unnamed_stalls,
  round(100.0*count(*) FILTER (mcat != 'Unclassified')/count(*),1) AS named_txn_pct,
  round(100.0*sum(amount) FILTER (mcat != 'Unclassified')/sum(amount),1) AS named_rev_pct
FROM txm""").iloc[0]
food["coverage"] = {"named_stalls": int(cov.named_stalls), "unnamed_stalls": int(cov.unnamed_stalls),
    "named_txn_pct": float(cov.named_txn_pct), "named_rev_pct": float(cov.named_rev_pct)}
# verified category mix (named stalls only)
food["mix"] = recs(q("""SELECT mcat, count(*) AS n, round(sum(amount)/100.0) AS sgd,
  round(avg(amount)/100.0,2) AS avg_sgd FROM txm WHERE mcat != 'Unclassified'
  GROUP BY 1 ORDER BY n DESC"""))
# unclassified block: factual price-band profile, no category claim
un = q("""SELECT count(*) AS n, round(sum(amount)/100.0) AS rev,
  round(median(amount)/100.0,2) AS med_sgd,
  round(100.0*count(*) FILTER (amount<=100)/count(*)) AS b1,
  round(100.0*count(*) FILTER (amount>100 AND amount<=200)/count(*)) AS b2,
  round(100.0*count(*) FILTER (amount>200 AND amount<=300)/count(*)) AS b3,
  round(100.0*count(*) FILTER (amount>300)/count(*)) AS b4
FROM txm WHERE mcat='Unclassified'""").iloc[0]
food["unclassified"] = {"n": int(un.n), "rev": int(un.rev), "med_sgd": float(un.med_sgd),
    "bands": [int(un.b1), int(un.b2), int(un.b3), int(un.b4)]}
# price ladder: share of each VERIFIED category's txns in $ bands
food["price_ladder"] = recs(q("""SELECT mcat,
  round(100.0*count(*) FILTER (amount<=100)/count(*)) AS b1,
  round(100.0*count(*) FILTER (amount>100 AND amount<=200)/count(*)) AS b2,
  round(100.0*count(*) FILTER (amount>200 AND amount<=300)/count(*)) AS b3,
  round(100.0*count(*) FILTER (amount>300)/count(*)) AS b4,
  round(median(amount)/100.0,2) AS med_sgd
FROM txm WHERE mcat IN ('Drinks','Snacks & Desserts','Cooked Food','Fruits') GROUP BY 1"""))
# modal price point per verified category ("the menu")
food["modal_price"] = recs(q("""SELECT mcat, amount, cnt FROM (
  SELECT mcat, amount, count(*) AS cnt,
    row_number() OVER (PARTITION BY mcat ORDER BY count(*) DESC) AS rk
  FROM txm WHERE mcat IN ('Drinks','Snacks & Desserts','Cooked Food') GROUP BY 1,2)
WHERE rk=1"""))
# weekly category counts (incl. Unclassified — template uses verified-only denominators)
food["weekly"] = recs(q("""SELECT wk::VARCHAR AS week, mcat, count(*) AS n,
  round(avg(amount),1) AS avg_cents FROM txm GROUP BY 1,2 ORDER BY 1,2"""))
# day-type breakdown (incl. Unclassified)
food["by_daytype"] = recs(q("""SELECT daytype, mcat, count(*) AS n FROM txm GROUP BY 1,2"""))
# price-band mix by day type over ALL stalls — factual, no category claim.
# (The verified sample is too small off school days to chart: weekend n=183, CNY n=1,099.)
food["bands_by_daytype"] = recs(q("""SELECT daytype, count(*) AS n,
  round(100.0*count(*) FILTER (amount<=100)/count(*)) AS b1,
  round(100.0*count(*) FILTER (amount>100 AND amount<=200)/count(*)) AS b2,
  round(100.0*count(*) FILTER (amount>200 AND amount<=300)/count(*)) AS b3,
  round(100.0*count(*) FILTER (amount>300)/count(*)) AS b4,
  round(avg(amount)/100.0,2) AS avg_sgd
FROM txm GROUP BY 1"""))
# verified category share on school days only (CNY & weekends removed)
food["school_mix"] = recs(q("""SELECT mcat, count(*) AS n FROM txm
  WHERE daytype='School' AND mcat != 'Unclassified' GROUP BY 1 ORDER BY n DESC"""))
OUT["food"] = food
print("food", round(time.time()-t0), "s", flush=True)

# =====================================================================
# 4 · SPENDING PER SCHOOL ("atas")
# =====================================================================
# per-card spend/day (cards present only) then per-school average
base = q("""WITH c AS (SELECT schoolId, cardId, count(*) AS n, sum(amount) AS amt,
    count(DISTINCT txn_date) AS days FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2)
SELECT schoolId, count(*) AS cards, round(avg(amt/days)/100.0,2) AS spend_day,
  round(avg(n*1.0/days),2) AS txns_day FROM c GROUP BY 1""")
tots = q(f"""SELECT schoolId, any_value({LEVEL}) AS lvl_sfx, count(*) AS n,
  round(avg(amount)/100.0,2) AS avg_ticket FROM txm GROUP BY 1""")
sch = tots.merge(base, on="schoolId", how="left")

def eff_level(sfx, sid):
    ml = (geo.get(sid, {}).get("level") or "").upper()
    if ml.startswith("PRIMARY"): return "Primary"
    if ml.startswith("SECONDARY"): return "Secondary"
    if ml.startswith("JUNIOR COLLEGE"): return "Junior College"
    return sfx
sch["level"] = [eff_level(s, i) for s, i in zip(sch.lvl_sfx, sch.schoolId)]
sch["moe_type"] = [geo.get(i, {}).get("type") for i in sch.schoolId]
sch["name"] = [geo.get(i, {}).get("name") for i in sch.schoolId]
sch["ip"] = [geo.get(i, {}).get("ip") for i in sch.schoolId]

schools = {}  # for the report's top table / level chart
sc = {}
by_type, by_level = {}, {}
atas_rows = []
for _, r in sch.iterrows():
    sd = None if pd.isna(r.spend_day) else float(r.spend_day)
    nm = None if (r["name"] is None or (isinstance(r["name"], float) and pd.isna(r["name"]))) else r["name"]
    mt = None if (r.moe_type is None or (isinstance(r.moe_type, float) and pd.isna(r.moe_type))) else r.moe_type
    sc[r.schoolId] = {"id": r.schoolId, "name": nm, "level": r.level,
        "moe_type": mt, "n": int(r.n), "avg_ticket": float(r.avg_ticket),
        "cards": (None if pd.isna(r.cards) else int(r.cards)), "spend_day": sd,
        "txns_day": (None if pd.isna(r.txns_day) else float(r.txns_day))}
    if sd and mt:   # mt is None-coerced; r.moe_type is NaN (truthy!) for unmatched schools
        atas_rows.append({"sid": r.schoolId, "type": mt, "level": r.level,
                          "ip": r.ip, "spend_day": sd, "avg_ticket": float(r.avg_ticket)})

at = pd.DataFrame(atas_rows)
def grp(df, col):
    g = df.groupby(col).agg(schools=("sid", "count"), spend_day=("spend_day", "mean"),
        avg_ticket=("avg_ticket", "mean")).round(2).reset_index()
    return recs(g)
# by level over ALL schools with spend_day (not just matched)
lvl = pd.DataFrame([{"level": s["level"], "spend_day": s["spend_day"]}
                    for s in sc.values() if s["spend_day"]])
lvl_g = lvl.groupby("level").agg(schools=("spend_day", "count"),
    spend_day=("spend_day", "mean")).round(2).reset_index()

top = sorted([s for s in sc.values() if s["spend_day"] and (s["cards"] or 0) >= 150],
             key=lambda s: -s["spend_day"])[:12]
OUT["schools"] = {
    "atas_by_type": grp(at, "type"),
    "by_type_level": recs(at.groupby(["level", "type"]).agg(schools=("sid", "count"),
        spend_day=("spend_day", "mean")).round(2).reset_index()),
    "by_ip": grp(at[at["level"].isin(["Secondary", "Junior College"])], "ip"),
    "by_level": recs(lvl_g),
    "top": top,
    "coverage": {"matched": len(atas_rows), "total": len(sc)},
}
print("schools", round(time.time()-t0), "s | matched", len(atas_rows), "/", len(sc), flush=True)

# =====================================================================
# 5 · CNY impact (revenue + food, before/during/after)
# =====================================================================
cny = {}
cny["daily_rev"] = recs(q("""SELECT txn_date::VARCHAR AS date, round(sum(amount)/100.0) AS sgd,
  count(*) AS n, any_value(CASE WHEN txn_date BETWEEN DATE '2026-02-16' AND DATE '2026-02-18' THEN 'CNY'
    WHEN dayofweek(txn_date) IN (0,6) THEN 'Weekend' ELSE 'School' END) AS daytype
FROM txm GROUP BY 1 ORDER BY 1"""))
# school-day revenue: week before CNY vs CNY week vs week after
cny["windows"] = recs(q("""SELECT
  CASE WHEN txn_date BETWEEN DATE '2026-02-09' AND DATE '2026-02-13' THEN '1 Before (9-13 Feb)'
       WHEN txn_date BETWEEN DATE '2026-02-16' AND DATE '2026-02-20' THEN '2 CNY week (16-20 Feb)'
       WHEN txn_date BETWEEN DATE '2026-02-23' AND DATE '2026-02-27' THEN '3 After (23-27 Feb)' END AS window,
  round(sum(amount)/100.0) AS sgd, count(*) AS n, count(DISTINCT txn_date) AS days,
  round(sum(amount)/100.0/count(DISTINCT txn_date)) AS sgd_per_day
FROM txm WHERE txn_date IN (DATE '2026-02-09',DATE '2026-02-10',DATE '2026-02-11',DATE '2026-02-12',DATE '2026-02-13',
  DATE '2026-02-16',DATE '2026-02-17',DATE '2026-02-18',DATE '2026-02-19',DATE '2026-02-20',
  DATE '2026-02-23',DATE '2026-02-24',DATE '2026-02-25',DATE '2026-02-26',DATE '2026-02-27')
GROUP BY 1 ORDER BY 1"""))
OUT["cny"] = cny
print("cny", round(time.time()-t0), "s", flush=True)

path = os.path.join(HERE, "feb_service.json")
json.dump(OUT, open(path, "w", encoding="utf-8"), ensure_ascii=False, allow_nan=False, default=str)
print("WROTE", path, os.path.getsize(path)//1024, "KB", round(time.time()-t0), "s")
