// SMART Buddy insights app — Singapore map, role-based nav, views in a docked drawer (windowing.js).
// Roles filter the top bar to each team's views (F&B / Engineering / Management);
// everything is deep-linkable and cross-linked (school ↔ stall ↔ machine).
import maplibregl from 'maplibre-gl';
import { fetchMonths, fetchBundle } from './sbData.js';
import { ST } from './charts.js';
import { openSchool } from './school-window.js';
import { openOverview } from './overview-window.js';
import { openFeb } from './feb-window.js';
import { openStallExplorer, openStall } from './stall-window.js';
import { openEng, openTerminal } from './eng-window.js';
import { openItems } from './items-window.js';
import { openSavings } from './savings-window.js';
import { openHub, ROLES } from './hub-window.js';
import { openPlayback, setPlaybackMonth } from './playback-window.js';
import { openUpload } from './upload-window.js';
import { initAuth, authReady, authRoles, logout } from './auth.js';
import { initSolace } from './solace/solace.js';
import { initSam, setSamMode } from './sam/samClient.js';
import { initSamPanel, setSamExpanded, setSamPanelMode } from './sam/samPanel.js';
import { initMode, getMode, setMode, onModeChange, MODES } from './mode.js';
import { closeAll, info, esc } from './windowing.js';
import { setCompareData, clearCompare, toggle as toggleCompare, followMap, pinnedKind, isPinned, pinsParam, restorePins, openDetail as openCompare } from './compare.js';
import { startTour, openTours, CHAPTERS } from './tour.js';
import { openShortcuts } from './shortcuts.js';
import { initOnboarding, tick } from './onboard.js';

// Force Keycloak login first when configured (live deploy). No-op stub in local dev (no VITE_KEYCLOAK_URL).
// Fire-and-forget: login-required redirects unauthenticated browsers to Keycloak; sb-api calls await
// `authReady` (see sbApi.js) so no request races the token.
initAuth();
// When auth settles, show who's signed in + a logout button in the nav.
authReady.then(({ username }) => renderUser(username));

const LV_COLOR = { Primary: '#0a5fd8', Secondary: '#00955f', 'Junior College': '#6a3fd1', Other: '#48484d' };
const SEV = (v, warn, bad) => (v == null ? 'none' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'good');
const NODATA = '#8e8e93';    // Errors/Speed mode: a school or shop without that figure — grey, never "good"
let colorMode = 'level';
// Each role opens on the colouring it acts on: Engineering → error rate; F&B / Management → level.
const ROLE_COLOR = { eng: 'errors' };
const vendorMarkers = [];
// Map filter — stackable on/off pills, the Super App POC's project-filter pattern: any combination,
// never zero, "All" turns every pill on; kept in the URL hash (#layers=…) so a view is shareable.
// Vendor layers place a stall beside its host school only where build_insights set `host` (fact-only).
const VENDOR = { pbs: { school: 'PBS', cls: 'mk-book', offset: [9, -9] },
                 stamps: { school: 'SSSTM', cls: 'mk-stamp', offset: [-9, -9] } };
const LAYERS = [
    ...Object.entries(LV_COLOR).map(([id, color]) => ({ id, label: id, color })),
    { id: 'pbs', label: 'PBS Bookstores', color: '#7d5fd3', shape: 'sq' },
    { id: 'stamps', label: 'Stamp points', color: '#d6336c', shape: 'dia' },
];
const DEFAULT_LAYERS = Object.keys(LV_COLOR);
// One key's value from the URL hash ('' if absent or malformed — a bad link must not stop the page).
const hashParam = (key) => { try { return decodeURIComponent(new RegExp(`(?:^|[#&])${key}=([^&]+)`).exec(location.hash)?.[1] || ''); } catch { return ''; } };
let layersOn = (() => {
    const ids = hashParam('layers').split(',').filter((id) => LAYERS.some((l) => l.id === id));
    return new Set(ids.length ? ids : DEFAULT_LAYERS);
})();
// Pinned comparison from a shared link (#pins=…); read now, because the first loadMonth() clears the pins (and the hash).
const linkPins = hashParam('pins');
// Set or drop one key=value in the URL hash, keeping the rest (shareable view state, no history entry).
function setHash(key, val) {
    const h = location.hash.slice(1).split('&').filter((p) => p && !p.startsWith(key + '='));
    if (val) h.unshift(`${key}=${encodeURIComponent(val)}`);
    history.replaceState(null, '', location.pathname + location.search + (h.length ? '#' + h.join('&') : ''));
}

/* ---------- Demo | Live (mode.js): which SAM agent the chat talks to; Live offers no Upload ---------- */
// #mode= in the link → the browser's stored choice → VITE_SB_DEFAULT_MODE → demo. The views read the
// same ClickHouse extract in both modes; only the chat topics and the Upload entry differ.
initMode({ defaultMode: import.meta.env.VITE_SB_DEFAULT_MODE, hashValue: hashParam('mode') });
const MODE_LABEL = { demo: 'Demo', live: 'Live' };
const MODE_TITLE = { demo: 'Demo: the uploaded extract and the demo agent (Upload available)',
                     live: 'Live: the live agent (no Upload)' };
// The toggle on the nav bar (#mode-toggle in index.html): built once, its pressed state follows the mode.
function renderModeToggle() {
    const el = document.getElementById('mode-toggle');
    if (!el) return;
    if (!el.childElementCount) {
        el.innerHTML = MODES.map((m) => `<button type="button" data-mode="${m}" title="${MODE_TITLE[m]}">${MODE_LABEL[m]}</button>`).join('');
        el.addEventListener('click', (e) => { const m = e.target.closest('[data-mode]')?.dataset.mode; if (m) setMode(m); });
    }
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === getMode())));
}
renderModeToggle();
onModeChange((m) => {
    setHash('mode', m);                                                              // shareable
    if (m === 'live') document.querySelector('.up-overlay.show .up-x')?.click();     // no upload in Live
    renderNav();                                                                     // menu + toggle
    setSamMode(m);                                                                   // chat topics
    setSamPanelMode(m);                                                              // header + new chat
});
const markerEls = new Map();
const markers = new Map();
let mapReady = false;

