// SMART Buddy insights app — the frame (central-specs capability dashboard-shell): the Singapore map, the top bar
// (month, search, Ask, menu), one list of views (the rail on wide and compact screens, the tab bar and More on
// phones), and the views in the drawer (windowing.js). Workspaces filter the list of views (F&B / Engineering /
// Management); everything is deep-linkable and cross-linked (school ↔ stall ↔ machine).
import maplibregl from 'maplibre-gl';
import { fetchMonths, fetchBundle, monthLabel } from './sbData.js';
import { ST, LV_COLOR, C, token } from './charts.js';
import { openSchool } from './school-window.js';
import { openSchools } from './schools-window.js';
import { openOverview, monthFigures } from './overview-window.js';
import { openFeb } from './feb-window.js';
import { openStallExplorer, openStall } from './stall-window.js';
import { openEng, openTerminal } from './eng-window.js';
import { openItems } from './items-window.js';
import { openSavings } from './savings-window.js';
import { openSubsidy } from './subsidy-window.js';
import { ROLES } from './roles.js';
import { openPlayback, setPlaybackMonth } from './playback-window.js';
import { authUser, logout } from './auth.js';
import { initSam } from './sam/samClient.js';
import { initSamPanel, setChatOpen, isChatOpen, replay as chatReplay } from './sam/samPanel.js';
import { openWindow, closeAll, openIds, setViewMonth, info, esc } from './windowing.js';
import { setCompareData, clearCompare, toggle as toggleCompare, followMap, pinnedKind, isPinned, pinsParam, restorePins, openDetail as openCompare } from './compare.js';
import { startTour, openTours, CHAPTERS } from './tour.js';
import { openShortcuts } from './shortcuts.js';
import { initOnboarding, tick } from './onboard.js';
import { icon, tableCard, money, big, pct, fmt } from './ui.js';

// This module only runs once the viewer is signed in: entry.js imports it after the CIAM login
// (auth.js) settles, so the map, the data calls and the chat never start behind the login.

const PHONE = matchMedia('(max-width: 719px)');
const stage = document.getElementById('stage');
const SEV =(v, warn, bad) => (v == null ? 'none' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'good');
const NODATA = ST.none;      // Errors/Speed mode: a school or shop without that figure — grey, never "good"
let colorMode = 'level';
// Each workspace opens on the colouring it acts on: Engineering → error rate; F&B / Management → level.
const ROLE_COLOR = { eng: 'errors' };
const vendorMarkers = [];
// Map filter — stackable show/hide rows in the Map key, never zero, kept in the URL hash (#layers=…) so a view is
// shareable. Vendor layers place a stall beside its host school only where build_insights set `host` (fact-only).
const VENDOR = { pbs: { school: 'PBS', cls: 'mk-book', offset: [9, -9] },
                 stamps: { school: 'SSSTM', cls: 'mk-stamp', offset: [-9, -9] } };
