# HANDOVER — SMART Buddy Dashboard project

Context file for a new Claude session / after context compaction. State as of **9 Jul 2026**.
User: Gideon Seck (gideon.seck@styl.solutions). Everything in README.md is current; this file
adds the decisions, pipeline mechanics, and gotchas a new session needs.

> **⭐ 9 Jul 2026 — BIG PIVOT: live playback on InfluxDB + Ditto (tree-twin architecture).**
> The project moved from static/DuckDB serving to a **time-playback** system: ingest the Feb data
> into **InfluxDB** (history) + **Eclipse Ditto** (current-state twins), modelled on
> `tree-digital-twin`, so the dashboard can scrub the February timeline. **All 6 phases built +
> pushed to `origin/main`; first live run happens on the VM** (needs Docker + platform Influx/Ditto
> creds — this workstation has neither). Read **`PLAN_PLAYBACK_MIGRATION.md`** (design) and
> **`SB_DEPLOY.md`** (VM runbook) first, plus memory `playback-migration-plan.md`.
> - **Ingestion:** `smart-buddy-agent/ingestion/sb_backfill.py` — `feb_data` CSVs → Influx `sb_*`
>   measurements + `org.smartbuddy` Ditto twins; PII hashed at ingest; tree-twin write path +
>   safety flow (`--check` → dry-run → `--write`, `safe_id`, attribute-preserve, `/ditto-raw`).
> - **Backend:** `smart-buddy-agent/sb-api/` (Node) — Flux playback series + Ditto markers.
> - **Frontend:** `smart-buddy-app/` gained a **Playback** window (scrub/play the timeline; reads
>   sb-api, demo-data fallback offline) — ADDITIVE: the existing windows still read bundled JSON.
> - **Data assistant (chat):** the SAM agent now answers by querying the **`sb_*` Influx
>   measurements via the existing `IOT_UAT_MCP` connector's `execute_flux_query`** (see
>   `smart-buddy-agent/sam-agent-instructions.md`) — NOT DuckDB/artifact (those were superseded).
> Decisions #22–24 below.

> **8 Jul 2026 — two changes:** (1) the project was **narrowed to February 2026 only** — Mar/Apr
> txn + the May health drop were deleted from disk (see §1 "Feb-only purge" row, decision #20, and
> DATA_PIPELINE.md §7); several reports are now frozen historical artifacts. (2) A **SAM agent +
> VM-deploy plan** was written (`PLAN_SAM_AGENT.md`). ⚠ The DuckDB/MCP approach in that plan was
> **superseded** by the 9 Jul Influx/Ditto pivot above (DuckDB is now ingest-time compute only).

---

## 1 · What was asked and delivered (chronological)

