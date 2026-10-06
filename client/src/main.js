// SMART Buddy insights app — Singapore map, role-based nav, draggable windows.
// Roles filter the top bar to each team's views (F&B / Engineering / Management);
// everything is deep-linkable and cross-linked (school ↔ stall ↔ machine).
import maplibregl from 'maplibre-gl';
import { fetchMonths, fetchBundle } from './sbData.js';
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
import { initSam } from './sam/samClient.js';
import { initSamPanel } from './sam/samPanel.js';

// Force Keycloak login first when configured (live deploy). No-op stub in local dev (no VITE_KEYCLOAK_URL).
// Fire-and-forget: login-required redirects unauthenticated browsers to Keycloak; sb-api calls await
// `authReady` (see sbApi.js) so no request races the token.
initAuth();
// When auth settles, show who's signed in + a logout button in the nav.
authReady.then(({ username }) => renderUser(username));

const LV_COLOR = { Primary: '#0a5fd8', Secondary: '#00955f', 'Junior College': '#6a3fd1', Other: '#48484d' };
const HEALTH = (v, warn, bad) => (v >= bad ? '#ff3b30' : v >= warn ? '#ff9500' : '#34c759');
let colorMode = 'level';
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
let layersOn = (() => {
    const m = /(?:^|[#&])layers=([^&]+)/.exec(location.hash);
    const ids = m ? decodeURIComponent(m[1]).split(',').filter((id) => LAYERS.some((l) => l.id === id)) : [];
    return new Set(ids.length ? ids : DEFAULT_LAYERS);
})();
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
// stops the top bar from overflowing when a role shows several views (see renderNav). `icon: true`
// renders a compact icon-only button for utility actions (grouped after the analytical views).
const VIEWS = {
    overview: { label: 'Overview',   title: 'Network Overview',      kind: 'global',   open: () => openOverview(GLOBAL, SCHOOLS, open) },
    eng:      { label: 'Terminals',  title: 'Terminal Health',       kind: 'stalls',   open: (p) => openEng(STALLS, p || {}) },
    feb:      { label: 'Wearables',  title: 'Wearables & Health',    kind: 'wearable', open: (p) => openFeb(FEB, p) },
    items:    { label: 'Purchases',  title: 'Purchases & Nutrition', kind: 'items',    open: (p) => openItems(ITEMS, p) },
    savings:  { label: 'Saving',     title: 'Saving vs Spending',    kind: 'savings',  open: (p) => openSavings(SAVINGS, p) },
    playback: { label: 'Playback',   title: 'Timeline playback',     kind: null,       open: (p) => openPlayback(p || {}) },
    upload:   { label: '⬆', title: 'Upload data', icon: true,        kind: null,       open: () => openUpload(onUploaded) },
};
const viewAvailable = (k) => VIEWS[k].kind == null || curKinds.includes(VIEWS[k].kind);
let role = localStorage.getItem('sb-role') || null;

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
    localStorage.setItem('sb-role', r);
    renderNav();
    if (openPrimary) openFirstAvailable(r);
}
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
    if (!keys.includes('upload')) keys.push('upload');      // always
    nv.innerHTML = keys.map((k) => `<button class="nav-btn${VIEWS[k].icon ? ' nav-icon' : ''}" data-view="${k}" title="${VIEWS[k].title || VIEWS[k].label}">${VIEWS[k].label}</button>`).join('') +
        `<button class="nav-role" id="role-btn" title="Switch workspace">${role ? ROLES[role].icon + ' ' + ROLES[role].label : '☰ All views'} ▾</button>`;
    nv.querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => VIEWS[b.dataset.view].open()));
    nv.querySelector('#role-btn').addEventListener('click', () => openHub(setRole));
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
    el.title = 'Datasets loaded for the selected month';
    el.innerHTML = COVERAGE.map(([kind, label]) => {
        const on = curKinds.includes(kind);
        return `<span class="cov ${on ? 'cov-on' : 'cov-off'}" title="${label} ${on ? 'loaded' : 'not present this month'}">${on ? '✓' : '–'} ${label}</span>`;
    }).join('');
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
    await loadMonth(m);
    renderNav();
    openFirstAvailable(role);
}

// Called by the upload window after a successful load — refresh months + current data.
async function onUploaded() {
    MONTHS = await fetchMonths().catch(() => MONTHS);
    if (!MONTHS.find((x) => x.month === curMonth) && MONTHS.length) curMonth = MONTHS.at(-1).month;
    await loadMonth(curMonth);
    renderNav();
}