/* ---------- per-month data (fetched from the ClickHouse-backed read API) ---------- */
// These start empty and are (re)filled by loadMonth() from the insight bundles. Windows receive
// them as arguments at open time, so switching month + reopening a view shows the new month.
let GLOBAL = {}, SCHOOLS = {}, FEB = null, STALLS = { stalls: [], terminals: [] }, ITEMS = null, SAVINGS = null;
let MONTHS = [];                 // [{month, kinds}]
let curMonth = null, curKinds = [];

/* ---------- views & roles ---------- */
// Each view maps to an insight-bundle kind; renderNav only shows the ones the current month has
// (Feb → wearable; March → items/savings). Playback + Upload are always available.
// `label` is the compact nav text; `title` is the full name shown on hover. Keeping labels short
// stops the top bar from overflowing when a role shows several views (see renderNav). Utility actions
// (switch workspace, upload, sign out) live in the workspace menu instead (renderNav).
const VIEWS = {
    overview: { label: 'Overview',   title: 'Network Overview',      kind: 'global',   open: () => openOverview(GLOBAL, SCHOOLS, FEB?.special) },
    eng:      { label: 'Terminals',  title: 'Terminal Health',       kind: 'stalls',   open: (p) => openEng(STALLS, p || {}) },
    feb:      { label: 'Wearables',  title: 'Wearables & Health',    kind: 'wearable', open: (p) => openFeb(FEB, p) },
    items:    { label: 'Purchases',  title: 'Purchases & Nutrition', kind: 'items',    open: (p) => openItems(ITEMS, p) },
    savings:  { label: 'Saving',     title: 'Saving vs Spending',    kind: 'savings',  open: (p) => openSavings(SAVINGS, p) },
    playback: { label: 'Playback',   title: 'Timeline playback',     kind: null,       open: (p) => openPlayback(p || {}) },
};
const viewAvailable = (k) => VIEWS[k].kind == null || curKinds.includes(VIEWS[k].kind);
let role = localStorage.getItem('sb-role') || null;
let username = null;

// Canonical datasets shown in the per-month coverage strip. Each maps to the insight-bundle `kind`
// that proves it was loaded, so the strip reflects exactly what THIS month has — making the
// platform's per-month adaptiveness visible instead of silently hiding views.
const COVERAGE = [
    ['global', 'Transactions'],
    ['wearable', 'Wearables'],
    ['items', 'Purchases'],
    ['savings', 'Savings'],
];