const LAYERS = [
    ...Object.entries(LV_COLOR).map(([id, color]) => ({ id, label: id, color })),
    { id: 'pbs', label: 'PBS Bookstores', color: C.books, shape: 'sq' },
    { id: 'stamps', label: 'Stamp points', color: C.save, shape: 'dia' },
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

const markerEls = new Map();
const markers = new Map();
let mapReady = false;

/* ---------- per-month data (fetched from the read API over the Postgres serving store) ---------- */
// These start empty and are (re)filled by loadMonth() from the insight bundles. Windows receive
// them as arguments at open time, so switching month + reopening a view shows the new month.
let GLOBAL = {}, SCHOOLS = {}, FEB = null, STALLS = { stalls: [], terminals: [] }, ITEMS = null, SAVINGS = null, SUBSIDY = null;
let MONTHS = [];                 // [{month, kinds}]
let curMonth = null, curKinds = [];

/* ---------- the views: one list, in this order (rail, tab bar + More) ---------- */
// `kind` = the insight bundle a view needs; a view whose bundle the month lacks stays in the list, dimmed
// ("Not in ‹Month Year›") and does not open. Overview, Schools, Terminals and Playback need only the base bundles.
const VIEWS = {
    overview: { label: 'Overview',   title: 'Network Overview',      kind: 'global',   open: () => openOverview(GLOBAL, SCHOOLS, FEB?.special, STALLS) },
    schools:  { label: 'Schools',    title: 'Schools',               kind: 'schools',  open: (p) => openSchools(SCHOOLS, p || {}) },
    eng:      { label: 'Terminals',  title: 'Terminal Health',       kind: 'stalls',   open: (p) => openEng(STALLS, p || {}) },
    subsidy:  { label: 'Subsidies',  title: 'SSS Subsidies',         kind: 'subsidy',  open: (p) => openSubsidy(SUBSIDY, p) },
    items:    { label: 'Purchases',  title: 'Purchases & Nutrition', kind: 'items',    open: (p) => openItems(ITEMS, p) },
    savings:  { label: 'Savings',    title: 'Saving vs Spending',    kind: 'savings',  open: (p) => openSavings(SAVINGS, p) },
    feb:      { label: 'Wearables',  title: 'Wearables & Health',    kind: 'wearable', open: (p) => openFeb(FEB, p) },
    playback: { label: 'Playback',   title: 'Timeline playback',     kind: null,       open: (p) => openPlayback(p || {}) },
};
const ORDER = Object.keys(VIEWS);
const TABS = ['overview', 'schools', 'eng'];               // the phone's tab bar, between Map and More
// Which list entry a drawer view belongs to (the current one is marked).
const VIEW_OF = (id) => (id === 'route' ? 'eng' : VIEWS[id] ? id : null);
const viewAvailable = (k) => VIEWS[k].kind == null || curKinds.includes(VIEWS[k].kind);
let role = ROLES[localStorage.getItem('sb-role')] ? localStorage.getItem('sb-role') : null;
const username = authUser();     // who is signed in (menu); null when the login is disabled
const listKeys = () => ORDER.filter((k) => k === 'playback' || !role || ROLES[role].views.includes(k));
const notIn = () => `Not in ${monthLabel(curMonth)}`;
const shortMonth = (m) => { const [y, mo] = String(m).split('-'); return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo]} ${y}`; };

function openView(k, preset) {
    if (!VIEWS[k] || !viewAvailable(k)) return false;
    closeSheets();
    VIEWS[k].open(preset);
    return true;
}
function setRole(r, openPrimary = true) {
    role = ROLES[r] ? r : null;
    if (role) localStorage.setItem('sb-role', role); else localStorage.removeItem('sb-role');
    setColorMode(ROLE_COLOR[role] || 'level');
    renderNav();
    if (openPrimary) openFirstAvailable();
}
// Open the workspace's primary view, or the first view this month has.
function openFirstAvailable() {
    const wanted = role ? [ROLES[role].primary, ...listKeys()] : listKeys();
    openView(wanted.find((v) => VIEWS[v] && viewAvailable(v)) || 'playback');
}

/* ---------- the frame: month switch, rail, tab bar + More, menu ---------- */
function renderNav() { renderMonthSwitch(); renderRail(); renderTabbar(); renderMenu(); renderKpiStrip(); syncCurrent(); }

// A segmented control for up to four months, otherwise a select; below 720 px always the select (shell.css).
function renderMonthSwitch() {
    const el = document.getElementById('month-switch');
    if (!MONTHS.length) { el.innerHTML = ''; return; }
    const few = MONTHS.length <= 4;
    el.innerHTML = (few ? `<div class="seg month-seg" role="group" aria-label="Data month">${MONTHS.map((m) =>
        `<button type="button" data-month="${m.month}" aria-pressed="${m.month === curMonth}">${shortMonth(m.month)}</button>`).join('')}</div>` : '') +
        `<select class="month-select${few ? ' month-sel-phone' : ''}" aria-label="Data month">${MONTHS.map((m) =>
            `<option value="${m.month}"${m.month === curMonth ? ' selected' : ''}>${shortMonth(m.month)}</option>`).join('')}</select>`;
    el.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => switchMonth(b.dataset.month)));
    el.querySelector('select').addEventListener('change', (e) => switchMonth(e.target.value));
}

function railButton(k, cls) {
    const v = VIEWS[k], ok = viewAvailable(k);
    return `<button type="button" class="${cls}" data-view="${k}"${ok ? '' : ` aria-disabled="true" aria-label="${v.label}, ${notIn()}"`}
        title="${ok ? v.title : `${v.label} — ${notIn()}`}">${icon(k)}<span class="lbl">${v.label}</span>${ok ? '' : `<small>Not in ${shortMonth(curMonth).split(' ')[0]}</small>`}<span class="tip">${v.label}${ok ? '' : ` — ${notIn()}`}</span></button>`;
}
function renderRail() {
    const rail = document.getElementById('rail');
    rail.innerHTML = listKeys().map((k) => railButton(k, 'rl')).join('');
}
function renderTabbar() {
    const tb = document.getElementById('tabbar');
    tb.innerHTML = `<button type="button" class="tb" data-tab="map">${icon('map')}<span>Map</span></button>` +
        TABS.map((k) => `<button type="button" class="tb" data-tab="${k}"${viewAvailable(k) ? '' : ` aria-disabled="true" aria-label="${VIEWS[k].label}, ${notIn()}"`}>${icon(k)}<span>${VIEWS[k].label}</span></button>`).join('') +
        `<button type="button" class="tb" data-tab="more" aria-haspopup="dialog" aria-controls="more-sheet">${icon('more')}<span>More</span></button>`;
}
document.getElementById('rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b && b.getAttribute('aria-disabled') !== 'true') openView(b.dataset.view);
});
document.getElementById('tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]')?.dataset.tab;
    if (!t) return;
    if (t === 'map') { closeSheets(); setChatOpen(false); closeAll(); }
    else if (t === 'more') openMore();
    else if (viewAvailable(t)) { setChatOpen(false); openView(t); }
});

// More (phones): the views not on the tab bar, dimmed with "Not in ‹Month›" when the month lacks them.
const more = document.getElementById('more-sheet'), scrim = document.getElementById('scrim');
function openMore() {
    const keys = listKeys().filter((k) => !TABS.includes(k));
    more.innerHTML = `<h2>More views</h2>${keys.map((k) => { const ok = viewAvailable(k);
        return `<button type="button" data-view="${k}"${ok ? '' : ' aria-disabled="true"'}>${icon(k)}${VIEWS[k].label}${ok ? '' : `<small>${notIn()}</small>`}</button>`; }).join('')}`;
    more.hidden = false; scrim.hidden = false;
    document.querySelector('.tb[data-tab="more"]').setAttribute('aria-expanded', 'true');
    more.querySelector('button:not([aria-disabled])')?.focus();
}
more.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b && b.getAttribute('aria-disabled') !== 'true') { setChatOpen(false); openView(b.dataset.view); }
});
// The phone's sheets that float over the map (More, the Map key) close on the scrim, Esc, or a choice.
function closeSheets() {
    if (!more.hidden) { more.hidden = true; document.querySelector('.tb[data-tab="more"]')?.setAttribute('aria-expanded', 'false'); }
    if (stage.classList.contains('key-open')) { stage.classList.remove('key-open'); keyBtn.setAttribute('aria-expanded', 'false'); }
    scrim.hidden = true;
}
scrim.addEventListener('click', closeSheets);

// The menu: workspace, Tours, Keyboard & mouse (720 px and wider), who is signed in, Sign out.
const menu = document.getElementById('nav-menu'), menuBtn = document.getElementById('menu-btn');
function renderMenu() {
    const ws = [[null, 'All views', 'Every view'], ...Object.entries(ROLES).map(([id, r]) => [id, r.label, r.desc])];
    menu.innerHTML = `<div class="mh">Workspace</div>
      ${ws.map(([id, label, desc]) => `<button type="button" data-role="${id || ''}" aria-pressed="${(id || null) === role}">
        <span class="tick" aria-hidden="true">${(id || null) === role ? '✓' : ''}</span><span>${label}<small>${desc}</small></span></button>`).join('')}
      <hr><button type="button" data-act="tours">${icon('tours')}Tours…</button>
      <button type="button" data-act="keys" class="wide-only">${icon('keys')}Keyboard &amp; mouse<kbd>?</kbd></button>
      ${username ? `<hr><div class="who">Signed in as <b>${esc(username)}</b></div>
        <button type="button" data-act="logout">${icon('signout')}Sign out</button>` : ''}`;
}
menu.addEventListener('toggle', (e) => {                // popovers open centred; pin it under the button
    menuBtn.setAttribute('aria-expanded', e.newState === 'open');
    if (e.newState !== 'open') return;
    const r = menuBtn.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px` });
    menu.querySelector('button')?.focus();
});
menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    menu.hidePopover();
    menuBtn.focus();                                     // focus comes back to the menu button after
    if (b.dataset.role != null) setRole(b.dataset.role || null);
    else if (b.dataset.act === 'tours') openTours(tourKeys(), tour);
    else if (b.dataset.act === 'keys') openShortcuts();
    else if (b.dataset.act === 'logout') logout();
});

