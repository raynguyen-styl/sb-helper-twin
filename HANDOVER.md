# HANDOVER — SMART Buddy Dashboard

Orientation for a teammate (or a fresh session) picking this up. Last updated **6 Oct 2026**.

> **1 Oct session work (§3d + §3e) is committed & pushed (6 Oct) but NOT on UAT** — vendor layers, dashboard filter
> fix, daily-chart fix, copy pass, APSN Katong (§3d) **and the terminal service view + service route (§3e)**, plus
> §3f. Deploy with `reload/VENDOR_LAYERS_DEPLOY.md` + `reload/SERVICE_ROUTE_DEPLOY.md` (same images, one pass).

**▶ Next session — start here**
1. Don't force-push `main`.
2. Deploy §3d + §3e + §3f on UAT in one pass (`VENDOR_LAYERS_DEPLOY.md` then `SERVICE_ROUTE_DEPLOY.md` verify list).
3. Chase the answers that unblock the next step (§5): service-team thresholds, who services PBS/SSSTM machines,
   meaning of the `ISP-<date>` serial, data-owner questions on RPS/CHKL/MGS/SCGS/FHPS.
4. Local test harness (no Docker/WSL/ClickHouse on this laptop) — scripts are in the 1 Oct session scratchpad,
   **not the repo**: `%LOCALAPPDATA%\Temp\claude\c--Users-STYLSG-Downloads-Smart-Buddy-Dashboard\59c05f86-5ca5-4db1-965b-ce8a795969fb\scratchpad\local\`
   — `seed_and_build.py` (DuckDB stand-in running the real `build_insights.run`; `SKIP_SEED=1` reuses the seeded
   2 GB `sb_local.duckdb`), `local_api.py` (api-service stand-in), `fake_ch.py` + `route_test.mjs` (drive the real
   mcp-service), `shots_route.mjs` (headless-Chrome screenshots). Temp folders can be cleaned — if gone, rebuild from
   the descriptions in `reload/VENDOR_LAYERS_DEPLOY.md` § Local verification. Run the client against it with
   `VITE_SB_API_URL=http://127.0.0.1:<port> npx vite --port <other than 5188>`.

`main` has the **basemap Carto → OneMap** fix (`8a5d7df`) plus the **marker-contrast + drag-limit** follow-up (§3c). Everything below is **committed & pushed**;
`279f3ec` was the last build confirmed live on UAT (15 Jul). Whether the later commits (`21f1e16` map
expansion, `79a3a82` PBS fix, `8a5d7df` basemap) have reached UAT is **unconfirmed — check the VM
before assuming.** One screen: what the system is, what changed most recently, how to deploy, and
what's open.

**⚠️ Git remote moved:** the repo is now
`git@git.styl.solutions:presales-prototypes/atlantic-platform/smart-buddy-data.git` (the old
`rtls-demo/smart-buddy-data` path still redirects to the same project). Local `origin` was updated
28 Sep; the **VM's clone may still point at the old path**. `git remote set-url origin <new>` there too.

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
| **reload/VENDOR_LAYERS_DEPLOY.md** | ⭐ NEW (1 Oct) — deploy §3d: steps, expected numbers, rollback, open reconcile question |
| **reload/SERVICE_ROUTE_DEPLOY.md** | ⭐ NEW (1 Oct) — deploy §3e (terminal service view, `terminal_health`, `plan_service_route`) |
| **ingestion-service/pbs_hosts.csv** + **stamp_hosts.csv** | ⭐ NEW — every reviewed vendor-placement decision with its evidence |
| **ONEMAP_BASEMAP_FIX.md** | paste-in prompt to apply the Carto→OneMap basemap fix to *other* map projects + OneMap licensing summary |
| **reload/MAP_EXPANSION_DEPLOY.md** | Deploy the 158→331 map markers (+7 corrected) + stall-copy + SAM count |
| **reload/UAT_DEPLOY.md** | The prior one-pass UAT deploy (linkage fix + March wearables) |
| **DEPLOY.md** | Full deploy runbook (compose stacks, ingest, SAM, verify) |
| **README.md** | Overview, deployed architecture, data facts & caveats |
| **mcp-service/agent-prompt.md** + **agent-setup.md** | SAM agent instructions to paste into the mesh |

