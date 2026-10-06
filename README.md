# SMART Buddy Dashboard — Data Analysis Project

Analysis of the SMART Buddy school payment + wearable ecosystem for STYL Solutions.

> **Deployed system (current):** the dashboard now serves **two months — February 2026 + March 2026**,
> and **all data is read live from the shared ClickHouse `smartbuddy` database** (nothing is baked into
> the JS bundle). Data arrives through the dashboard's **chunked Upload feature** (any size), is loaded
> per-month (`month` partition), and the per-month insight bundles are precomputed into an `insights`
> table. A top-bar **month picker** switches everything. Feb + March both have canteen + wearable
> (activity/heart-rate); March also has purchase line-items + saving/spending. Runbook + pipeline: **DEPLOY.md** / below.
>
> The historical analysis notes below (Feb-only scope, local parquet pipeline, frozen HTML/PDF reports)
> describe the ORIGINAL offline analysis and are kept as a record.

The dataset: **~4.0M canteen transactions/month** (334 schools) + **wearable records both months**
(Feb 2.95M activity + 2.39M heart-rate, ~13,600 users; March 2.48M + 2.26M, ~12,460 users) + March
**~4.3M purchase line-items** and **~145k student saving/spending** rows.

## Deliverables

| File / folder | What it is | How to view |
|---|---|---|
| `client/` | **Interactive insights app** (tree-digital-twin style), **February 2026 only** (tentative, 7 Jul — every window reads the same month) with a **role-based hub** — pick F&B / Engineering / Management and the nav shows that team's views. Windows: map + school details (per-school window: **revenue-by-stall bars**, every store individually, + a **Terminals tab** with each machine tagged to its stall and its machine-vs-site verdict), Network Overview (signal shown as plain-language quality bands; food charts read within name-verified volume), **Terminal Health** (2,604 machines with fault verdicts vs school peers), **February Insights** (day-type × user-segment × firmware × level filters), plus a **Playback** window and a **SAM chat** panel. **Stall Explorer is shelved from the nav** (no item/SKU data — revisit when a menu/itemID feed exists); per-stall detail stays reachable via school windows, search and `#stall=` links. Unified search; everything cross-linked & deep-linkable (`#role=eng`, `#terminal=…`, `#feb=cny`) | **Dev:** `cd client && npm install && npm run dev` → http://localhost:5188 (own port; 5173 belongs to the tree-digital-twin project). **Team-shareable:** containerized (`Dockerfile` + repo-root `docker-compose.yml`) as a Vite→nginx site with Keycloak login + Playback via api-service — `docker compose up -d --build` → :8097. Full runbook in **DEPLOY.md** |
| `SMART_Buddy_Dashboard.html` ⧗ | Main insights dashboard — KPIs, clusters, transactions, activity, heart rate, cross-dataset patterns, **data-quality report** (26 issue types) | double-click (offline, self-contained) |
| `SMART_Buddy_Anomaly_Patterns.html` ⧗ | Root-cause drill-down of every anomaly family + prioritized action list | double-click |
| `SMART_Buddy_Health_Anomaly_Patterns.html` ⧗ | Health-only subset of the anomaly report (payment content stripped — for the wearable supplier) | double-click |
| `SMART_Buddy_Purchase_Insights.html` | What students buy — categories, price points, school levels, habits (**Feb only** now). Verified-name classification policy (no price-based category guessing; generic-named stalls = Unclassified) | double-click |
| `SMART_Buddy_Feb2026_Insights.html` | **February 2026 report** — the month where wearable + transaction data overlap: shared calendar, CNY in both sensors, fitness-signal replication (r=−0.297), firmware fault predates May | double-click |
| `SMART_Buddy_Findings_Report.pdf` ⧗ | 6-page print report (whole Feb–Apr quarter): network health, speed trends, food categories, school spending ("atas" analysis) | any PDF reader |
| `SMART_Buddy_Feb2026_Service_Report.pdf` | **February-2026 service-team report** (7-page print, Feb data only): terminal network health **with machine-vs-location fault verdicts**, speed trends, food categories, spending per school, food-type trends, and the CNY-week impact. Built for the service supervisor. Source: `SMART_Buddy_Feb2026_Service_Report.html` (self-contained) | any PDF reader |
| `SMART_Buddy_{Dashboard,Anomaly_Patterns,Purchase_Insights,Health_Anomaly_Patterns}.pdf` | Email-ready PDF prints of the HTML reports | any PDF reader |
| `analysis/` | The Python/DuckDB pipeline that produced everything (run order in PIPELINE.md §5) | — |