function setRole(r, openPrimary = true) {
    role = r;
    if (r) localStorage.setItem('sb-role', r); else localStorage.removeItem('sb-role');
    localStorage.setItem('sb-hub-seen', '1');
    initOnboarding();
    setColorMode(ROLE_COLOR[r] || 'level');
    renderNav();
    if (openPrimary) openFirstAvailable(r);
}
// Role picker result: a role · null = "Skip — all views" · undefined = closed with ✕ (keeps the current role; on a
// first visit it counts as Skip).
function pickRole(r) { if (r !== undefined || !localStorage.getItem('sb-hub-seen')) setRole(r ?? null); }
// Open a role's primary view, or the first available one if the primary isn't in this month.
function openFirstAvailable(r) {
    const wanted = r ? [ROLES[r].primary, ...ROLES[r].views] : Object.keys(VIEWS);
    const k = wanted.find((v) => VIEWS[v] && viewAvailable(v)) || 'playback';
    VIEWS[k].open();
}
function renderNav() {
    const nv = document.getElementById('nav-views');
    let keys = [...(role ? ROLES[role].views : Object.keys(VIEWS))].filter((k) => VIEWS[k] && viewAvailable(k));
    if (!keys.includes('playback')) keys.push('playback');  // always
    nv.innerHTML = keys.map((k) => `<button class="nav-btn" data-view="${k}" title="${VIEWS[k].title || VIEWS[k].label}">${VIEWS[k].label}</button>`).join('') +
        `<button class="nav-role" id="role-btn" popovertarget="nav-menu" title="${getMode() === 'live' ? 'Workspace, tours, sign out' : 'Workspace, upload, sign out'}">${role ? ROLES[role].icon + ' ' + ROLES[role].label : '☰ All views'} ▾</button>
        <div id="nav-menu" class="nav-menu" popover>
          <button data-act="role">Switch workspace…</button>
          ${getMode() === 'demo' ? '<button data-act="upload">⬆ Upload data</button>' : ''}
          <button data-act="tours">Tours…</button>
          <button data-act="keys">Keyboard &amp; mouse <kbd>?</kbd></button>
          ${username ? `<div class="nav-menu-user">Signed in as <b>${username.replace(/[&<"]/g, '')}</b></div>
            <button data-act="logout">Sign out</button>` : ''}
        </div>`;
    nv.querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => VIEWS[b.dataset.view].open()));
    const menu = nv.querySelector('#nav-menu'), rb = nv.querySelector('#role-btn');
    menu.addEventListener('toggle', (e) => {                // popovers open centred; pin it under the button
        if (e.newState !== 'open') return;
        const r = rb.getBoundingClientRect();
        Object.assign(menu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, r.right - menu.offsetWidth)}px` });
    });
    menu.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        menu.hidePopover();
        if (act === 'role') openHub(pickRole);
        else if (act === 'upload') openUpload(onUploaded);
        else if (act === 'tours') { rb.focus(); openTours(tourKeys(), tour); }   // focus comes back to the ▾ button after
        else if (act === 'keys') { rb.focus(); openShortcuts(); }
        else logout();
    });
    renderModeToggle();
    renderMonthPicker();
    renderCoverage();
}

// A compact "what this month has" strip beside the month picker. Driven by the current month's
// bundle `kinds` — present datasets read ✓, absent ones read – (dimmed). This is the visible proof
// that the platform understands each month's data rather than treating a gap as an error.
function renderCoverage() {
    const right = document.querySelector('.nav-right');
    if (!right) return;
    let el = document.getElementById('month-cov');
    if (!MONTHS.length || !curMonth) { el?.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'month-cov'; el.className = 'month-cov';
        const picker = document.getElementById('month-picker');
        right.insertBefore(el, picker ? picker.nextSibling : right.firstChild);
    }
    // Only what's missing this month — nothing to say when every dataset is loaded.
    const missing = COVERAGE.filter(([kind]) => !curKinds.includes(kind)).map(([, label]) => label);
    el.title = 'Not loaded for the selected month, so their views are hidden';
    el.innerHTML = missing.length ? `<span class="cov cov-off">Not this month: ${missing.join(', ')}</span>` : '';
}

// Month picker in the top-right nav. Hidden until ≥1 month exists.
function renderMonthPicker() {
    const right = document.querySelector('.nav-right');
    if (!right) return;
    let sel = document.getElementById('month-picker');
    if (!MONTHS.length) { sel?.remove(); return; }
    if (!sel) {
        sel = document.createElement('select');
        sel.id = 'month-picker'; sel.className = 'month-picker'; sel.title = 'Data month';
        right.insertBefore(sel, right.firstChild);
        sel.addEventListener('change', () => switchMonth(sel.value));
    }
    const fmt = (m) => { const [y, mo] = m.split('-'); return `${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+mo]} ${y}`; };
    sel.innerHTML = MONTHS.map((m) => `<option value="${m.month}"${m.month === curMonth ? ' selected' : ''}>${fmt(m.month)}</option>`).join('');
}

async function switchMonth(m) {
    if (m === curMonth) return;
    if (await loadMonth(m) === false) return;
    renderNav();
    openFirstAvailable(role);
}

// Called by the upload window after a successful load — refresh months + current data.
async function onUploaded() {
    MONTHS = await fetchMonths().catch(() => MONTHS);
    if (!MONTHS.find((x) => x.month === curMonth) && MONTHS.length) curMonth = MONTHS.at(-1).month;
    if (await loadMonth(curMonth) === false) return;
    renderNav();
}

// User badge + logout in the top-right nav (only when Keycloak is enabled → username present).
function renderUser(name) {
    if (!name || name === 'dev') return;                      // local dev / no-auth → no sign-out entry
    username = name;
    renderNav();
}

/* ---------- cross-window API (used by stall/eng/school windows + SAM actions) ---------- */
// samActive tracks the last thing the user opened so buildSamContext() can tell
// the agent what's on screen (a hint only — the agent answers from the DB).
const samActive = { school: null, stall: null, terminal: null };
window.SB = {
    mode: getMode,                                   // Demo | Live (the tour's step predicate reads it)
    openSchool: (sid) => { samActive.school = sid; return open(sid); },
    openStall: (id) => { samActive.stall = id; return openStall(STALLS, id); },
    openTerminal: (tid) => { samActive.terminal = tid; return openTerminal(STALLS, tid); },
    openStalls: (preset) => openStallExplorer(STALLS, preset),
    // Gate the data-dependent views: a SAM action or deep link that targets a view the CURRENT month
    // lacks is a no-op rather than a crash (feb/items/savings each throw on a null bundle otherwise).
    openFeb: (tab) => { if (viewAvailable('feb') && FEB) openFeb(FEB, tab); },
    openItems: (tab) => { if (viewAvailable('items')) openItems(ITEMS, tab); },
    openSavings: () => { if (viewAvailable('savings')) openSavings(SAVINGS); },
    openPlayback: (preset) => openPlayback(preset || {}),
    focusSchool: (sid) => { samActive.school = sid; flyToSchool(sid); },
};

// Open a school, then fly the map to it + pulse its dot — used by list rows and search. Open first: docking
// the school pads the map, and the fly-to carries that padding so the school lands in the visible part.
function flyToSchool(sid) {
    open(sid);
    const s = SCHOOLS[sid], el = markerEls.get(sid);
    if (s?.lat != null && map) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 14), padding: mapPad });
    if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
}

// The drawer covers the map's right edge (or its bottom, as a sheet): pad the map so centring and fly-to land
// in the visible part, and fold SAM to its rail when a view opens — the two share the right edge.
let mapPad = { right: 0, bottom: 0 };
addEventListener('dock', (e) => {
    const { pushed, right, bottom } = e.detail;
    mapPad = { right, bottom };
    map?.easeTo({ padding: mapPad, duration: 300 });
    if (pushed) setSamExpanded(false);
    syncRings();
});
// One "selected" ring: the school shown in the drawer right now (gone once you leave it). Also drop hover rings whose
// row/card vanished under the pointer — a removed element never fires mouseout.
function syncRings() {
    const top = document.querySelector('#dock .tw:not(.under)')?.dataset.win;
    for (const [sid, el] of markerEls) { el.classList.remove('hl'); el.classList.toggle('open', top === `school-${sid}`); }
}

// Linked hover: any drawer row tagged data-sid lights up that school's dot, and hovering a dot lights its
// rows (rowsOf). One delegated listener covers every view, present and future.
const rowsOf = (sid) => document.querySelectorAll(`#dock [data-sid="${CSS.escape(sid)}"], #compare-row [data-sid="${CSS.escape(sid)}"]`);
for (const el of [document.getElementById('dock'), document.getElementById('compare-row')])
    for (const [type, on] of [['mouseover', true], ['mouseout', false]]) {
        el.addEventListener(type, (e) => {
            const r = e.target.closest('[data-sid]');
            if (r && !r.contains(e.relatedTarget)) markerEls.get(r.dataset.sid)?.classList.toggle('hl', on);
        });
    }
// Compare (compare.js): pinned items get their letter + colour ring on their marker (school dot or vendor shop).
setCompareData(() => ({ schools: SCHOOLS, stalls: STALLS, mode: colorMode }));
let pins = [];
addEventListener('compare', (e) => {
    pins = e.detail;
    paintPins();
    fitPinned(pins);
    setHash('pins', pinsParam());
    if (pins.length >= 2) tick('compare');
});
function paintPins() {     // also after the markers are redrawn (paintVendors)
    for (const el of document.querySelectorAll('.maplibregl-marker[data-cmp]')) { delete el.dataset.cmp; el.style.removeProperty('--cmp'); }
    for (const { sid, shop, L, c } of pins) {
        const el = shop ? document.querySelector(`[data-shop="${CSS.escape(shop)}"]`) : markerEls.get(sid);
        if (!el) continue;
        if (!el.dataset.cmp) el.style.setProperty('--cmp', c);
        el.dataset.cmp = (el.dataset.cmp || '') + L;
    }
    syncRings();
}
// Zoom to fit every pin's place (compare.js: a vendor shop's own spot, else its school), clear of the tray and the drawer.
function fitPinned(pins) {
    const pts = pins.map((p) => p.pt).filter(Boolean);
    if (!map || !pts.length) return;
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const top = document.querySelector('.maptop').getBoundingClientRect().bottom - stage.top + 24;
    const box = new maplibregl.LngLatBounds();
    pts.forEach(([lat, lng]) => box.extend([lng, lat]));
    const bottom = stage.bottom - document.querySelector('.mapbl').getBoundingClientRect().top + 16;   // clear of legend + checklist
    // MapLibre adds the map's own padding (the drawer, mapPad) on top of this, so only the margins go here.
    map.fitBounds(box, { padding: { top, right: 40, bottom, left: 60 }, maxZoom: 15, duration: 800 });
}
// Rows/cards acting as buttons (role="button") open on Enter/Space like real buttons.
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"]:not(button)')) {
        e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey }));
    }
});

