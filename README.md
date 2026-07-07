# SMART Buddy Dashboard — Data Analysis Project

Analysis of the SMART Buddy school payment + wearable ecosystem for STYL Solutions:
**13.4M canteen transactions** (Feb–Apr 2026, 334 schools) and **two wearable data drops** —
May 2026 (3.8M health/HR records, ~9,900 users) and **February 2026** (5.3M records, ~13,600
users), the first month that **overlaps** the transaction period. Everything below was generated
from the raw CSVs in `txn/` and `health data/`.

## Deliverables

| File / folder | What it is | How to view |
|---|---|---|
| `smart-buddy-app/` | **Interactive insights app** (tree-digital-twin style), **February 2026 only** (tentative, 7 Jul — every window reads the same month) with a **role-based hub** — pick F&B / Engineering / Management and the nav shows that team's views. Windows: map + school details (per-school window: **revenue-by-stall bars**, every store individually, + a **Terminals tab** with each machine tagged to its stall and its machine-vs-site verdict), Network Overview (signal shown as plain-language quality bands; food charts read within name-verified volume), **Terminal Health** (2,604 machines with fault verdicts vs school peers), **February Insights** (day-type × user-segment × firmware × level filters). **Stall Explorer is shelved from the nav** (no item/SKU data — revisit when a menu/itemID feed exists); per-stall detail stays reachable via school windows, search and `#stall=` links. Unified search; everything cross-linked & deep-linkable (`#role=eng`, `#terminal=…`, `#feb=cny`) | **Dev:** `cd smart-buddy-app && npm install && npm run dev` → http://localhost:5188 (own port; 5173 belongs to the tree-digital-twin project). **Team-shareable:** containerized (`Dockerfile` + repo-root `docker-compose.yml`) as a static nginx site — `docker compose up -d --build` → :8088. Full steps in **DEPLOY.md** |
| `SMART_Buddy_Dashboard.html` | Main insights dashboard — KPIs, clusters, transactions, activity, heart rate, cross-dataset patterns, **data-quality report** (26 issue types) | double-click (offline, self-contained) |
| `SMART_Buddy_Anomaly_Patterns.html` | Root-cause drill-down of every anomaly family + prioritized action list | double-click |
| `SMART_Buddy_Health_Anomaly_Patterns.html` | Health-only subset of the anomaly report (payment content stripped — for the wearable supplier) | double-click |
| `SMART_Buddy_Purchase_Insights.html` | What students buy — categories, price points, school levels, habits. **Reworked 7 Jul 2026 to the verified-name classification policy** (no price-based category guessing; generic-named stalls = Unclassified) | double-click |
| `SMART_Buddy_Feb2026_Insights.html` | **February 2026 report** — first month where wearable + transaction data overlap: shared calendar, CNY in both sensors, fitness-signal replication (r=−0.297), firmware fault predates May | double-click |
| `SMART_Buddy_Findings_Report.pdf` | 6-page print report (whole Feb–Apr quarter): network health, speed trends, food categories, school spending ("atas" analysis) | any PDF reader |
| `SMART_Buddy_Feb2026_Service_Report.pdf` | **February-2026 service-team report** (7-page print, Feb data only): terminal network health **with machine-vs-location fault verdicts**, speed trends, food categories, spending per school, food-type trends, and the CNY-week impact. Built for the service supervisor. Source: `SMART_Buddy_Feb2026_Service_Report.html` (self-contained) | any PDF reader |
| `SMART_Buddy_{Dashboard,Anomaly_Patterns,Purchase_Insights,Health_Anomaly_Patterns}.pdf` | Email-ready PDF prints of the HTML reports | any PDF reader |
| `analysis/` | The Python/DuckDB pipeline that produced everything (run order in HANDOVER.md §4) | — |

Shareable links (claude.ai artifacts, enable sharing before forwarding):
- Dashboard: https://claude.ai/code/artifact/bb33efc8-4bfd-404d-8d36-68f82741e2f3
- Anomaly patterns: https://claude.ai/code/artifact/d6c8048d-9167-48d9-9669-ba1faa489977
- Purchase insights: https://claude.ai/code/artifact/2e53acbc-2348-4f0a-8294-63f851c056b3 (redeployed 7 Jul with the verified-name policy)
- (No artifact yet for the Feb reports or the app.)