// User badge + logout in the top-right nav (only when Keycloak is enabled → username present).
function renderUser(username) {
    if (!username || username === 'dev') return;              // local dev / no-auth → no badge
    const right = document.querySelector('.nav-right');
    if (!right || document.getElementById('nav-user')) return;
    const wrap = document.createElement('div');
    wrap.id = 'nav-user'; wrap.className = 'nav-user';
    const name = document.createElement('span');
    name.className = 'nav-user-name'; name.title = 'Signed in'; name.textContent = `👤 ${username}`;
    const btn = document.createElement('button');
    btn.className = 'nav-logout'; btn.title = 'Sign out'; btn.textContent = 'Logout';
    btn.addEventListener('click', () => logout());
    wrap.append(name, btn);
    right.appendChild(wrap);
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
    openPlayback: (preset) => openPlayback(preset || {}),
};

// Snapshot of dashboard state sent with each SAM query (role + what's open).
function buildSamContext() {
    return {
        source: 'smart-buddy-frontend',
        scope: curMonth ? `month ${curMonth}` : 'no data loaded',
        role: role || 'all',
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
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
} catch (e) {
    // no WebGL (headless / old GPU) — the windows and search still work
    console.warn('Map unavailable:', e.message);
}

function markerColor(s) {
    if (colorMode === 'errors') return HEALTH(s.err_pct, 5, 10);
    if (colorMode === 'speed') return HEALTH(s.med_ms ?? 0, 2500, 4000);
    return LV_COLOR[s.level] || LV_COLOR.Other;
}
function markerSize(s) {
    const v = s.spend_day || 2;
    return Math.max(9, Math.min(24, 4 + v * 3));
}
function paintMarkers() {
    for (const [sid, el] of markerEls) {
        const s = SCHOOLS[sid];
        el.style.background = markerColor(s);
    }
    for (const [mk, s] of vendorMarkers) mk.getElement().style.setProperty('--c', markerColor(s));
    renderLegend();
}

if (map) map.on('load', () => { mapReady = true; rebuildMap(); });
else renderLegend();

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
        el.title = `${s.name || s.id} — $${s.spend_day ?? '?'} /day`;
        el.addEventListener('click', (e) => { e.stopPropagation(); open(s.id); });
        const mk = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
        markers.set(s.id, mk); markerEls.set(s.id, el);
    }
    paintVendors();
    renderFilter();
    renderLegend();                  // after the markers, so the "N schools mapped" count is current
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
            const s = vendorStat(st);
            el.style.setProperty('--c', markerColor(s));
            el.title = `${st.name} — $${st.rev.toLocaleString('en-SG')} · ${st.n.toLocaleString('en-SG')} txns`;
            el.addEventListener('click', (e) => { e.stopPropagation(); window.SB.openStall(st.id); });
            vendorMarkers.push([new maplibregl.Marker({ element: el, offset: v.offset }).setLngLat([st.at[1], st.at[0]]).addTo(map), s]);
        }
    }
}

function renderFilter() {
    const bar = document.getElementById('filterbar');
    if (!bar) return;
    const n = (l) => VENDOR[l.id] ? placed(VENDOR[l.id].school).length
        : Object.values(SCHOOLS).filter((s) => s.level === l.id && s.lat != null).length;
    const all = layersOn.size === LAYERS.length;
    bar.innerHTML = `<button class="fpill${all ? ' on' : ''}" data-l="*" aria-pressed="${all}">All</button>` +
        LAYERS.map((l) => { const on = layersOn.has(l.id);
            return `<button class="fpill${on ? ' on' : ''}" data-l="${l.id}" aria-pressed="${on}" style="--pill:${l.color}">
              <span class="fdot ${l.shape || ''}"></span>${l.label} <span class="fn">${n(l)}</span></button>`; }).join('');
    bar.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.l;
        if (id === '*') LAYERS.forEach((l) => layersOn.add(l.id));
        else if (!layersOn.delete(id)) layersOn.add(id);
        if (!layersOn.size) layersOn.add(id);                       // never zero
        for (const [sid, el] of markerEls) el.style.display = layersOn.has(SCHOOLS[sid].level) ? '' : 'none';
        paintVendors(); renderFilter();
        const rest = location.hash.replace(/(?:^#|&)layers=[^&]*/, '').replace(/^[#&]/, '');
        const same = layersOn.size === DEFAULT_LAYERS.length && DEFAULT_LAYERS.every((x) => layersOn.has(x));
        const h = [same ? '' : 'layers=' + encodeURIComponent([...layersOn].join(',')), rest].filter(Boolean).join('&');
        history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
    }));
}

