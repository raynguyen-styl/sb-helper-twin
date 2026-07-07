"""Build the February Insights bundle for the map app (feb.json).

Precomputes every filter slice the Feb window offers, so the app stays client-only:
  - Activity:   day-type (School/Weekend/CNY) x user-segment intraday curves + time budgets
  - Wear:       adoption cohorts, days-worn histogram, daily active/new users
  - Heart rate: firmware x day-type hourly curves, HR zones, resting distribution
  - Spending:   school-level x food-category daily/hourly/mix (Feb only)
  - CNY story:  four weekday windows around CNY (before / break / return / normal)

Reads  parquet/feb_{health,heart_rate,txn}.parquet  (convert_parquet_feb.py)
Writes appdata/feb.json   (copy to smart-buddy-app/src/data/)
"""
import duckdb, json, os, time
import numpy as np, pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect(); con.sql("SET timezone='Asia/Singapore'")
t0 = time.time()
def q(s): return con.sql(s).df()
def recs(df): return json.loads(df.to_json(orient="records"))

geo = json.load(open(os.path.join(HERE, "school_geo.json")))

# day-type: CNY block = eve half-day + the two public holidays
DAYTYPE = """CASE
 WHEN d BETWEEN DATE '2026-02-16' AND DATE '2026-02-18' THEN 'CNY'
 WHEN dayofweek(d) IN (0,6) THEN 'Weekend'
 ELSE 'School' END"""

# ---------------- clean health view ----------------
con.sql(f"""CREATE OR REPLACE VIEW h AS
SELECT *, CAST(to_timestamp(recorded_time) AS DATE) AS d,
       (hour(to_timestamp(recorded_time))*2 + minute(to_timestamp(recorded_time))//30) AS slot
FROM '{PQ}/feb_health.parquet'
WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000""")
con.sql(f"CREATE OR REPLACE VIEW hd AS SELECT *, {DAYTYPE} AS daytype FROM h")

# ---------------- user features + segments ----------------
uf = q("""
SELECT user_id,
  count(DISTINCT d) AS wear_days,
  sum(steps)*1.0/count(DISTINCT d) AS steps_pd,
  count(DISTINCT CASE WHEN dayofweek(d) IN (0,6) THEN d END) AS wk_days
FROM h GROUP BY 1""")
rhr = q(f"""
SELECT user_id, avg(r) AS rhr FROM (
  SELECT user_id, hr_date, min(lowest_bpm) AS r FROM '{PQ}/feb_heart_rate.parquet'
  WHERE bpm_number BETWEEN 30 AND 220 AND lowest_bpm BETWEEN 30 AND 150
    AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
  GROUP BY 1,2) GROUP BY 1""")
uf = uf.merge(rhr, on="user_id", how="left")

X = np.column_stack([np.log1p(uf["steps_pd"]), uf["wear_days"], uf["wk_days"] / 8.0])
km = KMeans(n_clusters=4, n_init=10, random_state=42).fit(StandardScaler().fit_transform(X))
uf["seg"] = km.labels_
# label by profile rank (never by index): order clusters by steps_pd median
prof = uf.groupby("seg").agg(steps=("steps_pd","median"), wear=("wear_days","median"),
                             wk=("wk_days","median"), n=("user_id","count"), rhr=("rhr","median"))
order = prof.sort_values("steps", ascending=False).index.tolist()
# names match this fit's profiles (ranked by median steps):
# 0: high steps, weekday-only wear · 1: high steps, wears weekends too
# 2: light use, few days · 3: abandoned after ~1 day
SEGNAMES = ["School-day actives", "Everyday wearers", "Occasional users", "Barely used"]
segmap = {old: i for i, old in enumerate(order)}
uf["seg"] = uf["seg"].map(segmap)
prof = uf.groupby("seg").agg(steps=("steps_pd","median"), wear=("wear_days","median"),
                             wk=("wk_days","median"), n=("user_id","count"), rhr=("rhr","median"))
segments = [{"id": int(i), "name": SEGNAMES[i], "users": int(r.n),
             "steps": int(r.steps), "wear_days": round(float(r.wear),1),
             "wk_days": round(float(r.wk),1),
             "rhr": (None if pd.isna(r.rhr) else round(float(r.rhr),1))}
            for i, r in prof.iterrows()]