**Sharing the app with the team** (chosen 7 Jul 2026 — app only, no database): the app
bundles its data into the build, so it deploys as a **self-contained static nginx site**
(no InfluxDB/Ditto/API). `Dockerfile` + `nginx.conf` in `smart-buddy-app/`, `docker-compose.yml`
at the repo root — mirrors the tree-digital-twin `frontend` service, stripped of all backend
wiring. **Completely separate from tree-twin-uat**: it connects to none of the shared platform
stores (bucket `rtls`, Ditto `org.nparks`, Solace), and the compose stack is isolated by design
(project `smartbuddy`, container `smartbuddy-frontend`, host port 8088 via `SB_FRONTEND_PORT`,
private `sb-net` network — none of which collide with tree-twin's `nparks-*` / 8087 / `backend`).
Placement, hostname, and auth are handled by the deploying engineer — full brief (incl. the exact
tree-twin values to avoid and the basemap-egress caveat) in **DEPLOY.md**.

## Headline findings

**Quarter (Feb–Apr transactions):**
- **The recess economy**: 52% of the quarter's $25.7M flows 9–11 am; average ticket $1.64 → $2.71 through the day.
- **Three-point menu (name-verified stalls, 17.2% of purchases)**: $1 drink · $1 snack · $2 cooked meal, locked to the timetable. The other ~83% of purchases happen at stalls without a trustworthy name (generic "Stall 1" or bare company names) and are reported as **Unclassified** — price facts only, never guessed.
- **"Atas" schools spend more**: Independent $3.84/student-day ($2.70 ticket) vs Government $3.41 ($1.93) — pricier purchases, not more of them. Level > status: secondary outspends primary ~40%.
- **Network is healthy but…**: flat 6–9% error baseline; the **3.0 ASCAN reader stack is 2× slower** than 2.0, every week.
- **Machine or location?** Comparing each terminal against its school peers: **165 machine-level faults** (service the unit) vs **190 site-level issues across 52 schools** (fixing the machine won't help) — browsable in the app's Terminal Health window.

**February (the overlap month — health × transactions on the same days):**
- **Both sensors see the same calendar**: school days ≈8,100 steps/user vs ≈3,600 otherwise; CNY (17–18 Feb) = $0 revenue and Sunday-level movement; activity snapped back on 19 Feb but spending stayed 12–27% low all CNY week.
- **The fitness signal replicates**: steps ↔ heart rate r = −0.297 (n=6,991) in Feb vs −0.36 in May — two independent months, same conclusion.
- **The 255-bpm firmware fault predates May**: firmware 1.1.9.0.0 produced 100% of February's sensor errors too — strengthens the retirement case.
- **Wearing is a school habit**: 4 user segments (k-means) from "school-day actives" to "barely used"; resting HR rises 64 → 79 bpm across declining engagement.

## Key data facts & caveats (read before analysing further)

1. **Units**: txn `amount` = cents SGD; health `calories` = millical (÷1000 → kcal); `distances` = cm. Health rows are 30-min incremental intervals (daily totals = sums).
2. **No individual-level linkage** between transactions and health data: studentId is 100% NULL and cardId ≠ user_id. The **Feb 2026 drop shares calendar days** with the transactions, so day-aligned *aggregate* comparison is possible (and used); user-level joins remain impossible.
3. **No item/SKU data — verified-name classification only, v2** (service-team policy, 7 Jul 2026): a stall gets a food category **only if its registered name says what it sells AND its own prices don't contradict the claim** (behavior can veto a name, never assign one). Names covering two food groups ("Hot Drinks and Snacks") are **Mixed**; corporate suffixes (pte ltd/trading/marketing) are NOT evidence — bare company names (BL Marketing, Overseas Associates…) are **Unclassified until STYL confirms the vendor list**. Result: 493–498 verified stalls, ~17.2–17.5% of purchases; everything else is Unclassified, price bands only. The single source of truth is `analysis/taxonomy.py` (shared by all 5 pipeline scripts). Name-vs-price agreement for the food categories runs 93–97%. The verified sample skews toward stall types that register real names (bookshops especially).
4. **School identities are inferred**: IDs acronym-matched to the MOE School Directory — 158/334 confident (4 hand-verified); the rest have level-by-suffix only, no map position, no MOE type.
5. **Excluded as non-student traffic**: school code "STYL" (vendor test terminals), storeName "Retrieve…" (maintenance flows), amounts > $200.
6. **HR files are keyed by sync time**: ~41% backfill in May, 40.3% in Feb; filter payload `hr_date` to the target month for curves.
7. WiFi terminals report signal as **dBm** in the same column cellular uses for a 0–31 scale.
8. **File formats differ per drop**: May health CSVs are TAB-separated; Feb health CSVs are comma-separated fully-quoted (6 part files each for activity/HR).
9. Stall ↔ machine is ~1:1 (2,491 of 2,546 stalls have exactly one terminal) — "filter by machine number" and "filter by stall" are nearly the same thing.

Full method notes: the Method sections inside each HTML report and the PDF appendix.
Pipeline architecture, metric logic & data-quality handling: **PIPELINE.md**.
Run order, decisions & session context: **HANDOVER.md**.
