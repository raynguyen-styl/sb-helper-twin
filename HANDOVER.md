# HANDOVER — SMART Buddy Dashboard

Orientation for a teammate (or a fresh session) picking this up. Last updated **7 Oct 2026** (3rd session: polish + deploy runbook).

> **State:** everything up to §3n is **committed and pushed to `origin/main`** (7 Oct, 3rd session; `git log -1`):
> the whole dashboard rework, frontend only (no API, ingest or SAM change): interactivity + accessibility (§3g) →
> docked drawer instead of floating windows (§3h) → compare up to 4 schools / stalls / terminals as graphs linked to
> the map (§3i, §3k) → decluttered map + top bar + onboarding checklist (§3j) → keyboard fixes, Keyboard & mouse list,
> 2D-only map (§3l) → polish: grey "No data" dots, no repeated drawer title, shareable compare links, long names
> wrap (§3m) → tours in 12 chapters per role, vendor pins zoom/badge, review fixes incl. escaping feed text (§3n).
> **UAT runs `f87fd46`** (pinned 7 Oct from a UAT screenshot; GitLab has no UAT tag, so this is evidence, not a record).
> Waiting to deploy (one pass, `reload/UAT_DEPLOY_OCT.md`): `e738195` vendor layers + service route + vendor marker
> colours (§3d/§3e/§3f) · `a48a84d` SAM fixes · the §3g–§3n commit. `79a3a82`'s aggregate rebuild is unconfirmed —
> step 2 of that runbook checks it. No raw CSV upload is needed; only `reload/schools.csv` (+APSNK) is reloaded.

