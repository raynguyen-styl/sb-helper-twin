"""February 2026 insights: day-aligned health + heart-rate + transaction analysis.

First month where wearable data and transaction data OVERLAP in time
(May health vs Feb-Apr txn had no common days). Linkage is still aggregate-only
(cardId != user_id), but every chart here compares the same calendar days.

Reads  analysis/parquet/feb_{health,heart_rate,txn}.parquet  (convert_parquet_feb.py)
Writes analysis/feb_insights.json
"""
import duckdb, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = os.path.join(HERE, "parquet")
con = duckdb.connect()
con.sql("SET timezone='Asia/Singapore'")

H  = f"'{PQ}/feb_health.parquet'"
R  = f"'{PQ}/feb_heart_rate.parquet'"
T  = f"'{PQ}/feb_txn.parquet'"

OUT = {}

def rows(sql):
    return con.sql(sql).fetchall()

# ---------- clean views (same gates as the main pipeline) ----------
con.sql(f"""
CREATE VIEW hclean AS
SELECT *, CAST(to_timestamp(recorded_time) AS DATE) AS d,
       hour(to_timestamp(recorded_time)) AS hh,
       (hour(to_timestamp(recorded_time))*2 + minute(to_timestamp(recorded_time))//30) AS slot
FROM {H}
WHERE data_type IN (0,1) AND calories <= 500000 AND steps <= 4000
""")
con.sql(f"""
CREATE VIEW rclean AS
SELECT * FROM {R}
WHERE bpm_number BETWEEN 30 AND 220
  AND TRY_CAST(hr_date AS DATE) BETWEEN DATE '2026-02-01' AND DATE '2026-02-28'
""")
con.sql(f"""
CREATE VIEW tclean AS
SELECT *, CAST(amount AS DOUBLE)/100 AS sgd
FROM {T}
WHERE schoolId != 'STYL' AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000
""")

# ---------- meta ----------
m = rows(f"SELECT count(*), count(DISTINCT user_id), count(DISTINCT wearable_name) FROM {H}")[0]
r = rows(f"SELECT count(*), count(DISTINCT user_id) FROM {R}")[0]
t = rows("SELECT count(*), count(DISTINCT cardId), count(DISTINCT schoolId), sum(sgd) FROM tclean")[0]
OUT["meta"] = {"h_rows": m[0], "h_users": m[1], "h_wear": m[2],
               "r_rows": r[0], "r_users": r[1],
               "t_rows": t[0], "t_cards": t[1], "t_schools": t[2], "t_rev": round(t[3], 2)}

# ---------- daily series: activity vs spending, same calendar days ----------
OUT["daily"] = [
    {"d": d, "dow": dow, "steps": round(s or 0), "kcal": round(k or 0, 1),
     "users": u, "rev": round(rev or 0), "txns": n or 0,
     "spc": round(spc or 0, 2), "cards": c or 0}
    for d, dow, s, k, u, rev, n, spc, c in rows("""
WITH act AS (
  SELECT d, CAST(strftime(d,'%a') AS VARCHAR) dow,
         sum(steps)*1.0/count(DISTINCT user_id) steps_pu,
         sum(calories)/1000.0/count(DISTINCT user_id) kcal_pu,
         count(DISTINCT CASE WHEN steps>0 THEN user_id END) users
  FROM hclean GROUP BY 1,2),
spend AS (
  SELECT txn_date d, sum(sgd) rev, count(*) n,
         sum(sgd)/count(DISTINCT cardId) spc, count(DISTINCT cardId) cards
  FROM tclean GROUP BY 1)
SELECT CAST(act.d AS VARCHAR), act.dow, steps_pu, kcal_pu, users,
       rev, n, spc, cards
FROM act LEFT JOIN spend ON act.d = spend.d
ORDER BY act.d
""")]

# ---------- intraday: 30-min activity, school days vs weekends/holidays ----------
# label days by txn volume: weekday with >40% of median school-day txns = school day
sd = con.sql("""
SELECT txn_date, count(*) n FROM tclean GROUP BY 1
""").df()
med = sd[sd.n > sd.n.max()*0.4].n.median()
school_days = sorted(str(x)[:10] for x in sd[sd.n > med*0.4].txn_date)
OUT["school_days"] = school_days
sd_list = ",".join(f"DATE '{x}'" for x in school_days)

# constant denominator (all user-days in the day set), so slots sum to the daily total
OUT["intraday"] = {
  "school": [{"slot": s, "steps": round(v, 1)} for s, v in rows(f"""
      SELECT slot, sum(steps)*1.0/(SELECT count(DISTINCT (user_id, d)) FROM hclean WHERE d IN ({sd_list}))
      FROM hclean WHERE d IN ({sd_list}) GROUP BY 1 ORDER BY 1""")],
  "nonschool": [{"slot": s, "steps": round(v, 1)} for s, v in rows(f"""
      SELECT slot, sum(steps)*1.0/(SELECT count(DISTINCT (user_id, d)) FROM hclean WHERE d NOT IN ({sd_list}))
      FROM hclean WHERE d NOT IN ({sd_list}) GROUP BY 1 ORDER BY 1""")],
}
OUT["txn_hourly"] = [{"hh": h, "rev": round(v)} for h, v in rows(f"""
    SELECT hour(txn_time), sum(sgd) FROM tclean
    WHERE txn_date IN ({sd_list}) GROUP BY 1 ORDER BY 1""")]