// Mark the list entry of the view on top of the drawer as the current one (rail, tab bar).
function syncCurrent(ids = openIds()) {
    const cur = [...ids].reverse().map(VIEW_OF).find(Boolean) || null;
    const tab = !ids.length ? 'map' : TABS.includes(cur) ? cur : cur ? 'more' : null;
    const mark = (b, on) => { if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); };
    document.querySelectorAll('#rail [data-view]').forEach((b) => mark(b, b.dataset.view === cur));
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => mark(b, b.dataset.tab === tab));
}

// The month's headline figures over the map (the same as Overview's cards).
function renderKpiStrip() {
    const el = document.getElementById('kpi-strip');
    const f = monthFigures(GLOBAL, STALLS);
    if (!f) { el.innerHTML = ''; return; }
    const chipEl = (l, v) => `<div class="kpi-chip"><span class="l">${l}</span><span class="v">${v}</span></div>`;
    el.innerHTML = chipEl('Spend', money(f.sgd)) + chipEl('Taps', big(f.txns)) + chipEl('Schools', fmt(f.schools)) +
        (f.err != null ? chipEl('Errors', pct(f.err)) : '');
}

async function switchMonth(m) {
    if (m === curMonth) return;
    if (await loadMonth(m) === false) return;
    renderNav();
    openFirstAvailable();
}

/* ---------- cross-window API (used by stall/eng/school windows + SAM actions) ---------- */
// samActive tracks the last thing the user opened so buildSamContext() can tell
// the agent what's on screen (a hint only — the agent answers from the DB).
const samActive = { school: null, stall: null, terminal: null };
window.SB = {
    openSchool: (sid) => { samActive.school = sid; return open(sid); },
    openStall: (id) => { samActive.stall = id; return openStall(STALLS, id); },
    openTerminal: (tid) => { samActive.terminal = tid; return openTerminal(STALLS, tid); },
    openStalls: (preset) => openStallExplorer(STALLS, preset),
    // Gate the data-dependent views: a SAM action or deep link that targets a view the CURRENT month
    // lacks is a no-op rather than a crash (feb/items/savings each throw on a null bundle otherwise).
    openFeb: (tab) => { if (viewAvailable('feb') && FEB) openFeb(FEB, tab); },
    openItems: (tab) => { if (viewAvailable('items')) openItems(ITEMS, tab); },
    openSavings: () => { if (viewAvailable('savings')) openSavings(SAVINGS); },
    openSubsidy: () => { if (viewAvailable('subsidy')) openSubsidy(SUBSIDY); },
    openPlayback: (preset) => openPlayback(preset || {}),
    focusSchool: (sid) => { samActive.school = sid; flyToSchool(sid); },
    // Render a captured chat exchange without the broker (README "The chat"): SB.chatReplay({ question, progress, reply })
    chatReplay: (x) => chatReplay(x),
};

// Open a school, then fly the map to it + pulse its dot — used by list rows, search, deep links and the chat.
// Open first: docking the school pads the map, and the fly-to carries that padding so the school lands in the
// visible part of the map.
function flyToSchool(sid) {
    if (!SCHOOLS[sid]) return;
    if (PHONE.matches) setChatOpen(false);
    open(sid);
    const s = SCHOOLS[sid], el = markerEls.get(sid);
    if (s?.lat != null && map) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), PHONE.matches ? 13 : 14), padding: mapPad });
    if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
}

// The drawer covers the map's right edge (or its bottom, as a sheet): pad the map so centring and fly-to land
// in the visible part. Below 1100 px a view and the chat replace each other.
let mapPad = { right: 0, bottom: 0 };
addEventListener('dock', (e) => {
    const { pushed, right, bottom, ids } = e.detail;
    mapPad = { right, bottom };
    map?.easeTo({ padding: mapPad, duration: 300 });
    if (pushed && innerWidth < 1100 && isChatOpen()) setChatOpen(false);
    syncRings(); syncCurrent(ids);
});
// One "selected" ring: the school shown in the drawer right now (gone once you leave it). Also drop hover rings whose
// row/card vanished under the pointer — a removed element never fires mouseout.
function syncRings() {
    const top = document.querySelector('#dock .tw:not(.under)')?.dataset.win;
    for (const [sid, el] of markerEls) { el.classList.remove('hl'); el.classList.toggle('open', top === `school-${sid}`); }
}

