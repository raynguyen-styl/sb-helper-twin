"""What students buy — category taxonomy, price points, school & time differentiation.

CLASSIFICATION POLICY (supervisor-mandated, 7 Jul 2026): categories come ONLY from
descriptive stall names; generic-named stalls are 'Unclassified' — price facts only,
no k-means price-archetype guessing."""
import duckdb, json, os, time

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet").replace("\\", "/")
con = duckdb.connect(); con.sql("SET timezone='Asia/Singapore'")
t0 = time.time(); OUT = {}
def q(s): return con.sql(s).df()
def recs(df): return json.loads(df.to_json(orient="records"))

from taxonomy import STALLCAT_SQL

LEVEL = """CASE
 WHEN schoolId = 'NYP' OR schoolId = 'SOTA' THEN 'Other/Tertiary'
 WHEN schoolId LIKE '%JC' THEN 'Junior College'
 WHEN schoolId LIKE '%PS' OR schoolId LIKE '%P' THEN 'Primary'
 WHEN schoolId LIKE '%SS' OR schoolId LIKE '%GS' OR schoolId LIKE '%HS' THEN 'Secondary'
 ELSE 'Other/Tertiary' END"""

# base view: purchases only (exclude STYL test terminals + maintenance retrieve flows + >$200 outliers)
con.sql(f"""CREATE OR REPLACE VIEW tx AS
SELECT *, {LEVEL} AS level, extract(hour FROM txn_time) AS hh
FROM '{PQ}/txn.parquet'
WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000""")

# ---------------- category per STALL: taxonomy.py (name evidence + behavior veto) ----------------
con.sql(STALLCAT_SQL)
con.sql("""CREATE OR REPLACE VIEW txm AS
  SELECT tx.*, sc.mcat FROM tx JOIN stallcat sc USING (schoolId, storeId)""")
print("taxonomy", time.time()-t0, flush=True)

# coverage: verified vs unclassified, at stall and transaction level
OUT["coverage"] = recs(q("""SELECT mcat AS cat, count(DISTINCT storeId) AS stores, count(*) AS n,
  round(sum(amount)/100.0,0) AS sgd,
  round(avg(amount)/100.0,2) AS avg_sgd, round(median(amount)/100.0,2) AS med_sgd
FROM txm GROUP BY 1 ORDER BY n DESC"""))
covt = q("""SELECT round(100.0*count(*) FILTER (mcat!='Unclassified')/count(*),1) AS txn_pct,
  round(100.0*sum(amount) FILTER (mcat!='Unclassified')/sum(amount),1) AS rev_pct,
  count(DISTINCT storeId) FILTER (mcat!='Unclassified') AS named_stalls,
  count(DISTINCT storeId) FILTER (mcat='Unclassified') AS unnamed_stalls FROM txm""").iloc[0]
OUT["coverage_total"] = {"named_txn_pct": float(covt.txn_pct), "named_rev_pct": float(covt.rev_pct),
  "named_stalls": int(covt.named_stalls), "unnamed_stalls": int(covt.unnamed_stalls)}
# price-band profile of the unclassified pool (what we CAN say)
unb = q("""SELECT round(median(amount)/100.0,2) AS med_sgd,
  round(100.0*count(*) FILTER (amount<=100)/count(*)) AS b1,
  round(100.0*count(*) FILTER (amount>100 AND amount<=200)/count(*)) AS b2,
  round(100.0*count(*) FILTER (amount>200 AND amount<=300)/count(*)) AS b3,
  round(100.0*count(*) FILTER (amount>300)/count(*)) AS b4
FROM txm WHERE mcat='Unclassified'""").iloc[0]
OUT["unclassified_bands"] = {"med_sgd": float(unb.med_sgd),
  "bands": [int(unb.b1), int(unb.b2), int(unb.b3), int(unb.b4)]}
OUT["mix_overall"] = recs(q("""SELECT mcat, count(*) AS n, round(sum(amount)/100.0,0) AS sgd,
  round(avg(amount)/100.0,2) AS avg_sgd FROM txm GROUP BY 1 ORDER BY n DESC"""))