/* ---------- per-month data loading ---------- */
async function loadMonth(m) {
    curMonth = m;
    if (!m) {
        GLOBAL = {}; SCHOOLS = {}; STALLS = { stalls: [], terminals: [] };
        FEB = ITEMS = SAVINGS = null; curKinds = [];
        rebuildMap(); return;
    }
    localStorage.setItem('sb-month', m);
    curKinds = MONTHS.find((x) => x.month === m)?.kinds || [];
    setPlaybackMonth(m);
    const [g, sc, st] = await Promise.all([
        fetchBundle(m, 'global').catch(() => ({})),
        fetchBundle(m, 'schools').catch(() => ({ schools: {} })),
        fetchBundle(m, 'stalls').catch(() => ({ stalls: [], terminals: [] })),
    ]);
    GLOBAL = g || {}; SCHOOLS = (sc && sc.schools) || {}; STALLS = st || { stalls: [], terminals: [] };
    FEB = curKinds.includes('wearable') ? await fetchBundle(m, 'wearable').catch(() => null) : null;
    ITEMS = curKinds.includes('items') ? await fetchBundle(m, 'items').catch(() => null) : null;
    SAVINGS = curKinds.includes('savings') ? await fetchBundle(m, 'savings').catch(() => null) : null;
    rebuildMap();
}

/* ---------- boot: months → data → role + deep links ---------- */
async function boot() {
    MONTHS = await fetchMonths().catch(() => []);
    const saved = localStorage.getItem('sb-month');
    curMonth = MONTHS.find((x) => x.month === saved)?.month || MONTHS.at(-1)?.month || null;
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
    const openedByLink = mSchool || mStall || mTerm || (mFeb && viewAvailable('feb')) ||
        (mItems && viewAvailable('items')) || (mSav && viewAvailable('savings')) || mRole || mPlay;
    if (!openedByLink) {
        if (role) openFirstAvailable(role);
        else openHub(setRole);                        // pick a workspace (Upload stays a nav button)
    }
}
boot();

function open(sid) {
    const s = SCHOOLS[sid];
    if (!s) return;
    openSchool(s, GLOBAL, STALLS);
    markerEls.get(sid)?.classList.add('open');
}

