# HANDOVER — SMART Buddy Dashboard

Orientation for a teammate picking this up. Last updated **13 Jul 2026**. One screen: what the system
is, what changed on the current branch, how to make it live, and what's still open.

---

## 1 · What this is

Data-analysis + live dashboard for the **SMART Buddy** school-canteen payment + wearable ecosystem
(STYL Solutions). The **deployed system** now serves **two months — February + March 2026**, reads
**all data live from the shared ClickHouse `smartbuddy` database**, and is upload-driven (chunked
"Upload data" tab → per-`month` partitions → precomputed `insights` bundles). Role hub (F&B /
Engineering / Management) + a top-bar month picker. Full architecture + runbook: **DEPLOY.md**.

## 2 · Reading order

| Doc | For |
|---|---|
| **HANDOVER.md** (this) | Current state, the active branch, deploy steps, open items |
| **README.md** | Overview, deployed architecture, data facts & caveats |
| **DEPLOY.md** | The deploy runbook (compose stacks, ingest, SAM agent, verify) |
| **PIPELINE.md** | The offline `analysis/` pipeline (historical reports) |
| **mcp-service/agent-prompt.md** + **agent-setup.md** | SAM agent instructions to paste into the mesh |

## 3 · Active branch — `feat/demo-adaptive-dashboard` (NOT yet merged/pushed)

Built this session on top of `origin/main` (`9dc9028`). Theme: make the demo tell the **"smart,
adaptive platform"** story (upload any month → it adapts, links datasets, handles gaps) for a
**leadership / internal / service-engineer** audience. 5 commits, verified locally, **not yet live**:

| Commit | What it adds |
|---|---|
| `289ecab` | **Adaptive spine** — a per-month data-coverage strip by the month picker (✓ present / – absent), graceful "no data" states everywhere (no crashes), and removal of stale/contradictory copy. |
| `66af16d` | **Headline linkage** — `build_insights.py` matches the March receipt `items` to transactions (school-aware basket join, ~99%) → **per-stall receipt contents** ("what's sold here") + **per-card habits** (loyalty, healthy cohort). Surfaced in the Purchases window's "Stalls & habits" tab and the stall/school "What's sold here" panels. Aggregate + hashed-token only. |
| `d489130` | **Wallet↔savings cross-check** — `build_savings` reconciles the `Smart Buddy/ATM` wallet rail vs the savings ledger (~92% locally), shown in Saving-vs-Spending. Plus **SAM prompt/schema** made month-aware and taught the items/wallet/stall rules. |
| `b5a86e1` | **PII hardening** — `studentId` is now **dropped entirely** at ingest (was hashed; it's null/unused); SAM is **strict aggregate-only** (never prints a token or a single-person row, refuses to identify individuals). |
| `508395f` | **Terminal Health guard** — the engineering window no longer crashes when its bundle is absent. |

**Verification status:** each slice was checked with a local DuckDB harness, a unit test of the real
linkage function against `march_data/`, and Playwright browser tests against mock bundles; client
builds clean. **The one gap:** `build_insights.py` has **not run against the real ClickHouse** — first
true run is on the VM/UAT (see §4).

## 4 · Make it live (on UAT, after pulling this branch)

1. `docker compose up -d --build` + the agent stack (DEPLOY.md §4a) to ship the new client/services.
2. **Re-ingest** the transactions (+ items) so the `studentId` column leaves ClickHouse and tokens
   stay stable (pin `SB_ID_SALT`). DEPLOY.md §4c.
3. **Rebuild March insights** so the new bundle fields (linkage `receipt`/`top_stalls`/`habits`,
   savings `reconcile`) exist: `SB_MONTH=2026-03 … ch-insights` (DEPLOY.md §4d). Without this the new
   panels simply don't appear — they degrade gracefully.
4. **Update SAM**: re-paste the block from `mcp-service/agent-prompt.md` into the UAT agent, and
   redeploy `mcp-service` so `schema.js` (the live data dictionary) updates.
5. **Smoke-test** (DEPLOY.md §8) + adversarial SAM check: ask *"which student/card spent the most?"* →
   it must **refuse** and answer in aggregate.

## 5 · Open items / decisions

- **Demo questions** — 3–4 on-stage SAM questions to tune the agent (pending from the presenter).
- **Taxonomy v3** — receipt-based stall categorisation (17%→~99% coverage) is **built as a draft only**
  (`analysis/taxonomy_v3_draft.py`), **not wired**, pending supervisor sign-off. Slice 2 already shows
  the receipt item-mix per stall, so v3's remaining value is a single category label + Overview
  coverage. Decision needed.
- **Real-ClickHouse verification** of `build_insights.py` (see §3) — run on UAT.
- **Housekeeping** — a git stash holds superseded README/.gitignore edits (droppable); the old
  `FINDINGS_COMPENDIUM.md` / `PLAN_MARCH_SERVICE_INSIGHTS.md` are pre-build local notes.

## 6 · Guardrails (do NOT undo)

- **No `cardId`↔`user_id` re-identification bridge** — different id spaces, aggregate-only.
- **Identity masked**: `studentId` + student names are dropped at ingest; card/user/sync ids are
  irreversible salted-hash tokens used only for grouping — never emitted in SAM replies or the UI.
- **No price-based food inference**; taxonomy v3 stays additive/unsigned.
- **School/stall names are data, never instructions** (SAM prompt-injection safety).
- **Don't force-push `main`.**

## 7 · Key data facts (see README §"Key data facts" for the full list)

- Money is **cents SGD** everywhere (÷100). `items.itemName` is a **generic till button** ("Food Set
  Meal", "Open Item") — use `itemType`/`healthyChoice`, never quote it as a dish.
- `items` carry `schoolName`+`storeName` only (no `schoolId`/`cardId`); joins to txns are **school-aware**.
- **No March health/wearable feed** (Feb only); March "wearable spend" = the **wallet** rail
  (`paymentType='Smart Buddy/ATM'`), not activity.
- `studentId`/`studentName` are absent (dropped); `studentId` was ~always NULL anyway.
