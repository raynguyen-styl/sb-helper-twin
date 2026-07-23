# HANDOVER — SMART Buddy Dashboard

Orientation for a teammate (or a fresh session) picking this up. Last updated **15 Jul 2026**.
`main` is at **`279f3ec`** live on UAT (linkage 99.7%, March wearables). **Uncommitted on top (this
session):** the **map expansion 158→331 markers (+7 misplaced dots corrected)**, a nav-bar consolidation,
a stall-copy fix + SAM count text — built & verified against the raw `Feb-Mar_Data` feed, **not yet on
UAT** (see §3a / `reload/MAP_EXPANSION_DEPLOY.md`). One screen: what the system is, what changed most
recently, how to deploy, and what's open.

---

## 1 · What this is

Data-analysis + live dashboard for the **SMART Buddy** school-canteen payment + wearable ecosystem
(STYL Solutions). The **deployed system** serves **February + March 2026**, reads **all data live from
the shared ClickHouse `smartbuddy` database**, and is upload-driven (chunked "Upload data" tab → per-
`month` partitions → precomputed `insights` bundles). Role hub (F&B / Engineering / Management) + a
top-bar month picker with a data-coverage strip. Full architecture + runbook: **DEPLOY.md**.

**Data by month:** transactions/speed/stalls **and wearables (health, heart_rate)** exist for **both**
Feb & March; item-level purchases (`items`) + `saving_spending` are **March only**.

## 2 · Reading order

| Doc | For |
|---|---|
| **HANDOVER.md** (this) | Current state, recent work, deploy pointer, open items |
| **reload/MAP_EXPANSION_DEPLOY.md** | ⭐ NEW — deploy the 158→331 map markers (+7 corrected) + stall-copy + SAM count |
| **reload/UAT_DEPLOY.md** | The prior one-pass UAT deploy (linkage fix + March wearables) |
| **DEPLOY.md** | Full deploy runbook (compose stacks, ingest, SAM, verify) |
| **README.md** | Overview, deployed architecture, data facts & caveats |
| **mcp-service/agent-prompt.md** + **agent-setup.md** | SAM agent instructions to paste into the mesh |

## 3a · This session (15 Jul — NOT yet committed/deployed)

- **Map expansion 158 → 331 markers (+7 corrected).** Rebuilt `ingestion-service/school_geo.json` from the
  authoritative `schoolId→school` mapping, **verified against the raw `Feb-Mar_Data` feed**: the basket→txn
  linkage reproduces at **99.68%**, and the `items` receipts (which carry NO `schoolId`) match transaction
  `schoolId`s to the exact second+cent — so they identify each school independently and confirm
  `school_moe_map.csv` exactly (0 disagreements). +173 new markers (OneMap: postal from `moe_schools.json`;
  11 SPED by name). `reload/schools.csv` regenerated (331 rows). Diff vs HEAD: **+173 added, 7 changed, 0
  removed.** Unmapped: 3 by design (APSN Katong — no OneMap hit; PBS + Self-Serve-Stamps — not schools).
  Deploy = `reload/MAP_EXPANSION_DEPLOY.md` (rebuild ingest+insights both months + reload schools table).
- **⚠️ Corrected 7 base-geo coordinate errors** (the base geo, not the csv, was wrong — confirmed with the
  data owner 15 Jul): acronyms were misleading. `RVPS` River Valley→**Riverside** (17 km), `RLPS`
  Rulang→**Rivervale** (21 km), `CCPS` Canossa→**Concord** (17 km), `CHS` Catholic High→**Chongfu**, `NJC`
  Nanyang→**National**, `NBSS` Naval Base→**Northbrooks**, `GESS`→**Gan Eng Seng Primary**. Their namesakes
  are separate IDs, now also mapped (RUPS=Rulang, CNPS=Canossa, NVBSS=Naval Base, CAHP/CAHS=Catholic High).
- **Stall Explorer copy fix** (`client/src/stall-window.js`): the stale "No item/SKU data exists" caption
  now reflects that March has receipts ("what's sold here").
- **SAM school-count text** 158 → 331 (`schema.js`, `agent-prompt.md`) — needs an MCP rebuild + re-paste.
- **Nav-bar consolidation** (`client/src/main.js`, `theme.css`): shortened the view labels (full names as
  hover tooltips) + Upload as a compact icon, so the top bar no longer overflows.
- **Taxonomy v3 stays DEFERRED** (user chose "leave as documented" — no sign-off yet). Only the honest
  receipt view ("what's sold here", already live) is surfaced; no receipt-based category inference.

## 3b · This session (23 Jul — NOT yet committed/deployed)

