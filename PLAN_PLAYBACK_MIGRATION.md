# PLAN — Migrate SMART Buddy to InfluxDB + Ditto with time playback

**Status:** PLAN ONLY — nothing built. Review / adjust before we execute.
**Why:** the project now wants **playback** (scrub the February timeline and watch spend /
faults / activity evolve). That is a time-series + state-at-time use case — the right fit for
**InfluxDB (history) + Eclipse Ditto (current state)**, modelled on **`tree-digital-twin`**.

---

## 1 · Decisions

### Locked (from you)
| # | Decision | Choice |
|---|---|---|
| 1 | Storage | **Full replace** — InfluxDB + Ditto become the serving stores; retire the DuckDB/Parquet *serving* layer |
| 2 | Scope | **February 2026 only** (the data we still have on disk) |
| 3 | Playback subjects | **All three** — schools & terminals on the map, wearables/health, and individual card/user |

### Confirmed (8 Jul)
- **A. `cardId` cardinality (individual playback) — CONFIRMED.** `cardId` ~179K distinct, `user_id`
  ~13.6K. tree-twin warns: **never put high-cardinality/mutable values in Influx tags** (each = a
  "series"; 179K = memory blow-up, the exact old VM-space risk). So: schools (334) / terminals (2,600)
  / stalls (2,546) = **tags** (fine); **per-user** borderline-OK as a tag (13.6K); **per-card** is
  **on-demand only** — query one hashed card at a time with `cardId` as a *field* filter, NOT a
  browsable animated layer of 179K.
- **B. Computing — CONFIRMED, tree-twin style.** Compute everything **in the ingestion script** and
  write finished numbers to Influx/Ditto — exactly how `backfill.py` computes `derive_status()`/
  `fuse_overall()` in Python before writing. Refinement: the compute *inside* that script **reuses our
  existing tested DuckDB SQL** (taxonomy / atas / verdicts) instead of re-writing in pandas — same
  architecture, reused logic. The app never queries DuckDB at runtime.
- **C. Static reports — CONFIRMED frozen.** `SMART_Buddy_*.html/pdf` become frozen artifacts (already
  non-regenerable after the Feb purge). The live product is the playback app.

---

## 2 · How tree-digital-twin actually works (the model we copy)

Confirmed by reading the repo. Key point: **it is not live streaming** — it's a *historical replay*:
1. **One-shot `backfill.py`** parses CSVs → writes **all history to InfluxDB** (`tree_telemetry`
   measurement) and **only the latest reading per device to Ditto** (one Thing per tree). Downsamples
   to one point per device per time-bucket (daily default) so Influx stays small.
2. **`nparks-api`** (Node/Express) serves history from Influx via **Flux** (`/…/playback?from&to`
   returns a daily series) and current state from **Ditto search**; container 3300 → host 3310.
3. **Frontend** fetches the **whole daily series once**, then plays it back **client-side**: a
   `<input range>` scrubber + a `setInterval(120ms)` that steps an **integer index** through the
   in-memory array (`tree-window.js` `_setupPlaybar`/`_showFrame`/`togglePlay`). No polling, no
   websocket, no Ditto subscription during playback.
4. **Solace** is used only for the "Ask Arborist" agent request/reply — not for telemetry.
5. Backing stores (Influx, Ditto+Mongo, Solace, Keycloak, nginx-proxy) are the **shared platform**
   (`solace-pubsub-geo-filtering`) already on the VM; tree-twin only ships api + forecast + frontend
   (+ one-shot ingestion). Data is isolated **by Influx measurement name + Ditto namespace** (shared
   `rtls` bucket, `org.nparks` namespace).

**Load-bearing Flux detail to reuse:** `playbackDaily` does
`filter(measurement, id) |> group(["_field"]) |> aggregateWindow(1d, mean) |> pivot |> sort`.
The `group(["_field"])` **merges series that split when a tag value changes** — mandatory whenever a
tag can change over time. (Another reason to keep mutable state out of tags.)

---

## 3 · Target architecture (SMART Buddy)

```
 RAW Feb data on disk (parquets / feb_data CSVs — real ids, gitignored)
        │
        │  sb-ingestion  (Python; reuses our DuckDB/pandas to COMPUTE aggregates,
        │                 hashes personal ids, then writes out — like backfill.py)
        ├───────────────────────────────┬───────────────────────────────┐
        ▼                               ▼                               ▼
   InfluxDB  (shared rtls bucket,   Ditto  (namespace org.smartbuddy,   (no third store)
   new measurements — HISTORY)      latest-state twins — CURRENT)
        │                               │
        └───────────────┬───────────────┘
                        ▼
                 sb-api  (Node/Express — clone of nparks-api)
                   • /api/schools, /api/terminals        ← Ditto search (map markers + state)
                   • /api/<entity>/playback?from&to      ← Flux daily/hourly series
                   • /api/card/{token}/timeline          ← Flux on-demand single-entity (field filter)
                        │
                        ▼
                 smart-buddy-app  (existing Vite app + the tree-window PLAYBACK engine)
                   • map of schools/terminals; click → window with Play ▶ + scrubber
                   • timeline scrubs Feb; spend/errors/speed/steps/HR animate
                        │  (Solace, unchanged)
                        ▼
                 SAM agent  ← can now read the SAME Influx bucket via the existing IOT_UAT_MCP
                              connector's execute_flux_query (see §7) — no artifact upload needed
```