// Snapshot of dashboard state sent with each SAM query (role + what's open).
function buildSamContext() {
    return {
        source: 'smart-buddy-frontend',
        scope: curMonth ? `month ${curMonth}` : 'no data loaded',
        role: role || 'all',
        mode: getMode(),
        viewing: { school: samActive.school, stall: samActive.stall, terminal: samActive.terminal },
        hash: location.hash || null,
    };
}

/* ---------- map ---------- */
let map = null;
try {
    map = new maplibregl.Map({
        container: 'map',
        attributionControl: { compact: true },   // OneMap terms require the SLA attribution
        style: {
            version: 8,
            // OneMap (SLA) — keyless; Carto's CDN now serves "API KEY REQUIRED" tiles. Singapore-only, z11–19.
            sources: { onemap: { type: 'raster',
                tiles: ['https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png'],
                tileSize: 256, minzoom: 11, maxzoom: 19,
                attribution: '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:20px;width:20px;vertical-align:middle" alt="OneMap"> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> ©2026 contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>' } },
            layers: [
                // OneMap's sea grey — tiles it skips (open sea at high zoom) blend in instead of showing white
                { id: 'sea', type: 'background', paint: { 'background-color': '#d1d1d1' } },
                // wash the basemap out to neutral grey so the coloured school dots stand out
                { id: 'onemap', type: 'raster', source: 'onemap',
                  paint: { 'raster-saturation': -1, 'raster-brightness-min': 0.25, 'raster-contrast': -0.2 } },
            ],
        },
        center: [103.832, 1.352],
        zoom: 11.15,
        minZoom: 11,   // no OneMap tiles below z11 — stop users zooming out to a blank map
        maxBounds: [[103.58, 1.12], [104.16, 1.494]],   // OneMap's tiled area — no dragging off into blank
        // a flat 2D map: no rotate or tilt by mouse (right/Ctrl-drag), touch or keyboard (Shift+arrows), no compass
        dragRotate: false, touchPitch: false, pitchWithRotate: false, maxPitch: 0,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
} catch (e) {
    // no WebGL (headless / old GPU) — the windows and search still work
    console.warn('Map unavailable:', e.message);
}

// good / warn / bad in Errors & Speed mode (null in Level mode). 'bad' also gets a dark ring (.alert),
// so status never relies on colour alone.
function markerSev(s) {
    if (colorMode === 'errors') return SEV(s.err_pct, 5, 10);
    if (colorMode === 'speed') return SEV(s.med_ms, 2500, 4000);
    return null;
}
function markerColor(s) {
    const sev = markerSev(s);
    return sev === 'none' ? NODATA : sev ? ST[sev] : LV_COLOR[s.level] || LV_COLOR.Other;
}
function markerSize(s) {
    const v = s.spend_day || 2;
    return Math.max(9, Math.min(24, 4 + v * 3));
}
function paintMarkers() {
    for (const [sid, el] of markerEls) {
        const s = SCHOOLS[sid];
        el.style.background = markerColor(s);
        el.classList.toggle('alert', markerSev(s) === 'bad');
    }
    for (const [mk, s] of vendorMarkers) {
        mk.getElement().style.setProperty('--c', markerColor(s));
        mk.getElement().classList.toggle('alert', markerSev(s) === 'bad');
    }
    renderLegend();
}
function setColorMode(m) { colorMode = m; paintMarkers(); followMap(m); }   // the comparison's topic follows the map
addEventListener('compare-topic', (e) => { if (colorMode !== e.detail) setColorMode(e.detail); });   // …and the map follows it

if (map) map.on('load', () => { mapReady = true; rebuildMap(); });
else renderLegend();

// Shift+mousedown on the map starts MapLibre's box-zoom, which swallows the click — keep it off the dots so
// Shift-click pins (Shift-drag on empty map still box-zooms).
const noBoxZoom = (e) => { if (e.shiftKey) e.stopPropagation(); };

// (Re)draw the school markers for the current month's SCHOOLS — called on load + on month switch.
function rebuildMap() {
    if (!map || !mapReady) return renderLegend();
    for (const mk of markers.values()) mk.remove();
    markers.clear(); markerEls.clear();
    for (const s of Object.values(SCHOOLS)) {
        if (s.lat == null) continue;
        const el = document.createElement('div');
        el.className = 'mk';
        const d = markerSize(s);
        el.style.cssText = `width:${d}px;height:${d}px;background:${markerColor(s)}${layersOn.has(s.level) ? '' : ';display:none'}`;
        if (markerSev(s) === 'bad') el.classList.add('alert');
        el.title = `${s.name || s.id} — $${s.spend_day ?? '?'} /day · Shift-click to compare`;
        el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `Open ${el.title}`);
        el.addEventListener('mousedown', noBoxZoom);
        el.addEventListener('click', (e) => { e.stopPropagation();
            if (e.shiftKey || e.ctrlKey || e.metaKey) toggleCompare('school', s); else open(s.id); });
        // hover a dot → light up that school's rows in the drawer (and the reverse, see the dock listener above)
        el.addEventListener('mouseenter', () => rowsOf(s.id).forEach((r) => r.classList.add('hl')));
        el.addEventListener('mouseleave', () => rowsOf(s.id).forEach((r) => r.classList.remove('hl')));
        const mk = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
        markers.set(s.id, mk); markerEls.set(s.id, el);
    }
    paintVendors();
    renderLegend();                  // after the markers, so the layer counts are current
}

const pbsShops = () => STALLS.stalls.filter((st) => st.school === 'PBS');
const placed = (school) => STALLS.stalls.filter((st) => st.school === school && st.at);   // st.at = [lat, lng, name]
// A vendor shop is coloured like a school: level of its host school, errors/speed of its own machine.
// ponytail: busiest machine's figures only (1–2 shops have a second one); merge them if that grows.
function vendorStat(st) {
    const t = STALLS.terminals.filter((x) => st.terms.includes(x.id)).sort((a, b) => b.n - a.n)[0] || {};
    return { level: SCHOOLS[st.host || st.campus?.[0]]?.level, err_pct: t.err_pct, med_ms: t.med_ms };
}
function paintVendors() {
    vendorMarkers.splice(0).forEach(([m]) => m.remove());
    if (!map || !mapReady) return;
    for (const [id, v] of Object.entries(VENDOR)) {
        if (!layersOn.has(id)) continue;
        for (const st of placed(v.school)) {
            const el = document.createElement('div');
            el.className = v.cls;
            el.dataset.shop = st.id;          // compare badge target (paintPins)
            const s = vendorStat(st);
            el.style.setProperty('--c', markerColor(s));
            if (markerSev(s) === 'bad') el.classList.add('alert');
            el.title = `${st.name} — $${st.rev.toLocaleString('en-SG')} · ${st.n.toLocaleString('en-SG')} txns · Shift-click to compare`;
            el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `Open ${el.title}`);
            el.addEventListener('mousedown', noBoxZoom);
            el.addEventListener('click', (e) => { e.stopPropagation();
                if (e.shiftKey || e.ctrlKey || e.metaKey) toggleCompare('stall', st); else window.SB.openStall(st.id); });
            vendorMarkers.push([new maplibregl.Marker({ element: el, offset: v.offset }).setLngLat([st.at[1], st.at[0]]).addTo(map), s]);
        }
    }
    paintPins();
}