// Linked hover: any drawer row tagged data-sid lights up that school's dot while hovered or focused, and hovering
// a dot lights its rows (rowsOf). One delegated listener covers every view, present and future.
const rowsOf = (sid) => document.querySelectorAll(`#dock [data-sid="${CSS.escape(sid)}"], #compare-row [data-sid="${CSS.escape(sid)}"]`);
for (const el of [document.getElementById('dock'), document.getElementById('compare-row')])
    for (const [type, on] of [['mouseover', true], ['mouseout', false], ['focusin', true], ['focusout', false]]) {
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
    stage.classList.toggle('has-pins', pins.length > 0);
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
    const st = stage.getBoundingClientRect();
    const top = document.querySelector('.maptop').getBoundingClientRect().bottom - st.top + 24;
    const box = new maplibregl.LngLatBounds();
    pts.forEach(([lat, lng]) => box.extend([lng, lat]));
    const bottom = PHONE.matches ? 96 : st.bottom - document.querySelector('.mapbl').getBoundingClientRect().top + 16;   // clear of the key + checklist
    // MapLibre adds the map's own padding (the drawer, mapPad) on top of this, so only the margins go here.
    map.fitBounds(box, { padding: { top, right: 40, bottom, left: PHONE.matches ? 24 : 60 }, maxZoom: 15, duration: 800 });
}
// Rows/cards acting as buttons (role="button") open on Enter/Space like real buttons.
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"]:not(button)')) {
        e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey }));
    }
});

// Snapshot of dashboard state sent with each question (the month, the role, what's open). The chat route
// rebuilds the orchestrator's context hint from these fields only (central-specs capability chat-bridge).
function buildSamContext() {
    return {
        month: curMonth || undefined,
        role: role || 'all',
        viewing: { school: samActive.school, stall: samActive.stall, terminal: samActive.terminal },
    };
}
// A school's exact name or code (ignoring case) → its id, for the chat's links (sam-chat spec). Rebuilt per month.
let placeIndex = null;
function resolvePlace(text) {
    if (!placeIndex) {
        placeIndex = new Map();
        for (const s of Object.values(SCHOOLS)) { placeIndex.set(s.id.toLowerCase(), s.id); if (s.name) placeIndex.set(s.name.toLowerCase(), s.id); }
    }
    return placeIndex.get(String(text ?? '').trim().toLowerCase()) || null;
}

/* ---------- map ---------- */
// The basemap (central-specs capability basemap): OneMap Grey, washed to grey, over the washed sea's grey. Two
// frames: from 720 px zoom 11–19 within OneMap's tiled area; below 720 px zoom 9.5–19 with wider bounds, so the
// main island fits a phone, fitted to the schools. Re-applied when the width crosses 720 px.
const FRAME = { wide: { minZoom: 11, bounds: [[103.58, 1.12], [104.16, 1.494]] },
                phone: { minZoom: 9.5, bounds: [[103.40, 0.95], [104.35, 1.70]] } };
const HOME = { center: [103.832, 1.352], zoom: 11.15 };
const SEA = token('--map-sea');
let map = null;
try {
    const f = PHONE.matches ? FRAME.phone : FRAME.wide;
    map = new maplibregl.Map({
        container: 'map',
        attributionControl: { compact: true },   // OneMap terms require the SLA attribution
        style: {
            version: 8,
            // OneMap (SLA) — keyless; Carto's CDN now serves "API KEY REQUIRED" tiles. Singapore-only, z11–19.
            sources: { onemap: { type: 'raster',
                tiles: ['https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png'],
                tileSize: 256, minzoom: 11, maxzoom: 19,
                attribution: '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:20px;width:20px;vertical-align:middle" alt="OneMap"> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> ©2026 contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>' },
                // OneMap draws a "South China Sea / Pedra Branca" inset box in the open sea off the East Coast — a
                // territorial-claim mark, not geography — in its z12 tiles (3230-3231/2033) and, further south-east, in
                // its z11 tiles (1615-1616/1016-1017). Raster labels can't be switched off, so a sea-coloured polygon
                // covers each. MapLibre picks 256-px raster tiles at round(zoom + 1): z11 tiles for map zoom 9.5–10.5
                // (phones only), z12 for 10.5–11.5, z13+ (no inset) from 11.5 — so each cover shows exactly while its
                // own tiles are on screen.
                'inset-z12': { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon',
                    coordinates: [
                        [[[103.903, 1.230], [104.004, 1.230], [104.004, 1.2958], [103.903, 1.2958], [103.903, 1.230]]],     // the box and its side labels
                        [[[103.934, 1.2958], [103.976, 1.2958], [103.976, 1.3045], [103.934, 1.3045], [103.934, 1.2958]]],  // the latitude label above it, just off the East Coast shore
                    ] } } },
                'inset-z11': { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
                    coordinates: [[[103.958, 1.135], [104.112, 1.135], [104.112, 1.256], [103.958, 1.256], [103.958, 1.135]]] } } } },
            layers: [
                // OneMap's sea grey — tiles it skips (open sea, beyond its tiled area) blend in instead of showing white
                { id: 'sea', type: 'background', paint: { 'background-color': SEA } },
                // wash the basemap out to neutral grey so the coloured school dots stand out
                { id: 'onemap', type: 'raster', source: 'onemap',
                  paint: { 'raster-saturation': -1, 'raster-brightness-min': 0.25, 'raster-contrast': -0.2 } },
                // the washed sea's grey (sampled: --map-sea), each while its own tiles are on screen
                { id: 'inset-z12', type: 'fill', source: 'inset-z12', minzoom: 10.5, maxzoom: 11.5, paint: { 'fill-color': SEA } },
                { id: 'inset-z11', type: 'fill', source: 'inset-z11', maxzoom: 10.5, paint: { 'fill-color': SEA } },
            ],
        },
        center: HOME.center,
        zoom: PHONE.matches ? 10 : HOME.zoom,
        minZoom: f.minZoom,   // no OneMap tiles below z11 (map zoom 9.5) — stop users zooming out to a blank map
        maxBounds: f.bounds,
        // a flat 2D map: no rotate or tilt by mouse (right/Ctrl-drag), touch or keyboard (Shift+arrows), no compass
        dragRotate: false, touchPitch: false, pitchWithRotate: false, maxPitch: 0,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    window.SB.map = map;   // the instance, for the console and the basemap checks (SB.map.getZoom(), getBounds())
} catch (e) {
    // no WebGL (headless / old GPU) — the windows and search still work
    console.warn('Map unavailable:', e.message);
}
// Widen before narrowing, so the bounds and the minimum zoom never fight each other.
function applyFrame() {
    if (!map) return;
    if (PHONE.matches) { map.setMaxBounds(FRAME.phone.bounds); map.setMinZoom(FRAME.phone.minZoom); fitSchools(); }
    else { map.setMinZoom(FRAME.wide.minZoom); map.setMaxBounds(FRAME.wide.bounds); map.jumpTo(HOME); }
}
function fitSchools() {
    const pts = Object.values(SCHOOLS).filter((s) => s.lat != null);
    if (!map || !pts.length) return;
    const box = new maplibregl.LngLatBounds();
    pts.forEach((s) => box.extend([s.lng, s.lat]));
    map.fitBounds(box, { padding: 16, duration: 0, maxZoom: 12 });
}
PHONE.addEventListener('change', applyFrame);

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