| Request (date) | Deliverable | Status |
|---|---|---|
| Insights dashboard from all CSVs, with data-quality reporting (3 Jul) | `SMART_Buddy_Dashboard.html` | ✅ done, also artifact link |
| Find the **patterns behind the anomalies** (3 Jul) | `SMART_Buddy_Anomaly_Patterns.html` | ✅ done, also artifact link |
| Item/purchase insights across schools & time (3 Jul) | `SMART_Buddy_Purchase_Insights.html` | ✅ done, also artifact link |
| Shareable links (3 Jul) | 3 claude.ai artifacts (URLs in README) — user must enable sharing per artifact | ✅ done |
| Findings email draft (3 Jul) | delivered in chat (not a file) | ✅ done |
| Map app ("like tree-digital-twin") + network health, speed trends, food, school spending, PDF (6 Jul) | `smart-buddy-app/` + `SMART_Buddy_Findings_Report.pdf` | ✅ done |
| Move app off port 5173 — it's used by another project (6 Jul) | `vite.config.js`: dev pinned to **5188**, preview 5189, `strictPort` | ✅ done |
| PDFs of the 3 reports + health-only anomaly subset (3 Jul) | `SMART_Buddy_*.pdf`, `SMART_Buddy_Health_Anomaly_Patterns.html/.pdf` | ✅ done |
| Supplier Q&A on avg-HR + 255 values, email draft (3 Jul) | answered in chat from raw+parquet; logic preserved in PIPELINE.md §4.7 | ✅ done |
| Pipeline doc (3 Jul) | `PIPELINE.md` | ✅ done |
| Merge 6 Feb-2026 health part CSVs into one file (6 Jul) | `20260629_tbl_health_data_Feb2026.csv` — created, then **removed from disk by the user**; the 6 part files are canonical, pipeline reads them via glob | ✅ done (file gone, by design) |
| Feb 2026 data: insights + dashboard (6 Jul) | `SMART_Buddy_Feb2026_Insights.html` + `analysis/{convert_parquet_feb,analyze_feb}.py` | ✅ done |
| Feb mechanics in the app, clickable filters + deep dives (6 Jul) | app "February Insights" window (`feb-window.js` + `src/data/feb.json` via `build_feb_app_data.py`) | ✅ done |
| Dashboard revamp: role-based access, stall/machine filters, eng diagnostics, seamless nav (6 Jul) | `hub-window.js` (F&B/Eng/Mgmt role hub), `stall-window.js` (Stall Explorer + stall detail), `eng-window.js` (Terminal Health + machine-vs-site verdicts), unified search, cross-links, deep links; `src/data/stalls.json` via `build_stalls_data.py`; `convert_txn_perf.py` closes the txn_perf gap | ✅ done |
| **Service-team report from Feb 2026 data** (7 Jul): network health, speed trends, food items, spending per school, food-type trends — new report (not a rework of Purchase Insights, which has no network/speed) | `SMART_Buddy_Feb2026_Service_Report.{html,pdf}` + `analysis/{analyze_feb_service.py,feb_service_report.html,splice_feb_service.py}` → `feb_service.json` | ✅ done |
| **De-hallucination sweep** (7 Jul, supervisor policy): remove all price-based category guessing; verified-name categories + Unclassified everywhere | All 5 taxonomy scripts + app windows + 3 reports regenerated (`Feb2026_Service_Report`, `Findings_Report.pdf`, `Purchase_Insights.{html,pdf}`); Purchase Insights template recreated (`purchase_insights_template.html` + `splice_purchase_insights.py`); quarter PDF splice scripted (`splice_pdf_report.py`); artifact redeployed same URL | ✅ done |
| **Share the app with the team** (7 Jul): deploy off the local dev server, "app only, no database" (chosen over the full Influx/Ditto platform pattern) | `smart-buddy-app/{Dockerfile,nginx.conf,.dockerignore}` + repo-root `docker-compose.yml` + `DEPLOY.md`; static nginx site (data bundled into the build), mirrors tree-digital-twin `frontend` stripped of all backend wiring; behind shared nginx-proxy + Keycloak on the VM. Container image not built here (Docker absent on the workstation); `npm run build` verified | ✅ deploy artifacts done |
| **Dashboard UX pass** (7 Jul, user feedback): Feb-only scope (tentative); Stall Explorer shelved (no item/SKU data); school window reworked (per-stall revenue bars + merged Terminals tab, stall-tagged, verdicts); signal 0–31 → plain-language quality bands; Food Trends → coverage strip + verified-only bars | `build_app_data.py` Feb-filtered (FEB_ALL/FEB_WK consts; `speed_components_weekly` replaces `_monthly`); `school-window.js` rewritten (2 tabs); `overview-window.js` (bands, coverage strip, Feb captions); `main.js`/`hub-window.js` (VIEWS minus stalls; F&B primary = feb); global+schools JSON regenerated — meta now matches stalls.json exactly (3,959,550 txns / $7.57M) | ✅ done, screenshots verified |
| **Taxonomy v2** (7 Jul evening, user: "how do we know a named stall sells what the name says?"): audited name→category against price behavior, then tightened everywhere | NEW **`analysis/taxonomy.py`** (single source of truth, imported by all 5 scripts): corporate suffixes ≠ bookshop (44 stalls → Unclassified pending vendor list; 4 café misclassifications fixed), 2+ food words → **Mixed** (23 stalls), behavior **veto** on strong contradiction only (9 stalls), pure Fruits gone (all combos). `build_app_data.py --quarter` → `appdata_quarter/` for the Findings PDF (appdata/ stays Feb for the app); `splice_pdf_report.py` reads appdata_quarter. All app JSONs + all 3 reports (html+pdf) regenerated; artifact redeployed same URL (label taxonomy-v2-mixed-veto) | ✅ done, all outputs verified |
| **Isolate Feb data to CSV** (8 Jul): export the Feb-only rows to one folder | `feb_data/` (gitignored): `feb_transactions.csv` (3,977,666), `feb_health_data.csv` (2,948,308), `feb_heart_rate.csv` (2,393,845) — kept separate per user | ✅ done |
| **Feb-only purge** (8 Jul, user: "remove the rest of the other months data — we only work with Feb"): delete Mar/Apr + May source data | Deleted: `txn` parts 006–016 (Mar/Apr); May health `*_May2026.csv`; May `health.parquet`/`heart_rate.parquet`; `analysis/appdata_quarter/`. Rebuilt `txn.parquet`/`txn_perf.parquet` to Feb-only. **Consequence:** Dashboard, anomaly/health reports, quarter Findings PDF **no longer regenerable** (shipped files intact). See decision #20 + DATA_PIPELINE.md §7 | ✅ done |
| **Rewrite `DATA_PIPELINE.md`** (8 Jul): the old untracked opencode-era doc was outdated; also answer colleague "where do those tasks happen?" | Rewrote to the real DuckDB Feb-only pipeline; added "Where these tasks run" (all local/offline, static site, no server/DB/cloud) + §7 purge record | ✅ done |
| **Plan: VM deploy + SAM agent over Feb data** (8 Jul, user: "refer to tree-digital-twin; add a SAM agent; VM may lack space for Influx/Ditto; plan first, don't execute") | **`PLAN_SAM_AGENT.md`** — DuckDB (not Influx/Ditto) + SAM-mesh+MCP agent (clone-and-adapt from cloned refs `Downloads/{iot-platform,htx-pilot}`). **PLAN ONLY — nothing built.** Memory: `sam-agent-plan.md` | ⏸ awaiting go-ahead |

“**Atlantic**” in an early request was ambiguous → clarified to mean *“app-style like
C:\Users\STYLSG\Downloads\tree-digital-twin”* (Vite + MapLibre + draggable windows, Apple-style
theme). It is NOT a platform/library.

