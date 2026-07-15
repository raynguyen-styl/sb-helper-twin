# HANDOVER — SMART Buddy Dashboard

Orientation for a teammate (or a fresh session) picking this up. Last updated **15 Jul 2026**.
`main` is at **`9a258c7`**; the code (through `4ed1d51`) is **live on UAT — deployed + verified
15 Jul** (linkage 99.7%, March wearables). One screen: what the system is, what changed most
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
| **reload/UAT_DEPLOY.md** | ⭐ The current one-pass UAT deploy (linkage fix + March wearables) |
| **DEPLOY.md** | Full deploy runbook (compose stacks, ingest, SAM, verify) |
| **README.md** | Overview, deployed architecture, data facts & caveats |
| **mcp-service/agent-prompt.md** + **agent-setup.md** | SAM agent instructions to paste into the mesh |

## 3 · Most recent work (this session, 13–14 Jul — all on `main`)

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

- ~~Deploy to UAT~~ — **DONE 15 Jul** (linkage + March wearables live & verified; see §3).
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
- **Housekeeping** — reload data bundles (`SMARTBUDDY_RELOAD_DATA.zip`, `SMARTBUDDY_MARCH_WEARABLE_DATA.zip`,
  `march_wearable/`, the `20260714_STUDENT_*` day-file dirs) are gitignored/untracked scratch — deletable.

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