let firstFit = true;
map?.on('load', () => {
    mapReady = true; rebuildMap();
    // phones: the attribution starts folded to its ⓘ (one tap shows OneMap and the SLA), so it never sits under the map's buttons
    if (PHONE.matches) document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
});   // without a map, loadMonth's rebuildMap() still draws the key

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
        el.title = `${s.name || s.id} — S$${s.spend_day ?? '?'} per card per day · Shift-click to compare`;
        el.addEventListener('mousedown', noBoxZoom);
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.shiftKey || e.ctrlKey || e.metaKey) return toggleCompare('school', s);
            open(s.id);
            if (PHONE.matches) map.easeTo({ center: [s.lng, s.lat], padding: mapPad, duration: 300 });   // keep the dot above the sheet
        });
        // hover a dot → light up that school's rows in the drawer (and the reverse, see the dock listener above)
        el.addEventListener('mouseenter', () => rowsOf(s.id).forEach((r) => r.classList.add('hl')));
        el.addEventListener('mouseleave', () => rowsOf(s.id).forEach((r) => r.classList.remove('hl')));
        const mk = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
        // after the Marker, which labels every element "Map marker"
        el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `Open ${el.title}`);
        markers.set(s.id, mk); markerEls.set(s.id, el);
    }
    paintVendors();
    renderLegend();                  // after the markers, so the layer counts are current
    if (firstFit && PHONE.matches && markers.size) fitSchools();
    if (markers.size) firstFit = false;
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
            el.title = `${st.name} — S$${st.rev.toLocaleString('en-SG')} · ${st.n.toLocaleString('en-SG')} taps · Shift-click to compare`;
            el.addEventListener('mousedown', noBoxZoom);
            el.addEventListener('click', (e) => { e.stopPropagation();
                if (e.shiftKey || e.ctrlKey || e.metaKey) toggleCompare('stall', st); else window.SB.openStall(st.id); });
            vendorMarkers.push([new maplibregl.Marker({ element: el, offset: v.offset }).setLngLat([st.at[1], st.at[0]]).addTo(map), s]);
            el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `Open ${el.title}`);   // after the Marker's own label
        }
    }
    paintPins();
}

// Show/hide a layer from its Map key row; never zero layers; kept in the URL hash (#layers=…) so a view is shareable.
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
    placeIndex = null;
    setViewMonth(monthLabel(m));
    if (!m) {
        GLOBAL = {}; SCHOOLS = {}; STALLS = { stalls: [], terminals: [] };
        FEB = ITEMS = SAVINGS = SUBSIDY = null; curKinds = [];
        rebuildMap(); return;
    }
    localStorage.setItem('sb-month', m);
    const kinds = MONTHS.find((x) => x.month === m)?.kinds || [];
    setPlaybackMonth(m);
    const opt = (k) => kinds.includes(k) ? fetchBundle(m, k).catch(() => null) : null;
    const [g, sc, st, feb, items, sav, sub] = await Promise.all([
        fetchBundle(m, 'global').catch(() => ({})),
        fetchBundle(m, 'schools').catch(() => ({ schools: {} })),
        fetchBundle(m, 'stalls').catch(() => ({ stalls: [], terminals: [] })),
        opt('wearable'), opt('items'), opt('savings'), opt('subsidy'),
    ]);
    if (seq !== loadSeq) return false;
    curKinds = kinds;
    GLOBAL = g || {}; SCHOOLS = (sc && sc.schools) || {}; STALLS = st || { stalls: [], terminals: [] };
    FEB = feb; ITEMS = items; SAVINGS = sav; SUBSIDY = sub;
    placeIndex = null;
    closeAll(); clearCompare();      // anything opened on the old markers while this month was loading
    rebuildMap();
}