## 3f · 6 Oct session (committed with §3d/§3e; frontend-only, ships in the same deploy)

- **Bookstore squares + stamp-point diamonds now follow the map's Level / Errors / Speed toggle** like school dots
  (`client/src/main.js` `vendorStat`, `theme.css` `--c`). Level = host school's level (Catholic High campus point →
  first linked section, CAHP); Errors/Speed = the shop's own machine (busiest one if it has two). Bookshop-only
  places (Radin Mas, West View, Dazhong) have no school row → grey "Other". Verified locally (March): marker colours
  match a recount from the stalls bundle exactly.
- **SAM consistency pass (needs the `smartbuddy-mcp` rebuild + re-paste, same deploy):** the `run_sql` and
  `get_server_time` tool texts still said wearables were Feb-only (fixed); the wallet reconcile is now stated as
  ~92% on raw `txn` / ~88% on `tx` everywhere (was "~92%" against `tx`); `schools.type` covers all 332 (was
  "~320 of ~334"); `tx` row counts 3.84M / 3.59M; SAM told that `resolve_time_range` defaults to February;
  `mcp-service/README.md` de-staled (old `feb_*` table names, deleted `build_feb_clickhouse.py`).
- **Housekeeping:** legacy Feb-only pipeline data (`txn/` raw parts, `analysis/parquet/`, `analysis/appdata/` + the
  generated `analysis/*.json` / `pdf_report_spliced.html`), empty `smart-buddy-app/`, `__pycache__/`, `client/dist/`
  moved to the git-ignored `need to delete manually/` for manual deletion. **Consequence:** the old `analysis/`
  pipeline (and the frozen root reports) can no longer be rebuilt; the deployed system + local harness read
  `Feb-Mar_Data/`. `opencode.json` (literal API key) is now git-ignored.

## 3e · Terminal service view + route (1 Oct, later — deploy = `reload/SERVICE_ROUTE_DEPLOY.md`)

Ask: service staff (who fix the machines) want "which terminals are faulty/slow, and route me to fix them" — from
the dashboard **and** SAM. Monthly data is the example; real-time later.
- **Terminal = entity tagged to a location.** `terminalId` is a device serial (`ISP-<yyyymmdd>-<seq>-<chk>`, the date
  is unconfirmed — never before first use); location comes only from its txn rows. ~1:1 per month (2,631/2,635 Mar),
  but machines **do move** (7 changed store Feb→Mar, some mid-month) → now shown where they **last** transacted.
- **"Retrieve…" stalls were mislabelled "maintenance flows"** — they're real sales at machines later pulled (store
  relabelled at retrieval). Now in the terminal view (tag `retrieved`), still out of spend.
- **Problem tags** (staff choose what to fix): machine · site · check · slow · stopped · offline · retrieved.
  `stopped`/`offline` thresholds are **placeholders for the service team**.
- **One source:** `build_insights` writes the stalls bundle's terminal rows to **`smartbuddy.terminal_health`**; SAM
  queries it + new tool **`plan_service_route`**; dashboard Terminals window → tick → **Service route** window. Visit
  order = nearest-next from **STYL Service Center, 3015A Ubi Road 1 #06-02 S408705** (OneMap 1.328343, 103.893102),
  straight-line km. (A ClickHouse view was the first plan; no local ClickHouse to test it, and it would duplicate the
  tested Python verdict — so the builder writes a table instead.)
- **PBS/SSSTM machines** are the same STYL hardware (PBS: 36% over the fault rule) but whether STYL services them is a
  **contract question** → listed as "Not routed" until answered.
