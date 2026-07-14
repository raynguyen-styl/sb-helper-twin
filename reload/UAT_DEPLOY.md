# UAT deploy — linkage fix + March wearables (one pass)

Everything to deploy the current `main` to the UAT VM. Two changes ship together:

| commit | change | needs data? | needs client rebuild? |
|---|---|---|---|
| `fc8aed6` | **March linkage 0-match fix** (DuckDB timestamp rebuild in `build_insights.py`) | NO reload | no |
| `4ed1d51` | **March wearables** (health + heart_rate) + month-generic builder & client | March wearable zip | YES |

One `git pull` gets both. Re-running any step is idempotent (insights = ReplacingMergeTree, newest wins) — safe if part of this was already deployed.

## Prerequisites
- **`SMARTBUDDY_MARCH_WEARABLE_DATA.zip`** (231 MB) on the machine you run `scripts/vm-load.sh` from (the one with the VM SSH key). Unzip it → `march/march_health_data.csv`, `march/march_heart_rate.csv`. *(Only the wearables need data; the linkage fix needs none.)*
- March transactions/items/saving_spending already loaded (they are — used by the linkage + wearable spend).

## Steps (UAT VM, repo root)

```bash
# 1) code (brings both fc8aed6 + 4ed1d51)
git pull

# 2) rebuild the changed images + restart the running services.
#    ingestion image (ch-insights + smartbuddy-ingest) = both build_insights.py + build_insights_wearable.py
#    smartbuddy-frontend = the feb-window.js wearable-view change
docker compose -f docker-compose.yml -f docker-compose.agent.yml build smartbuddy-frontend ch-insights smartbuddy-ingest
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d smartbuddy-frontend smartbuddy-ingest

# 3) ingest March wearables ONLY (health rebuilds pb_wearable_daily for March). No other data reload.
B=/path/to/unzipped/bundle
bash scripts/vm-load.sh $B/march/march_health_data.csv  health      2026-03 replace 1
bash scripts/vm-load.sh $B/march/march_heart_rate.csv   heart_rate  2026-03 replace 1

# 4) rebuild insight bundles
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
SB_MONTH=2026-03 $CC                               # linkage fix + March base bundles (global/schools/stalls/items/savings)
$CC python build_insights_wearable.py 2026-03      # NEW March wearable bundle
$CC python build_insights_wearable.py 2026-02      # REQUIRED: Feb wearable rebuild for the cny->special schema
```

**Why the Feb wearable rebuild (step 4, last line):** the wearable bundle key changed `cny → special` and the new frontend reads `special`. If you rebuild the frontend but not the Feb wearable bundle, the *February* Wearables view breaks. Rebuild both months.

**What you do NOT need:** no DB wipe, no `ch-init`, no reload of txn/items/saving, no `SB_MONTH=2026-02 $CC` (Feb base bundles are unchanged — the linkage fix is March-only). SAM/`mcp-service` is a separate deploy (see note).

## Verify
1. **Linkage** — the `SB_MONTH=2026-03 $CC` log prints `linkage: 3,7xx,xxx/… baskets matched (99.x%), ~2,562 stalls, ~185,192 cards`. (If `0/… skipping`, stop and report.)
2. **Row counts** — `SELECT count() FROM smartbuddy.health WHERE month='2026-03'` → 2,481,501; `heart_rate` → 2,260,462.
3. **Dashboard → March**: coverage strip shows **Wearables ✓**; a **Wearables & Health** view appears with a **"March break"** story tab (auto-detected school-holiday week ~16–23 Mar, near-zero canteen trade, recovering into Term 2); and the "What's sold here" / top-stalls / purchase-habits linkage panels populate.
4. **Dashboard → February**: still shows the **CNY story** tab (red 16–18) and works — confirms the Feb wearable rebuild + new frontend didn't regress Feb.

## Notes
- **SAM is not deployed by this.** `schema.js` / `agent-prompt.md` now document wearables as Feb+March, but SAM only picks that up on an `mcp-service` rebuild + re-paste of the instructions (DEPLOY.md §7). Until then SAM still says wearables are Feb-only.
- Companion single-change runbooks: `reload/MARCH_WEARABLE.md` (wearables), `LINKAGE_FIX_UAT.md` (linkage).