// Show/hide a layer from its legend row; never zero layers; kept in the URL hash (#layers=…) so a view is shareable.
function toggleLayer(id) {
    if (!layersOn.delete(id)) layersOn.add(id);
    if (!layersOn.size) layersOn.add(id);
    applyLayers();
}
function applyLayers() {
    for (const [sid, el] of markerEls) el.style.display = layersOn.has(SCHOOLS[sid].level) ? '' : 'none';
    paintVendors(); renderLegend();
    setHash('layers', isDefaultLayers() ? '' : [...layersOn].join(','));
}
const isDefaultLayers = () => layersOn.size === DEFAULT_LAYERS.length && DEFAULT_LAYERS.every((x) => layersOn.has(x));

/* ---------- per-month data loading ---------- */
let loadSeq = 0;
// Returns false when a newer loadMonth() started meanwhile (fast month switching): its data must not land.
async function loadMonth(m) {
    const seq = ++loadSeq;
    curMonth = m;
    closeAll(); clearCompare();      // open views + pins hold the old month's data
    if (!m) {
        GLOBAL = {}; SCHOOLS = {}; STALLS = { stalls: [], terminals: [] };
        FEB = ITEMS = SAVINGS = null; curKinds = [];
        rebuildMap(); return;
    }
    localStorage.setItem('sb-month', m);
    const kinds = MONTHS.find((x) => x.month === m)?.kinds || [];
    setPlaybackMonth(m);
    const opt = (k) => kinds.includes(k) ? fetchBundle(m, k).catch(() => null) : null;
    const [g, sc, st, feb, items, sav] = await Promise.all([
        fetchBundle(m, 'global').catch(() => ({})),
        fetchBundle(m, 'schools').catch(() => ({ schools: {} })),
        fetchBundle(m, 'stalls').catch(() => ({ stalls: [], terminals: [] })),
        opt('wearable'), opt('items'), opt('savings'),
    ]);
    if (seq !== loadSeq) return false;
    curKinds = kinds;
    GLOBAL = g || {}; SCHOOLS = (sc && sc.schools) || {}; STALLS = st || { stalls: [], terminals: [] };
    FEB = feb; ITEMS = items; SAVINGS = sav;
    closeAll(); clearCompare();      // anything opened on the old markers while this month was loading
    rebuildMap();
}