con.register("useg", uf[["user_id","seg"]])
con.sql("CREATE OR REPLACE VIEW hs AS SELECT hd.*, useg.seg FROM hd JOIN useg USING (user_id)")
print("segments", segments, flush=True)

OUT = {"segments": segments}

# ---------------- activity slices: daytype x segment ----------------
def act_slice(where):
    intr = q(f"""
      SELECT slot, sum(steps)*1.0 /
        (SELECT count(DISTINCT (user_id, d)) FROM hs WHERE {where}) AS v
      FROM hs WHERE {where} GROUP BY 1 ORDER BY 1""")
    k = q(f"""
      SELECT sum(steps)*1.0/count(DISTINCT (user_id,d)) AS steps,
             sum(calories)/1000.0/count(DISTINCT (user_id,d)) AS kcal,
             count(DISTINCT user_id) AS users,
             count(DISTINCT (user_id,d)) AS user_days FROM hs WHERE {where}""").iloc[0]
    tb = q(f"""
      SELECT CASE WHEN steps < 25 THEN 'sed' WHEN steps < 250 THEN 'light' ELSE 'active' END AS z,
             count(*)*0.5/(SELECT count(DISTINCT (user_id,d)) FROM hs WHERE {where}) AS hrs
      FROM hs WHERE {where} GROUP BY 1""")
    full = [0.0]*48
    for _, r in intr.iterrows(): full[int(r.slot)] = round(float(r.v), 1)
    return {"intraday": full,
            "steps": int(k.steps), "kcal": int(k.kcal), "users": int(k.users),
            "user_days": int(k.user_days),
            "budget": {r.z: round(float(r.hrs),2) for _, r in tb.iterrows()}}

activity = {}
for dt, dtw in [("All","TRUE"), ("School","daytype='School'"),
                ("Weekend","daytype='Weekend'"), ("CNY","daytype='CNY'")]:
    for sg, sgw in [("All","TRUE")] + [(str(s["id"]), f"seg={s['id']}") for s in segments]:
        activity[f"{dt}|{sg}"] = act_slice(f"({dtw}) AND ({sgw})")
OUT["activity"] = activity
print("activity slices", round(time.time()-t0), "s", flush=True)

# ---------------- daily series + percentile bands ----------------
OUT["daily"] = recs(q(f"""
WITH ud AS (SELECT user_id, d, {DAYTYPE} AS daytype, sum(steps) AS st FROM h GROUP BY 1,2)
SELECT d::VARCHAR AS d, strftime(d,'%a') AS dow, any_value(daytype) AS daytype,
  round(avg(st)) AS steps, count(*) AS users,
  round(quantile_cont(st,0.10)) AS p10, round(quantile_cont(st,0.25)) AS p25,
  round(quantile_cont(st,0.50)) AS p50, round(quantile_cont(st,0.75)) AS p75,
  round(quantile_cont(st,0.90)) AS p90
FROM ud GROUP BY d ORDER BY d"""))

OUT["user_hist"] = recs(q("""
WITH u AS (SELECT user_id, sum(steps)*1.0/count(DISTINCT d) AS spd FROM h GROUP BY 1)
SELECT least(floor(spd/2000)*2000, 20000)::INT AS lo, count(*) AS n FROM u GROUP BY 1 ORDER BY 1"""))

OUT["wkend_contrast"] = recs(q("""
WITH ud AS (SELECT user_id, d, dayofweek(d) IN (0,6) AS wkend, sum(steps) AS st FROM h GROUP BY 1,2,3),
u AS (SELECT user_id,
        avg(st) FILTER (NOT wkend) AS school_st, avg(st) FILTER (wkend) AS wk_st,
        count(*) FILTER (NOT wkend) AS nd, count(*) FILTER (wkend) AS nw
      FROM ud GROUP BY 1)
SELECT round(least(greatest(wk_st/school_st, 0), 2)/0.2)*0.2 AS ratio, count(*) AS n
FROM u WHERE nd >= 3 AND nw >= 2 AND school_st > 500 GROUP BY 1 ORDER BY 1"""))

