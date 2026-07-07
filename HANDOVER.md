# HANDOVER — SMART Buddy Dashboard project

Context file for a new Claude session / after context compaction. State as of **7 Jul 2026**.
User: Gideon Seck (gideon.seck@styl.solutions). Everything in README.md is current; this file
adds the decisions, pipeline mechanics, and gotchas a new session needs.

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
    (global/schools/stalls/feb JSON all Feb). The REPORTS keep their original scopes (Findings PDF and
    Purchase Insights stay Feb–Apr; they were not changed). Restore the quarter in the app by widening
    `FEB_ALL`/`FEB_WK` in `build_app_data.py` and re-running (overview sub/captions would need re-wording).
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

## 3 · Repo layout

```
Smart Buddy Dashboard/
├─ txn/                       16 raw CSVs, Feb–Apr 2026 (comma, 'NULL' strings, ~4GB)
├─ health data/
│  ├─ 20260629_tbl_{health_data,heart_rate}_May2026.csv    May drop (TAB-separated!)
│  └─ {health_data,heart_rate}_202602_part1-6.csv          Feb drop (comma, fully quoted!)
├─ SMART_Buddy_*.html         self-contained reports (Chart.js embedded) + PDFs
├─ SMART_Buddy_Findings_Report.pdf                 quarter (Feb–Apr) network/speed/food/school
├─ SMART_Buddy_Feb2026_Service_Report.{html,pdf}   Feb-only service report (+ fault verdicts, CNY)
├─ docker-compose.yml         team-share deploy: one static nginx frontend, host :8088 (see DEPLOY.md)
├─ DEPLOY.md                  app-only deployment guide (no DB; behind nginx-proxy + Keycloak on the VM)
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
│  ├─ convert_parquet.py      May+quarter raw CSVs → parquet/{health,heart_rate,txn}.parquet
│  ├─ convert_parquet_feb.py  Feb part CSVs + txn Feb cut → parquet/feb_*.parquet
│  ├─ convert_txn_perf.py     speed components → parquet/txn_perf[_YYYYMM].parquet (arg = month)
│  ├─ analyze.py              → insights.json        (main dashboard data)
│  ├─ analyze_feb.py          → feb_insights.json    (Feb health×txn report data)
│  ├─ analyze_anomalies.py    → anomaly_patterns.json (needs hr_fw.parquet — still ad-hoc!)
│  ├─ analyze_purchases.py    → purchase_insights.json
│  ├─ build_app_data.py       → appdata/{global,schools}.json  (app + PDF data, Feb–Apr)
│  ├─ build_feb_app_data.py   → appdata/feb.json    (February Insights window slices)
│  ├─ build_stalls_data.py    → appdata/stalls.json (stall + machine data, verdicts)
│  ├─ analyze_feb_service.py   → feb_service.json    (Feb service-report data: net/speed/food/school + verdicts + CNY)
│  ├─ feb_service_report.html  Feb service-report template; splice_feb_service.py → ../SMART_Buddy_Feb2026_Service_Report.html
│  ├─ purchase_insights_template.html  Purchase Insights template (recreated 7 Jul); splice_purchase_insights.py → ../SMART_Buddy_Purchase_Insights.html
│  ├─ feb_report_template.html  template for SMART_Buddy_Feb2026_Insights.html (splice chartjs+json)
│  ├─ pdf_report.html         quarter PDF template; splice_pdf_report.py → pdf_report_spliced.html (print → Findings_Report.pdf)
│  ├─ geocode_retry.py · school_geo.json (FINAL, 158 schools) · moe_schools.json
│  └─ parquet/                ON disk (7 Jul): txn, health, heart_rate, txn_perf (quarter/May, regenerated)
│                             + feb_health, feb_heart_rate, feb_txn, txn_perf_202602 (Feb)
├─ README.md · HANDOVER.md · PIPELINE.md
```

**PIPELINE.md** = engineer-facing pipeline doc (architecture, output catalog, metric logic,
data-quality gates). The old ⚠ txn_perf gap is closed (`convert_txn_perf.py`); **hr_fw.parquet
for the May file is still ad-hoc** (only remaining gap — `convert_parquet_feb.py` shows the
firmware-extraction pattern to copy).

**NOT on disk (regenerate if needed):** the built `insights/anomaly_patterns` JSONs and
`chart.umd.js` (use `smart-buddy-app/node_modules/chart.js/dist/chart.umd.min.js`). The quarter
parquets and `purchase_insights.json` were regenerated 7 Jul and ARE on disk. Templates: only the
Dashboard and Anomaly reports have no template (their HTML is the source of truth — edit in
place); Purchase Insights, both Feb reports and the quarter PDF all build from templates in
`analysis/`.

## 4 · Pipeline — regeneration order