/* ---------- boot: months → data → role + deep links ---------- */
async function boot() {
    MONTHS = await fetchMonths().catch(() => []);
    const saved = localStorage.getItem('sb-month');
    curMonth = MONTHS.find((x) => x.month === saved)?.month || MONTHS.at(-1)?.month || null;
    colorMode = ROLE_COLOR[role] || 'level';         // saved role's default colouring, before the first paint
    await loadMonth(curMonth);
    renderNav();

    const h = location.hash;
    const mRole = h.match(/role=(\w+)/);
    const mSchool = h.match(/school=([A-Za-z]+)/);
    const mStall = h.match(/stall=([\w.]+)/);
    const mTerm = h.match(/terminal=([\w-]+)/);
    const mFeb = h.match(/feb(?:=(\w+))?/);
    const mItems = h.match(/items(?:=(\w+))?/);
    const mSav = h.match(/savings/);
    const mPlay = h.match(/playback/);
    if (mRole && ROLES[mRole[1]]) setRole(mRole[1]);
    if (mSchool) open(mSchool[1].toUpperCase());
    if (mStall) openStall(STALLS, mStall[1]);
    if (mTerm) openTerminal(STALLS, mTerm[1]);
    if (mFeb && viewAvailable('feb')) openFeb(FEB, mFeb[1]);
    if (mItems && viewAvailable('items')) openItems(ITEMS, mItems[1]);
    if (mSav && viewAvailable('savings')) openSavings(SAVINGS);
    if (mPlay) openPlayback({});
    const mPins = linkPins && restorePins(linkPins) >= 2;
    if (mPins) { openCompare(); map?.once('moveend', () => fitPinned(pins)); }   // the drawer's padding ease cancels the first fit
    const openedByLink = mSchool || mStall || mTerm || (mFeb && viewAvailable('feb')) ||
        (mItems && viewAvailable('items')) || (mSav && viewAvailable('savings')) || mRole || mPlay || mPins;
    if (!openedByLink) {
        if (role) openFirstAvailable(role);
        else if (localStorage.getItem('sb-hub-seen')) openFirstAvailable(null);   // skipped the picker before
        else openHub(pickRole, tour);                  // first visit: pick a workspace, skip, or take the tour
    }
    if (localStorage.getItem('sb-hub-seen')) initOnboarding();
}
boot();

function open(sid) {
    const s = SCHOOLS[sid];
    if (!s) return;
    openSchool(s, GLOBAL, STALLS);
    tick('school');
}

/* ---------- legend = map key + layer filter ---------- */
// One panel instead of pills + legend (Esri interactive legend): colour-by switch, then every layer as a show/hide row
// with its count. Collapses to a button (remembered per viewer); "Reset" appears only when the view isn't the default.
let legendOpen = localStorage.getItem('sb-legend') !== '0';
function renderLegend() {
    const lg = document.getElementById('legend');
    const unmapped = Object.values(SCHOOLS).filter((s) => s.lat == null).length;
    const changed = !isDefaultLayers() || colorMode !== (ROLE_COLOR[role] || 'level');
    lg.classList.toggle('closed', !legendOpen);
    const head = `<button class="lg-head" aria-expanded="${legendOpen}">Map key${changed ? ' <span class="lg-badge">filtered</span>' : ''}
      <span class="lg-chev" aria-hidden="true">${legendOpen ? '▾' : '▴'}</span></button>`;
    let body = '';
    if (legendOpen) {
        const modes = [['level', 'Level'], ['errors', 'Errors'], ['speed', 'Speed']];
        const band = (c, t, cls = '') => `<div class="li"><span class="dot ${cls}" style="background:${c}"></span>${t}</div>`;
        let scale = colorMode === 'errors' ? band(ST.good, '&lt; 5% errors') + band(ST.warn, '5 – 10%') + band(ST.bad, '&gt; 10%', 'alert')
            : colorMode === 'speed' ? band(ST.good, 'median &lt; 2.5s') + band(ST.warn, '2.5 – 4s') + band(ST.bad, '&gt; 4s', 'alert') : '';
        if ([...Object.values(SCHOOLS).filter((s) => s.lat != null), ...vendorMarkers.map(([, s]) => s)]
            .some((s) => markerSev(s) === 'none')) scale += band(NODATA, 'No data');
        const n = (l) => VENDOR[l.id] ? placed(VENDOR[l.id].school).length
            : Object.values(SCHOOLS).filter((s) => s.level === l.id && s.lat != null).length;
        const tip = { pbs: 'Pacific Bookstores shops beside their host school. Square colour follows the colour-by switch (host school level; own machine for errors/speed).',
                      stamps: 'POSB Smiley Stamp machines beside their school (savings, not spending). Same colouring as bookstores.' };
        body = `<div class="lg-label">Colour by</div>
          <div class="mode">${modes.map(([k, t]) => `<button data-mode="${k}" class="${colorMode === k ? 'on' : ''}" aria-pressed="${colorMode === k}">${t}</button>`).join('')}</div>
          ${scale}
          <div class="lg-label">Show ${info('Dot size = spend per card per day. Click a row to show or hide it on the map.')}</div>
          ${LAYERS.map((l) => { const on = layersOn.has(l.id);
              const mark = l.shape ? `<span class="dot ${l.shape}"></span>` : `<span class="dot" style="background:${colorMode === 'level' ? l.color : 'transparent'}"></span>`;
              return `<div class="lg-line"><button class="lg-row${on ? ' on' : ''}" data-l="${l.id}" aria-pressed="${on}">
                <span class="lg-check" aria-hidden="true">${on ? '✓' : ''}</span>${mark}${l.label}<span class="fn">${n(l)}</span></button>
                ${tip[l.id] ? info(tip[l.id]) : ''}${l.id === 'pbs' ? '<button class="lg-link" id="books-btn" title="List every PBS bookshop">list</button>' : ''}</div>`; }).join('')}
          ${unmapped ? `<div class="foot"><button id="unmapped-btn">${unmapped} school${unmapped > 1 ? 's' : ''} not on the map</button></div>` : ''}
          ${changed ? '<button class="lg-reset">Reset view</button>' : ''}`;
    }
    lg.innerHTML = head + body;
    lg.querySelector('.lg-head').addEventListener('click', () => {
        legendOpen = !legendOpen; localStorage.setItem('sb-legend', legendOpen ? '1' : '0'); renderLegend(); });
    lg.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setColorMode(b.dataset.mode)));
    lg.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => toggleLayer(b.dataset.l)));
    lg.querySelector('#unmapped-btn')?.addEventListener('click', openUnmapped);
    lg.querySelector('#books-btn')?.addEventListener('click', openBookstores);
    lg.querySelector('.lg-reset')?.addEventListener('click', () => {
        layersOn = new Set(DEFAULT_LAYERS); setColorMode(ROLE_COLOR[role] || 'level'); applyLayers(); });
}