---

## 4 · Storage mapping

### 4.1 InfluxDB — history (shared `rtls` bucket, retention infinite, new measurement names)
Downsample to per-entity-per-bucket points (never raw 4M rows). **Tags = low-cardinality only.**

| Measurement | Grain | Tags (low-card) | Fields | ~points |
|---|---|---|---|---|
| `sb_txn` | per **terminal** per **hour** | `schoolId`(334), `terminalId`(2,600), `network_type`, `mcat` | `txns`, `revenue_cents`, `err_count`, `offline_count`, `median_speed_ms` | ~1.7M |
| `sb_stall` | per **stall** per **day** | `schoolId`, `storeId`(2,546), `mcat` | `txns`, `revenue_cents` | ~70K |
| `sb_wearable` | per **user** per **day** | `user_id`(13.6K — borderline; acceptable) | `steps`, `active_minutes`, `mean_bpm`, `resting_bpm` | ~380K |
| `sb_school` | per **school** per **day** | `schoolId`, `moe_type`, `level` | `txns`, `revenue_cents`, `err_pct`, `distinct_cards` | ~9K |
| `sb_card` (on-demand only) | per **card** per **day** | *none* — `cardId` is a **FIELD**, not a tag | `cardId`(hashed), `txns`, `spend_cents` | queried one card at a time |

- **Personal ids are hashed before write** (`cardId`/`user_id` → `sb_…` tokens, our existing
  `build_feb_duckdb` logic) — do NOT write raw ids into the shared platform store.
- Hourly `sb_txn` is what makes the **recess spikes / CNY drop** visible when scrubbing.

### 4.2 Ditto — current state (namespace `org.smartbuddy`, one Thing per entity)
Latest-state twins for the map + detail panels (mirrors `ditto_body()`):
- `org.smartbuddy:school-{schoolId}` — attributes `name, moe_type, level, zone, lat, lng`;
  features `spend {total_sgd, avg_ticket, distinct_cards}`, `network {err_pct, offline_pct, median_speed}`.
- `org.smartbuddy:terminal-{terminalId}` — attributes `schoolId, network_type`;
  features `health {err_pct, median_speed_ms, p95_speed_ms, flag}`, `status {last_seen}`.
