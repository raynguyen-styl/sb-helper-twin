# UAT deploy — map expansion (158→331 markers, 7 corrected) + stall-copy fix

Ships three coupled changes. **No transaction/items/saving/wearable data reload** — only the school
dimension + rebuilt bundles + a frontend/MCP rebuild.

| change | file(s) | needs image rebuild |
|---|---|---|
| **Map: 158→331 markers, +7 corrected** | `ingestion-service/school_geo.json`, `reload/schools.csv` | `ch-insights` + `smartbuddy-ingest` (school_geo.json is baked in) |
| **Stall Explorer copy fix** ("No item/SKU data exists" → accurate) | `client/src/stall-window.js` | `smartbuddy-frontend` |
| **SAM school-count text** (158 → 331) | `mcp-service/src/schema.js`, `mcp-service/agent-prompt.md` | `smartbuddy-mcp` + re-paste instructions |

## What changed in the data — and how it was verified
`school_geo.json`: **158 → 331** entries. Rebuilt from the authoritative `schoolId → school` mapping,
**verified against the raw `Feb-Mar_Data` feed**:
- The basket→txn **linkage reproduces at 99.68%** on this data (matches prod).
- The `items` receipts carry **no `schoolId`** — only a school name — yet they match transaction
  `schoolId`s to the **exact second + cent**. So the receipts identify each school *independently* of the
  acronym. This bridge matches `analysis/school_moe_map.csv` exactly (0 disagreements) → the csv is correct.

Two kinds of change:
- **+173 new markers** — previously-unmapped schools geocoded via OneMap (postal from the MOE directory
  `moe_schools.json`; 11 special-education schools by name).
- **7 base-geo coordinates CORRECTED** — they had been pointing at the *wrong* school (the acronym looked
  like one school, but the receipts prove another). **3 were 17–21 km off.**

  | ID | was (wrong) | now (receipt-verified) | moved |
  |---|---|---|---|
  | RVPS | River Valley Primary | Riverside Primary | 17.4 km |
  | RLPS | Rulang Primary | Rivervale Primary | 21.3 km |
  | CCPS | Canossa Catholic Primary | Concord Primary | 17.2 km |
  | CHS | Catholic High | Chongfu School | 9.3 km |
  | NJC | Nanyang JC | National JC | 7.3 km |
  | NBSS | Naval Base Sec | Northbrooks Sec | 1.6 km |
  | GESS | Gan Eng Seng (generic) | Gan Eng Seng Primary | 1.0 km |

  (Their acronym-namesakes are separate IDs and are now mapped correctly too: RUPS=Rulang,
  CNPS=Canossa Catholic, NVBSS=Naval Base Sec, CAHP/CAHS=Catholic High, GESSS=Gan Eng Seng Sec.)

Diff vs git HEAD: **+173 added, 7 changed, 0 removed.** `reload/schools.csv` regenerated (159 → 332 lines).

**Unmapped (3, by design):** `APSNK` APSN Katong (no reliable OneMap hit — left unmapped, not guessed);
`PBS` Pacific Bookstores and `SSSTM` Self-Serve-Stamps (not schools). (`STYL` test terminals are filtered
upstream and never reach the map.)

## Steps (UAT VM, repo root)
```bash
# 1) code
git pull

# 2) rebuild the changed images
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  build smartbuddy-frontend ch-insights smartbuddy-ingest smartbuddy-mcp
docker compose -f docker-compose.yml -f docker-compose.agent.yml \
  up -d smartbuddy-frontend smartbuddy-ingest smartbuddy-mcp

# 3) reload the schools dimension table (158 → 331 rows). REPLACE, no rebuild flag needed for a dimension.
bash scripts/vm-load.sh reload/schools.csv schools 2026-02 replace 1

# 4) rebuild the schools/global bundles for BOTH months (the map reads the per-month `schools` bundle,
#    which is built from school_geo.json). Idempotent (ReplacingMergeTree, newest wins).
CC="docker compose -f docker-compose.yml -f docker-compose.agent.yml --profile ingest run --rm ch-insights"
SB_MONTH=2026-02 $CC
SB_MONTH=2026-03 $CC

# 5) SAM: re-paste the ```text block from mcp-service/agent-prompt.md § "Copy For AI Agent"
#    into the agent's Instructions (the school count line changed). See mcp-service/agent-setup.md §4.
```

## Verify
1. **Map** — open the dashboard (either month): legend footer reads **"331 schools mapped"**, "unmapped"
   drops to **3**. New dots fill previously-blank areas.
2. **Corrected dots moved** — search `RLPS`: it now sits in **Sengkang (Rivervale)**, not Jurong (Rulang);
   `RVPS` in **Woodlands (Riverside)**, not the old River Valley spot; `CHS` = **Chongfu**, not Catholic High.
3. **Schools table** — `SELECT count() FROM smartbuddy.schools` → **331**.
4. **Stall Explorer** — the footer caption no longer says "No item/SKU data exists".
5. **SAM** — ask *"how many schools have map coordinates?"* → ~331.

## Notes
- Food-category classification is UNCHANGED — still **v2 name-verified only**; taxonomy v3 (receipt-based
  category inference) stays **deferred** pending supervisor sign-off (`analysis/taxonomy_v3_draft.py`).
- Rollback the map: `git checkout HEAD~1 -- ingestion-service/school_geo.json reload/schools.csv`,
  rebuild `ch-insights`, rerun steps 4 + 3.
