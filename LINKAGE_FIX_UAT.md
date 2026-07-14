# UAT redeploy — items↔txn linkage fix (March 2026)

**Commit:** `24adc6a` on `main` — `fix(insights): items↔txn linkage joins on (school, second, amount), not storeName`
**Files changed:** `ingestion-service/build_insights.py` **only** (27 insertions, 15 deletions).
**Owner of this step:** whoever operates the UAT VM (Augustus). **Everything below runs on the UAT VM, from the repo root.**

---

## What broke and what changed (context)

The dashboard's "what students buy" linkage (per-stall receipts + per-card habits) came back **empty** on UAT and crashed the first March insights build. Cause: it joined the two data feeds on `storeName`, but they name stalls differently — the **items** feed says `"Stall 10"` where the **txn** feed says `"Fruits and Drinks - Stall 1"`. Zero rows matched → empty school map → `NaN` → crash. (It passed locally only because the local CSV sample happened to use matching names.)

The fix drops `storeName` from the join entirely: it learns each school's id by majority vote over `(exact-second, amount)`, matches baskets to transactions on `(schoolId, exact-second, amount)`, and takes the canonical stall name/id from the **txn** side. Verified locally: **99.7%** of baskets match, school map unchanged, wallet↔savings still 92.4%, PII unchanged.

## What this redeploy is — and is NOT

- ✅ It IS: pull the fix → rebuild the ingestion image → re-run the **March** insights build.
- ❌ It is NOT a data reload, NOT `ch-init`, NOT a Keycloak/SAM change, NOT a client/api/mcp rebuild.
- The March fact tables (`txn`, `items`, `saving_spending`) already loaded on UAT are **untouched**; we only regenerate the precomputed `insights` bundles from them.

---

## Step 0 — confirm the March data is actually loaded

Run against the shared ClickHouse (any client, or `clickhouse-client`):

```sql
SELECT 'txn' AS t,             count() AS n FROM smartbuddy.txn             WHERE month='2026-03'
UNION ALL SELECT 'items',           count() FROM smartbuddy.items           WHERE month='2026-03'
UNION ALL SELECT 'saving_spending', count() FROM smartbuddy.saving_spending WHERE month='2026-03';
```

**Expected (roughly):** `txn ≈ 3.7M`, `items ≈ 4.29M`, `saving_spending ≈ 145k`.

- If all three have rows → continue to Step 1.
- If any is **0** → the March upload didn't finish. Do NOT proceed; re-upload that month first (DEPLOY.md §4c), then continue.

---

## Steps 1–3 — pull, rebuild, re-run

```bash
# 1) get the fix
git pull

# 2) rebuild the ingestion image (code is baked in via COPY, not bind-mounted).
#    rebuild BOTH: ch-insights (this re-run) AND smartbuddy-ingest (so FUTURE uploads use the fix too,
#    otherwise the next re-upload would auto-run the OLD buggy build and re-break the linkage).
docker compose -f docker-compose.yml -f docker-compose.agent.yml build ch-insights smartbuddy-ingest
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d smartbuddy-ingest

# 3) re-run ONLY March insights (Feb is unaffected — do not touch it)
SB_MONTH=2026-03 docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights
```

---

## Step 4 — verify

**a) Build log.** The `ch-insights` run must print a line like:

```
linkage: 3,7xx,xxx/3,7xx,xxx baskets matched (99.x%), 2,5xx stalls, 18x,xxx cards
```

- `(99.x%)` with a few thousand stalls and ~180k cards → success.
- `0/… baskets matched … skipping linkage` → **STOP and report back.** That means the March timestamps or amounts don't line up (a different problem from the storeName issue this fix addresses) and needs investigation before going further.

**b) Dashboard.** Open the March 2026 view:
- Stall / school windows → a **"What's sold here"** panel appears (item-type mix + healthy share).
- Purchases view → **top-stalls** table and **purchase-habits** panel appear.
- These were silently hidden while the linkage was empty; no frontend rebuild is needed — the client reads the bundles live.

---

## Safety / rollback notes

- **Re-runs are safe and idempotent.** `insights` is a `ReplacingMergeTree(updated_at)` and the API reads newest-wins (`ORDER BY updated_at DESC LIMIT 1`), so re-running immediately serves the fresh bundle over the stale one — nothing to clean up. You can re-run Step 3 as many times as needed.
- **Feb is out of scope.** Do not rebuild the Feb bundles as part of this.
- **If you need to back out:** the previous behaviour was simply "linkage empty" (no crash after the earlier patch), so reverting `build_insights.py` to `7ea7ee5` and re-running Step 3 restores that state. No data is at risk either way.

---

## Report back

Paste the `linkage: … matched (…%) …` line from the Step 3 output. Once that shows ~99%, this is done.