# ---------------- wear & adoption ----------------
OUT["wear"] = {
  "days_hist": recs(q("""SELECT wear_days AS days, count(*) AS n FROM
      (SELECT user_id, count(DISTINCT d) AS wear_days FROM h GROUP BY 1) GROUP BY 1 ORDER BY 1""")),
  "cohorts": recs(q("""
    WITH u AS (SELECT user_id, count(DISTINCT d) AS wd,
        sum(steps)*1.0/count(DISTINCT d) AS spd,
        count(DISTINCT CASE WHEN dayofweek(d) IN (0,6) THEN d END) AS wkd
      FROM h GROUP BY 1)
    SELECT CASE WHEN wd >= 25 THEN 'Daily wearers (25-28d)'
                WHEN wd >= 15 THEN 'Regular (15-24d)'
                WHEN wd >= 5 THEN 'Occasional (5-14d)'
                ELSE 'Tried it (1-4d)' END AS cohort,
      count(*) AS users, round(avg(spd)) AS steps,
      round(avg(wkd*1.0/8)*100) AS weekend_pct, min(wd) AS ord
    FROM u GROUP BY 1 ORDER BY min(wd) DESC""")),
  "daily_active": recs(q("""
    WITH first AS (SELECT user_id, min(d) AS fd FROM h GROUP BY 1)
    SELECT h.d::VARCHAR AS d, count(DISTINCT h.user_id) AS users,
      count(DISTINCT CASE WHEN f.fd = h.d THEN h.user_id END) AS new_users
    FROM h JOIN first f USING (user_id) GROUP BY h.d ORDER BY h.d""")),
}
print("wear", round(time.time()-t0), "s", flush=True)

# ---------------- heart rate: firmware x daytype ----------------
con.sql(f"""CREATE OR REPLACE VIEW r AS
SELECT *, TRY_CAST(hr_date AS DATE) AS d FROM '{PQ}/feb_heart_rate.parquet'""")
con.sql(f"""CREATE OR REPLACE VIEW rv AS
SELECT *, {DAYTYPE} AS daytype FROM r
WHERE bpm_number BETWEEN 30 AND 220 AND d BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'""")

fw_top = [x for (x,) in con.sql(
    "SELECT firmware_version FROM rv GROUP BY 1 ORDER BY count(*) DESC LIMIT 4").fetchall() if x]
curves = {}
for fw, fww in [("All","TRUE")] + [(f, f"firmware_version='{f}'") for f in fw_top]:
    for dt, dtw in [("All","TRUE"), ("School","daytype='School'"),
                    ("Weekend","daytype='Weekend'"), ("CNY","daytype='CNY'")]:
        cur = q(f"SELECT hr_hour AS hh, avg(bpm_number) AS bpm, count(*) AS n FROM rv WHERE ({fww}) AND ({dtw}) GROUP BY 1 ORDER BY 1")
        full = [None]*24; ns = [0]*24
        for _, rr in cur.iterrows():
            full[int(rr.hh)] = round(float(rr.bpm),1); ns[int(rr.hh)] = int(rr.n)
        curves[f"{fw}|{dt}"] = {"bpm": full, "n": ns}

zones_hourly = {}
for dt, dtw in [("School","daytype='School'"), ("Weekend","daytype='Weekend'"), ("CNY","daytype='CNY'")]:
    zh = q(f"""SELECT hr_hour AS hh,
        100.0*count(*) FILTER (bpm_number >= 100)/count(*) AS mod,
        100.0*count(*) FILTER (bpm_number >= 120)/count(*) AS vig
      FROM rv WHERE {dtw} GROUP BY 1 ORDER BY 1""")
    zones_hourly[dt] = [{"hh": int(r.hh), "mod": round(float(r["mod"]),1), "vig": round(float(r.vig),1)}
                        for _, r in zh.iterrows()]
zones_daily = recs(q("""
SELECT daytype,
  round(count(*) FILTER (bpm_number < 80)*1.0/count(DISTINCT (user_id,d)), 2) AS rest,
  round(count(*) FILTER (bpm_number >= 80 AND bpm_number < 100)*1.0/count(DISTINCT (user_id,d)), 2) AS light,
  round(count(*) FILTER (bpm_number >= 100 AND bpm_number < 120)*1.0/count(DISTINCT (user_id,d)), 2) AS mod,
  round(count(*) FILTER (bpm_number >= 120)*1.0/count(DISTINCT (user_id,d)), 2) AS vig
FROM rv GROUP BY 1"""))