- `org.smartbuddy:stall-{schoolId}-{storeId}` — attributes `storeName, mcat`; features `spend {…}`. *(optional — include if stall map pins are wanted; else stalls stay Influx-only)*
- `org.smartbuddy:app-settings` — bookmarks / shared prefs (like tree-twin's `app-settings`).
- Wearable users: **not** individual Ditto Things (13.6K twins of little map value) — served from Influx.

---

## 5 · Components to build (each = a rename/adapt of a tree-twin piece)

| New component | Clone of | What changes |
|---|---|---|
| `smart-buddy-agent/ingestion/` (Python) | `tree-digital-twin/ingestion/backfill.py` | Read Feb parquets (reuse our DuckDB queries + `taxonomy.py`), hash ids, compute the §4 aggregates, bulk-write history→Influx + latest→Ditto. One-shot, `--write` gated. |
| `smart-buddy-agent/sb-api/` (Node/Express) | `nparks-api` | Routes: `/api/schools`,`/api/terminals` (Ditto search), `/api/{entity}/playback` (Flux daily/hourly, **with `group(["_field"])`**), `/api/card/{token}/timeline` (on-demand field filter). Drop forecast/RCA unless wanted. |
| Playback UI in `smart-buddy-app` | `frontend/tree-window.js` playback engine | Reuse the scrubber + `setInterval` frame-stepper; fetch per-entity series once; **add a speed control** (parameterize the 120 ms). Wire into existing school/terminal windows + a wearable window. |
| `docker-compose.sb.yml` | `tree-digital-twin/docker-compose.yml` | Services `sb-api` + `smartbuddy-frontend` (+ one-shot `sb-ingestion`, profile `backfill`). Connect to shared `backend` net for Influx/Ditto/Solace. |
| Retire | DuckDB *serving* + Path-A aggregate artifacts + `smartbuddy-mcp` | DuckDB survives only as an ingest-time compute lib; the MCP server / feb.duckdb / aggregate CSVs are no longer the serving path (keep in repo history or delete on your call). |

---

## 6 · Playback UX (what the user sees)
- Map of schools (dot size = spend, colour = error/speed) — from Ditto.
- Click a school/terminal → detail window with **▶ Play / ⏸ + a timeline scrubber** over 1–28 Feb.
- Scrubbing animates the hourly/daily series (spend, error rate, speed; steps/HR on the wearable
  window) — watch recess spikes, the **CNY drop (16–18 Feb)**, faults emerging.
- Individual: a search/lookup that loads **one** card-token or user timeline on demand (§4.1 `sb_card`).
- Mechanism (from tree-twin): fetch the full series once, scrub a client-side index — no live feed.

---

## 7 · Agent convergence (bonus — this pivot helps the SAM agent)
Putting SMART Buddy history in the **shared `rtls` bucket** means the **existing `IOT_UAT_MCP`
connector** (whose `execute_flux_query` runs Flux against that bucket) can now **reach the canteen
measurements** — the exact blocker from the Data-Analysis saga. So the agent could answer questions
by querying `sb_txn`/`sb_school` directly, **no new connector and no artifact upload**. Caveat: that
tool's built-in description advertises the RTLS schema, so we'd supply the SMART Buddy measurement
schema in the **agent instructions**. (Records: supersedes Path A in `sam-agent-instructions.md`.)

---

## 8 · Security / privacy (carries over)
- **Hash `cardId`/`user_id`/`sync_id` at ingest** (reuse the salted-hash logic) — the shared Influx/Ditto
  must never hold raw customer ids. Aggregates + hashed tokens only.
- Reuse **separate secrets** (Influx write token, Ditto creds) — never reuse tree-twin's.
- Data isolation by **measurement name + `org.smartbuddy` namespace** (same model tree-twin uses to
  coexist with RTLS in the shared bucket).
- Gate the app/agent behind auth (Keycloak/proxy) — answers/state still concern real (if hashed) ids.

---

## 9 · Isolation values (avoid colliding with tree-twin / RTLS)
| Resource | tree-twin uses | SMART Buddy uses |
|---|---|---|
| Influx bucket | `rtls` (shared) | **`rtls` (shared)** — new measurements `sb_*` |
| Ditto namespace | `org.nparks` | **`org.smartbuddy`** |
| Container names | `nparks-*` | **`smartbuddy-api`, `smartbuddy-frontend`, `smartbuddy-ingestion`** |
| Host ports | 8087 (fe), 3310 (api), 3400, 8088 | **8089 (fe), 3320 (api)** (pick free ports) |
| Compose project | `tree-digital-twin` | **`smartbuddy`** |
| Solace topic domain | `nparks` | **`smartbuddy`** |

---

## 10 · Prerequisites & blockers
| Item | Owner | For |
|---|---|---|
| **Write access** to the shared InfluxDB (`iot-uat.styl.solutions/influx`, bucket `rtls`) + a token | platform owner | ingestion |
| **Ditto creds** (`/ditto-raw` basic-auth) + policy id | platform owner | ingestion / twins |
| Bucket **retention = infinite** (data is months in the past) | platform owner | history survives |
| Shared platform (`solace-pubsub-geo-filtering`) up + `backend` network reachable | platform owner | api ↔ stores |
| Feb raw data present on the build machine (parquets/feb_data — ✅ on disk) | us | ingestion input |
| Confirm decisions **A/B/C** in §1 | you | design lock |

---

## 11 · Build phases (once approved)
1. **Ingestion** — `sb-ingestion` writes §4 measurements + twins to a *local/dev* Influx+Ditto first
   (docker), verify counts + a Flux playback query + a Ditto search. *(local, safe, unblocks)*
2. **API** — `sb-api` playback + markers endpoints; verify against the dev stores.
3. **Frontend playback** — port the tree-window scrubber engine into `smart-buddy-app`; wire to `sb-api`;
   add speed control; school/terminal/wearable windows + individual lookup.
4. **Compose + isolation** — `docker-compose.sb.yml`, renamed/re-ported; point at the shared stores.
5. **Agent** — update instructions to query `sb_*` via `IOT_UAT_MCP`; retire Path-A artifacts.
6. **Cutover** — retire DuckDB serving + old dashboard data path; docs.

Phases 1–3 are local/offline-safe (dev Influx+Ditto in docker). 4–6 need the §10 platform prereqs.

---

## 12 · Out of scope / risks
- **No live streaming** — this is historical replay (client-side scrub), like tree-twin. A true live
  feed (producer→Solace→ditto-sync) is a separate future effort.
- **Flux ≠ SQL joins** — cross-dataset analytics move to ingest-time (Python/DuckDB), not runtime.
- **Individual-card layer** is the cardinality risk (decision A) — default to on-demand lookup.
- **Re-work cost** — full replace rebuilds serving + FE data path; the Path-A / MCP / feb.duckdb work
  becomes ingest-time helper or is retired. Confirm before we start.
```