// Bookstores window: shops needing a decision first (highlighted), then placed shops. Every reviewed
// placement/flag carries its evidence (backend/ingestion-service/pbs_hosts.csv) in an ⓘ tip.
const STATUS = { highlight: ['pill-warn', 'Primary/secondary conflict'], unlink: ['pill-warn', 'Not confirmed'],
                 ask: ['pill-bad', 'Not identified'] };
function openBookstores() {
    import('./windowing.js').then(({ openWindow }) => {
        const shops = pbsShops().sort((a, b) => b.rev - a.rev);
        const body = openWindow({ id: 'bookstores', title: 'Pacific Bookstores (PBS)',
            sub: `${shops.length} school bookshops`, chips: [] });
        if (!body) return;
        const fmt = (n) => Number(n).toLocaleString('en-SG');
        const todo = shops.filter((st) => !st.host), done = shops.filter((st) => st.host);
        const head = `<tr><th>Shop</th><th>School</th><th style="text-align:right">Txns</th>
          <th style="text-align:right">Revenue</th><th style="text-align:right">Stamps</th></tr>`;
        const nums = (st) => `<td class="num">${fmt(st.n)}</td><td class="num">$${fmt(st.rev)}</td>
          <td class="num">${st.stamp ? '$' + fmt(st.stamp) : '–'}</td>`;
        const school = (st) => {
            const s = SCHOOLS[st.host];
            const ev = st.evidence ? info(st.evidence) : '';
            if (s) return `<a href="#" data-sid="${esc(s.id)}">${esc(s.name || s.id)}</a>${ev}`;
            return `${esc(st.at?.[2] || st.host)} <span class="chip chip-other">bookshop only</span>${ev}`;
        };
        const flag = (st) => { const [cls, txt] = STATUS[st.status] || STATUS.ask;
            const cand = SCHOOLS[st.candidate];
            return `<span class="${cls}">${txt}</span>${cand ? ` likely ${esc(cand.name)}` : ` (name says “${esc(st.code || '?')}”)`}
              ${info(st.evidence || 'The code in the shop name is not one of our school IDs, and no reviewed decision exists yet.')}`; };
        body.innerHTML = `<div class="cap" style="margin-bottom:8px">Each shop is placed at its school only when the evidence
          agrees ${info(`The feed files every shop under vendor ID PBS and names it "Pacific Bookstores - <code>". A shop is
          placed when that code is exactly one of our school IDs and card data agrees, or after a reviewed decision with
          sources (PBS directory, MOE list, POSB list, card data). Bookshop sales are not counted in canteen figures.
          Stamps = POSB Smiley Stamps sold (savings, not purchases).`)}</div>
          ${todo.length ? `<h5>Needs a decision (${todo.length})</h5><table class="mini">${head}
            ${todo.map((st) => `<tr class="click" role="button" tabindex="0" data-stall="${esc(st.id)}"><td>${esc(st.name)}</td><td>${flag(st)}</td>${nums(st)}</tr>`).join('')}
          </table>` : ''}
          <h5>Placed (${done.length})</h5><table class="mini">${head}
            ${done.map((st) => `<tr class="click" role="button" tabindex="0" data-stall="${esc(st.id)}"><td>${esc(st.name)}</td><td>${school(st)}</td>${nums(st)}</tr>`).join('')}
          </table>`;
        body.querySelectorAll('tr[data-stall]').forEach((tr) =>
            tr.addEventListener('click', (e) => { if (!e.target.closest('.info')) window.SB.openStall(tr.dataset.stall); }));
        body.querySelectorAll('a[data-sid]').forEach((a) =>
            a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(a.dataset.sid); }));
    });
}

function openUnmapped() {
    import('./windowing.js').then(({ openWindow }) => {
        const body = openWindow({ id: 'unmapped', title: 'Schools without a map position',
            sub: 'ID not confidently matched to the MOE directory', chips: [] });
        if (!body) return;
        const rows = Object.values(SCHOOLS).filter((s) => s.lat == null)
            .sort((a, b) => b.n - a.n);
        body.innerHTML = `<div class="cap" style="margin-bottom:8px">In rankings and search, just no map marker ${info(`Matching
          used acronym inference against the MOE school directory; ambiguous IDs were left unmapped rather than guessed.`)}</div>
          <table class="mini"><tr><th>ID</th><th>Level</th><th style="text-align:right">Txns</th>
          <th style="text-align:right">$/day</th></tr>
          ${rows.map((s) => `<tr class="click" role="button" tabindex="0" data-sid="${s.id}"><td><b>${s.id}</b></td>
            <td>${s.level}</td><td class="num">${s.n.toLocaleString()}</td>
            <td class="num">${s.spend_day ? '$' + s.spend_day.toFixed(2) : '–'}</td></tr>`).join('')}</table>
          ${rows.length ? '' : '<div class="note-box">Every school this month has a map position.</div>'}`;
        body.querySelectorAll('tr[data-sid]').forEach((tr) =>
            tr.addEventListener('click', () => open(tr.dataset.sid)));
    });
}