```bash
pip install duckdb scikit-learn pillow          # pandas already present (v3)
cd analysis
# --- original quarter/May pipeline ---
python convert_parquet.py                        # ~15 s; → parquet/{txn,health,heart_rate}.parquet
python convert_txn_perf.py                       # → parquet/txn_perf.parquet (full period)
# taxonomy.py = shared classification module (imported by all 5 analyze/build scripts — edit ONLY there)
python build_app_data.py                         # → appdata/{global,schools}.json  (FEB-ONLY, for the app)
python build_app_data.py --quarter               # → appdata_quarter/{global,schools}.json (for the Findings PDF)
# --- Feb 2026 pipeline ---
python convert_parquet_feb.py                    # ~12 s; → parquet/feb_*.parquet
python convert_txn_perf.py 2026-02               # ~5 s;  → parquet/txn_perf_202602.parquet
python analyze_feb.py                            # → feb_insights.json (static Feb report data)
python build_feb_app_data.py                     # → appdata/feb.json
python build_stalls_data.py                      # → appdata/stalls.json
python analyze_feb_service.py                    # → feb_service.json (Feb service-report data)
python splice_feb_service.py                     # → ../SMART_Buddy_Feb2026_Service_Report.html (chartjs + json)
python analyze_purchases.py                      # → purchase_insights.json (verified-name categories)
python splice_purchase_insights.py               # → ../SMART_Buddy_Purchase_Insights.html
python splice_pdf_report.py                      # → pdf_report_spliced.html (reads appdata_quarter/; print → Findings_Report.pdf)
cp appdata/*.json ../smart-buddy-app/src/data/   # refresh the app bundle (Feb scope)
# NB --print-to-pdf needs an ABSOLUTE output path (relative paths fail silently, old file untouched)
# Feb Insights HTML: splice chart.umd.min.js + feb_insights.json into feb_report_template.html
# chart.umd.min.js source: smart-buddy-app/node_modules/chart.js/dist/ (the splice_*.py scripts read it from there)
# PDFs: chrome --headless=new --no-pdf-header-footer --print-to-pdf=... --virtual-time-budget=15000 file:///...
```

Headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) renders screenshots and
PDFs. Node v24 installed. No poppler (verify PDFs by screenshotting the source HTML instead).

## 5 · The HTML reports

Built as: template (placeholders `/*__CHARTJS__*/` + `/*__DATA__*/{}`) + chart.umd.js + JSON,
spliced by the `splice_*.py` scripts in `analysis/`. Only the Dashboard and Anomaly reports lack
templates (their shipped HTML is the source of truth — edit in place). Purchase Insights' template
was recreated 7 Jul (`purchase_insights_template.html` — edit it, not the shipped HTML); the Feb
reports and the quarter PDF also have templates (`feb_report_template.html`,
`feb_service_report.html`, `pdf_report.html`). Artifact versions of the three originals differ slightly
(`data-theme` overrides + MutationObserver); redeploy to the SAME artifact URLs via the Artifact
tool `url` param. No artifact exists for the Feb report or the app.

## 6 · Established analytical facts (verified; don't re-derive)

**Data quirks** — health `raw` is JSON for data_type=1, hex for 0 (both 30-min intervals; only 65
users have both); 137 garbage data_type values ride on corrupt packets (Feb: 310); HR payload dates
span 1970–2038 (41% backfill in May AND 40.3% in Feb — stable behaviour); HR duplicate hours are
multi-sync retries (dedup = keep latest sync_id).

**Anomaly root causes** — firmware 1.1.9.0.0 → 100% of 255-bpm + 88% of <40-bpm in May, and
**the same signature already in Feb** (373 err-255 + 176 sub-40, 100% from 1.1.9.0.0 → fault
predates May); UNKNOWN paymentType ≈ error path; night 1¢ txns → STYL test terminals; $9,999.90 →
"Retrieve…" maintenance; negative signal → WiFi dBm (45 terminals); 18 gen-0 wearables →
whole-record corruption; 23:00 HR spike → sparse-sampling artifact (reproduces in Feb: 90.3 bpm).

**Behavioural (quarter)** — recess 9–11am = 52% of spend; verified menu (named stalls, 18.5% of
txns) = $1 drink / $1 snack / $2 meal; purchase clock shifts later with age; stall loyalty ~52%;
secondary $4.03/day > JC $3.23 > primary $2.88; bookshop spikes at term starts; steps↔HR r = −0.36;
Independent $3.84/day vs Government $3.41.
**Verified-classification layer (7 Jul)** — coverage: 554 named stalls (quarter) / 546 (Feb),
18.5% of txns, 19.5% of revenue; verified mix skews to name-registering stall types (bookshops!);
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

- **Health CSVs: May = TAB-separated, Feb = comma fully-quoted** (6 part files, header in each);
  both use literal `'NULL'`. Txn CSVs comma. Always `nullstr='NULL'`.
- DuckDB `read_csv` on txn needs explicit types for `errorCode`/`cardId`/etc. (sampling mistypes across 16 files).
- **Weekly aggregates**: quarter starts Sun 1 Feb → filter `txn_date BETWEEN '2026-02-02' AND '2026-04-26'`.
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

- **App deployment (artifacts done, 7 Jul; deploy owned by a colleague)**: containerized as a static nginx
  site — `smart-buddy-app/{Dockerfile,nginx.conf,.dockerignore}` + repo-root `docker-compose.yml`. **DEPLOY.md
  is the colleague's brief** (isolation guarantees vs tree-twin-uat, exact values to avoid, the 3 decisions
  he owns — placement/hostname/auth — with a checklist for each). **Remaining, on his host:** `docker compose
  up -d --build` (Docker absent on the analysis workstation), pick a non-`tree-twin-uat` hostname, gate access
  (new Keycloak client or proxy basic-auth), confirm outbound internet or self-host the Carto basemap tiles.
- **Last remaining pipeline gap**: `hr_fw.parquet` (May HR + firmware) still ad-hoc — script it like
  `convert_parquet_feb.py` does for Feb if anomaly report needs regenerating.
- No artifact/share link exists for `SMART_Buddy_Feb2026_Insights.html` or the app — create on request.
- The unmatched-176 school list would collapse with a STYL-internal schoolId→name mapping — ask if one exists.
- **Recommendation to surface upstream** (now printed in all three reports): have stall operators
  register descriptive stall names — the 81% Unclassified blind spot shrinks with zero analytics work.
  An item/SKU feed (or stall→menu mapping) from the vendor would eliminate it entirely.
- If real menu/SKU data ever appears, the stall windows are designed to absorb it (price bands are the current proxy).
- Artifacts: user must click share on each; redeploys must reuse the URLs in README.