# ---------- heart rate ----------
OUT["hr_curve"] = [{"hh": h, "bpm": round(b, 1), "n": n} for h, b, n in rows(
    "SELECT hr_hour, avg(bpm_number), count(*) FROM rclean GROUP BY 1 ORDER BY 1")]

OUT["hr_fw"] = [{"fw": f or "?", "n": n, "err255": e255, "lt40": l40} for f, n, e255, l40 in rows(f"""
    SELECT firmware_version, count(*),
           count(CASE WHEN lowest_bpm=255 AND highest_bpm=255 AND avg_bpm=255 THEN 1 END),
           count(CASE WHEN avg_bpm < 40 AND avg_bpm > 0 THEN 1 END)
    FROM {R} GROUP BY 1 ORDER BY 2 DESC""")]

bf = rows(f"""
    SELECT count(*),
           count(CASE WHEN TRY_CAST(hr_date AS DATE) NOT BETWEEN DATE '2026-02-01' AND DATE '2026-02-28' THEN 1 END),
           count(CASE WHEN TRY_CAST(hr_date AS DATE) IS NULL THEN 1 END)
    FROM {R}""")[0]
OUT["hr_backfill"] = {"total": bf[0], "outside_feb": bf[1], "bad_date": bf[2]}

OUT["hr_dup"] = rows(f"""
    SELECT count(*) - count(DISTINCT (user_id, hr_date, hr_hour)) FROM rclean""")[0][0]

OUT["resting"] = [{"lo": int(lo), "n": n} for lo, n in rows("""
    WITH ud AS (SELECT user_id, hr_date, min(lowest_bpm) r FROM rclean
                WHERE lowest_bpm BETWEEN 30 AND 150 GROUP BY 1,2),
    u AS (SELECT user_id, avg(r) r FROM ud GROUP BY 1)
    SELECT floor(r/5)*5, count(*) FROM u GROUP BY 1 ORDER BY 1""")]

# ---------- steps <-> HR correlation (Feb users) ----------
con.sql(f"""
CREATE VIEW ucorr AS
WITH st AS (SELECT user_id, sum(steps)*1.0/count(DISTINCT d) steps_pd FROM hclean GROUP BY 1),
hr AS (SELECT user_id, avg(bpm_number) bpm FROM rclean GROUP BY 1 HAVING count(*) >= 50)
SELECT st.user_id, steps_pd, bpm FROM st JOIN hr USING(user_id) WHERE steps_pd > 0
""")
cr = rows("SELECT corr(steps_pd, bpm), count(*) FROM ucorr")[0]
OUT["corr"] = {"r": round(cr[0], 3), "n": cr[1],
               "sample": [{"x": round(x), "y": round(y, 1)} for x, y in rows(
                   "SELECT steps_pd, bpm FROM ucorr USING SAMPLE 900")]}

# ---------- data quality ----------
q = {}
q["garbage_dtype"] = rows(f"SELECT count(*) FROM {H} WHERE data_type NOT IN (0,1)")[0][0]
q["huge_steps"]    = rows(f"SELECT count(*) FROM {H} WHERE steps > 4000")[0][0]
q["huge_cal"]      = rows(f"SELECT count(*) FROM {H} WHERE calories > 500000")[0][0]
q["hr_err255"]     = rows(f"SELECT count(*) FROM {R} WHERE lowest_bpm=255 AND highest_bpm=255 AND avg_bpm=255")[0][0]
q["hr_hi255_real"] = rows(f"SELECT count(*) FROM {R} WHERE highest_bpm=255 AND avg_bpm<255")[0][0]
q["hr_lt40"]       = rows(f"SELECT count(*) FROM {R} WHERE avg_bpm BETWEEN 1 AND 39")[0][0]
q["upload_before_record"] = rows(f"SELECT count(*) FROM {H} WHERE uploaded_time < recorded_time - 60")[0][0]
q["foreign_tz"]    = rows(f"SELECT count(*) FROM {H} WHERE tz != 480")[0][0]
corrupt = rows(f"""
    SELECT count(DISTINCT wearable_name) FROM {H}
    WHERE data_type NOT IN (0,1) OR steps > 100000""")[0][0]
q["corrupt_wearables"] = corrupt
OUT["quality"] = q

# ---------- CNY focus: which days dropped? ----------
OUT["cny"] = [
    {"d": d, "dow": dow, "rev": round(rev or 0), "steps": round(s or 0)}
    for d, dow, rev, s in rows("""
WITH sp AS (SELECT txn_date d, sum(sgd) rev FROM tclean GROUP BY 1),
ac AS (SELECT d, sum(steps)*1.0/count(DISTINCT user_id) s FROM hclean GROUP BY 1)
SELECT CAST(ac.d AS VARCHAR), strftime(ac.d,'%a'), rev, s
FROM ac LEFT JOIN sp ON ac.d = sp.d
WHERE ac.d BETWEEN DATE '2026-02-14' AND DATE '2026-02-22' ORDER BY ac.d""")]

with open(os.path.join(HERE, "feb_insights.json"), "w") as f:
    json.dump(OUT, f)
print("written feb_insights.json,", os.path.getsize(os.path.join(HERE, "feb_insights.json")), "bytes")