- Verified locally: 0 verdict changes, March 691 machines need attention across 248 schools; SAM tool driven over MCP
  against a fake ClickHouse endpoint; dashboard screenshots, no JS errors.

## 3d · 1 Oct session (deploy = `reload/VENDOR_LAYERS_DEPLOY.md`)

Trigger: the UAT dashboard still showed **"PBS" as a school** (110,544 March txns, 30,243 cards), plus SSSTM and an
unmapped APSNK. Everything below was verified on the raw Feb + Mar CSVs through a local DuckDB stand-in running the
**unmodified** `build_insights.run`. Fidelity: March linkage = 3,700,936 / 3,712,897 (99.7%), the same as live UAT;
MGSP matched the UAT screenshot exactly.

**Bugs fixed (root causes)**
- **`79a3a82` was only half a fix.** It changed `ingest_core.TX_FILTER` (Playback/SAM), but `build_insights.py` builds
  the dashboard bundles with its own `schoolId != 'STYL'` filters. School-level aggregates now exclude the shared
  `NON_SCHOOL` constant (`ingest_core.py`). Vendor stalls remain stalls.
- **Every stall's Daily revenue and every terminal's daily error/speed series were empty in prod**: `d::VARCHAR` on a
  `query_df` datetime64 gives `'2026-03-02 00:00:00'` ≠ day key. Now `strftime(d,'%Y-%m-%d')`. Same class of bug as
  the linkage fix (§6 guardrail).
- **Stalls bundle crashes on current libraries** (duckdb 1.5.4 + pandas 3.0.3: `list(DISTINCT <category col>)` returns
  int16 codes, so `json.dumps` fails). `requirements.txt` is unpinned, so an image rebuild would hit this. Fixed with a cast.

