# Add March 2026 wearables (health + heart-rate) to the dashboard

Brings the **Wearables & Health** view to March (it was Feb-only). Involves ingesting the March
`health` + `heart_rate` data and a **coordinated code deploy** (builder + client both changed).

> ⚠️ **Coordinated deploy — do all of it together.** The wearable bundle schema changed (`cny` →
> generic `special` calendar story) and the client (`feb-window.js`) now reads `special`. So you must
> **rebuild the client AND rebuild BOTH months' wearable bundles** in the same deploy — otherwise the
> already-deployed Feb view breaks (old bundle has `cny`, new client wants `special`).

## What changed in code (already on `main`)
- `ingestion-service/build_insights_wearable.py` — now month-generic (was hard-gated to Feb): dynamic
  day count, month-aware HR date bounds, `txn_date`→DATE normalisation (prod `query_df` gotcha), and a
  per-month **calendar story** — CNY for Feb, or the **school-holiday week auto-detected** from the
  canteen-txn collapse for other months (no hardcoded dates).
- `client/src/feb-window.js` — CNY-specific bits (tab, filter, red-day coloring, "February"/"28"
  captions) are now driven by the bundle's `special` block + `meta.days`, so March renders cleanly with
  its own "March break" story and Feb keeps CNY.

## Data bundle (out-of-band, too big for git)
`SMARTBUDDY_MARCH_WEARABLE_DATA.zip` → unzips to:
```
march/march_health_data.csv     (2,481,501 rows — all March SGT, user_id present, no PII)
march/march_heart_rate.csv      (2,260,462 rows — all March SGT)
```
Verified single-month (the `202603*` daily files concatenated). Schema is identical to the Feb feeds.

## Steps (on the UAT VM, repo root)

```bash
# 1) code
git pull

# 2) rebuild the changed images + restart the running services
#    smartbuddy-frontend -> feb-window.js change ;  ch-insights/smartbuddy-ingest -> builder change
docker compose -f docker-compose.yml -f docker-compose.agent.yml build smartbuddy-frontend ch-insights smartbuddy-ingest
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d smartbuddy-frontend smartbuddy-ingest

# 3) ingest March wearables (health rebuilds pb_wearable_daily for March)
B=/path/to/unzipped/bundle
bash scripts/vm-load.sh $B/march/march_health_data.csv  health      2026-03 replace 1
bash scripts/vm-load.sh $B/march/march_heart_rate.csv   heart_rate  2026-03 replace 1

# 4) (re)build the wearable bundle for BOTH months — Feb MUST be rebuilt for the new `special` schema
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
$CC python build_insights_wearable.py 2026-03
$CC python build_insights_wearable.py 2026-02
```

## Verify
- `SELECT count() FROM smartbuddy.health WHERE month='2026-03'` → 2,481,501; `heart_rate` → 2,260,462.
- The `build_insights_wearable.py 2026-03` log prints `-> insights[2026-03/wearable] … KB`.
- Dashboard: switch the month picker to **March** → the coverage strip shows **Wearables ✓**, and a
  **Wearables & Health** nav item appears. Open it:
  - Activity / Heart rate / Spending tabs populate (≈12,460 wearable users, ≈2.5M activity rows).
  - A **“March break”** story tab (not "CNY story") shows the auto-detected school-holiday week
    (~16–23 Mar) with near-zero canteen trade during the break, recovering as Term 2 resumes.
  - Day-type filter reads **School / Weekend / School holidays** (not CNY).
- Switch back to **February** → still shows the **CNY story** tab, CNY day-type, red 16–18. (Confirms
  the Feb rebuild + new client didn't regress Feb.)

## Note — SAM
This does not update SAM. `mcp-service/schema.js` + `agent-prompt.md` now document wearables as
**Feb + March** (was Feb-only), but SAM only picks that up on an `mcp-service` redeploy + re-paste of
the instructions (DEPLOY.md §7). Until then SAM will still say wearables are February-only.