# ---------------- price ladders ----------------
OUT["price_ladder"] = recs(q("""SELECT mcat, round(amount/10)*10 AS cents, count(*) AS n
FROM txm WHERE amount <= 500 AND mcat IN ('Drinks','Snacks & Desserts','Cooked Food','Fruits')
GROUP BY 1,2 ORDER BY 1,2"""))
OUT["top_prices"] = recs(q("""
WITH p AS (SELECT mcat, amount, count(*) AS n,
  row_number() OVER (PARTITION BY mcat ORDER BY count(*) DESC) AS rk
 FROM txm GROUP BY 1,2)
SELECT mcat, amount, n FROM p WHERE rk<=6 ORDER BY mcat, n DESC"""))
OUT["price_by_level"] = recs(q("""SELECT level, mcat, round(avg(amount)/100.0,2) AS avg_sgd,
  round(median(amount)/100.0,2) AS med_sgd, count(*) AS n
FROM txm WHERE level != 'Other/Tertiary' GROUP BY 1,2 ORDER BY 1,2"""))
print("prices", time.time()-t0, flush=True)

# ---------------- category mix by level / hour / weekday ----------------
OUT["mix_by_level"] = recs(q("""SELECT level, mcat, count(*) AS n FROM txm GROUP BY 1,2 ORDER BY 1,2"""))
OUT["mix_by_hour"] = recs(q("""SELECT hh AS hour, mcat, count(*) AS n FROM txm
WHERE hh BETWEEN 6 AND 17 AND mcat IN ('Drinks','Snacks & Desserts','Cooked Food','Fruits','Bookshop & Supplies')
GROUP BY 1,2 ORDER BY 1,2"""))
OUT["hour_by_level"] = recs(q("""SELECT level, hh AS hour, count(*) AS n FROM txm
WHERE hh BETWEEN 6 AND 17 AND level != 'Other/Tertiary' GROUP BY 1,2 ORDER BY 1,2"""))
OUT["ticket_by_hour_level"] = recs(q("""SELECT level, hh AS hour, round(avg(amount)/100.0,2) AS avg_sgd
FROM txm WHERE hh BETWEEN 6 AND 17 AND level != 'Other/Tertiary' GROUP BY 1,2 ORDER BY 1,2"""))
OUT["weekday_cat"] = recs(q("""SELECT dayofweek(txn_date) AS dow, mcat, count(*) AS n FROM txm
WHERE dayofweek(txn_date) BETWEEN 1 AND 5 GROUP BY 1,2 ORDER BY 1,2"""))
print("mix", time.time()-t0, flush=True)

# ---------------- level summary (spend per card etc.) ----------------
OUT["level_summary"] = recs(q("""
WITH c AS (SELECT level, cardId, count(*) AS n, sum(amount) AS amt, count(DISTINCT txn_date) AS days
  FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2)
SELECT level, count(*) AS cards, round(avg(n),1) AS txns_per_card,
  round(avg(amt/days)/100.0,2) AS spend_per_active_day,
  round(avg(n*1.0/days),2) AS txns_per_active_day,
  round(avg(amt)/100.0,0) AS quarter_spend
FROM c GROUP BY 1 ORDER BY spend_per_active_day"""))

# ---------------- bookshop seasonality ----------------
OUT["bookshop_daily"] = recs(q("""SELECT txn_date::VARCHAR AS date, round(sum(amount)/100.0,0) AS sgd
FROM txm WHERE mcat='Bookshop & Supplies' GROUP BY 1 ORDER BY 1"""))
OUT["bookshop_hour"] = recs(q("""SELECT hh AS hour, count(*) AS n FROM txm
WHERE mcat='Bookshop & Supplies' AND hh BETWEEN 6 AND 17 GROUP BY 1 ORDER BY 1"""))
OUT["canteen_daily"] = recs(q("""SELECT txn_date::VARCHAR AS date, round(sum(amount)/100.0,0) AS sgd
FROM txm WHERE mcat != 'Bookshop & Supplies' GROUP BY 1 ORDER BY 1"""))
print("bookshop", time.time()-t0, flush=True)