/* ---------- boot: months → data → workspace + deep links ---------- */
async function boot() {
    MONTHS = await fetchMonths().catch(() => []);
    const saved = localStorage.getItem('sb-month');
    curMonth = MONTHS.find((x) => x.month === saved)?.month || MONTHS.at(-1)?.month || null;
    colorMode = ROLE_COLOR[role] || 'level';         // saved workspace's default colouring, before the first paint
    await loadMonth(curMonth);
    renderNav();
    if (!MONTHS.length) return openNoData();          // nothing seeded yet: say so instead of opening Playback on nothing

    const h = location.hash;
    const mRole = h.match(/role=(\w+)/);
    const mSchool = h.match(/school=([A-Za-z]+)/);
    const mSchools = /(?:^#|&)schools(?:&|$)/.test(h);
    const mStall = h.match(/stall=([\w.]+)/);
    const mTerm = h.match(/terminal=([\w-]+)/);
    const mFeb = h.match(/feb(?:=(\w+))?/);
    const mItems = h.match(/items(?:=(\w+))?/);
    const mSav = h.match(/savings/);
    const mSub = h.match(/subsidy/);
    const mPlay = h.match(/playback/);
    if (mRole && ROLES[mRole[1]]) setRole(mRole[1]);
    if (mSchools) openView('schools');
    if (mSchool) flyToSchool(mSchool[1].toUpperCase());
    if (mStall) openStall(STALLS, mStall[1]);
    if (mTerm) openTerminal(STALLS, mTerm[1]);
    if (mFeb && viewAvailable('feb')) openFeb(FEB, mFeb[1]);
    if (mItems && viewAvailable('items')) openItems(ITEMS, mItems[1]);
    if (mSav && viewAvailable('savings')) openSavings(SAVINGS);
    if (mSub && viewAvailable('subsidy')) openSubsidy(SUBSIDY);
    if (mPlay) openPlayback({});
    const mPins = linkPins && restorePins(linkPins) >= 2;
    if (mPins) { openCompare(); map?.once('moveend', () => fitPinned(pins)); }   // the drawer's padding ease cancels the first fit
    const openedByLink = mSchool || mSchools || mStall || mTerm || (mFeb && viewAvailable('feb')) ||
        (mItems && viewAvailable('items')) || (mSav && viewAvailable('savings')) || (mSub && viewAvailable('subsidy')) ||
        mRole || mPlay || mPins;
    if (!openedByLink) openFirstAvailable();          // a first visit: the map and Overview, no dialog
    initOnboarding();
}
boot();

// The serving store holds no month yet (a fresh deploy before the seed, or an API that cannot be reached):
// say so in the drawer rather than opening Playback on nothing. The months appear on the next reload.
function openNoData() {
    const body = openWindow({ id: 'nodata', title: 'No data yet', sub: 'The store holds no month', chips: [] });
    if (!body) return;
    body.innerHTML = `<div class="empty-note">The dashboard reads the Postgres serving store through the read API, and no month
      was returned. Either the store has not been seeded yet (an operator fills it following
      <code>backend/postgres/SEEDING.md</code>) or the API is not reachable. Reload once a month has been seeded.</div>`;
}

function open(sid) {
    const s = SCHOOLS[sid];
    if (!s) return;
    closeSheets();
    openSchool(s, GLOBAL, STALLS);
    tick('school');
}

/* ---------- the Map key = colour by + layer filter ---------- */
// One panel (Esri interactive legend): the colour-by switch, then every layer as a show/hide row with its count.
// Wide and compact screens: a card that collapses to its header (remembered per viewer); "Reset view" appears only
// when the view isn't the default. Phones: closed by default, a sheet opened from the Map key button.
let legendOpen = localStorage.getItem('sb-legend') !== '0';
const keyBtn = document.getElementById('key-btn');
function renderLegend() {
    const lg = document.getElementById('legend');
    const phone = PHONE.matches, isOpen = phone || legendOpen;
    const unmapped = Object.values(SCHOOLS).filter((s) => s.lat == null).length;
    const changed = !isDefaultLayers() || colorMode !== (ROLE_COLOR[role] || 'level');
    lg.classList.toggle('closed', !isOpen);
    const head = phone
        ? `<div class="lg-head">Map key${changed ? ' <span class="lg-badge">filtered</span>' : ''}<button class="icon-btn lg-close" aria-label="Close the Map key">${icon('close')}</button></div>`
        : `<button class="lg-head" aria-expanded="${legendOpen}">Map key${changed ? ' <span class="lg-badge">filtered</span>' : ''}
            <span class="lg-chev" aria-hidden="true">${legendOpen ? '▾' : '▴'}</span></button>`;
    let body = '';
    if (isOpen) {
        const modes = [['level', 'Level'], ['errors', 'Errors'], ['speed', 'Speed']];
        const band = (c, t, cls = '') => `<div class="li"><span class="dot ${cls}" style="background:${c}"></span>${t}</div>`;
        let scale = colorMode === 'errors' ? band(ST.good, 'Under 5% errors') + band(ST.warn, '5 – 10%') + band(ST.bad, 'Over 10% (ringed)', 'alert')
            : colorMode === 'speed' ? band(ST.good, 'Median under 2.5 s') + band(ST.warn, '2.5 – 4 s') + band(ST.bad, 'Over 4 s (ringed)', 'alert') : '';
        if ([...Object.values(SCHOOLS).filter((s) => s.lat != null), ...vendorMarkers.map(([, s]) => s)]
            .some((s) => markerSev(s) === 'none')) scale += band(NODATA, 'No data');
        const n = (l) => VENDOR[l.id] ? placed(VENDOR[l.id].school).length
            : Object.values(SCHOOLS).filter((s) => s.level === l.id && s.lat != null).length;
        const tip = { pbs: 'Pacific Bookstores shops beside their host school. Square colour follows the colour-by switch (host school level; own machine for errors/speed).',
                      stamps: 'POSB Smiley Stamp machines beside their school (savings, not spending). Same colouring as bookstores.' };
        body = `<div class="lg-label">Colour by</div>
          <div class="seg mode" role="group" aria-label="Colour by">${modes.map(([k, t]) => `<button type="button" data-mode="${k}" aria-pressed="${colorMode === k}">${t}</button>`).join('')}</div>
          ${scale}
          <div class="lg-label">Show ${info('Dot size = spend per card per day. Press a row to show or hide it on the map.')}</div>
          ${LAYERS.map((l) => { const on = layersOn.has(l.id);
              const mark = l.shape ? `<span class="dot ${l.shape}" style="background:${l.color}"></span>` : `<span class="dot" style="background:${colorMode === 'level' ? l.color : 'transparent'}"></span>`;
              return `<div class="lg-line"><button class="lg-row${on ? ' on' : ''}" data-l="${l.id}" aria-pressed="${on}">
                <span class="lg-check" aria-hidden="true">${on ? '✓' : ''}</span>${mark}${l.label}<span class="fn">${n(l)}</span></button>
                ${tip[l.id] ? info(tip[l.id]) : ''}${l.id === 'pbs' ? '<button class="lg-link" id="books-btn" title="List every PBS bookshop">list</button>' : ''}</div>`; }).join('')}
          ${unmapped ? `<div class="foot"><button id="unmapped-btn">${unmapped} school${unmapped > 1 ? 's' : ''} not on the map</button></div>` : ''}
          ${changed ? '<button class="btn lg-reset">Reset view</button>' : ''}`;
    }
    lg.innerHTML = head + body;
    lg.querySelector('button.lg-head')?.addEventListener('click', () => {
        legendOpen = !legendOpen; localStorage.setItem('sb-legend', legendOpen ? '1' : '0'); renderLegend(); });
    lg.querySelector('.lg-close')?.addEventListener('click', () => { closeSheets(); keyBtn.focus(); });
    lg.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setColorMode(b.dataset.mode)));
    lg.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => toggleLayer(b.dataset.l)));
    lg.querySelector('#unmapped-btn')?.addEventListener('click', () => { closeSheets(); openUnmapped(); });
    lg.querySelector('#books-btn')?.addEventListener('click', () => { closeSheets(); openBookstores(); });
    lg.querySelector('.lg-reset')?.addEventListener('click', () => {
        layersOn = new Set(DEFAULT_LAYERS); setColorMode(ROLE_COLOR[role] || 'level'); applyLayers(); });
}
keyBtn.addEventListener('click', () => {
    const on = !stage.classList.contains('key-open');
    closeSheets();
    if (!on) return;
    stage.classList.add('key-open'); scrim.hidden = false; keyBtn.setAttribute('aria-expanded', 'true');
    renderLegend();
    document.querySelector('#legend button')?.focus();
});
PHONE.addEventListener('change', () => { closeSheets(); renderLegend(); });