**▶ Next session — start here**
0. **Committed + pushed (7 Oct).** Next commits: ask the user first; run the 8 checks (see "Run the dashboard
   locally") before committing client changes. Keep the local-only files (below) out.
1. **The user tries it in a real browser** — a private window shows the first-visit flow (role picker → Skip / tour →
   checklist). The workspace menu needs a browser with `popover` (Chrome/Edge 114+, Safari 17+, Firefox 125+). Not UI
   problems, just data: most school food mix is "Unclassified"; schools have no errors-over-time series (only terminals do).
2. **Deploy = the user pushes to GitLab, a colleague runs `reload/UAT_DEPLOY_OCT.md` on the VM** (Claude can't reach
   it). That one runbook is the whole pass, in order: git remote fix → PBS pre-check → pull → 4 images → `schools`
   reload → both months' bundles (gates) → SAM re-paste → 17 checks (data, vendors, route, the §3g–§3n rework, SAM).
   It replaces walking VENDOR_LAYERS + SERVICE_ROUTE + the per-section "On UAT, check" lists separately.
3. **SAM** is step 7 of that runbook: paste only after the `smartbuddy-mcp` rebuild + both bundle runs, or SAM calls a
   tool/table that doesn't exist yet. Then `mcp-service/agent-setup.md` § Verify.
4. Chase the answers that unblock the next step (§5): service-team thresholds, who services PBS/SSSTM machines,
   meaning of the `ISP-<date>` serial, data-owner questions on RPS/CHKL/MGS/SCGS/FHPS.
5. **User to-dos from 6 Oct:** delete `need to delete manually/` (~1.6 GB, git-ignored, holds raw data with real IDs);
   decide whether `LINKAGE_FIX_UAT.md` + `reload/MARCH_WEARABLE.md` (done runbooks, still tracked) go; delete the
   fully-merged `feat/demo-adaptive-dashboard` branch on GitLab if wanted.

**Dashboard controls** (source of truth: `client/src/shortcuts.js`, shown in-app via ▾ menu → Keyboard & mouse, or `?`):
click a dot = open · **Shift-click = add to Compare** · drag / scroll = pan / zoom (no rotate or tilt — 2D only) ·
**Esc = Back** in the drawer · search ↑ ↓ Enter Esc · compare topics ← → Home End · tours: ▾ menu → Tours…, or "▶ Tour" in a view's header.

**Run the dashboard locally** (no Docker/WSL/ClickHouse on this laptop). The harness lives in the 1 Oct session
scratchpad, **not the repo**: `%LOCALAPPDATA%\Temp\claude\c--Users-STYLSG-Downloads-Smart-Buddy-Dashboard\59c05f86-5ca5-4db1-965b-ce8a795969fb\scratchpad\local\`
```
python local_api.py sb_local.duckdb 8787                                     # in the harness folder (own terminal)
cd client && VITE_SB_API_URL=http://127.0.0.1:8787 npx vite --port 5189 --strictPort   # → http://localhost:5189
```
Run both in their own terminals: as Claude Code background tasks they are stopped after at most 2 hours.
`sb_local.duckdb` (2 GB) was built 1 Oct from the raw `Feb-Mar_Data/` CSVs by the real `build_insights.run`; after an
ingest-code change, rebuild it with `seed_and_build.py` (`SKIP_SEED=1` reuses the seeded tables). Also there:
`fake_ch.py` + `route_test.mjs` (drive the real mcp-service), `shots_route.mjs` (screenshots over CDP).
**The 6 headless-Chrome checks** (each prints one line per behaviour + "JS errors: none"; screenshots go to `<outDir>`):

| Script | Covers | Run |
|---|---|---|
| `verify_ux.mjs` | §3g interactions + drawer (§3h): SAM rail, map padding, Back keeps tab/scroll, fly-to, sheet, hub | `node verify_ux.mjs <outDir> http://localhost:5189/` |
| `verify_compare.mjs` | pins, zoom-to-fit, rings, topics ↔ map colour, charts, numbers, stalls, terminals | same args |
| `verify_declutter.mjs` | first visit, Skip, ▾ menu, Map key filter/Reset/collapse, checklist, Shift-click, Feb chip | same args |
| `verify_tour.mjs` | tour: no auto-start, each step's target + card, Back/arrows/Esc/Done, focus, Engineering, narrow | same args |
| `verify_2d.mjs` | no rotate/tilt by right-drag, Ctrl-drag, Shift+arrows; no compass | `node verify_2d.mjs http://localhost:5189/` |
| `verify_keys.mjs` | search combobox, drawer Esc (not over menu/upload/tour/typing), compare tabs, `?` list | same as 2d (`OUT=<dir>` for its screenshot) |
| `verify_polish.mjs` | §3m/§3n: grey No-data dot + key row, one view = no crumb, long name wraps, compare link (slots, fit, crafted/malformed links), vendor pins (PBS/stamps/their machines), compare reopen/unpin, fast month switch, feed text injected as markup never runs | same as keys |
| `verify_chapters.mjs` | §3n: per role the Tours list, then every step of every chapter (target found, card on screen), Next tour, ▶ Tour | same as keys |

A hash-only URL change doesn't reload the page — the scripts add `?r=…`. `verify_ux.pre-dock.mjs` = the old
floating-window version. The stand-in has no `schools` table and no wearable playback (client falls back to demo).
If the temp folder is gone, rebuild from `reload/VENDOR_LAYERS_DEPLOY.md` § Local verification. Client changes need no
rebuild (Vite hot-reloads).

**Local-only files (deliberately NOT in git):** `.agents/`, `.claude/` (speckit skills — note `.agents/rules` points at
`.specify/memory/constitution.md`, which doesn't exist), `opencode.json` (**literal API key**, git-ignored) +
`.opencode.json` (reads `litellmkey.txt`, git-ignored), `Coding_LiteLLM_STYL_Guide_v1.2.docx`, `FINDINGS_COMPENDIUM.md`,
`Generalinformationofschools.csv` (MOE directory, cited as evidence), `analysis/taxonomy_v3_draft.py`.
**GitLab CLI:** `glab` is installed but not logged in to `git.styl.solutions` (`glab auth login --hostname
git.styl.solutions`, user does this) — until then only plain git (fetch/push over VPN) works.

One screen: what the system is, what changed most recently, how to deploy, and what's open.

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
top-bar month picker (a "Not this month" chip names any dataset a month lacks). Full architecture + runbook: **DEPLOY.md**.

**Data by month:** transactions/speed/stalls **and wearables (health, heart_rate)** exist for **both**
Feb & March; item-level purchases (`items`) + `saving_spending` are **March only**.

## 2 · Reading order

| Doc | For |
|---|---|
| **HANDOVER.md** (this) | Current state, recent work, deploy pointer, open items |
| **reload/UAT_DEPLOY_OCT.md** | ⭐ NEW (7 Oct) — the one-pass UAT deploy for a colleague: everything since `f87fd46`, gates, 17 checks, rollback |
| **DASHBOARD_OVERHAUL_PLAN.md** | ⭐ NEW (7 Oct) — why + design of the docked drawer (built, §3h), the user's answers, and what followed (§3i–§3l) |
| **MAP_DATA_FLOW.png** | NEW (7 Oct) — one-page flowchart: CSV → upload → ClickHouse → `build_insights` → api-service → map |
| **reload/VENDOR_LAYERS_DEPLOY.md** | ⭐ NEW (1 Oct) — deploy §3d: steps, expected numbers, rollback, open reconcile question |
| **reload/SERVICE_ROUTE_DEPLOY.md** | ⭐ NEW (1 Oct) — deploy §3e (terminal service view, `terminal_health`, `plan_service_route`) |
| **ingestion-service/pbs_hosts.csv** + **stamp_hosts.csv** | ⭐ NEW — every reviewed vendor-placement decision with its evidence |
| **ONEMAP_BASEMAP_FIX.md** | paste-in prompt to apply the Carto→OneMap basemap fix to *other* map projects + OneMap licensing summary |
| **reload/MAP_EXPANSION_DEPLOY.md** | Deploy the 158→331 map markers (+7 corrected) + stall-copy + SAM count |
| **reload/UAT_DEPLOY.md** | The prior one-pass UAT deploy (linkage fix + March wearables) |
| **DEPLOY.md** | Full deploy runbook (compose stacks, ingest, SAM, verify) |
| **README.md** | Overview, deployed architecture, data facts & caveats |
| **mcp-service/agent-prompt.md** + **agent-setup.md** | SAM agent instructions to paste into the mesh |

## 3n · 7 Oct, 3rd session — tours per chapter, vendor pins, pre-commit review fixes (committed 7 Oct)

- **Tours in chapters** (user: "more detailed, through all the functions"; chose chapters + only the role's views). Research
  still says long tours get dropped, so instead of one long tour: 12 chapters of 3–6 steps on real data (`tour.js`
  `CHAPTERS`): Basics (the old 6) · Map & Map key · School details · Compare · Overview · Terminals & service route ·
  Purchases · Saving · Wearables · Playback · SAM assistant · Menu, upload & keys. ▾ menu → **Tours…** lists the
  chapters this viewer can take (`main.js tourKeys`: shared + the role's views this month has; ✓ = done, `sb-tours`);
  each view header has **"▶ Tour"** (`windowing.js`, `chapterFor`); the last step offers **"Next tour: …"** (next not done).
  A view chapter reopens its view before every step, so wandering off mid-chapter doesn't break it. The tours act for
  real (open views, click tabs, tick 3 machines + plan a route, pin 2 schools) — the pins/ticks stay afterwards.
  Picker + checklist still start Basics. Never auto-starts.
- **Vendor pins** (user: zoom worked for schools, not PBS / stamp points): a pin now carries its own place
  (`compare.js place`: a PBS / stamp shop — or its machine — at its own square/diamond, else its school), so the map
  zooms to it and the letter badge sits on the square/diamond (`main.js paintPins`, `[data-shop]`, `theme.css`).
- **Review fixes** (subagent review of the whole uncommitted diff, each verified):
  - **Feed text is escaped everywhere it goes into HTML** (stored-XSS risk via an uploaded CSV): one shared `esc`
    exported by `windowing.js` (replaces 3 copies); `openWindow` escapes title + sub; names / store names / categories /
    labels / file names in overview, items, feb, school, stall, eng, playback, upload, bookstores list, search.
    Checked by injecting `<img onerror>` names: shown as text, never run. **Not done:** raw IDs in `data-*`
    attributes (school / stall / terminal codes) — the root fix is validating ID format at ingest.
  - Re-opening the comparison from the tray no longer desyncs its topic (a tab stopped responding).
  - Unpinning no longer closes views opened on top of the comparison (`closeView` closes that view only).
  - Fast month switching: `loadMonth` fetches all bundles in parallel and drops a stale result (`loadSeq`).
  - Esc = Back also from a ticked checkbox; when Esc closes the last view, focus goes to the map.
  - `#pins=` ignores a repeated id; `[data-win=…]` selectors use `CSS.escape`.
- **Also:** view headers wrap (a long school name gets its own row instead of 4 squeezed lines); a tour no longer adds
  a 1px page scrollbar (`.sr-only` pinned to the corner).
- **Verified:** new `verify_chapters.mjs` + extended `verify_polish.mjs` + the other 6 scripts, 0 JS errors.

## 3m · 7 Oct, 3rd session — polish (committed 7 Oct)

The four open polish items from §3h/§3i/§5, all chosen by the user.
- **Grey "No data"** (`main.js` `SEV`): a school or vendor shop with no error/speed figure is grey (`NODATA`) in
  Errors/Speed mode instead of falling through to "good"; the Map key adds a "No data" row only when such a dot exists.
  Today: one dot, RACY in March (no speed figure).
- **No repeated title** (`windowing.js`): with one view open the drawer bar shows only ✕; Back + breadcrumbs appear
  from two views.
- **Shareable compare** (`compare.js` `pinsParam`/`restorePins`, `main.js` `setHash`/`hashParam`): pins live in the hash as
  `#pins=school:MGSP,,TKGS` (an empty slot keeps the letters). Opening the link restores the pins and, with ≥2,
  opens the comparison and zooms to them (after the drawer's padding ease, which otherwise cancels the fit). Only ids
  found in the loaded month are pinned; `__proto__`-style ids are ignored (own-property lookup), and a malformed `%` in
  any hash value no longer stops the page (it did for `#layers`). The link carries no month.
- **Long names wrap** (`theme.css .tw-head .t`): e.g. "Paya Lebar Methodist Girls' School (Secondary)" on two lines.
- **Verified:** new `verify_polish.mjs` + all 6 earlier scripts, 0 JS errors. (verify_ux's "Back keeps scroll (net tab)
  0 → 0" is the stand-in's Network tab fitting the drawer, the same with these edits reverted; the sheet case scrolls 300 → 300.)

## 3l · 7 Oct, 2nd session — opt-in guided tour, keyboard, 2D-only map (committed 7 Oct)

User asked for a tutorial mode; chose spotlight + Next, offered never forced, all areas. Web research (subagent: NN/g,
Atlassian Spotlight/Onboarding, Material, MDN, Shepherd docs; vendor stats from Chameleon/Pendo flagged as weaker):
user-started tours of ≤ ~6 steps finish far more often; headline ≤27 / body ≤75 chars; "n of 6"; Back + Skip each step;
target stays clickable; focus into the card, back at the end; Esc exits; reduced motion respected.
- **`client/src/tour.js`** (no library): dims everything but the target (box-shadow cutout, pointer-events none → the
  page stays usable), dark card (never mistaken for real UI) placed right → left → below → above the target, centred if
  missing, docked at the bottom under 720px; follows moving targets (rAF); polite live region announces each step.
- **6 steps on real data**, tailored to the role (`main.js tour()`): 1 fly to a school (Engineering: most errors; others:
  highest spend/card·day) → 2 Map key (Engineering colours by Errors) → 3 opens that school in the drawer (Back /
  breadcrumbs) → 4 pins it (tray, Compare ▸, Shift-click) → 5 top bar (views, month, search) → 6 SAM + "replay from ▾".
- **Keyboard & mouse list** (`client/src/shortcuts.js`): ▾ menu → "Keyboard & mouse", or `?` anywhere except while typing
  or during the tour. Native modal `<dialog>` (focus stays inside, Esc closes, focus returns). Keep it in step with the
  real handlers when controls change. Checked in `verify_keys.mjs`.
- **Keyboard gaps fixed:** search is a combobox (↑ ↓ move, Enter opens, Esc closes); **Esc in the drawer = Back** (closes at the last view; ignored while typing or when the menu / Upload / tour / role picker is open — `windowing.js`, capture phase); comparison topic tabs follow the tabs pattern (← → Home End, roving tabindex). Checked with `verify_keys.mjs`.
- **2D-only map (user, same session):** rotate/tilt removed everywhere — right/Ctrl-drag, touch twist/tilt, Shift+arrows (`dragRotate:false`, `touchPitch:false`, `maxPitch:0`, `disableRotation()`), and no compass button. Checked with `verify_2d.mjs`.
- **Entry points:** first-visit role picker ("Take the 1-minute tour" = all views + tour), checklist ("▶ Take the 1-minute
  tour"), ▾ menu ("Take the tour"). Never auto-starts. Checklist + drawer tip hide while touring; `sb-tour` = done/skipped.
- **Verified:** new `verify_tour.mjs` (no auto-start, each step's spotlight target + card placement + focus, Back,
  ArrowRight, Done/Esc/Skip cleanup, focus return, Engineering colouring, narrow dock) + `verify_declutter`, 0 JS errors.
- **On UAT, check:** fresh browser → picker → "Take the 1-minute tour" → 6 steps, Esc exits; ▾ → Take the tour replays.

## 3k · 7 Oct, 2nd session — comparison = graphs per topic, linked to the map (committed 7 Oct)

User: the comparison showed everything even with the map on Errors, wanted graphs, and found "Only differences" /
"vs level average" unclear → **both removed, no average anywhere** (user's choice); graphs first, numbers on demand;
map "Colour by" ↔ comparison topic linked **both ways**.
- `compare.js` rows are grouped by **topic** (school: Spend · Errors · Speed · Network · Food & menu; stall: Spend · Errors ·
  Food & menu; terminal: Errors · Speed · Network · Spend). One topic shows at a time (tabs).
- **Chart per data job** (dataviz skill): one horizontal bar chart per measure (item colour + letter, value at the bar end,
  separate charts so no shared/dual axis); lines for time series (school weekly revenue + weekly speed; stall daily +
  by-hour revenue; terminal daily error + daily speed); 100% stacked bars for shares (school transactions by stall
  category in the Overview's category colours; stall price bands in a validated one-hue ramp); words (verdict, problems,
  category, network type) in a small facts table. "Show numbers" (`<details>`) = the table view.
- **Link:** `main.js setColorMode` → `followMap(mode)`; a topic tab → `compare-topic` event → `setColorMode`. Errors/Speed
  topics colour the map the same; Spend/Network/Food → Level. Opening a terminal comparison colours the map by Errors.
- **Data limit (stated in the view):** schools have no errors-over-time series (only per terminal) — not derived.
- Palettes checked with the dataviz validator: item colours pass (warnings covered by letters + table); price-band ramp
  passes; the Overview category palette's grey "Unclassified" is a deliberate "unknown" grey.
- Verified: `verify_compare.mjs` (topics, both-way link, stacks, numbers, stalls, terminals) + `verify_ux` + `verify_declutter`, 0 JS errors.

## 3j · 7 Oct, 2nd session — declutter + onboarding (committed 7 Oct)

User: "still clunky", wanted zoom-to-fit for compared schools, the blue ring to clear, and research on how others
declutter/onboard. Research (subagent: NN/g, Baymard, Esri, Carbon, Shopify, OS) → user picked all 4 packages + slim tray.
- **Zoom to fit** (`main.js fitPinned`): every pin/unpin fits the map to the pinned items' schools, clear of the tray,
  the drawer and the legend column (MapLibre adds its own padding = the drawer, so only margins are passed).
- **Blue rings fixed:** `.mk.open` was added on open and never removed → now `syncRings()` gives it only to the school
  on top of the drawer; hover `.hl` stuck when a card was removed under the pointer → cleared on every dock/pin change.
- **A · Map:** filter pills + legend → one collapsible **Map key** (`renderLegend`): colour-by switch, then each layer as
  a show/hide row with its count (Esri interactive legend); "filtered" badge + "Reset view" only when not default;
  footnotes → ⓘ; "N not on the map" only when N > 0; PBS list = a link on its row. Coverage strip → one
  "Not this month: …" chip only when a dataset is missing. Compare cards → a **slim tray** (letter chips; the card
  peeks on hover/focus, CSS only).
- **B · Top bar:** Upload + Switch workspace + Sign out → one workspace menu (native `popover`: Esc/click-away close;
  Chrome/Edge 114+, Safari 17+, Firefox 125+). The 6 views stay visible text buttons.
- **C · Onboarding:** role picker has "Skip — show all views" (✕ on first visit = Skip; later ✕ keeps the role);
  `client/src/onboard.js` = 3-step checklist (Open a school · Compare two · Ask SAM) that ticks itself
  (`tick()` from `main.js`; SAM sends `smartbuddy:sam-ask`), dismissible, gone for good when done; one-time
  "‹ Back…" tip in the drawer bar. All per-viewer `localStorage` (`sb-hub-seen`, `sb-onboard`, `sb-tip-back`, `sb-legend`).
- **D:** Shift/Ctrl-click a school (or vendor) dot pins it — the dot stops Shift+mousedown reaching MapLibre's box-zoom,
  which otherwise swallows the click; Shift+Enter works from the keyboard. School view: 4 headline numbers + "More
  numbers". A school/stall/terminal opened over one of its own kind **replaces** it (short breadcrumbs).
- **Verified locally:** new `verify_declutter.mjs` (first visit, Skip, menu + Esc, legend filter/Reset/collapse, checklist
  ticks, Shift-click ×2, tray peek, Back tip, Feb chip) + `verify_ux.mjs` + `verify_compare.mjs`, all pass, 0 JS errors.
- **On UAT, check:** fresh browser → role picker has Skip → checklist bottom-left · Map key rows hide/show dots, Reset ·
  role ▾ menu has Upload · Shift-click 2 dots → tray + map zooms to both · Feb shows "Not this month: Purchases, Savings".

## 3i · 7 Oct, 2nd session — compare cards (committed 7 Oct)

> **Partly superseded the same day:** the cards became a slim tray (§3j) and the table + "Only differences" /
> "vs average" became graphs per topic with no baseline (§3k). Kept below for the history of decisions.

User: docking lost side-by-side comparison; wanted the old pop-ups back but better (web research: Baymard comparison
tools — hide identical rows, group attributes, sticky column heads; NN/g — few items; one colour per entity).
User choices: compact cards · one type per set · snapped row (no drag) · max 4 · schools + stalls + terminals.
- **`client/src/compare.js`** (one module): "＋ Compare" in the school / stall / terminal view header (`pinButton`) pins
  the item as a card in `#compare-row` under the map's filter pills (`.maptop` wrapper in `index.html`). Cards: 3 key
  numbers (best/worst coloured) + a sparkline; click opens the item; ✕ removes. Fixed slots → a pin keeps its letter.
- **One colour + letter per item** (Okabe-Ito A–D) on the card, the table column, the chart lines and a badge + ring on
  its school's map dot (`compare` event → `main.js`). Card hover lights the dot (same delegated listener as the drawer).
- **"Compare in detail"** (≥2 pins) → drawer view: rows grouped Spend / Speed & errors / Network / Food & menu /
  Profile / Trends, each a filter chip (Profile off by default); **Only differences** (on by default; equal, or numbers
  within 5%); **vs baseline** = level average (schools), same-school stalls (stalls), same-school peers (terminals);
  best/worst coloured; trend charts overlay the items in their colours.
- Pinning another type asks first (native `confirm`) and starts a new set; a 5th pin shows "Compare holds 4".
  Month switch clears the pins (they hold the old month's rows). All from the bundles already loaded — no API change.
- **Verified locally:** new harness script `verify_compare.mjs` (pins, badges, hover, filters, baseline, remove,
  type switch, 4-max, terminal set, month reset) + `verify_ux.mjs` still all pass, 0 JS errors.
- **Not done (say if wanted):** pins aren't in the URL (not shareable); no pin buttons on list rows (pin from the item's
  view); with the wide drawer open the 4th card wraps to a second row.
- **On UAT, check:** open 2–3 schools → "＋ Compare" each → cards appear under the pills, letters on their dots →
  "Compare in detail" → toggle chips / Only differences / vs level average · pin a stall → asked to start a new set.

## 3h · 7 Oct, 2nd session — docked drawer replaces floating windows (committed 7 Oct)

`DASHBOARD_OVERHAUL_PLAN.md` item 8, built after the user answered its 5 questions (answers recorded there).
- **One seam:** `openWindow()` (`client/src/windowing.js`) now renders into `#dock` (`index.html`), a drawer docked right
  of the map, left of SAM's 48px rail. Same return value, so the views barely changed: the 10 per-module
  `tw.style` width/left/top lines are gone; dense views pass `wide: true` (Overview, Terminals, route, Stalls,
  Wearables, Purchases, Saving → `min(740px, 60vw)`; others 560px). Drag code deleted.
- **Back stack = the DOM:** earlier views stay in the drawer, hidden (`visibility`), so Back / a breadcrumb returns to
  the same tab, scroll position and charts with no re-render. Opening a view already in the stack goes back to it.
  `closeView(id)` (route re-plan), `closeAll()`.
- **Map padding:** the drawer emits a `dock` event with the area it covers; `main.js` eases the map padding, and
  `flyToSchool` now opens first and flies with that padding → the school lands centred in the visible map. The
  filter pills / legend stay clear via CSS vars `--dock-r` / `--dock-b`.
- **SAM:** folds to its rail when a view opens (`setSamExpanded`, `samPanel.js`); clicking the rail expands it over
  the drawer (z-index 50 → 1100).
- **Month switch / upload reload** clears the drawer (`loadMonth`). Fixes a pre-existing bug: an open window kept
  showing the old month after switching (`openWindow` returned `null` for an existing id).
- **Narrow screens:** below 1100px the drawer is a bottom sheet (55% height); at ≤720px it sits above SAM's bar.
- **Role hub** stays a centred card over the map (`float: true`); Upload is still its own modal.
- **Verified locally** (`verify_ux.mjs`, both months, 1600×1000 + 1000×900): all §3g checks + drawer clear of the SAM
  rail, SAM collapsed, map padded 788px, crumbs + Back, Back keeps tab and scroll (300→300), fly-to dot at x≈487 of a
  992px visible map, month switch → one fresh Overview, close → padding 0, sheet at 1000px, hub floats, SAM rail
  expands over the drawer. 0 JS errors.
- ~~Polish: the bar repeats the title with one view; long names truncate; no Escape-to-go-back~~ — all done (§3l, §3m).
- **On UAT, check:** open Overview → drawer on the right, SAM folded to its rail · click a top spender → the map flies
  and the school sits in the visible part, crumb "Network Overview › <school>" · ‹ Back → Overview on the same tab ·
  switch month → drawer shows the new month · narrow the window below 1100px → bottom sheet.

## 3g · 7 Oct session — dashboard interactivity + accessibility (committed 7 Oct)

User: the Overview looked outdated (that was UAT's old build — fixed on `main` already) and the dashboard felt clunky.
Web research (NN/g, Carbon, Power BI, Esri, WCAG) → items 1–7 built, item 8 planned (`DASHBOARD_OVERHAUL_PLAN.md`).
KPI deltas vs previous month: **KIV** (user wants multi-month comparison later).
- **Overview is clickable:** terminal rows open the Terminal window; top-spender rows fly the map to the school
  (pulse) + open it; a school-type bar filters the table to that type (click again / "show all" clears).
- **Fixes:** school-type chart showed 3 of 6 labels (Chart.js autoSkip) → 2-line labels, all shown; Overview window
  no longer covers the SAM panel; stale Upload hints (wearables/txn_perf are Feb + March).
- **Holiday shading** on daily + weekly charts from the wearable bundle's detected `special.marked_days` (CNY 16–18
  Feb, March break 16–20 + 23 Mar) — no hard-coded dates; no shading for a month without that bundle.
  Plugin-free (`charts.js` `shade`).
- **Linked hover:** any window row with `data-sid` lights its map dot, and a dot lights its rows (one delegated
  listener in `main.js`). Overview + Terminals list rows carry it.
- **Role defaults:** Engineering opens with the map coloured by Errors (`ROLE_COLOR`); F&B / Management → Level.
- **Accessibility:** status colours → Okabe-Ito (`charts.js` `ST`) for marks, darker tokens (`--good/--warn/--bad`,
  ≥4.8:1) for text; "bad" dots get a dark ring (not colour alone); markers, clickable rows and role cards are
  keyboard-reachable (Enter/Space); charts get `role=img` + their heading as label.
- **Verified locally** (harness, both months): `verify_ux.mjs` drove every interaction, 0 JS errors.
- **Known limit (→ overhaul):** fly-to centres the school, but floating windows can still cover it. *(Fixed by §3h.)*
- **On UAT, check** (after the deploy): Overview → click a "Terminals needing attention" row (terminal opens) · School
  Spending shows 6 type labels, click "Independent" (table filters) · click a top spender (map flies + dot pulses) ·
  March charts shaded 16–20 + 23 Mar, Feb 16–18 · hover a row → its dot gets a blue outline · switch role to
  Engineering → legend on Errors, worst dots ringed · Tab key reaches rows/dots, Enter opens.
- **Also fixed while checking docs (7 Oct):** UAT version pinned (header); stale "Feb-only / bundled `src/data`"
  claims in README, client/README, PIPELINE, DEPLOY; the map-flow diagram.

## 3f · 6 Oct session (`e738195` with §3d/§3e + `a48a84d`; ships in the same deploy)

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
- **Local view** *(superseded 1 Oct — use "Run the dashboard locally" at the top; the harness shows the dots)*:
  `cd client && npm run dev` → http://localhost:5188. The basemap renders, but **school dots won't**. The client fetches data from api-service (`VITE_SB_API_URL`), and this
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

> Pending newer deploy: **`reload/UAT_DEPLOY_OCT.md`** (everything since `f87fd46`, one pass).

Summary: `git pull` → rebuild `smartbuddy-frontend` + `ch-insights` + `smartbuddy-ingest` →
**ingest March `health`+`heart_rate` as `2026-03`** (data sent separately; the linkage fix needs no
data) → rebuild bundles: `SB_MONTH=2026-03 ch-insights` (linkage) + `build_insights_wearable.py`
for **both** `2026-03` **and** `2026-02` (Feb rebuild is required — the `cny→special` schema change).
No DB wipe, no `ch-init`, no txn/items/saving reload. **Gate:** the March insights log must print
`linkage: …(99.x%)…`; if `0/… skipping`, stop.

## 5 · Open items / decisions

- **Deploy to UAT** — one pass covers everything since 15 Jul (see header + "Next session" steps 1–2).
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
- **After the deploy, check the OneMap basemap** (§3c) on a real screen: dots visible on the grey map, no white when
  dragging to any edge; bookstore squares / stamp diamonds recolour with Level / Errors / Speed (§3f).
- **Apply the OneMap fix to the other STYL map projects** (§3c) using `ONEMAP_BASEMAP_FIX.md`.
- **Legal check on OneMap terms** (free "currently", revocable, attribution mandatory) before production.
- **Update the VM's git remote** to the `presales-prototypes/atlantic-platform/...` path (see header).
- **Confirm on UAT** whether the map expansion (`21f1e16`) and the PBS fix (`79a3a82`) already went out — step 0 of
  `VENDOR_LAYERS_DEPLOY.md` checks the PBS one; either way the one-pass deploy brings both.
- **School mapping — RESOLVED 15 Jul; APSN Katong added 1 Oct** (OneMap by postal 467354). All 332 school IDs mapped.
- **SAM redeploy** — texts checked for consistency 6 Oct (`a48a84d`, §3f). Redeploy = rebuild `smartbuddy-mcp` +
  run `ch-insights` for both months + re-paste the whole ```text block from `agent-prompt.md` § "Copy For AI Agent"
  (single source; `agent-setup.md` §4 + § Verify). Solace gateway confirmed working.
- ~~Small UI question: no speed/error figures showed as "good"~~ — **grey "No data" since 7 Oct (§3m).**
- **KPI comparison across months — KIV (user, 7 Oct):** no "vs previous month" deltas for now; the user wants
  comparison across several months later. The overhaul plan's question 5 leaves room for it in the layout.
- **Demo questions** — 3–4 on-stage SAM questions to tune the agent (pending from presenter).
- **Taxonomy v3** — **DEFERRED (15 Jul, conscious decision):** v2 name-verified classification stays
  live; the receipt-evidence v3 upgrade (`analysis/taxonomy_v3_draft.py`, 17%→~99% coverage) is kept as
  an unwired draft, revisit if/when the supervisor signs off the policy change. Not an active task.
- **Housekeeping — DONE 15 Jul:** dropped the stale stash; git-ignored `litellmkey.txt`; deleted the
  scratch bundles/zips, the per-month sliced CSVs (`march_data`/`feb_data`/`march_wearable`), the old
  `PLAN_MARCH_SERVICE_INSIGHTS.md`, and the raw multi-month extracts incl. April (`Feb-Apr transactions`,
  `Student_items`, `health data`, `20260714_*_MAR_APR_2026`) — ~17 GB. **April source is gone** (re-request
  from the data team if an April rollout is needed). Kept `FINDINGS_COMPENDIUM.md` (referenced by the v3
  draft + memory). *(6 Oct: the `txn/` dir + other legacy pipeline data moved to `need to delete manually/` — §3f.)*

## 6 · Guardrails (do NOT undo)

- **No `cardId`↔`user_id` re-identification bridge** — different id spaces, aggregate-only.
- **Identity masked**: `studentId` + names dropped at ingest; card/user/sync ids are irreversible
  salted-hash tokens for grouping only — never emitted in SAM replies or the UI.
- **No price-based food inference**; taxonomy v3 stays additive/unsigned.
- **Dashboard decisions by the user (7 Oct):** the tour **never auto-starts** (offered only) · the map is **2D only**
  (no rotate/tilt, no compass) · compare shows **no average/baseline** and no "Only differences" (both removed on
  purpose) · one type per comparison, max 4 · the drawer, not floating windows (the role picker stays a card) ·
  ask before committing.
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