# ---------------- basket behaviour ----------------
OUT["txns_per_day_dist"] = recs(q("""
WITH d AS (SELECT level, cardId, txn_date, count(*) AS k FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2,3)
SELECT level, CASE WHEN k=1 THEN '1' WHEN k=2 THEN '2' WHEN k=3 THEN '3' ELSE '4+' END AS purchases,
  count(*) AS card_days FROM d WHERE level != 'Other/Tertiary' GROUP BY 1,2 ORDER BY 1,2"""))

OUT["combo_pairs"] = recs(q("""
WITH s AS (SELECT cardId, txn_date, mcat, timestamp,
    lead(mcat) OVER (PARTITION BY cardId, txn_date ORDER BY timestamp) AS next_cat,
    lead(timestamp) OVER (PARTITION BY cardId, txn_date ORDER BY timestamp) AS next_ts
  FROM txm WHERE cardId IS NOT NULL AND mcat IN ('Drinks','Snacks & Desserts','Cooked Food','Fruits'))
SELECT mcat AS first_cat, next_cat, count(*) AS n,
  round(median((next_ts-timestamp)/60000.0),1) AS median_min_gap
FROM s WHERE next_cat IS NOT NULL AND mcat != 'Bookshop & Supplies'
GROUP BY 1,2 ORDER BY n DESC LIMIT 16"""))

OUT["gap_dist"] = recs(q("""
WITH s AS (SELECT cardId, txn_date, timestamp,
    lead(timestamp) OVER (PARTITION BY cardId, txn_date ORDER BY timestamp) AS next_ts
  FROM txm WHERE cardId IS NOT NULL)
SELECT CASE WHEN gap<2 THEN '<2 min' WHEN gap<10 THEN '2-10 min' WHEN gap<60 THEN '10-60 min'
  WHEN gap<180 THEN '1-3 h' ELSE '>3 h' END AS bucket, count(*) AS n, min(gap) AS ord
FROM (SELECT (next_ts-timestamp)/60000.0 AS gap FROM s WHERE next_ts IS NOT NULL)
GROUP BY 1 ORDER BY min(gap)"""))

OUT["loyalty"] = recs(q("""
WITH cs AS (SELECT level, cardId, storeId, count(*) AS k FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2,3),
 c AS (SELECT level, cardId, max(k)*1.0/sum(k) AS top_share, sum(k) AS n FROM cs GROUP BY 1,2 HAVING sum(k)>=15)
SELECT level, round(avg(top_share)*100,1) AS avg_top_stall_pct, count(*) AS cards
FROM c WHERE level != 'Other/Tertiary' GROUP BY 1"""))
print("basket", time.time()-t0, flush=True)

# ---------------- school differentiators ----------------
OUT["school_scatter"] = recs(q("""
WITH c AS (SELECT schoolId, level, cardId, count(*) AS n, sum(amount) AS amt, count(DISTINCT txn_date) AS days
  FROM txm WHERE cardId IS NOT NULL GROUP BY 1,2,3)
SELECT schoolId, any_value(level) AS level, count(*) AS cards,
  round(avg(amt/days)/100.0,2) AS spend_per_day, round(avg(n*1.0/days),2) AS txns_per_day,
  round(sum(amt)/sum(n)/100.0,2) AS avg_ticket
FROM c GROUP BY 1 HAVING count(*) >= 200 ORDER BY spend_per_day DESC"""))

# drinks-heavy schools, measured within each school's VERIFIED volume only
# (min 5,000 verified txns so shares rest on real samples)
OUT["drinks_heavy"] = recs(q("""
SELECT schoolId, any_value(level) AS level, count(*) AS n,
  round(100.0*count(*) FILTER (mcat='Drinks')/count(*),1) AS drinks_pct,
  round(100.0*count(*) FILTER (mcat='Cooked Food')/count(*),1) AS food_pct
FROM txm WHERE mcat != 'Unclassified'
GROUP BY 1 HAVING count(*) >= 5000 ORDER BY drinks_pct DESC LIMIT 8"""))
print("schools", time.time()-t0, flush=True)

with open(os.path.join(HERE, "purchase_insights.json"), "w") as f:
    json.dump(OUT, f, default=str)
print("WROTE purchase_insights.json", time.time()-t0)
