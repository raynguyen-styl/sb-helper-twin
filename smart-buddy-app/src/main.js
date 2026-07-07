// SMART Buddy insights app — Singapore map, role-based nav, draggable windows.
// Roles filter the top bar to each team's views (F&B / Engineering / Management);
// everything is deep-linkable and cross-linked (school ↔ stall ↔ machine).
import maplibregl from 'maplibre-gl';
import GLOBAL from './data/global.json';
import SCHOOLS from './data/schools.json';
import FEB from './data/feb.json';
import STALLS from './data/stalls.json';
import { openSchool } from './school-window.js';
import { openOverview } from './overview-window.js';
import { openFeb } from './feb-window.js';
import { openStallExplorer, openStall } from './stall-window.js';
import { openEng, openTerminal } from './eng-window.js';
import { openHub, ROLES } from './hub-window.js';

const LV_COLOR = { Primary: '#2a78d6', Secondary: '#1baf7a', 'Junior College': '#7d5fd3', Other: '#8e8e93' };
const HEALTH = (v, warn, bad) => (v >= bad ? '#ff3b30' : v >= warn ? '#ff9500' : '#34c759');
let colorMode = 'level';
const markerEls = new Map();

/* ---------- views & roles ---------- */
const VIEWS = {
    overview: { label: 'Network Overview', open: () => openOverview(GLOBAL, SCHOOLS, open) },
    stalls:   { label: 'Stall Explorer',   open: (p) => openStallExplorer(STALLS, p || {}) },
    eng:      { label: 'Terminal Health',  open: (p) => openEng(STALLS, p || {}) },
    feb:      { label: 'February Insights', open: (p) => openFeb(FEB, p) },
};
let role = localStorage.getItem('sb-role') || null;

function setRole(r, openPrimary = true) {
    role = r;
    localStorage.setItem('sb-role', r);
    renderNav();
    if (openPrimary) VIEWS[ROLES[r].primary].open();
}
function renderNav() {
    const nv = document.getElementById('nav-views');
    const keys = role ? ROLES[role].views : Object.keys(VIEWS);
    nv.innerHTML = keys.map((k) => `<button class="nav-btn" data-view="${k}">${VIEWS[k].label}</button>`).join('') +
        `<button class="nav-role" id="role-btn" title="Switch workspace">${role ? ROLES[role].icon + ' ' + ROLES[role].label : '☰ All views'} ▾</button>`;
    nv.querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => VIEWS[b.dataset.view].open()));
    nv.querySelector('#role-btn').addEventListener('click', () => openHub(setRole));
}

/* ---------- cross-window API (used by stall/eng/school windows) ---------- */
window.SB = {
    openSchool: (sid) => open(sid),
    openStall: (id) => openStall(STALLS, id),
    openTerminal: (tid) => openTerminal(STALLS, tid),
    openStalls: (preset) => openStallExplorer(STALLS, preset),
};

/* ---------- map ---------- */
let map = null;
try {
    map = new maplibregl.Map({
        container: 'map',
        attributionControl: false,
        style: {
            version: 8,
            sources: { carto: { type: 'raster',
                tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
                tileSize: 256, attribution: '© OpenStreetMap © CARTO' } },
            layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
        },
        center: [103.832, 1.352],
        zoom: 11.15,
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
    renderLegend();
}

if (map) map.on('load', () => {
    for (const s of Object.values(SCHOOLS)) {
        if (s.lat == null) continue;
        const el = document.createElement('div');
        el.className = 'mk';
        const d = markerSize(s);
        el.style.cssText = `width:${d}px;height:${d}px;background:${markerColor(s)}`;
        el.title = `${s.name || s.id} — $${s.spend_day ?? '?'} /day`;
        el.addEventListener('click', (e) => { e.stopPropagation(); open(s.id); });
        new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
        markerEls.set(s.id, el);
    }
    renderLegend();
});
else renderLegend();

/* ---------- boot: role + deep links ---------- */
renderNav();
{
    const h = location.hash;
    const mRole = h.match(/role=(\w+)/);
    const mSchool = h.match(/school=([A-Za-z]+)/);
    const mStall = h.match(/stall=([\w.]+)/);
    const mTerm = h.match(/terminal=([\w-]+)/);
    const mFeb = h.match(/feb(?:=(\w+))?/);
    if (mRole && ROLES[mRole[1]]) setRole(mRole[1]);
    if (mSchool) open(mSchool[1].toUpperCase());
    if (mStall) openStall(STALLS, mStall[1]);
    if (mTerm) openTerminal(STALLS, mTerm[1]);
    if (mFeb) openFeb(FEB, mFeb[1]);
    const openedByLink = mSchool || mStall || mTerm || mFeb || mRole;
    if (!openedByLink) {
        if (role) { renderNav(); VIEWS[ROLES[role].primary].open(); }
        else openHub(setRole);          // first visit: pick a workspace
    }
}

function open(sid) {
    const s = SCHOOLS[sid];
    if (!s) return;
    openSchool(s, GLOBAL, GLOBAL.network_mix);
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
      <div class="foot">${markerEls.size} schools mapped (MOE-matched) ·
        <button id="unmapped-btn">${unmapped} unmapped</button></div>`;
    lg.querySelectorAll('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => { colorMode = b.dataset.mode; paintMarkers(); }));
    lg.querySelector('#unmapped-btn').addEventListener('click', openUnmapped);
}

function openUnmapped() {
    import('./windowing.js').then(({ openWindow }) => {
        const body = openWindow({ id: 'unmapped', title: 'Schools without a map position',
            sub: 'ID not confidently matched to the MOE directory', chips: [] });
        if (!body) return;
        const rows = Object.values(SCHOOLS).filter((s) => s.lat == null)
            .sort((a, b) => b.n - a.n);
        body.innerHTML = `<div class="cap" style="margin-bottom:8px">These schools appear in all rankings and
          can be opened from here or via search — they just have no marker. Matching used acronym inference
          against the MOE school directory; ambiguous IDs were left unmapped rather than guessed.</div>
          <table class="mini"><tr><th>ID</th><th>Level</th><th style="text-align:right">Txns</th>
          <th style="text-align:right">$/day</th></tr>
          ${rows.map((s) => `<tr style="cursor:pointer" data-sid="${s.id}"><td><b>${s.id}</b></td>
            <td>${s.level}</td><td class="num">${s.n.toLocaleString()}</td>
            <td class="num">${s.spend_day ? '$' + s.spend_day.toFixed(2) : '–'}</td></tr>`).join('')}</table>`;
        body.querySelectorAll('tr[data-sid]').forEach((tr) =>
            tr.addEventListener('click', () => open(tr.dataset.sid)));
    });
}

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
