# UAT deploy — PBS/SSSTM schoolId exclusion fix (spend-ranking bug)

Ships one filter fix + doc corrections. **No raw transaction/items/saving/wearable file reload
needed** — `txn` already has every month's rows; this only regenerates the derived `tx` view + two
small aggregate tables from data already in ClickHouse.

| change | file(s) | needs image rebuild |
|---|---|---|
| **`TX_FILTER` now excludes `PBS`/`SSSTM`** (was `STYL` only) | `ingestion-service/ingest_core.py` | `smartbuddy-ingest` |
| **SAM schema/instructions say PBS/SSSTM are vendors, not schools** | `mcp-service/src/schema.js`, `mcp-service/agent-prompt.md`, `mcp-service/agent-setup.md` | `smartbuddy-mcp` + re-paste instructions |
| **Corrected stale "PBS" sanity-check answers** | `DEPLOY.md`, `HANDOVER.md` | — (docs only) |

## What was wrong

`PBS` (Pacific Bookstores — a bookshop concessionaire operating stalls inside ~156+ schools) and
`SSSTM` (Self-Serve-Stamps, same pattern) were never excluded from `TX_FILTER`. `analysis/
school_moe_map.csv` already tags both `category=non_school` and the 15 Jul map-expansion fix
(`reload/MAP_EXPANSION_DEPLOY.md`) already left them unmapped on the map — but that fix never
propagated to the spend aggregation, so `GROUP BY schoolId` kept summing each vendor's revenue across
every school it operates in into one fake "school" that outranked any real one. Both the Playback
"biggest spenders" list and the SAM agent's "which school spends the most" answer returned **PBS,
~$321,334** instead of the real top school, **Methodist Girls' School (Primary), ~$101,474**.
`APSNK` (APSN Katong) is untouched — it's a real special-education school missing only from the MOE
geocoding file, not a vendor code.

## Steps (UAT VM, repo root)

```bash
# 1) code
git pull

# 2) rebuild the changed images
docker compose -f docker-compose.yml -f docker-compose.agent.yml build smartbuddy-ingest smartbuddy-mcp
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d smartbuddy-ingest smartbuddy-mcp
```

### 3) Apply the new filter to the live data — pick ONE:

**Option A — fast path (recommended): run the rebuild SQL directly, no file reload.**
`tx`/`pb_school_daily`/`pb_schools` are all derived purely from `txn` (already loaded, both months) +
`schools` — none of this needs the source CSVs again. If you have direct ClickHouse access
(`clickhouse-client` or similar), run exactly what `ingest_core.py`'s `REBUILD` dict would run, with
the new filter substituted (`schoolId NOT IN ('STYL','PBS','SSSTM') AND storeName NOT ILIKE
'%retrieve%' AND amount <= 20000`):

```sql
CREATE OR REPLACE VIEW smartbuddy.tx AS
  SELECT * FROM smartbuddy.txn
  WHERE schoolId NOT IN ('STYL','PBS','SSSTM') AND storeName NOT ILIKE '%retrieve%' AND amount <= 20000;

DROP TABLE IF EXISTS smartbuddy.pb_school_daily;
CREATE TABLE smartbuddy.pb_school_daily (
  month String, school_id String, date Date, txns Int32, revenue_sgd Float64
) ENGINE=MergeTree PARTITION BY month ORDER BY tuple();
INSERT INTO smartbuddy.pb_school_daily
  SELECT month, schoolId, txn_date, toInt32(count()), round(sum(amount)/100.0,2)
  FROM smartbuddy.tx GROUP BY month, schoolId, txn_date;

DROP TABLE IF EXISTS smartbuddy.pb_schools;
CREATE TABLE smartbuddy.pb_schools (
  month String, school_id String, name Nullable(String), sgd Int64
) ENGINE=MergeTree PARTITION BY month ORDER BY tuple();
INSERT INTO smartbuddy.pb_schools
  SELECT t.month, t.schoolId, any(s.name), toInt64(round(sum(t.amount)/100.0))
  FROM smartbuddy.tx t LEFT JOIN smartbuddy.schools s USING (schoolId)
  GROUP BY t.month, t.schoolId;
```

**Option B — only the existing tooling (heavier, re-transforms the source files):** re-run the same
Feb + March transaction files that are already documented in `reload/RELOAD_RUNBOOK.md` §0/§3 through
`scripts/vm-load.sh <file> transactions <month> replace 1` — this re-executes `ingest_core.py`'s
`load_dataset()`, which now uses the corrected `TX_FILTER` and rebuilds `tx`/`pb_school_daily`/
`pb_schools` (and unnecessarily also `stall_category`/`stallcat`, which don't need touching for this
fix, but re-deriving them is harmless).

## Verify

1. `SELECT school_id, name, sgd FROM smartbuddy.pb_schools WHERE month='2026-02' ORDER BY sgd DESC
   LIMIT 5` → top row is a real school (Methodist Girls' School (Primary), ~$101,474), not `PBS`.
2. **Playback:** dashboard → Playback → school list → biggest spender is a real school; `PBS`/`SSSTM`
   no longer appear as pickable "schools".
3. **SAM:** re-paste the ```text block from `mcp-service/agent-prompt.md` § "Copy For AI Agent" (schema
   changed) into the agent's Instructions, then ask *"which school spends the most in February?"* →
   Methodist Girls' School (Primary), ~$101,474.

## Notes

- Rollback: `git checkout HEAD~1 -- ingestion-service/ingest_core.py`, rebuild `smartbuddy-ingest`,
  rerun step 3 (Option A) with the old filter string.
- This does not affect `stall_category`/`stallcat` (food-category tagging) — unrelated to this fix.
- Vendor-level analysis of PBS/SSSTM (if ever wanted) is still possible via the raw `txn` table, which
  keeps every row — only `tx` and anything derived from it excludes them.