OUT["hr"] = {
  "firmwares": ["All"] + fw_top,
  "curves": curves,
  "zones_hourly": zones_hourly,
  "zones_daily": zones_daily,
  "resting": recs(q("""
    WITH ud AS (SELECT user_id, d, min(lowest_bpm) AS r FROM rv
                WHERE lowest_bpm BETWEEN 30 AND 150 GROUP BY 1,2),
    u AS (SELECT user_id, avg(r) AS r FROM ud GROUP BY 1)
    SELECT (floor(r/5)*5)::INT AS lo, count(*) AS n FROM u WHERE r BETWEEN 40 AND 120 GROUP BY 1 ORDER BY 1""")),
  "fw_table": recs(q(f"""
    SELECT coalesce(firmware_version,'?') AS fw, count(*) AS n, count(DISTINCT user_id) AS users,
      count(*) FILTER (lowest_bpm=255 AND highest_bpm=255 AND avg_bpm=255) AS err255,
      count(*) FILTER (avg_bpm > 0 AND avg_bpm < 40) AS lt40
    FROM '{PQ}/feb_heart_rate.parquet' GROUP BY 1 HAVING count(*) >= 200 ORDER BY 2 DESC""")),
}
print("hr", round(time.time()-t0), "s", flush=True)

# ---------------- spending: level x category (Feb only) ----------------
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
SELECT *, {NAMECAT} AS namecat, {LEVEL} AS lvl_sfx, extract(hour FROM txn_time) AS hh, txn_date AS d
FROM '{PQ}/feb_txn.parquet'
WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000""")

# category = verified stall name ONLY (supervisor policy 7 Jul 2026): generic-named
# stalls are 'Unclassified' — no price-based category guessing (k-means removed).

# MOE mainlevel wins over suffix inference (same rule as the main app)
lvl_geo = {sid: g.get("level") for sid, g in geo.items() if g.get("level")}
def eff(sid, sfx):
    ml = (lvl_geo.get(sid) or "").upper()
    if ml.startswith("PRIMARY"): return "Primary"
    if ml.startswith("SECONDARY"): return "Secondary"
    if ml.startswith("JUNIOR COLLEGE"): return "Junior College"
    return sfx
lv = q("SELECT DISTINCT schoolId, lvl_sfx FROM tx")
lv["lvl"] = [eff(s, x) for s, x in zip(lv["schoolId"], lv["lvl_sfx"])]
con.register("lmap", lv[["schoolId","lvl"]])
con.sql("""CREATE OR REPLACE VIEW txm AS
SELECT tx.*, CASE WHEN namecat = 'Generic' THEN 'Unclassified' ELSE namecat END AS mcat, l.lvl
FROM tx LEFT JOIN lmap l USING (schoolId)""")

CATS = ["Drinks","Snacks & Desserts","Cooked Food","Fruits","Bookshop & Supplies","Unclassified"]
LVLS = ["Primary","Secondary","Junior College","Other"]
spend = {"levels": ["All"]+LVLS, "cats": ["All"]+CATS, "daily": {}, "hourly": {}, "kpis": {}}
feb_days = [f"2026-02-{i:02d}" for i in range(1,29)]
for lvn, lvw in [("All","TRUE")] + [(l, f"lvl='{l}'") for l in LVLS]:
    for ct, ctw in [("All","TRUE")] + [(c, f"mcat='{c}'") for c in CATS]:
        key = f"{lvn}|{ct}"
        dd = q(f"SELECT d::VARCHAR AS d, round(sum(amount)/100.0) AS v FROM txm WHERE ({lvw}) AND ({ctw}) GROUP BY 1")
        dmap = {r.d: float(r.v) for _, r in dd.iterrows()}
        spend["daily"][key] = [dmap.get(x, 0) for x in feb_days]
        hh = q(f"""SELECT hh, round(sum(amount)/100.0) AS v FROM txm
                   WHERE ({lvw}) AND ({ctw}) AND {DAYTYPE.replace('d ','d ')} = 'School' AND hh BETWEEN 5 AND 19 GROUP BY 1""")
        hmap = {int(r.hh): float(r.v) for _, r in hh.iterrows()}
        spend["hourly"][key] = [hmap.get(x, 0) for x in range(5, 20)]
        k = q(f"""SELECT count(*) AS n, round(sum(amount)/100.0) AS rev,
                  round(avg(amount)/100.0, 2) AS ticket, count(DISTINCT cardId) AS cards
                  FROM txm WHERE ({lvw}) AND ({ctw})""").iloc[0]
        spend["kpis"][key] = {"n": int(k.n), "rev": (0.0 if pd.isna(k.rev) else float(k.rev)),
                              "ticket": (None if pd.isna(k.ticket) else float(k.ticket)),
                              "cards": int(k.cards)}
spend["mix"] = {lvn: recs(q(f"""SELECT mcat, count(*) AS n, round(sum(amount)/100.0) AS sgd
    FROM txm WHERE {'TRUE' if lvn=='All' else f"lvl='{lvn}'"} GROUP BY 1 ORDER BY 2 DESC"""))
    for lvn in ["All"]+LVLS}
OUT["spend"] = spend
print("spend", round(time.time()-t0), "s", flush=True)

# ---------------- CNY story: four weekday windows ----------------
PERIODS = [
  ("Before (9-13 Feb)",  "d BETWEEN DATE '2026-02-09' AND DATE '2026-02-13'"),
  ("CNY break (16-18)",  "d BETWEEN DATE '2026-02-16' AND DATE '2026-02-18'"),
  ("Return (19-20)",     "d BETWEEN DATE '2026-02-19' AND DATE '2026-02-20'"),
  ("Normal (23-27)",     "d BETWEEN DATE '2026-02-23' AND DATE '2026-02-27'"),
]
cny = {"periods": [p for p, _ in PERIODS], "intraday": {}, "budget": {}, "hr": {}, "catmix": {}, "kpis": {}}
for name, w in PERIODS:
    a = act_slice(w.replace("d ", "hs.d ") if False else w)   # hs view has d column
    cny["intraday"][name] = a["intraday"]
    cny["budget"][name] = a["budget"]
    cny["kpis"][name] = {"steps": a["steps"], "kcal": a["kcal"], "users": a["users"]}
    hrc = q(f"SELECT hr_hour AS hh, avg(bpm_number) AS bpm FROM rv WHERE {w} GROUP BY 1 ORDER BY 1")
    full = [None]*24
    for _, rr in hrc.iterrows(): full[int(rr.hh)] = round(float(rr.bpm),1)
    cny["hr"][name] = full
    cm = q(f"""SELECT mcat, round(sum(amount)/100.0) AS sgd FROM txm WHERE {w} GROUP BY 1""")
    tot = cm["sgd"].sum()
    cny["catmix"][name] = ({r.mcat: round(100.0*float(r.sgd)/tot, 1) for _, r in cm.iterrows()}
                           if tot > 0 else {})
    rev = q(f"SELECT round(sum(amount)/100.0) AS rev, count(*) AS n FROM txm WHERE {w}").iloc[0]
    cny["kpis"][name]["rev"] = (0.0 if pd.isna(rev.rev) else float(rev.rev)); cny["kpis"][name]["txns"] = int(rev.n)
OUT["cny"] = cny
print("cny", round(time.time()-t0), "s", flush=True)

# ---------------- meta ----------------
mh = con.sql(f"SELECT count(*), count(DISTINCT user_id) FROM '{PQ}/feb_health.parquet'").fetchall()[0]
mr = con.sql(f"SELECT count(*), count(DISTINCT user_id) FROM '{PQ}/feb_heart_rate.parquet'").fetchall()[0]
mt = con.sql("SELECT count(*), round(sum(amount)/100.0), count(DISTINCT schoolId), count(DISTINCT cardId) FROM txm").fetchall()[0]
OUT["meta"] = {"h_rows": mh[0], "h_users": mh[1], "r_rows": mr[0], "r_users": mr[1],
               "t_rows": mt[0], "t_rev": mt[1], "t_schools": mt[2], "t_cards": mt[3],
               "generated": "2026-07-06"}

os.makedirs(os.path.join(HERE, "appdata"), exist_ok=True)
path = os.path.join(HERE, "appdata", "feb.json")
json.dump(OUT, open(path, "w"), allow_nan=False)   # bare NaN breaks strict JSON parsers (Vite)
print("WROTE", path, os.path.getsize(path)//1024, "KB", round(time.time()-t0), "s")