// Bookstores window: shops needing a decision first (highlighted), then placed shops. Every reviewed
// placement/flag carries its evidence (backend/ingestion-service/pbs_hosts.csv) in an ⓘ tip.
const STATUS = { highlight: ['pill-warn', 'Primary/secondary conflict'], unlink: ['pill-warn', 'Not confirmed'],
                 ask: ['pill-bad', 'Not identified'] };
function openBookstores() {
    const shops = pbsShops().sort((a, b) => b.rev - a.rev);
    const body = openWindow({ id: 'bookstores', title: 'Pacific Bookstores (PBS)', sub: `${shops.length} school bookshops`, chips: [] });
    if (!body) return;
    const todo = shops.filter((st) => !st.host), done = shops.filter((st) => st.host);
    const head = `<tr><th>Shop</th><th>School</th><th class="num">Taps</th><th class="num">Revenue</th><th class="num">Stamps</th></tr>`;
    const nums = (st) => `<td class="num">${fmt(st.n)}</td><td class="num">${money(st.rev)}</td>
      <td class="num">${st.stamp ? money(st.stamp) : '–'}</td>`;
    const school = (st) => {
        const s = SCHOOLS[st.host];
        const ev = st.evidence ? info(st.evidence) : '';
        if (s) return `<a href="#" data-open-sid="${esc(s.id)}">${esc(s.name || s.id)}</a>${ev}`;
        return `${esc(st.at?.[2] || st.host)} <span class="chip chip-other">bookshop only</span>${ev}`;
    };
    const flag = (st) => { const [cls, txt] = STATUS[st.status] || STATUS.ask;
        const cand = SCHOOLS[st.candidate];
        return `<span class="${cls}">${txt}</span>${cand ? ` likely ${esc(cand.name)}` : ` (name says “${esc(st.code || '?')}”)`}
          ${info(st.evidence || 'The code in the shop name is not one of our school IDs, and no reviewed decision exists yet.')}`; };
    body.innerHTML = `<p class="take">Each shop is placed at its school only when the evidence agrees ${info(`The feed files every
      shop under vendor ID PBS and names it "Pacific Bookstores - <code>". A shop is placed when that code is exactly one of our
      school IDs and card data agrees, or after a reviewed decision with sources (PBS directory, MOE list, POSB list, card data).
      Bookshop sales are not counted in canteen figures. Stamps = POSB Smiley Stamps sold (savings, not purchases).`)}</p>
      ${todo.length ? `<section class="sec"><div class="sec-h"><h2>Needs a decision (${todo.length})</h2></div>${tableCard(head,
        todo.map((st) => `<tr class="click" role="button" tabindex="0" data-stall="${esc(st.id)}"><td>${esc(st.name)}</td><td>${flag(st)}</td>${nums(st)}</tr>`).join(''))}</section>` : ''}
      <section class="sec"><div class="sec-h"><h2>Placed (${done.length})</h2></div>${tableCard(head,
        done.map((st) => `<tr class="click" role="button" tabindex="0" data-stall="${esc(st.id)}"><td>${esc(st.name)}</td><td>${school(st)}</td>${nums(st)}</tr>`).join(''))}</section>`;
    body.querySelectorAll('tr[data-stall]').forEach((tr) =>
        tr.addEventListener('click', (e) => { if (!e.target.closest('.info, a')) window.SB.openStall(tr.dataset.stall); }));
    body.querySelectorAll('a[data-open-sid]').forEach((a) =>
        a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); flyToSchool(a.dataset.openSid); }));
}

function openUnmapped() {
    const body = openWindow({ id: 'unmapped', title: 'Schools without a map position',
        sub: 'ID not confidently matched to the MOE directory', chips: [] });
    if (!body) return;
    const rows = Object.values(SCHOOLS).filter((s) => s.lat == null).sort((a, b) => b.n - a.n);
    body.innerHTML = `<p class="take">In rankings and search, just no map marker ${info(`Matching used acronym inference against
      the MOE school directory; ambiguous IDs were left unmapped rather than guessed.`)}</p>
      ${rows.length ? tableCard(`<tr><th>ID</th><th>Level</th><th class="num">Taps</th><th class="num">Per card per day</th></tr>`,
        rows.map((s) => `<tr class="click" role="button" tabindex="0" data-open-sid="${esc(s.id)}"><td><b>${esc(s.id)}</b></td>
          <td>${esc(s.level)}</td><td class="num">${fmt(s.n)}</td>
          <td class="num">${s.spend_day ? money(s.spend_day) : '–'}</td></tr>`).join(''))
        : '<div class="empty-note">Every school this month has a map position.</div>'}`;
    body.querySelectorAll('tr[data-open-sid]').forEach((tr) => tr.addEventListener('click', () => open(tr.dataset.openSid)));
}