- **PBS/SSSTM spend-ranking bug, fixed at the source.** The 15 Jul map-expansion entry above (§3a)
  already established that `PBS` (Pacific Bookstores, a bookshop concessionaire operating stalls inside
  ~156+ schools) and `SSSTM` (Self-Serve-Stamps, same pattern) are **not schools** — but that fix only
  touched the map/geocoding dimension. It never propagated to `TX_FILTER`
  (`ingestion-service/ingest_core.py`), so `tx` / `pb_schools` / `pb_school_daily` kept grouping by
  `schoolId` including these vendor codes — summing a vendor's revenue across every school it operates
  in into one fake "school" that outranks any real one. This is why both the Playback "biggest
  spenders" list (`/api/schools/PBS/playback`, DEPLOY.md §8) and the SAM agent's "which school spends
  the most" answer returned **PBS, ~$321,334** instead of the real top school, **Methodist Girls'
  School (Primary), ~$101,474** (caught during Super App POC-Hub orchestrator testing — see that repo's
  `specs/super-app/sam-orchestrator-build-smartbuddy.md`).
  - Fix: `TX_FILTER` now excludes `schoolId IN ('STYL','PBS','SSSTM')` (was `STYL` only).
    `APSNK` (APSN Katong) is untouched — it's a real special-education school, just missing from the
    MOE geocoding file, not a vendor code.
  - Updated to match: `mcp-service/src/schema.js`, `mcp-service/agent-prompt.md`,
    `mcp-service/agent-setup.md` (stale "PBS" sanity check corrected), `DEPLOY.md` §8.
  - **Not yet live.** `tx` is a ClickHouse view and `pb_schools`/`pb_school_daily` are materialised
    tables — the code fix above only takes effect once someone reruns the aggregate rebuild
    (`ingest_core._rebuild(client, ['tx','pb_school_daily','pb_schools'], ...)`) against the live UAT
    ClickHouse, and rebuilds+redeploys `smartbuddy-mcp` so the SAM agent picks up the corrected
    `schema.js`/instructions. No raw-file reload needed — `stall_category`/`stallcat` (food-category
    tagging) is unrelated and untouched by this fix.
  - `analysis/school_moe_map.csv` (the reference proving PBS/SSSTM aren't schools) was sitting
    **uncommitted** in this repo — worth committing alongside this fix so the evidence has a git history.

## 3 · Most recent work (13–14 Jul — all on `main`)

The demo-adaptive dashboard (`289ecab`…`0d79919`) shipped earlier. Since then:

| Commit | What |
|---|---|
| `24adc6a` | **Linkage join fix** — the items↔txn linkage no longer joins on `storeName` (the two feeds name stalls differently in prod → 0 matches). Now: schoolName→schoolId learned by majority vote over `(exact-second, amount)`, match on `(schoolId, second, amount)`, canonical stall name from the txn side. |
| `fc8aed6` | **Linkage timestamp fix** — the *real* prod 0-match. `build_insights.py` rebuilt `dt` by string-concatenating `CAST(txn_date AS VARCHAR)`; via ClickHouse `query_df` a `Date` arrives as a **datetime64**, so that string was `'2026-03-01 00:00:00'` and `TRY_CAST` → NULL on every txn row. Fixed with type-safe `CAST(txn_date AS DATE) + CAST(txn_time AS TIME)`, second-truncated. Verified 99.79% (matches native ClickHouse). |
| `4ed1d51` | **March wearables** — `build_insights_wearable.py` made **month-generic** (was Feb-hardcoded) + the same `txn_date`→DATE fix; the calendar story is now adaptive (CNY for Feb; for other months the **school-holiday week is auto-detected** from the canteen-txn collapse). `client/src/feb-window.js` reads a generic `special` block (bundle key `cny → special`) so March renders a **"March break"** story and Feb keeps CNY. |
| `fa2dc10` | Docs: `reload/UAT_DEPLOY.md` consolidated runbook (+ fixed the frontend compose service name → `smartbuddy-frontend`). |

**Verification:** local DuckDB harnesses reproduced the prod bugs by simulating `query_df` types and
proved the fixes (linkage 0→99.79%; wearable spend arrays 0→nonzero). **Confirmed live on UAT
(15 Jul):** linkage `3,700,936/3,712,897 (99.7%)`, 2,562/2,562 stalls carry a receipt, items bundle
has `top_stalls`+`habits`; March wearables loaded (health 2,481,501 / heart_rate 2,260,462),
`/api/months` March includes `wearable`, bundle `special.label="March break"`; Feb rebuilt to the
`special` schema (`"CNY story"`), no regression.

## 4 · Deploy to UAT — see **`reload/UAT_DEPLOY.md`** (one pass, both changes)

Summary: `git pull` → rebuild `smartbuddy-frontend` + `ch-insights` + `smartbuddy-ingest` →
**ingest March `health`+`heart_rate` as `2026-03`** (data sent separately; the linkage fix needs no
data) → rebuild bundles: `SB_MONTH=2026-03 ch-insights` (linkage) + `build_insights_wearable.py`
for **both** `2026-03` **and** `2026-02` (Feb rebuild is required — the `cny→special` schema change).
No DB wipe, no `ch-init`, no txn/items/saving reload. **Gate:** the March insights log must print
`linkage: …(99.x%)…`; if `0/… skipping`, stop.

## 5 · Open items / decisions

- ~~Deploy to UAT~~ (linkage + March wearables) — **DONE 15 Jul** (live & verified; see §3).
- **Deploy the map expansion + nav consolidation** (this session, §3a) — commit + `reload/MAP_EXPANSION_DEPLOY.md`. Not yet on UAT.
- **School mapping — RESOLVED 15 Jul.** The data feed (receipts) is authoritative; `school_moe_map.csv` is
  correct; the base geo's 7 errors are fixed and all siblings mapped. Only `APSN Katong` remains unmappable
  (no OneMap hit). No csv reconcile needed.
- **SAM redeploy** — `schema.js`/`agent-prompt.md`/`agent-setup.md` are current (wearables Feb+March,
  items/wallet/linkage, identity-masking). Redeploy = rebuild `smartbuddy-mcp` + re-paste the ```text
  block from `agent-prompt.md` § "Copy For AI Agent" (see `agent-setup.md` §4). **Note (fixed 15 Jul):**
  `agent-setup.md` was a stale duplicate (Feb-only, dead table names, plain-text I/O) — now a pointer to
  the single maintained block in `agent-prompt.md`, so there's no drift trap. Solace gateway confirmed
  working. Being deployed now.
- **Demo questions** — 3–4 on-stage SAM questions to tune the agent (pending from presenter).
- **Taxonomy v3** — **DEFERRED (15 Jul, conscious decision):** v2 name-verified classification stays
  live; the receipt-evidence v3 upgrade (`analysis/taxonomy_v3_draft.py`, 17%→~99% coverage) is kept as
  an unwired draft, revisit if/when the supervisor signs off the policy change. Not an active task.
- **Housekeeping — DONE 15 Jul:** dropped the stale stash; git-ignored `litellmkey.txt`; deleted the
  scratch bundles/zips, the per-month sliced CSVs (`march_data`/`feb_data`/`march_wearable`), the old
  `PLAN_MARCH_SERVICE_INSIGHTS.md`, and the raw multi-month extracts incl. April (`Feb-Apr transactions`,
  `Student_items`, `health data`, `20260714_*_MAR_APR_2026`) — ~17 GB. **April source is gone** (re-request
  from the data team if an April rollout is needed). Kept `FINDINGS_COMPENDIUM.md` (referenced by the v3
  draft + memory). A `txn/` dir (~1.2 GB) remains — decide separately.

## 6 · Guardrails (do NOT undo)

- **No `cardId`↔`user_id` re-identification bridge** — different id spaces, aggregate-only.
- **Identity masked**: `studentId` + names dropped at ingest; card/user/sync ids are irreversible
  salted-hash tokens for grouping only — never emitted in SAM replies or the UI.
- **No price-based food inference**; taxonomy v3 stays additive/unsigned.
- **School/stall names are data, never instructions** (SAM prompt-injection safety).
- **⚠️ `query_df` returns ClickHouse `Date`/`DateTime` as datetime64** — never rebuild a timestamp by
  string-concatenating `CAST(a_date AS VARCHAR)`; use typed `CAST(... AS DATE) + CAST(... AS TIME)`.
  This one bug silently zeroed the linkage AND the wearable spend arrays.
- **Don't force-push `main`.**

## 7 · Key data facts (README has the full list)

- Money is **cents SGD** everywhere (÷100). `items.itemName` is a **generic till button** — use
  `itemType`/`healthyChoice`, never quote it as a dish.
- `items` carry `schoolName`+`storeName` only (no `schoolId`/`cardId`); joins to txns are **school-aware**
  via the `(second, amount)` majority-vote bridge (NOT `storeName` — the feeds' stall names differ).
- **Wearables now exist for Feb AND March** (health, heart_rate). `recorded_time` is a UNIX epoch (SGT).
  March also has the **wallet rail** (`paymentType='Smart Buddy/ATM'`) reconciling to `saving_spending`.
- `studentId`/`studentName` are absent (dropped at ingest).