## 2 · Decisions made WITH the user (do not re-litigate)

1. `amount` = **cents SGD** (user-confirmed).
2. Txn↔health linkage impossible at individual level → **aggregate comparison only**. Since the
   Feb-2026 drop, aggregate comparisons are **day-aligned** (shared calendar), still no user-level join.
3. Deliverables as **local HTML files** (not artifacts) — artifacts added later on request.
4. ~~Food categories: stall-name keywords + price-profile k-means for generic stalls.~~
   **SUPERSEDED by #14 (7 Jul 2026).**
5. School comparisons: **infer from IDs + MOE directory**, "Other" bucket for unmatched.
6. New dashboard = **app-style like tree twin**; PDF = **static print report**; atas = **infer from IDs**.
7. Feb analysis scope (6 Jul): **both activity + heart-rate**, txn window **Feb-only** (aligned days),
   standalone HTML report, **no Feb-vs-May month comparison section**.
8. App interactivity architecture: **precomputed JSON slices, client-only** — user chose this over a
   live DuckDB backend. All filters re-slice precomputed aggregates in JS.
9. "F&B items": **no SKU data exists** → user accepted **categories + price bands** (≤$1/$1–2/$2–3/>$3)
   as the item proxy, honestly labelled in the UI.
10. Roles: **hub + per-role nav hiding, switchable anytime, NO real login/security** (user chose over
    precomputed-only guidance and over a backend with auth). Stored in `localStorage['sb-role']`.
11. Stall/engineering views period: **Feb 2026 only** (user chose over full Feb–Apr).
12. Speed diagnostics: **rebuild txn_perf properly via a script** (chosen over totals-only).
13. Feb service report (7 Jul): a **new** report (`SMART_Buddy_Feb2026_Service_Report`), NOT a rework of
    Purchase Insights (which is purchase-only, no network/speed). **Feb 2026 only**; CNY (16–18 Feb)
    **shown and flagged**, not excluded; network section **includes machine-vs-location fault verdicts**
    (same logic as the app's Terminal Health). Layout mirrors `pdf_report.html` (the quarter Findings Report).
14. **Verified-name classification only** (supervisor-mandated via user, 7 Jul): food categories exist
    ONLY where the stall's registered name says what it sells; generic-named stalls ("Stall 1") are
    **Unclassified** — price facts only, never guessed. The k-means price-archetype step was **removed
    from every script and deliverable** (all 4 reports + app). Chosen over "two-layer fact/estimate"
    and "price-tier relabel" options. Keyword-on-named-stalls counts as verified (name is evidence).
    Every category chart states coverage (~18.5% of txns) and uses verified-only denominators with
    low-sample guards. Do NOT reintroduce price-based category inference.
15. **Team sharing = app only, no database** (7 Jul): to get the app off the local dev server, chosen
    over the "full platform pattern" (backfill Feb data → InfluxDB history + Ditto per-entity Things +
    a `smartbuddy-api` read layer, like tree-digital-twin). Rationale: the app already bundles its data
    into the build (`import … from './data/*.json'` in `main.js`), so `dist/` is self-contained and needs
    no runtime query engine. Deploy = one static nginx container.
    Data-volume note if the full pattern is ever revisited: Feb is ~12M points / ~400–600 MB Parquet —
    **not too much for InfluxDB** (tree-twin already parks 2.7 GB+ of tilt telemetry in the shared Influx);
    Ditto is for one twin-Thing-per-entity (terminal/stall/school), NOT bulk rows. The split is fixed by
    the platform's own `ingestion/src/backfill.py`: "history → InfluxDB, current-state → Ditto".
16. **App dashboard = February 2026 only, tentative** (7 Jul, user): all app windows read the same month
    (global/schools/stalls/feb JSON all Feb). The REPORTS kept their original scopes at the time (Findings
    PDF Feb–Apr; Purchase Insights Feb–Apr). **⚠ Superseded by #20 (8 Jul):** the "tentative" is now
    permanent — Feb-only is the hard scope, the quarter can no longer be restored (source purged), the
    Findings PDF is frozen, and Purchase Insights is now Feb-only (its txn source is Feb-only).
17. **Stall Explorer shelved** (7 Jul, user): without itemID/SKU data the explorer "doesn't work" for
    F&B questions — hidden from nav/roles (code kept: `stall-window.js` `openStallExplorer`, re-add
    `'stalls'` to VIEWS + ROLES when a menu/itemID feed arrives). Per-stall detail windows remain
    reachable (school-window bars, search, `#stall=` deep links). Replaced by per-school
    revenue-by-stall bars (every store individually; grey = Unclassified, never guessed).
18. **Taxonomy v2 — name evidence must survive a behavior cross-check** (7 Jul evening, user + audit):
    validated the name→category rules against each stall's own price behavior (93–97% agreement for food
    categories) and fixed what failed. Four rules, all in **`analysis/taxonomy.py`** (the ONLY place the
    classification lives — all 5 scripts import it): ① food words beat corporate suffixes ("IFood Cafes
    Pte Ltd" = Cooked Food, not Bookshop); ② bare company names (BL Marketing ×19, Overseas Associates ×17,
    Print Pak, Actlink, Asencio — 44 stalls / 30k Feb txns) are **Unclassified until STYL confirms the
    vendor list** ("pte ltd" is not evidence of goods sold; behavior sits between bookshop and food);
    ③ names hitting 2+ food-word groups = **Mixed** (23 stalls — genuinely combo stalls; includes ALL
    former Fruits stalls, so pure Fruits no longer exists); ④ **behavior veto**: single food category kept
    only if the stall's modal price doesn't strongly contradict it (Drinks >$2.00, Snacks >$3.50,
    Fruits >$3.00, Cooked <$1.00 or >$8.00; n≥100) — veto fires on contradiction ("Hot Stall 5" at $0.60
    modal), NOT on premium pricing ($5 Pool Cafe at ACSI stays Cooked Food, else atas schools get biased
    out). Price can veto a name, never assign one — still zero guessing. New coverage: Feb 493 stalls /
    17.5% txns / 18.5% rev; quarter 498 / 17.2% / 18.1%. "Overseas Associates" ≠ overseas transactions —
    the txn schema has NO country/currency/location field; every txn is at a Singapore school terminal.