/* ---------- SMART Buddy chat (the agents on the mesh, which read Redshift; month-aware context) ---------- */
// The chat asks the backend's chat route (central-specs decision 0007); the page holds no broker login. With no
// VITE_SB_API_URL, or the route down, the chat opens and shows "offline" — the rest of the app is unaffected.
initSam();
initSamPanel(buildSamContext, { askButton: document.getElementById('ask-btn'), resolvePlace, onPlace: (sid) => window.SB.focusSchool(sid) });
document.addEventListener('smartbuddy:sam-ask', () => tick('sam'));
document.addEventListener('smartbuddy:chat', (e) => { if (e.detail?.open) closeSheets(); });

/* ---------- opt-in tours (tour.js): menu → Tours, the checklist, or "Tour" on a view — never by themselves ---------- */
// Chapters this viewer can take: the shared ones + the views in their workspace that this month has (Playback always).
function tourKeys() {
    const views = new Set(listKeys().filter((k) => viewAvailable(k)));
    return Object.keys(CHAPTERS).filter((k) => !CHAPTERS[k].view || views.has(CHAPTERS[k].view));
}
// Tours work on real schools picked for the workspace: Engineering → most errors; others → biggest spender per card.
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
        view: (k) => openView(k),
        sam: setChatOpen,
    }, tourKeys());
}
document.addEventListener('smartbuddy:tour', (e) => tour(e.detail || 'basics'));

/* ---------- keys: "?" the Keyboard & mouse list, Ctrl/⌘ K and "/" search — not while typing, nor during a tour ---------- */
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]');
addEventListener('keydown', (e) => {
    if (document.querySelector('.tour-card')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === '?' && !PHONE.matches) { e.preventDefault(); openShortcuts(); }
    else if (e.key === 'Escape' && (!more.hidden || stage.classList.contains('key-open'))) { e.preventDefault(); closeSheets(); }
});

/* ---------- search: schools, stalls and machines, grouped ---------- */
// The combobox pattern: ↑ ↓ move through the matches (the first is chosen when they appear), Enter opens the chosen
// one, Esc closes. Full screen on phones (shell.css).
const searchPanel = document.getElementById('search-panel');
const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('search-results');
let hits = [], active = 0, searchFrom = null;
function openSearch() {
    if (!searchPanel.hidden) return searchEl.focus();
    searchFrom = document.activeElement;
    closeSheets();
    searchPanel.hidden = false;
    searchEl.value = '';
    renderHits();
    searchEl.focus();
}
function closeSearch(restore = true) {
    searchPanel.hidden = true;
    if (restore && searchFrom?.isConnected) searchFrom.focus();
}
document.getElementById('search-open').addEventListener('click', openSearch);
document.getElementById('search-close').addEventListener('click', () => closeSearch());
searchPanel.addEventListener('click', (e) => {
    if (e.target === searchPanel) return closeSearch();
    const r = e.target.closest('[data-i]');
    if (r) choose(hits[+r.dataset.i]);
});
searchPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeSearch(); }
    if (e.key === 'Tab') {                               // keep focus inside the dialog: the field ↔ the close button
        const f = [searchEl, document.getElementById('search-close')];
        const i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    }
});
searchEl.addEventListener('keydown', (e) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
        markActive();
    } else if (e.key === 'Enter') { e.preventDefault(); choose(hits[active] || hits[0]); }
});
searchEl.addEventListener('input', renderHits);
function renderHits() {
    const qy = searchEl.value.trim().toLowerCase();
    hits = [];
    if (qy.length >= 2) {
        const add = (list, max) => { for (const h of list) { if (max-- <= 0) break; hits.push(h); } };
        add(Object.values(SCHOOLS).filter((s) => s.id.toLowerCase().includes(qy) || (s.name || '').toLowerCase().includes(qy))
            .map((s) => ({ t: 'school', id: s.id, main: s.name || s.id, sub: `${s.id} · ${s.level}${s.lat == null ? ' · not on the map' : ''}` })), 6);
        add(STALLS.stalls.filter((st) => st.name.toLowerCase().includes(qy) || st.id.toLowerCase().includes(qy))
            .map((st) => ({ t: 'stall', id: st.id, main: st.name, sub: `${st.school} · ${st.cat}` })), 5);
        add(STALLS.terminals.filter((tm) => tm.id.toLowerCase().includes(qy))
            .map((tm) => ({ t: 'terminal', id: tm.id, main: '…' + tm.id.slice(-14), sub: `${tm.storeName || ''} · ${tm.school}` })), 5);
    }
    active = 0;
    const group = { school: 'Schools', stall: 'Stalls', terminal: 'Machines' };
    let last = null;
    resultsEl.innerHTML = qy.length < 2 ? '<div class="empty">Type two letters or more of a school, stall or machine.</div>'
        : hits.map((h, i) => { const head = h.t !== last ? `<h3 role="presentation">${group[h.t]}</h3>` : ''; last = h.t;
            return `${head}<div class="row" role="option" id="sr-${i}" aria-selected="false" data-i="${i}"><b>${esc(h.main)}</b><span>${esc(h.sub)}</span></div>`; }).join('')
            || '<div class="empty">No matches this month.</div>';
    markActive();
}
function markActive() {
    const rows = [...resultsEl.querySelectorAll('[data-i]')];
    rows.forEach((r, i) => r.setAttribute('aria-selected', i === active));
    if (rows[active]) { searchEl.setAttribute('aria-activedescendant', rows[active].id); rows[active].scrollIntoView({ block: 'nearest' }); }
    else searchEl.removeAttribute('aria-activedescendant');
}
function choose(h) {
    if (!h) return;
    closeSearch(false);
    setChatOpen(false);
    if (h.t === 'school') flyToSchool(h.id);
    else if (h.t === 'stall') openStall(STALLS, h.id);
    else openTerminal(STALLS, h.id);
}