⧗ = **frozen historical artifact.** Built from the May health drop and/or the Feb–Apr quarter
transactions, both removed in the 8 Jul Feb-only purge. The shipped file is unaffected but can
**no longer be regenerated** without re-downloading the source drops. Everything unmarked is
Feb-scoped and fully rebuildable from the data on disk.

Shareable links (claude.ai artifacts, enable sharing before forwarding):
- Dashboard: https://claude.ai/code/artifact/bb33efc8-4bfd-404d-8d36-68f82741e2f3
- Anomaly patterns: https://claude.ai/code/artifact/d6c8048d-9167-48d9-9669-ba1faa489977
- Purchase insights: https://claude.ai/code/artifact/2e53acbc-2348-4f0a-8294-63f851c056b3 (redeployed 7 Jul with the verified-name policy)
- (No artifact yet for the Feb reports or the app.)

## Architecture (deployed)

The app plugs into the shared IoT platform like tree-digital-twin, but **every window reads live from
the shared ClickHouse `smartbuddy` database** (via the api-service read API) — nothing is baked into the
JS bundle, and a top-bar **month picker** switches between Feb and March. Behind **Keycloak login**
(realm `styl-iot`, client `smart-buddy`; the token's client must be in the shared jwt-validator's
`JWT_ALLOWED_CLIENTS`). `Dockerfile` + `nginx.conf` live in `client/`; root `docker-compose.yml` runs
**client + api-service**, and `docker-compose.agent.yml` runs **mcp-service** (SAM) + the chunked
**upload service** + the ingest/insight one-shots. Isolated from tree-twin (project `smartbuddy`,
containers `smartbuddy-*`, host port 8097, `sb-net` + shared `backend` net). Public host
`smartbuddy-helper-uat.styl.solutions`; the client nginx same-origin-proxies `/smartbuddy-api/` +
`/smartbuddy-mcp/` + `/smartbuddy-ingest/`. Full runbook: **DEPLOY.md**.

Pieces:
- **Upload → ClickHouse** (`ingestion-service/`): the dashboard **Upload tab** posts chunked, resumable,
  **size-unlimited** files to the `smartbuddy-ingest` service, which hashes PII, loads them into the
  target table's `month` partition (`ingest_core.py`, atomic REPLACE/append), and rebuilds aggregates.
  `init_db.py` (one-shot) creates the db + `insights` table + scoped `smartbuddy_ro`/`smartbuddy_rw`
  users. `build_insights.py` (+ `build_insights_wearable.py`, run per month with wearables) precompute
  each month's dashboard bundles into the `insights` table. (`scripts/vm-load.sh` / `sb-upload.mjs` do the same load from a CLI.)
- **Read API** (`api-service/`): `/api/months`, `/api/insights?month=&kind=` (the bundles every window
  renders) + Playback series (`pb_*` tables), as the read-only `smartbuddy_ro` user.
- **Dashboard** (`client/`): map + per-school/stall/terminal windows, Network Overview, Terminal Health,
  **Wearables** (Feb + March), **Purchases & Nutrition** + **Saving vs Spending** (March), a **Playback** window
  and a **SAM chat** panel — each fetched per selected month. A **data-coverage strip** by the month
  picker shows which datasets each month has (the platform adapts, never errors on a gap). Where a month
  has both transactions and receipts, the ~99% basket→stall→card link surfaces **"what each stall
  actually sells"** + per-card habits, and Saving-vs-Spending shows a **wallet↔savings cross-check**.
