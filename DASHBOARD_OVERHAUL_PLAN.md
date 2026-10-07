# Dashboard overhaul plan: floating windows → docked panels

Status: **built 7 Oct 2026 (second session), committed 7 Oct** — see HANDOVER §3h. Answers to the open questions are at the end.
Same session, after this plan: compare (§3i, reworked as graphs §3k), decluttered map + onboarding (§3j), opt-in tour,
keyboard fixes, Keyboard & mouse list and a 2D-only map (§3l).
Context: HANDOVER.md §3g covers items 1–7 of the 7 Oct UX list, which are already built. This is item 8.

## Why

- Every view is a free-floating, draggable window over the map. Users pile them up, they hide the map, and the
  user has to manage them by hand. The 7 Oct "fly to school" can centre a school that a window then covers.
- Mature map products use a few **anchored** surfaces, not free-floating windows:
  - Felt: toolbar + legend + detail panel + table ([Felt](https://help.felt.com/getting-started/tour-the-interface)).
  - Esri Calcite: docking is the default; floating is the exception ([Calcite](https://developers.arcgis.com/calcite-design-system/tutorials/construct-a-mapping-app-components/)).
  - Material: side sheets let users work in the sheet and the main content at the same time.
- NN/g: tabs are a poor fit for content people compare, and progressive disclosure beyond 2 levels rarely works
  ([tabs](https://www.nngroup.com/articles/tabs-used-right/), [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).
  The Overview's 4 tabs and the School → Stall → Terminal window chains run into both problems.

## The lazy path: one seam

Every window goes through `openWindow({ id, title, sub, chips })` in `client/src/windowing.js`, which returns a body
element. There are 16 call sites in 10 modules. If `openWindow` renders into a **dock** instead of a floating `.tw`, most
modules don't change. Only the 10 places that set `tw.style.left/top/width` themselves need to go: eng ×3, feb,
hub, items, overview, savings, stall ×2. The callers' `id` already identifies each view, which
gives us the back stack for free.

## Proposed layout

```
┌ top bar: month · coverage · search · views · role ───────────────────────────┐
│ filter pills                                       │ DETAIL DRAWER (≈480px)  │
│                                                    │ ‹ Overview › RFGS › …   │
│                 MAP (always visible)               │ [view content]          │
│     padding-right = drawer width, so fly-to        │                         │
│     lands in the visible part                      │                         │
│ legend                                             │                         │
└────────────────────────────────────────────────────┴─────────────────────────┘
```

1. **Drawer** (right, one view at a time): a breadcrumb + back button replaces stacked windows. Opening a school from
   the Overview pushes it onto the stack; Back returns to the Overview at the same tab and scroll position.
2. **Map padding:** call `map.easeTo({ padding: { right: drawerWidth } })` on open and close. Then `flyToSchool` centres
   the school in the visible map with no extra code.
3. **Wide views** (Terminals, Wearables, Purchases, Saving) get a wider drawer (≈60% of the screen), or a
   bottom sheet (question 3).
4. **Keep as overlays:** Upload (already a modal), the role hub (first-run picker) and SAM (question 1).
5. **Hover and click linking** carry over unchanged. They key on `data-sid` and `window.SB`, not on windows.

## Steps (each one verified with the local harness and the headless-Chrome script from 7 Oct)

1. Add a `#dock` region in `index.html` and make `openWindow` render into it, keeping the same return value. Delete the
   per-module `tw.style` positioning.
2. Back stack and breadcrumbs, built from `id` and `title`.
3. Map padding on drawer open and close.
4. SAM placement (question 1).
5. Narrow screens: below about 1100px, the drawer becomes a full-width bottom sheet.
6. Update DEPLOY/README screenshots and the HANDOVER entry, then deploy together with the pending `e738195` + `a48a84d`.

Estimate: 1–2 sessions. Risk is low on logic and high on visuals. Nothing in data, ingest or SAM changes.

## Open questions (answer before building)

1. **SAM and the drawer both want the right edge.** (a) Drawer on the right, and SAM collapses to its rail while the
   drawer is open. (b) SAM becomes a tab inside the drawer. (c) Drawer on the left, SAM stays right.
2. **Side-by-side comparison.** Floating windows currently allow two schools open at once. Docking loses that. Is
   comparison needed? If so, use a "Compare" view inside the drawer rather than keeping floating windows.
3. **Wide views:** a wider right drawer, or a bottom sheet under the map?
4. **Overview tabs:** keep the 4 tabs, or one scrolling page with a sticky section index? NN/g favours the second
   for content people compare.
5. **Multi-month comparison** (KIV from 7 Oct): should the drawer's KPI cards be designed now to take a
   "vs other month(s)" slot later? This only affects layout, not data.

**Answers (user, 7 Oct):** 1 (a) drawer right, SAM folds to its rail when a view opens (expanding SAM overlays the
drawer) · 2 no comparison for now · 3 wider right drawer · 4 keep the 4 tabs · 5 no slot now (add with the feature).
**Revisited (same session):** comparison IS needed → built as pinned compare cards over the map + a detail table
(HANDOVER §3i), for schools, stalls and terminals.
