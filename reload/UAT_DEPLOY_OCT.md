# UAT deploy — October 2026 (one pass: bring UAT up to `main`)

For whoever runs the UAT VM. Follow the steps in order; each has an expected result, and a **STOP** line where a wrong
result means "don't continue, report back". About 30–45 min, most of it image builds and the two bundle rebuilds.

**Where UAT is now:** `f87fd46` (OneMap basemap, 28 Sep). This pass brings it to the latest `main`, which is what
was tested locally. **No raw data files are needed:** nothing is re-ingested. Only images, the `schools` table, the
insight bundles, one new table (`terminal_health`) and the SAM instructions change.

## What ships

| Change | Detail | Needs |
|---|---|---|
| Vendor layers (`e738195`) | PBS Bookstores + Stamp points as their own map layers (no longer "schools"), APSN Katong mapped (332 schools), stall daily-revenue + terminal daily series fixed, stalls-bundle crash on current pandas/duckdb fixed | ingest image, `schools` reload, both months' bundles, frontend |
| Terminal service route (`e738195`) | Terminals view: problem tags + tick → **Service route** from the STYL Service Center; new table `smartbuddy.terminal_health`; SAM tool `plan_service_route` | same + `smartbuddy-mcp` |
| SAM texts (`a48a84d`) | Agent texts consistent with the Feb + March data | `smartbuddy-mcp` + re-paste instructions |
| Dashboard rework (latest commit) | Docked drawer instead of floating windows, compare up to 4 as graphs, Map key, getting-started checklist, opt-in tour, keyboard fixes, 2D-only map, grey "No data" dots, shareable compare links. **Frontend only.** | frontend |

Background and full expected numbers: `reload/VENDOR_LAYERS_DEPLOY.md`, `reload/SERVICE_ROUTE_DEPLOY.md`,
HANDOVER.md §3d–§3m.

## Steps (UAT VM, repo root)

```bash
# 0) git remote: the repo moved. If this prints rtls-demo/…, point it at the new path.
git remote -v
git remote set-url origin git@git.styl.solutions:presales-prototypes/atlantic-platform/smart-buddy-data.git

# 1) note the running commit (for rollback). Expected: f87fd46…
git rev-parse --short HEAD
```

**2) Pre-check (an older fix, `79a3a82`).** In ClickHouse:

```sql
SELECT DISTINCT school_id FROM smartbuddy.pb_schools WHERE school_id IN ('PBS','SSSTM');
```

No rows → continue. Rows → first run step 3 **Option A** of `reload/PBS_SCHOOLID_FIX_DEPLOY.md` (SQL only, about a minute).

```bash
# 3) code. Check that `git log -1` shows the commit you were told to deploy.
git pull
git log -1 --oneline

# 4) rebuild the 4 images, restart the 3 long-running ones (ch-insights is run-once, step 6)
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  build smartbuddy-frontend ch-insights smartbuddy-ingest smartbuddy-mcp
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  up -d smartbuddy-frontend smartbuddy-ingest smartbuddy-mcp

# 5) reload the schools dimension (adds APSN Katong)
bash scripts/vm-load.sh reload/schools.csv schools 2026-02 replace 1
#    check: SELECT count() FROM smartbuddy.schools  → 332

# 6) rebuild both months' bundles (also creates + fills smartbuddy.terminal_health)
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
SB_MONTH=2026-02 $CC     # log: "-> terminal_health[2026-02]  2621 machines"
SB_MONTH=2026-03 $CC     # log: "linkage: 3,700,936/3,712,897 baskets matched (99.7%)" and "-> terminal_health[2026-03]  2633 machines"
```

**STOP** if the March log says `0/… skipping` (linkage broken), or either log says `(terminal_health skipped: …)`.
In both cases the dashboard may look fine, but SAM or the purchase views will be wrong.