**Facts established (each with a source — see the evidence columns in the two CSVs)**
- `PBS` = **Pacific Bookstores**: 156 shops (Feb) / 157 (Mar), named "Pacific Bookstores - <code>"; ~98% of their March receipt lines are BOOK (112,716 of 114,551).
- `SSSTM` = **"Self Serve Stamps"** (the feed's own name): 17 points (Feb) / 13 (Mar), each named after a school, selling
  only **"Digital Smiley Stamp(s)" at $0.50**. POSB's parent letter (Stamp Savings Programme) says stamps are bought by
  tapping Smart Buddy, and stamp value + a 10% bonus for a 20-stamp card is credited to the child's account →
  **savings, not spending**. POSB FAQ: only digital stamps carry value; physical stamps are "just for fun". No public
  source lists which schools have these machines — our data is the only evidence. `stampValue` > 0 marks every stamp sale.
- **PBS placement rule (user-approved):** place only with evidence; a **primary/secondary conflict → highlight, don't
  place**; unresolved → data owner. Card check: 144/146 exact-code shops have ≥50% of their cards also paying at that
  school's canteen. **PBS directory emails are NOT the feed codes** (e.g. `rvps@` = River Valley Primary, but feed
  `RVPS` = Riverside, and 82% of that shop's cards pay at the Riverside canteen) — never map by PBS email alone.
  ⚠️ The PBS network directory was read from `pacificbookshop.testing.uno` (a staging mirror with a few test rows;
  pacificbookstores.com blocks automated fetches). Every placement also has independent evidence (MOE list, POSB's
  official PBS list, the feed's own names, card data). Worth a manual look at pacificbookstores.com/network.
- Result: **152 of 157 PBS shops placed** (145 exact + 7 reviewed: GMPS→GMSP, MSHSP→MSHS, CKCS→CHKS, CSNGS→SNGS, plus
  bookshop-only places Radin Mas / West View / Dazhong at MOE address + OneMap coords). **Not placed:** MGS, SCGS
  (one PBS shop serves primary + secondary), RPS (PBS email says Rulang, but Rulang's shop is RUPS and RPS shares 0 cards with the
  Rulang canteen), CHKL (no source), FHPS (0 of 5 cards at FHPS; March only).
- **Stamp points: all placed** (13 Mar, 17 Feb) via exact name or reviewed decision. **Catholic High** = one
  whole-school point linked to both CAHP (Pri.) and CAHS (Sec.) — MOE lists one school at 9 Bishan St 22.
  St Margarets Secondary School = old name (renamed St. Margaret's School (Secondary) on 1 Jan 2023, school site).
- **APSN Katong mapped:** 900 New Upper Changi Rd S467354 (apsn.org.sg); OneMap lists it as "KATONG SCHOOL". 332 schools.

**UI:** map filter pills (Super App POC pattern) incl. PBS Bookstores + Stamp points; Bookstores window; Smiley Stamps
section in Saving (March); copy pass to one line + ⓘ. **Removed hard-coded Feb conclusions shown for every month**
(listed in the deploy doc). The SAM texts now say SSSTM = 13–17 points (they used to say "~156+ schools"), 332 schools,
and give both reconcile figures.

**Open from §3d** → §5.

## 3c · 28 Sep session (basemap `8a5d7df` + contrast/drag-limit commit, pushed, NOT yet on UAT)

- **Basemap was showing "API KEY REQUIRED" watermarks.** Carto's CDN now requires an API key.
  Keyless callers still get HTTP 200, but every tile is a ~2 KB watermark image. This hit every
  STYL project on the same Carto tiles. No code or data regression.
- **Fix:** `client/src/main.js` map init now uses **OneMap Grey** raster tiles
  (`https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png`). They are keyless, and the
  project already relies on OneMap for geocoding. Tiles exist at **z11–19 only**, so `minZoom: 11`.
  The **OneMap logo + "©2026 contributors | Singapore Land Authority" credit is mandatory**, so the
  attribution control is back on (compact). DEPLOY.md §9 and client/README notes updated.
- **Marker contrast (follow-up commit):** the basemap is washed out with MapLibre raster paint
  (`raster-saturation: -1`, `raster-brightness-min: 0.25`, `raster-contrast: -0.2`). That also
  removes the red restricted-area hatching and coloured MRT lines that competed with the dots.
  `LV_COLOR` in `main.js` is darker/more saturated (legend follows), and `.mk` in `theme.css` gains a
  1px dark ring outside the white border. `charts.js`'s own `LV_COLOR` (charts, not map) and the
  Errors/Speed `HEALTH` colours are unchanged.
- **Drag limit:** OneMap's tile coverage **shrinks at higher zoom** (e.g. nothing north of lat 1.494
  from z12, and open-sea tiles are omitted from ~z16). So the map has
  `maxBounds: [[103.58, 1.12], [104.16, 1.494]]`, the area covered at every zoom (east edge pulled
  in to hide a hard tile cut over Johor), plus a `background` layer in OneMap's sea grey `#d1d1d1`
  so skipped sea tiles don't show white. Side effect: on large screens the opening zoom is
  clamped slightly above 11.15 so the view fits the bounds. The whole island still fits.
- **Verified by screenshot** with headless Chrome over CDP (waiting for MapLibre `idle`; Chrome's
  `--screenshot`/`--virtual-time-budget` captures before tiles finish and gives false blank strips).
  The test used a scratch page with the real 331 school coordinates + identical map/marker settings,
  because locally there's no API data (see Local view below).
- **Licensing (checked, not legal advice):** free for commercial use under the OneMap Terms of Use,
  but "no charge *currently*": SLA can introduce fees or revoke access without notice. No
  tile caching/re-hosting. **Get legal to confirm before production.** Details in `ONEMAP_BASEMAP_FIX.md`.
- **Deploy:** frontend-only. On the VM: `git pull` → rebuild/restart `smartbuddy-frontend`. No
  data, ingest, or SAM changes. Verify the map shows streets and the credit appears bottom-right.
- **Other projects:** same fix via the paste-in prompt in `ONEMAP_BASEMAP_FIX.md` (covers MapLibre,
  Leaflet, OpenLayers, the dark/voyager → Night/Default style mapping, and CSP gotchas). Not done yet.
- **Local view:** `cd client && npm run dev` → http://localhost:5188. The basemap renders, but
  **school dots won't**. The client fetches data from api-service (`VITE_SB_API_URL`), and this
  machine has no `.env` files (only `.env.example`). The real `.env` lives on the VM. Supplying
  one (never paste secrets into chat) + a reachable api-service/ClickHouse is needed for local data.

## 3a · 15 Jul session (committed in `21f1e16`)

- **Map expansion 158 → 331 markers (+7 corrected).** Rebuilt `ingestion-service/school_geo.json` from the
  authoritative `schoolId→school` mapping, **verified against the raw `Feb-Mar_Data` feed**: the basket→txn
  linkage reproduces at **99.68%**, and the `items` receipts (which carry NO `schoolId`) match transaction
  `schoolId`s to the exact second+cent — so they identify each school independently and confirm
  `school_moe_map.csv` exactly (0 disagreements). +173 new markers (OneMap: postal from `moe_schools.json`;
  11 SPED by name). `reload/schools.csv` regenerated (331 rows). Diff vs HEAD: **+173 added, 7 changed, 0
  removed.** Unmapped: 3 by design (APSN Katong — no OneMap hit; PBS + Self-Serve-Stamps — not schools). *(1 Oct: APSN Katong now mapped; PBS/SSSTM are vendor layers — §3d.)*
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

## 3b · 23 Jul session (committed in `79a3a82`; UAT rebuild status unconfirmed)

- **PBS/SSSTM spend-ranking bug, fixed at the source.** The 15 Jul map-expansion entry above (§3a)
  already established that `PBS` (Pacific Bookstores, a bookshop concessionaire operating stalls inside
  ~156+ schools) and `SSSTM` (Self-Serve-Stamps — *corrected 1 Oct: 13–17 stamp points, not the PBS pattern; §3d*) are **not schools** — but that fix only
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
  - `analysis/school_moe_map.csv` (the reference proving PBS/SSSTM aren't schools) is now committed
    (`79a3a82`), along with `reload/PBS_SCHOOLID_FIX_DEPLOY.md` (exact UAT SQL + MCP redeploy).

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

> Pending newer deploy: **`reload/VENDOR_LAYERS_DEPLOY.md`** (§3d, after commit).

Summary: `git pull` → rebuild `smartbuddy-frontend` + `ch-insights` + `smartbuddy-ingest` →
**ingest March `health`+`heart_rate` as `2026-03`** (data sent separately; the linkage fix needs no
data) → rebuild bundles: `SB_MONTH=2026-03 ch-insights` (linkage) + `build_insights_wearable.py`
for **both** `2026-03` **and** `2026-02` (Feb rebuild is required — the `cny→special` schema change).
No DB wipe, no `ch-init`, no txn/items/saving reload. **Gate:** the March insights log must print
`linkage: …(99.x%)…`; if `0/… skipping`, stop.

## 5 · Open items / decisions

- **Deploy §3d** (`reload/VENDOR_LAYERS_DEPLOY.md`). Committed & pushed 6 Oct, not on UAT.
- **Deploy §3e + §3f** (`reload/SERVICE_ROUTE_DEPLOY.md`) — same images, same pass as §3d.
- **Service team:** set `STOPPED_DAYS` / `OFFLINE_PCT` (`build_insights.py`); say whether `slow` needs a minimum volume.
- **Account owner:** does STYL service PBS bookshop / SSSTM stamp machines? If yes → load the reviewed host placements so
  they can be routed. Ask the hardware team what the `ISP-<date>` serial date and the last letter mean.
- **Ask the data owner / PBS:** what `RPS` and `CHKL` are; whether `MGS` / `SCGS` shops should be one shared-campus
  entity (like the Catholic High stamp point); confirm FHPS; confirm MSHS = primary section and MSTHS = secondary;
  a deployment list of Self Serve Stamps machines, if STYL/POSB has one.
- **Decide: wallet ↔ savings cross-check.** It reconciles on `tx` (vendors excluded) = **88.4%** (March), but the ledger
  counts bookshop/stamp wallet spend too; on `txn` minus STYL/retrieve/>$200 it is **92.4%**. Code not changed.
- **Next upgrade (deferred by user):** other bookshop operators (~147 stalls: Shing Lee, Casco, Continental, BL Marketing, …)
  as part of the Bookstores view — they're already stalls under their schools.
- Consider pinning `duckdb`/`pandas` in `ingestion-service/requirements.txt` (§3d crash).
- ~~Deploy to UAT~~ (linkage + March wearables) — **DONE 15 Jul** (live & verified; see §3).
- **Deploy the OneMap basemap + contrast/drag-limit** (§3c): frontend-only rebuild on the VM. Not yet on UAT.
  After deploying, check a real screen: dots visible on grey map, no white when dragging to any edge.
- **Apply the OneMap fix to the other STYL map projects** (§3c) using `ONEMAP_BASEMAP_FIX.md`.
- **Legal check on OneMap terms** (free "currently", revocable, attribution mandatory) before production.
- **Update the VM's git remote** to the `presales-prototypes/atlantic-platform/...` path (see header).
- **Confirm on UAT** whether the map expansion (`21f1e16`, `reload/MAP_EXPANSION_DEPLOY.md`) and the PBS fix
  (`79a3a82`, `reload/PBS_SCHOOLID_FIX_DEPLOY.md`) were deployed. Both are committed; UAT status unknown.
- **School mapping — RESOLVED 15 Jul; APSN Katong added 1 Oct** (OneMap by postal 467354). All 332 school IDs mapped.
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
- **A terminal's location = where it LAST transacted that month** (`arg_max` by date+time), never `any_value` —
  machines get moved/swapped mid-month.
- **"Retrieve…" stalls are real sales**, not maintenance flows: out of spend, in the terminal/service view.
- **SAM never orders service visits itself** — it calls `plan_service_route`; SAM and the dashboard read the same
  `terminal_health` rows (written by `build_insights`), so don't re-implement the verdict in SQL elsewhere.
- **Don't force-push `main`.**

## 7 · Key data facts (README has the full list)

- Money is **cents SGD** everywhere (÷100). `items.itemName` is a **generic till button** — use
  `itemType`/`healthyChoice`, never quote it as a dish.
- `items` carry `schoolName`+`storeName` only (no `schoolId`/`cardId`); joins to txns are **school-aware**
  via the `(second, amount)` majority-vote bridge (NOT `storeName` — the feeds' stall names differ).
- **Wearables now exist for Feb AND March** (health, heart_rate). `recorded_time` is a UNIX epoch (SGT).
  March also has the **wallet rail** (`paymentType='Smart Buddy/ATM'`) reconciling to `saving_spending`.
- `studentId`/`studentName` are absent (dropped at ingest).
- `PBS` / `SSSTM` are **vendors**, never schools (§3d). Stamp purchases (`stampValue` > 0) are savings. Vendor shops are
  placed only via `pbs_hosts.csv` / `stamp_hosts.csv` evidence — **never infer a placement** (user rule, 1 Oct).
- **Terminals:** `terminalId` = device serial `ISP-<yyyymmdd>-<seq>-<chk>` (no location in it); `readerId` ≈ 1:1 with
  terminal. All 2,675 Feb+Mar terminals, incl. the 178 PBS/SSSTM ones, are STYL `ISP-` hardware. Service routes start
  at the **STYL Service Center, 3015A Ubi Road 1 #06-02, S408705** (OneMap 1.328343, 103.893102).