/* ---------- legend ---------- */
function renderLegend() {
    const lg = document.getElementById('legend');
    const unmapped = Object.values(SCHOOLS).filter((s) => s.lat == null).length;
    const modes = [['level', 'Level'], ['errors', 'Errors'], ['speed', 'Speed']];
    let items = '';
    if (colorMode === 'level') {
        items = Object.entries(LV_COLOR).map(([k, c]) =>
            `<div class="li"><span class="dot" style="background:${c}"></span>${k}</div>`).join('');
    } else if (colorMode === 'errors') {
        items = `<div class="li"><span class="dot" style="background:#34c759"></span>&lt; 5% error rate</div>
                 <div class="li"><span class="dot" style="background:#ff9500"></span>5 – 10%</div>
                 <div class="li"><span class="dot" style="background:#ff3b30"></span>&gt; 10%</div>`;
    } else {
        items = `<div class="li"><span class="dot" style="background:#34c759"></span>median &lt; 2.5s</div>
                 <div class="li"><span class="dot" style="background:#ff9500"></span>2.5 – 4s</div>
                 <div class="li"><span class="dot" style="background:#ff3b30"></span>&gt; 4s</div>`;
    }
    lg.innerHTML = `<h4>Schools · dot size = spend/day</h4>
      <div class="mode">${modes.map(([k, t]) =>
        `<button data-mode="${k}" class="${colorMode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${items}
      <div class="foot">■ Bookstores · ◆ Stamp points: same colours (host school's level; own machine for errors/speed)</div>
      <div class="foot">${markerEls.size} schools mapped (MOE-matched) ·
        <button id="unmapped-btn">${unmapped} unmapped</button></div>
      <div class="foot">Lists: <button id="books-btn">PBS bookstores (${pbsShops().length})</button></div>`;
    lg.querySelectorAll('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => { colorMode = b.dataset.mode; paintMarkers(); }));
    lg.querySelector('#unmapped-btn').addEventListener('click', openUnmapped);
    lg.querySelector('#books-btn').addEventListener('click', openBookstores);
}

// Bookstores window: shops needing a decision first (highlighted), then placed shops. Every reviewed
// placement/flag carries its evidence (ingestion-service/pbs_hosts.csv) in an ⓘ tip.
const STATUS = { highlight: ['pill-warn', 'Primary/secondary conflict'], unlink: ['pill-warn', 'Not confirmed'],
                 ask: ['pill-bad', 'Not identified'] };
function openBookstores() {
    import('./windowing.js').then(({ openWindow, info }) => {
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
            if (s) return `<a href="#" data-sid="${s.id}">${s.name || s.id}</a>${ev}`;
            return `${st.at?.[2] || st.host} <span class="chip chip-other">bookshop only</span>${ev}`;
        };
        const flag = (st) => { const [cls, txt] = STATUS[st.status] || STATUS.ask;
            const cand = SCHOOLS[st.candidate];
            return `<span class="${cls}">${txt}</span>${cand ? ` likely ${cand.name}` : ` (name says “${st.code || '?'}”)`}
              ${info(st.evidence || 'The code in the shop name is not one of our school IDs, and no reviewed decision exists yet.')}`; };
        body.innerHTML = `<div class="cap" style="margin-bottom:8px">Each shop is placed at its school only when the evidence
          agrees ${info(`The feed files every shop under vendor ID PBS and names it "Pacific Bookstores - <code>". A shop is
          placed when that code is exactly one of our school IDs and card data agrees, or after a reviewed decision with
          sources (PBS directory, MOE list, POSB list, card data). Bookshop sales are not counted in canteen figures.
          Stamps = POSB Smiley Stamps sold (savings, not purchases).`)}</div>
          ${todo.length ? `<h5>Needs a decision (${todo.length})</h5><table class="mini">${head}
            ${todo.map((st) => `<tr style="cursor:pointer" data-stall="${st.id}"><td>${st.name}</td><td>${flag(st)}</td>${nums(st)}</tr>`).join('')}
          </table>` : ''}
          <h5>Placed (${done.length})</h5><table class="mini">${head}
            ${done.map((st) => `<tr style="cursor:pointer" data-stall="${st.id}"><td>${st.name}</td><td>${school(st)}</td>${nums(st)}</tr>`).join('')}
          </table>`;
        body.querySelectorAll('tr[data-stall]').forEach((tr) =>
            tr.addEventListener('click', (e) => { if (!e.target.closest('.info')) window.SB.openStall(tr.dataset.stall); }));
        body.querySelectorAll('a[data-sid]').forEach((a) =>
            a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(a.dataset.sid); }));
    });
}

function openUnmapped() {
    import('./windowing.js').then(({ openWindow, info }) => {
        const body = openWindow({ id: 'unmapped', title: 'Schools without a map position',
            sub: 'ID not confidently matched to the MOE directory', chips: [] });
        if (!body) return;
        const rows = Object.values(SCHOOLS).filter((s) => s.lat == null)
            .sort((a, b) => b.n - a.n);
        body.innerHTML = `<div class="cap" style="margin-bottom:8px">In rankings and search, just no map marker ${info(`Matching
          used acronym inference against the MOE school directory; ambiguous IDs were left unmapped rather than guessed.`)}</div>
          <table class="mini"><tr><th>ID</th><th>Level</th><th style="text-align:right">Txns</th>
          <th style="text-align:right">$/day</th></tr>
          ${rows.map((s) => `<tr style="cursor:pointer" data-sid="${s.id}"><td><b>${s.id}</b></td>
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

/* ---------- unified search: schools + stalls + machines ---------- */
const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('search-results');
searchEl.addEventListener('input', () => {
    const qy = searchEl.value.trim().toLowerCase();
    if (qy.length < 2) { resultsEl.classList.remove('open'); return; }
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
        `<div class="row" data-i="${i}"><b>${h.main}</b><span>${h.sub}</span></div>`).join('')
        || '<div class="row"><span>No matches</span></div>';
    resultsEl.classList.add('open');
    resultsEl.querySelectorAll('[data-i]').forEach((r) =>
        r.addEventListener('click', () => {
            const h = hits[+r.dataset.i];
            resultsEl.classList.remove('open'); searchEl.value = '';
            if (h.t === 'school') {
                const s = SCHOOLS[h.id];
                if (s?.lat != null && map) map.flyTo({ center: [s.lng, s.lat], zoom: 14 });
                open(h.id);
            } else if (h.t === 'stall') openStall(STALLS, h.id);
            else openTerminal(STALLS, h.id);
        }));
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-results') && e.target !== searchEl) resultsEl.classList.remove('open');
});