**7) SAM instructions** (only after steps 4 + 6, otherwise SAM calls a tool or table that doesn't exist yet): copy the
**whole** ```text block from `mcp-service/agent-prompt.md` § "Copy For AI Agent" into the SAM agent's Instructions
field (`mcp-service/agent-setup.md` §4).

**Not needed:** no raw data reload, no `ch-init`, no DB wipe, no wearable bundle rebuild (`build_insights_wearable.py`).

## Verify

Expected values come from the local run on the same raw files. Small differences (< 1%) in linkage are normal.

**Data (ClickHouse)**
1. `SELECT month, count(), countIf(notEmpty(problems)) FROM smartbuddy.terminal_health GROUP BY month ORDER BY month`
   → `2026-02 2621 733`, `2026-03 2633 691`.

**Dashboard: vendors + service route** (March unless stated)
2. Map key (bottom-left): Primary 173 · Secondary 139 · Junior College 5 · Other 15 · PBS Bookstores 152 ·
   Stamp points 13. February: Other 14 · Stamp points 17. No PBS / SSSTM dot among the schools.
3. Map key → PBS Bookstores "list": 157 shops, 152 placed, "Needs a decision (5)": MGS, SCGS, RPS, CHKL, FHPS.
4. Search "Pacific Bookstores - MGS" → open the stall → Daily revenue shows bars (was empty).
5. Methodist Girls' School (Primary) (MGSP): $3.54 spend/card-day · $1.93 ticket · 46,768 txns · 8.2% errors.
6. Terminals → 2,633 machines, "Needs attention" 691 → filter Machine fault → tick the TKGS, RSYS, SCGSP and FHPS
   machines → Plan route → stops **TKGS → RSYS → SCGSP → FHPS**, about 28 km.
7. Saving → Smiley Stamps: Pacific Bookstores 67 points / 623 txns / $1,160.50 · Self Serve Stamps 13 / 348 / $598.00.

**Dashboard: the rework** (use a private window, so it behaves like a first visit)
8. First visit: a role picker with "Skip — show all views" and "Take the 1-minute tour". The tour never starts by itself.
9. Click a school dot → it opens in the right-hand drawer, SAM folds to its rail. From the Overview, click a top spender
   → the map flies there, breadcrumb "Network Overview › <school>", ‹ Back (or Esc) returns to the same tab.
10. Shift-click two school dots → a tray with A / B appears top-left, the map zooms to both → "Compare 2 ▸" opens graphs
    per topic. Clicking the Errors tab recolours the map by errors, and the reverse. Copy the URL into a new tab → the
    same comparison opens. Map key → tick PBS Bookstores → Shift-click two squares → letters on the squares, map zooms.
11. Map key → Colour by Speed (March): one grey dot (RACY, no speed data) and a "No data" row in the key.
12. Switch month → the drawer and the comparison reset; February shows the chip "Not this month: Purchases, Savings".
13. ▾ menu (top right) → Upload data / Tours… / Keyboard & mouse. Right-drag does not rotate the map.
14. ▾ → Tours…: Management lists 12 tours (F&B 11, Engineering 9; February drops Purchases + Saving). Run "Terminals &
    service route": 6 steps, it ends on a planned route. Each view header has "▶ Tour"; the last step offers "Next tour".

**SAM**
15. "How many schools have map coordinates?" → 332.
16. "Which terminals have machine faults in March and where are they?" → answers from `terminal_health`; then "plan a
    route to TKGS, RSYS, SCGSP and FHPS" → same order as check 6.
17. "Which school spends the most in February?" → Methodist Girls' School (Primary), about $101,474. Not PBS.

## Rollback

```bash
git checkout <commit from step 1>
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  build smartbuddy-frontend ch-insights smartbuddy-ingest smartbuddy-mcp
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  up -d smartbuddy-frontend smartbuddy-ingest smartbuddy-mcp
bash scripts/vm-load.sh reload/schools.csv schools 2026-02 replace 1      # the old 331-row file
SB_MONTH=2026-02 $CC; SB_MONTH=2026-03 $CC                                # bundles: newest row wins
```

Then `DROP TABLE IF EXISTS smartbuddy.terminal_health` (admin/rw user) and re-paste the old instructions block.
**Caution:** an old-commit `ch-insights` image rebuilt today pulls current pandas/duckdb and may hit the stalls-bundle
crash that `e738195` fixed (`requirements.txt` is unpinned). If only the dashboard UI is the problem, roll back just the
frontend: `git checkout <commit from step 1> -- client`, rebuild + restart `smartbuddy-frontend` only.

## Known and open (don't block the deploy)

- `stopped` / `offline` thresholds are placeholders until the service team sets them (`build_insights.py`).
- PBS / SSSTM machines are listed as "Not routed" until it's confirmed whether STYL services them.
- The wallet ↔ savings cross-check reads 88.4% on `tx` (92.4% incl. vendor stalls): a known decision, not a bug.
- The workspace ▾ menu needs a browser with `popover` (Chrome/Edge 114+, Safari 17+, Firefox 125+).
- OneMap basemap: free "currently", attribution mandatory. Legal to confirm before production.
- Compare links carry no month: they open in the viewer's current month, where a stall/terminal may not exist (it's
  dropped).