/* ---------- SAM data assistant (chat over the ClickHouse store, month-aware, via the mesh) ---------- */
// Additive + fully optional: with no VITE_SOLACE_*/VITE_SAM_* env set, the panel
// renders and simply shows "offline" — the rest of the app is unaffected.
initSolace();
initSam();
initSamPanel(buildSamContext);
setSamMode(getMode());          // route the chat to the active mode's agent
setSamPanelMode(getMode());     // and name it in the panel header
document.addEventListener('smartbuddy:sam-ask', () => tick('sam'));

/* ---------- opt-in tours (tour.js): ▾ menu → Tours, checklist, first-visit picker, "▶ Tour" on a view — never by themselves ---------- */
// Chapters this viewer can take: the shared ones + the views in their workspace that this month has (Playback always).
function tourKeys() {
    const views = new Set([...(role ? ROLES[role].views : Object.keys(VIEWS)), 'playback'].filter((k) => VIEWS[k] && viewAvailable(k)));
    return Object.keys(CHAPTERS).filter((k) => !CHAPTERS[k].view || views.has(k));
}
// Tours work on real schools picked for the role: Engineering → most errors; others → biggest spender per card.
function tour(key = 'basics') {
    const ok = Object.values(SCHOOLS).filter((s) => s.lat != null && s.n >= 1000 && layersOn.has(s.level));
    const [s, s2] = ok.sort((a, b) => role === 'eng' ? b.err_pct - a.err_pct : b.spend_day - a.spend_day);
    if (!s) return;
    const pin = (x) => { if (x && (!pinnedKind() || pinnedKind() === 'school') && !isPinned('school', x.id)) toggleCompare('school', x); };
    startTour(key, {
        marker: () => markerEls.get(s.id),
        // MapLibre skips the flight under prefers-reduced-motion (not `essential`); the timeout covers "already there".
        show: () => new Promise((done) => { if (!map) return done(); map.once('moveend', done); setTimeout(done, 1600);
            map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 13), padding: mapPad }); }),
        colour: (m) => setColorMode(m || ROLE_COLOR[role] || 'level'),
        open: () => open(s.id),
        openStall: () => { const st = STALLS.stalls.find((x) => x.school === s.id); if (st) openStall(STALLS, st.id); },
        pin: (n) => pin(n === 2 ? s2 : s),
        compare: () => { if (pins.length >= 2) openCompare(); },
        view: (k) => VIEWS[k].open(),
        sam: setSamExpanded,
        upload: (on) => { if (getMode() === 'live') return;   // no upload in Live (its tour step is hidden too)
            const x = document.querySelector('.up-overlay.show .up-x');
            if (on && !x) openUpload(onUploaded); else if (!on) x?.click(); },
    }, tourKeys());
}
document.addEventListener('smartbuddy:tour', (e) => tour(e.detail || 'basics'));
// "?" opens the Keyboard & mouse list — not while typing, nor during the tour.
addEventListener('keydown', (e) => {
    if (e.key === '?' && !e.target.closest?.('input, textarea, select') && !document.querySelector('.tour-card')) {
        e.preventDefault(); openShortcuts(); }
});

/* ---------- unified search: schools + stalls + machines ---------- */
// Keyboard: ↑ ↓ move through results, Enter opens (the first one if none is chosen), Esc closes (combobox pattern).
const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('search-results');
let active = -1;
const setOpen = (on) => {
    resultsEl.classList.toggle('open', on); searchEl.setAttribute('aria-expanded', on);
    if (!on) { active = -1; searchEl.removeAttribute('aria-activedescendant'); }
};
searchEl.addEventListener('keydown', (e) => {
    const rows = [...resultsEl.querySelectorAll('[data-i]')], open = resultsEl.classList.contains('open');
    if (e.key === 'Escape' && open) { setOpen(false); return; }
    if (!open || !rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = e.key === 'ArrowDown' ? (active + 1) % rows.length : (active <= 0 ? rows.length : active) - 1;
        rows.forEach((r, i) => r.setAttribute('aria-selected', i === active));
        searchEl.setAttribute('aria-activedescendant', rows[active].id);
        rows[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); rows[Math.max(active, 0)].click(); }
});
searchEl.addEventListener('input', () => {
    const qy = searchEl.value.trim().toLowerCase();
    active = -1; searchEl.removeAttribute('aria-activedescendant');
    if (qy.length < 2) { setOpen(false); return; }
    const hits = [];
    for (const s of Object.values(SCHOOLS)) {
        if (s.id.toLowerCase().includes(qy) || (s.name || '').toLowerCase().includes(qy))
            hits.push({ t: 'school', id: s.id, main: s.id, sub: `${s.name || 'unmatched'} · ${s.level}` });
        if (hits.length >= 6) break;
    }
    for (const st of STALLS.stalls) {
        if (hits.length >= 10) break;
        if (st.name.toLowerCase().includes(qy) || st.id.toLowerCase().includes(qy))
            hits.push({ t: 'stall', id: st.id, main: st.name, sub: `stall · ${st.school} · ${st.cat}` });
    }
    for (const tm of STALLS.terminals) {
        if (hits.length >= 12) break;
        if (tm.id.toLowerCase().includes(qy))
            hits.push({ t: 'terminal', id: tm.id, main: '…' + tm.id.slice(-14), sub: `machine · ${tm.storeName || ''} · ${tm.school}` });
    }
    resultsEl.innerHTML = hits.map((h, i) =>
        `<div class="row" role="option" id="sr-${i}" aria-selected="false" data-i="${i}"><b>${esc(h.main)}</b><span>${esc(h.sub)}</span></div>`).join('')
        || '<div class="row"><span>No matches</span></div>';
    setOpen(true);
    resultsEl.querySelectorAll('[data-i]').forEach((r) =>
        r.addEventListener('click', () => {
            const h = hits[+r.dataset.i];
            setOpen(false); searchEl.value = '';
            if (h.t === 'school') flyToSchool(h.id);
            else if (h.t === 'stall') openStall(STALLS, h.id);
            else openTerminal(STALLS, h.id);
        }));
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-results') && e.target !== searchEl) setOpen(false);
});