- **Data assistant** (`mcp-service` = `smartbuddy-mcp`): a **SAM agent** answers NL questions by writing
  read-only **ClickHouse SQL** over the `smartbuddy` tables via MCP (read-only user). Wire: shared Solace
  topic `STYL/iot/smartbuddy/system/shared/v1/sam/chat/{request,response,error}`, JSON `{correlationId,
  text,context,ts}`. See `mcp-service/agent-setup.md` + `agent-prompt.md`. (No InfluxDB/Ditto — one OLAP
  store serves the dashboard, playback and the agent.)

## Headline findings

> **February 2026 is the live scope.** The "Quarter" block below is **historical** — it
> summarises the Feb–Apr transactions that were removed in the Feb-only purge, preserved here
> from the now-frozen Findings PDF. The February block is the current, regenerable analysis.

**Quarter (Feb–Apr transactions) — historical, from the frozen `SMART_Buddy_Findings_Report.pdf`:**
- **The recess economy**: 52% of the quarter's $25.7M flows 9–11 am; average ticket $1.64 → $2.71 through the day.
- **Three-point menu (name-verified stalls, 17.2% of purchases)**: $1 drink · $1 snack · $2 cooked meal, locked to the timetable. The other ~83% of purchases happen at stalls without a trustworthy name (generic "Stall 1" or bare company names) and are reported as **Unclassified** — price facts only, never guessed.
- **"Atas" schools spend more**: Independent $3.84/student-day ($2.70 ticket) vs Government $3.41 ($1.93) — pricier purchases, not more of them. Level > status: secondary outspends primary ~40%.
- **Network is healthy but…**: flat 6–9% error baseline; the **3.0 ASCAN reader stack is 2× slower** than 2.0, every week.
- **Machine or location?** Comparing each terminal against its school peers: **165 machine-level faults** (service the unit) vs **190 site-level issues across 52 schools** (fixing the machine won't help) — browsable in the app's Terminal Health window.

**February (the overlap month — health × transactions on the same days):**
- **Both sensors see the same calendar**: school days ≈8,100 steps/user vs ≈3,600 otherwise; CNY (17–18 Feb) = $0 revenue and Sunday-level movement; activity snapped back on 19 Feb but spending stayed 12–27% low all CNY week.
- **The fitness signal replicates**: steps ↔ heart rate r = −0.297 (n=6,991) in Feb, matching the −0.36 measured earlier in the (now-removed) May drop — the negative signal held across two independent months.
- **The 255-bpm firmware fault predates May**: firmware 1.1.9.0.0 produced 100% of February's sensor errors too — strengthens the retirement case.
- **Wearing is a school habit**: 4 user segments (k-means) from "school-day actives" to "barely used"; resting HR rises 64 → 79 bpm across declining engagement.

## Key data facts & caveats (read before analysing further)

1. **Units**: txn `amount` = cents SGD; health `calories` = millical (÷1000 → kcal); `distances` = cm. Health rows are 30-min incremental intervals (daily totals = sums).
2. **No individual-level linkage** between transactions and health data: studentId is 100% NULL and cardId ≠ user_id. The **Feb 2026 drop shares calendar days** with the transactions, so day-aligned *aggregate* comparison is possible (and used); user-level joins remain impossible.
3. **Food category = verified stall name only, v2** (service-team policy, 7 Jul 2026): a stall gets a food category **only if its registered name says what it sells AND its own prices don't contradict the claim** (behavior can veto a name, never assign one). *(March now has receipt line-items: each stall additionally shows **what it actually sold** — item-type mix + healthier-choice share — but this never assigns a food category. The receipt-evidence category upgrade, taxonomy v3, stays **deferred** pending supervisor sign-off; see `analysis/taxonomy_v3_draft.py`.)* Names covering two food groups ("Hot Drinks and Snacks") are **Mixed**; corporate suffixes (pte ltd/trading/marketing) are NOT evidence — bare company names (BL Marketing, Overseas Associates…) are **Unclassified until STYL confirms the vendor list**. Result (Feb): 493 verified stalls, ~17.5% of purchases; everything else is Unclassified, price bands only. The single source of truth is `analysis/taxonomy.py` (shared by all 5 pipeline scripts). Name-vs-price agreement for the food categories runs 93–97%. The verified sample skews toward stall types that register real names (bookshops especially).
4. **School identities come from the receipts, not the acronyms**: `items` receipts carry no `schoolId`, yet link to transaction `schoolId`s to the exact second+cent (99.68%), so they identify each school independently. **All 332 school IDs geocoded** (320 MOE-directory-matched + 12 special-education via OneMap; APSN Katong added 1 Oct 2026 by postal code 467354 — OneMap lists it as "KATONG SCHOOL"). The other 2 IDs in the feed, `PBS` and `SSSTM`, are vendors, not schools (fact 10). *(15 Jul: the acronyms are misleading for 7 IDs — RVPS is Riverside not River Valley, RLPS is Rivervale not Rulang, CHS is Chongfu not Catholic High, NJC is National not Nanyang, NBSS is Northbrooks not Naval Base, CCPS is Concord not Canossa, GESS is Gan Eng Seng Primary. The base geo had these wrong; corrected from the feed, confirmed with the data owner.)*
5. **Excluded from spend**: school code "STYL" (vendor test terminals), storeName "Retrieve…", amounts > $200. *(Corrected 1 Oct 2026: "Retrieve…" stalls are **not** maintenance flows — they are real sales at machines that were later pulled; the store is relabelled at retrieval, e.g. "Retrieved 0526 Stall 1" = pulled May 2026, "Retrieve Stall 7 Pending WO TID" = work order pending. Mar: 14 stalls, 10,462 purchases, school hours, 94% of their cards also pay at another stall of the same school. They stay out of spend figures but **are** in the terminal / service view, tagged `retrieved`.)*
6. **HR file is keyed by sync time**: ~40.3% of Feb rows are pre-Feb backfill; filter payload `hr_date` to February for curves.
7. WiFi terminals report signal as **dBm** in the same column cellular uses for a 0–31 scale.
8. **Feb health CSVs** are comma-separated, fully-quoted (6 part files each for activity/HR). (The removed May drop was TAB-separated — noted in case an old export resurfaces.)
9. Stall ↔ machine is ~1:1 (2,491 of 2,546 stalls have exactly one terminal) — "filter by machine number" and "filter by stall" are nearly the same thing.
10. **Vendor IDs (verified 1 Oct 2026):** `PBS` = Pacific Bookstores — ~156 school bookshops filed under one ID, each named "Pacific Bookstores - <code>"; ~98% of their March receipt lines are BOOK (112,716 of 114,551). `SSSTM` = "Self Serve Stamps" (the feed's own name) — 13 points in March, 17 in February, each named after a school, selling only "Digital Smiley Stamp(s)" at $0.50 (POSB Stamp Savings Programme: stamps are savings credited back to the child, not spending). Any transaction with `stampValue` > 0 is a stamp purchase (also sold at bookshops). Both are excluded from school-level figures. A shop/point is placed at a school only from the feed's exact code/name or a reviewed decision with evidence — see `ingestion-service/pbs_hosts.csv` and `stamp_hosts.csv`; never inferred.

Full method notes: the Method sections inside each HTML report and the PDF appendix.
Pipeline (where tasks run, architecture, run order, metric logic & data-quality): **PIPELINE.md**.
Deployment (dashboard + Playback + SAM agent on the shared ClickHouse stack): **DEPLOY.md**.