19. **Must NOT conflict with tree-twin-uat** (7 Jul, user): SMART Buddy is a completely separate project.
    Safe by construction on **data** — app-only means no connection to the shared InfluxDB bucket `rtls`,
    Ditto `org.nparks`, or Solace. Hardened on **server** co-tenancy: compose project pinned `name: smartbuddy`,
    container `smartbuddy-frontend`, host port 8088 via `SB_FRONTEND_PORT` (distinct var + default from
    tree-twin's `FRONTEND_PORT`=8087), private `sb-net` bridge that does NOT auto-join tree-twin's external
    `backend` network. Placement / hostname / auth are owned by a **colleague** (deploying engineer) — the
    full brief with the exact tree-twin values to avoid (ports 8087/3310/3400/3300, `nparks-*` containers,
    project `tree-digital-twin`, network `solace-…_backend`, Keycloak realm `styl-iot` client `nparks-tree-twin`,
    domain `tree-twin-uat.styl.solutions`) is in **DEPLOY.md**. If auth via shared Keycloak: NEW client
    (e.g. `smart-buddy-dashboard`), never reuse `nparks-tree-twin`; app has no keycloak-js, so gate at the proxy.
20. **February 2026 only — hard purge** (8 Jul, user: "remove the rest of the other months data as we are
    only working with Feb data"). Chose **full Feb-only purge** (delete source, don't just filter) + **remove
    May health too**. Deleted from disk: `txn` parts 006–016 (Mar/Apr), May health `*_May2026.csv`, May
    `health.parquet`/`heart_rate.parquet`, `analysis/appdata_quarter/`; `txn.parquet`/`txn_perf.parquet`
    rebuilt Feb-only. `txn` parts 001–005 kept (pure Feb, filename still says `…to_Apr…`). **This is
    irreversible without re-downloading the source drops.** Consequence: `SMART_Buddy_Dashboard.html`, the
    anomaly/health reports, and `SMART_Buddy_Findings_Report.pdf` (quarter) can no longer be regenerated —
    the shipped files stay as frozen historical artifacts. All Feb deliverables (app + Feb reports) are
    unaffected and fully rebuildable. Feb rows also exported to `feb_data/` (gitignored). Full record:
    DATA_PIPELINE.md §7. Do NOT try to rebuild the quarter/May outputs — the inputs are gone.
21. **SAM agent + VM deploy = PLAN ONLY so far** (8 Jul, user: "plan first, report back, don't execute").
    Locked choices in **`PLAN_SAM_AGENT.md`**: (a) **DuckDB/Parquet** store (~200–300 MB), NOT Influx/Ditto —
    directly answers the user's VM-space worry (Influx → tag-cardinality explosion on cardId/terminalId;
    Ditto → thing-state, wrong for txn rows); (b) **SAM mesh + MCP** topology like tree-twin's `arborist`;
    (c) **full-raw NL→SQL** over real IDs (→ SQL hardening + auth required); (d) shared UAT VM, isolated;
    (e) MCP in **Node**, agent model **claude-opus-4-8**. Clone-and-adapt from reference repos cloned to
    `Downloads/{iot-platform,htx-pilot}` (mcp-rtls-server → smartbuddy-mcp; htx-pilot sam/ → FE panel).
    **Nothing is built.** Await the user's go-ahead before Phase 1 (build `feb.duckdb`). Memory pointer:
    `sam-agent-plan.md`. **⚠ SUPERSEDED by #22 — the DuckDB/MCP design was replaced by Influx/Ditto.**
22. **STORAGE PIVOT → InfluxDB + Ditto with time PLAYBACK** (9 Jul, user: "we're using influxdb and
    ditto as we want playback… redo the docker system referring to tree-digital-twin"). Playback is a
    genuine time-series/state-at-time use case → Influx (history) + Ditto (current state), the
    tree-twin model. **Full replace** of the *serving* layer (not the app windows — see #23); **Feb
    2026 only**; **all three** playback subjects (schools+terminals on the map, wearables/health,
    individual card/user). History → shared `rtls` bucket, new `sb_*` measurements; twins → Ditto
    namespace `org.smartbuddy`. Design in `PLAN_PLAYBACK_MIGRATION.md`; deploy in `SB_DEPLOY.md`.
    Built + pushed; first live run on the VM.
23. **Additive cutover + compute-at-ingest** (9 Jul). The existing analytical windows KEEP their
    precomputed bundled JSON (they never queried a runtime engine); Playback + the data assistant are
    the new live Influx/Ditto layer. **DuckDB survives only as an ingest-time compute step** (like
    tree-twin's `backfill.py` computes in pandas) — the `sb_*` aggregates + taxonomy are computed in
    `sb_backfill.py`, then written to the stores. No runtime DuckDB. Cardinality: `cardId` (179K) is a
    FIELD not a tag → individual-CARD lookup is on-demand/deferred; per-USER wearable works (13.6K tag).
24. **Data assistant reads Influx, not DuckDB/artifact** (9 Jul). The SAM agent answers by running
    Flux over the `sb_*` measurements via the **existing `IOT_UAT_MCP` connector** (`execute_flux_query`
    + `get_server_time` + `resolve_time_range`) — see `smart-buddy-agent/sam-agent-instructions.md`.
    This supersedes both earlier attempts (the `smartbuddy-mcp` DuckDB server SAM couldn't attach, and
    the "Data Analysis over an uploaded artifact" Path A). Text-in / text-out; same store as Playback.

## 3 · Repo layout

```
Smart Buddy Dashboard/
├─ txn/                       5 raw CSVs, part001–005, Feb 2026 only (comma, 'NULL', ~1.3GB)
│                             ⚠ filenames still say "…to_Apr…"; parts 006–016 (Mar/Apr) DELETED 8 Jul
├─ health data/
│  └─ {health_data,heart_rate}_202602_part1-6.csv          Feb drop (comma, fully quoted!)
│                             (the May TAB-separated *_May2026.csv drop was DELETED 8 Jul)
├─ feb_data/  (gitignored)    Feb rows exported to single CSVs (real IDs — never commit):
│  └─ feb_{transactions,health_data,heart_rate}.csv        3.98M / 2.95M / 2.39M rows
├─ SMART_Buddy_*.html         self-contained reports (Chart.js embedded) + PDFs
├─ SMART_Buddy_Findings_Report.pdf   ⧗ FROZEN — quarter (Feb–Apr); source data purged, not regenerable
├─ SMART_Buddy_Dashboard.html / _Anomaly_Patterns.* / _Health_Anomaly_*  ⧗ FROZEN (built on May+quarter)
├─ SMART_Buddy_Feb2026_Service_Report.{html,pdf}   Feb-only service report (+ fault verdicts, CNY)
├─ SMART_Buddy_Feb2026_Insights.html               Feb health×txn overlap report
├─ SMART_Buddy_Purchase_Insights.{html,pdf}        what students buy (Feb, verified-name only)
├─ docker-compose.yml         team-share deploy: one static nginx frontend, host :8088 (see DEPLOY.md)
├─ DEPLOY.md                  app-only deployment guide (no DB; behind nginx-proxy + Keycloak on the VM)
├─ DATA_PIPELINE.md           pipeline overview / task-map + "where the tasks run" (Feb-only)
├─ PLAN_SAM_AGENT.md          PLAN (not built): VM deploy + SAM agent over feb.duckdb
├─ smart-buddy-app/           Vite + MapLibre app — npm install && npm run dev → http://localhost:5188
│  ├─ Dockerfile              2-stage node build → nginx:1.27-alpine serving dist/ on 8080
│  ├─ nginx.conf              SPA fallback (hash routing) + /assets immutable cache + /healthz
│  ├─ .dockerignore           excludes node_modules/dist/.env from build context
│  ├─ vite.config.js          dev port pinned to 5188 (preview 5189, strictPort) — 5173 belongs to tree-digital-twin
│  ├─ index.html              nav = search + #nav-views (rendered per role by main.js)
│  └─ src/
│     ├─ main.js              role state, dynamic nav, unified search, window.SB cross-window API, deep links
│     ├─ hub-window.js        role hub (ROLES: fnb/eng/mgmt — views + primary window per role)
│     ├─ stall-window.js      Stall Explorer + per-stall detail (exports vchip)
│     ├─ eng-window.js        Terminal Health fleet + per-machine diagnostic
│     ├─ feb-window.js        February Insights (5 tabs, filter slices)
│     ├─ overview-window.js · school-window.js · windowing.js · charts.js · theme.css
│     └─ data/{global,schools,feb,stalls}.json   ← bundled datasets
├─ analysis/                  ALL pipeline scripts
│  ├─ convert_parquet.py      ⧗ HISTORICAL — needed May+quarter CSVs (now deleted); not runnable
│  ├─ convert_parquet_feb.py  Feb part CSVs + txn Feb cut → parquet/feb_*.parquet
│  ├─ convert_txn_perf.py     speed components → parquet/txn_perf[_YYYYMM].parquet (use: 2026-02)
│  ├─ analyze.py              ⧗ HISTORICAL → insights.json (main Dashboard; needed May+quarter)
│  ├─ analyze_feb.py          → feb_insights.json    (Feb health×txn report data)
│  ├─ analyze_anomalies.py    ⧗ HISTORICAL → anomaly_patterns.json (needed hr_fw.parquet/May HR)
│  ├─ analyze_purchases.py    → purchase_insights.json (Feb now)
│  ├─ build_app_data.py       default (Feb) → appdata/{global,schools}.json STILL RUNS (reads Feb txn.parquet);
│  │                          --quarter ⧗ DEAD (appdata_quarter needs Feb–Apr, purged)
│  ├─ build_feb_app_data.py   → appdata/feb.json    (February Insights window slices)
│  ├─ build_stalls_data.py    → appdata/stalls.json (stall + machine data, verdicts)
│  ├─ analyze_feb_service.py   → feb_service.json    (Feb service-report data: net/speed/food/school + verdicts + CNY)
│  ├─ feb_service_report.html  Feb service-report template; splice_feb_service.py → ../SMART_Buddy_Feb2026_Service_Report.html
│  ├─ purchase_insights_template.html  Purchase Insights template (recreated 7 Jul); splice_purchase_insights.py → ../SMART_Buddy_Purchase_Insights.html
│  ├─ feb_report_template.html  template for SMART_Buddy_Feb2026_Insights.html (splice chartjs+json)
│  ├─ pdf_report.html         ⧗ quarter PDF template + splice_pdf_report.py — report now FROZEN (appdata_quarter/ purged)
│  ├─ geocode_retry.py · school_geo.json (FINAL, 158 schools) · moe_schools.json
│  └─ parquet/                ON disk (Feb-only after 8 Jul purge): feb_txn, feb_health,
│                             feb_heart_rate, txn_perf_202602 + txn/txn_perf (rebuilt Feb-only).
│                             May health.parquet/heart_rate.parquet DELETED; appdata_quarter/ DELETED
├─ README.md · HANDOVER.md · PIPELINE.md
```

**DATA_PIPELINE.md** = pipeline overview / task-map (also answers "where do the tasks run?" —
all local/offline, static site). **PIPELINE.md** = deep engineer reference (architecture, output
catalog, metric logic, data-quality gates); both are now Feb-only. The old `hr_fw.parquet` ad-hoc
gap is **moot** — it needed the May HR file, which was purged (`convert_parquet_feb.py` already
extracts `firmware_version` for the Feb HR drop).

**NOT on disk (regenerate if needed):** the built `feb_insights/feb_service/purchase_insights`
JSONs (Feb-scoped, rebuildable) and `chart.umd.js` (use
`smart-buddy-app/node_modules/chart.js/dist/chart.umd.min.js`). **Cannot be regenerated (source
purged):** the `insights.json`/`anomaly_patterns.json` and the quarter `appdata_quarter/` behind
the frozen ⧗ reports. Templates: the Dashboard + Anomaly reports have no template (their HTML was
the source of truth — now frozen); Purchase Insights + both Feb reports build from templates in
`analysis/`.

## 4 · Pipeline — regeneration order

**Feb-only pipeline (current — all steps below run against the data on disk):**
```bash
pip install duckdb scikit-learn pillow          # pandas already present (v3)
cd analysis
# taxonomy.py = shared classification module (imported by every analyze/build script — edit ONLY there)
python convert_parquet_feb.py                    # ~12 s; → parquet/feb_*.parquet
python convert_txn_perf.py 2026-02               # ~5 s;  → parquet/txn_perf_202602.parquet
python build_app_data.py                         # → appdata/{global,schools}.json (Feb; reads Feb txn.parquet)
python build_feb_app_data.py                     # → appdata/feb.json
python build_stalls_data.py                      # → appdata/stalls.json
python analyze_feb.py                            # → feb_insights.json (static Feb report data)
python analyze_feb_service.py                    # → feb_service.json (Feb service-report data)
python analyze_purchases.py                      # → purchase_insights.json (verified-name categories, Feb)
python splice_feb_service.py                     # → ../SMART_Buddy_Feb2026_Service_Report.html
python splice_purchase_insights.py               # → ../SMART_Buddy_Purchase_Insights.html
cp appdata/*.json ../smart-buddy-app/src/data/   # refresh the app bundle (Feb scope)
# NB --print-to-pdf needs an ABSOLUTE output path (relative paths fail silently, old file untouched)
# Feb Insights HTML: splice chart.umd.min.js + feb_insights.json into feb_report_template.html
# chart.umd.min.js source: smart-buddy-app/node_modules/chart.js/dist/ (the splice_*.py scripts read it there)
# PDFs: chrome --headless=new --no-pdf-header-footer --print-to-pdf=... --virtual-time-budget=15000 file:///...
```

**⧗ Dead after the Feb-only purge (source data removed — do NOT run, they will error or mislead):**
`convert_parquet.py` (needed May health + Feb–Apr txn), `analyze.py` → `insights.json` (Dashboard),
`analyze_anomalies.py` → `anomaly_patterns.json` (needed May `hr_fw.parquet`),
`build_app_data.py --quarter` + `splice_pdf_report.py` (the Feb–Apr Findings PDF — `appdata_quarter/`
is gone). The reports they built remain as frozen files in the project root.

Headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) renders screenshots and
PDFs. Node v24 installed. No poppler (verify PDFs by screenshotting the source HTML instead).

## 5 · The HTML reports

Built as: template (placeholders `/*__CHARTJS__*/` + `/*__DATA__*/{}`) + chart.umd.js + JSON,
spliced by the `splice_*.py` scripts in `analysis/`. Only the Dashboard and Anomaly reports lack
templates (their shipped HTML is the source of truth — edit in place). Purchase Insights' template
was recreated 7 Jul (`purchase_insights_template.html` — edit it, not the shipped HTML); the Feb
reports have templates (`feb_report_template.html`, `feb_service_report.html`). The quarter PDF
template `pdf_report.html` still exists but its report is now frozen (⧗ — `appdata_quarter/` purged).
Artifact versions of the three originals differ slightly
(`data-theme` overrides + MutationObserver); redeploy to the SAME artifact URLs via the Artifact
tool `url` param. No artifact exists for the Feb report or the app.

## 6 · Established analytical facts (verified; don't re-derive)

> **Scope note (8 Jul):** the **quarter (Feb–Apr) and May** figures below are **historical** —
> their source data was purged, so they can't be re-derived; kept because they were verified and
> still inform the story. The **February** figures are current and rebuildable.

**Data quirks** — health `raw` is JSON for data_type=1, hex for 0 (both 30-min intervals; only 65
users have both); 137 garbage data_type values ride on corrupt packets (Feb: 310); HR payload dates
span 1970–2038 (40.3% backfill in Feb; the May drop showed 41% — stable behaviour); HR duplicate
hours are multi-sync retries (dedup = keep latest sync_id).

**Anomaly root causes** — firmware 1.1.9.0.0 → 100% of 255-bpm + 88% of <40-bpm in May, and
**the same signature already in Feb** (373 err-255 + 176 sub-40, 100% from 1.1.9.0.0 → fault
predates May); UNKNOWN paymentType ≈ error path; night 1¢ txns → STYL test terminals; $9,999.90 →
"Retrieve…" maintenance; negative signal → WiFi dBm (45 terminals); 18 gen-0 wearables →
whole-record corruption; 23:00 HR spike → sparse-sampling artifact (reproduces in Feb: 90.3 bpm).

**Behavioural (quarter — HISTORICAL, from the frozen Findings PDF)** — recess 9–11am = 52% of
spend; verified menu (named stalls, 18.5% of txns) = $1 drink / $1 snack / $2 meal; purchase clock
shifts later with age; stall loyalty ~52%; secondary $4.03/day > JC $3.23 > primary $2.88; bookshop
spikes at term starts; steps↔HR r = −0.36 (May); Independent $3.84/day vs Government $3.41.
**Verified-classification layer** — **taxonomy v2 (final) coverage: 493 Feb stalls / 17.5% of txns /
18.5% of revenue** (Mixed 23, vetoed 9). *(The v1 morning pass counted 546 Feb / 554 quarter at
18.5%/19.5% before the evening tightening — see decision #18.)* Verified mix skews to
name-registering stall types (bookshops!);
unclassified pool: median $1.50, 71% of purchases ≤$2. **Retracted as price-inference artifacts**:
"JC food is cheaper" (verified medians: $1.80 pri → $2.40 JC → $2.80 sec), "afternoon snack
o'clock" (only 15 named snack stalls), and "March-holiday week flips the mix" (named stalls simply
close that week — n=494; charts now gap it out).

**February (overlap month)** — school days ≈8,100 steps/user vs ≈3,600 non-school; CNY 17–18 Feb:
revenue $0 + steps at Sunday levels (16 Feb = half-day, $20K); activity rebounded 19 Feb but
spending stayed 12–27% low for the rest of CNY week; steps↔HR **replicates: r = −0.297 (n=6,991)**;
Sat steps 4,178 vs Sun 2,521; wearable user segments (k-means, label by profile!): School-day
actives 5.3K / Everyday wearers 2.6K / Occasional 5.1K / Barely used 600 — resting HR rises 64→79
across engagement levels.

**Stall/machine layer** — stall↔terminal ≈ 1:1 (2,491 of 2,546 stalls have exactly one machine);
storeId is school-scoped. Machine-vs-site verdicts vs school peers: **165 machine faults, 190 site
issues across 52 schools** (PBS = clearest site-level problem), 2,235 ok. Verdict thresholds:
err ≥10% & n≥300 (or med ≥4s); peers bad if peer-median err ≥8% or med ≥4s.

## 7 · Gotchas for the next session

- **Feb health CSVs = comma fully-quoted** (6 part files each, header in each); literal `'NULL'`.
  Txn CSVs comma. Always `nullstr='NULL'`. (The purged May drop was TAB-separated — noted only in
  case an old export resurfaces.)
- DuckDB `read_csv` on txn needs explicit types for `errorCode`/`cardId`/etc. (sampling mistypes across the 5 part files).
- **Weekly aggregates**: Feb starts Sun 1 Feb → filter `txn_date BETWEEN '2026-02-02' AND '2026-02-28'` (drops the single-day `2026-01-26` week bucket).
- **OneMap geocoding rate-limits hard**; `school_geo.json` is complete — reuse, don't regenerate.
- School acronym matcher: 176 IDs unmatched **by design** (ambiguous → don't guess). Coverage 158/334.
- k-means cluster indices are unstable across refits — assign labels by cluster *profile*, never index.
- **Do NOT reintroduce price-based food-category inference** (decision #14). mcat is one CASE:
  keyword-named → category, else 'Unclassified'. Category shares need verified-only denominators
  + **low-sample guards** (weekly <2,000 verified txns → null/gap; per-point n<300 → null) or
  single stalls produce artifacts ($22 "avg meal" from 4 txns; 93% "weekend Fruits" from 1 stall).
- `drinks_heavy` now means "drinks share of a school's *named-stall* volume" — 100% = all its named
  stalls are drink stalls, NOT that students only buy drinks.
- Edit report *templates* in `analysis/` (then re-splice), never the shipped HTML — except
  Dashboard + Anomaly reports, which have no template (edit shipped HTML in place).
- `pandas.to_json` emits epoch ms for dates — cast dates to VARCHAR in SQL. `pytz` is NOT installed —
  never return timestamptz to Python; CAST to VARCHAR in SQL.
- A pandas column named `cat` collides with the `.cat` accessor — use `row["cat"]`, not `row.cat`.
- **`json.dump` writes bare `NaN`** (invalid strict JSON — Vite returns 500 on import and the whole
  app module chain dies silently). Empty slices produce NaN and `NaN or 0` stays NaN (NaN is truthy).
  Use `pd.isna()` guards + `json.dump(..., allow_nan=False)`. Validate with `node -e "JSON.parse(...)"`.
- Headless-Chrome debugging of the app: a blank stage usually means a failed module import — check
  `curl <dev-server>/src/data/<file>.json?import` for 500s before suspecting WebGL.
- The map is wrapped in try/catch — app works without WebGL (windows/search fine, no markers).
- App deep links: `#role=fnb|eng|mgmt`, `#school=ID`, `#stall=storeId`, `#terminal=terminalId`,
  `#feb[=act|wear|hr|spend|cny]`. Role persists in `localStorage['sb-role']`; hub opens when unset.
- Cross-window navigation uses the `window.SB` API set in main.js (openSchool/openStall/openTerminal/openStalls).
- PowerShell 5.1: no `&&`; Bash tool works but needs `/c/...` paths; quote sed ranges.
- Chrome headless on localhost needs `dangerouslyDisableSandbox` on the Bash tool.
- **Do not move the app back to port 5173** — tree-digital-twin uses it. 5188/5189 pinned, `strictPort`.
- A stray Vite dev server from an old session may already hold 5188 — it serves current disk state
  (fine for testing); `npm run dev` will fail loudly on the port clash.
- Memory file: `~/.claude/projects/.../memory/smart-buddy-data-facts.md` — keep in sync.

## 8 · Open items / natural next steps

- **⭐ InfluxDB/Ditto playback + data assistant — ALL BUILT + PUSHED, awaiting VM deploy**
  (`PLAN_PLAYBACK_MIGRATION.md` design · `SB_DEPLOY.md` runbook · memory `playback-migration-plan.md`).
  Ingestion (`sb_backfill.py`), `sb-api`, the Playback window, and the Flux-based agent instructions
  are done. **Remaining is the VM deploy** (needs Docker + platform Influx write/read tokens + Ditto
  creds): run the 3-step backfill (`--check`→dry-run→`--write`), `docker compose -f
  docker-compose.sb.yml up`, add `nginx-smartbuddy.conf`, create the SAM agent on `IOT_UAT_MCP`.
  The workstation can't run it (no Docker; Ditto has no non-Docker option). Reference repos at
  `Downloads/{iot-platform,htx-pilot,tree-digital-twin}`.
- *(superseded)* The earlier `PLAN_SAM_AGENT.md` DuckDB/`smartbuddy-mcp` approach — kept in the repo
  but the Influx/Ditto pivot replaced it; `feb.duckdb` is now an ingest-time compute helper only.
- **App deployment (artifacts done, 7 Jul; deploy owned by a colleague)**: containerized as a static nginx
  site — `smart-buddy-app/{Dockerfile,nginx.conf,.dockerignore}` + repo-root `docker-compose.yml`. **DEPLOY.md
  is the colleague's brief** (isolation guarantees vs tree-twin-uat, exact values to avoid, the 3 decisions
  he owns — placement/hostname/auth — with a checklist for each). **Remaining, on his host:** `docker compose
  up -d --build` (Docker absent on the analysis workstation), pick a non-`tree-twin-uat` hostname, gate access
  (new Keycloak client or proxy basic-auth), confirm outbound internet or self-host the Carto basemap tiles.
- ~~pipeline gap: `hr_fw.parquet` (May HR + firmware) ad-hoc~~ — **moot after the Feb-only purge**
  (the May HR file is gone; `convert_parquet_feb.py` already extracts firmware for the Feb HR drop).
- No artifact/share link exists for `SMART_Buddy_Feb2026_Insights.html` or the app — create on request.
- The unmatched-176 school list would collapse with a STYL-internal schoolId→name mapping — ask if one exists.
- **Recommendation to surface upstream** (now printed in all three reports): have stall operators
  register descriptive stall names — the 81% Unclassified blind spot shrinks with zero analytics work.
  An item/SKU feed (or stall→menu mapping) from the vendor would eliminate it entirely.
- If real menu/SKU data ever appears, the stall windows are designed to absorb it (price bands are the current proxy).
- Artifacts: user must click share on each; redeploys must reuse the URLs in README.
