// live.js — the Live dashboard (central-specs change live-dashboard-sync). Live shows ONLY what the last
// live sync stored: the backend asked the live SAM agent (today the only path to Redshift) one JSON
// question per panel and kept the validated answers. Nothing here asks the agent; Sync starts the job.
//   reads  → api-service  /api/live/months, /api/live/panels   (VITE_SB_API_URL, read-only)
//   writes → live-sync    /sync, /sync/status                  (VITE_SB_LIVE_URL, default /smartbuddy-live)
// Every value from the agent is data, never markup: everything goes into the page through esc().
import { authReady, authToken } from './auth.js';
import { openWindow, esc } from './windowing.js';
import { mk, opts, ax, bar, line, C } from './charts.js';
import { monthLabel } from './sbData.js';

const API = (import.meta.env.VITE_SB_API_URL || '').replace(/\/$/, '');
const LIVE = ((import.meta.env.VITE_SB_LIVE_URL || '').trim() || '/smartbuddy-live').replace(/\/$/, '');
const POLL_MS = 2000;

export const live = { months: [], month: null, panels: {}, lastRun: null, sync: null };

async function call(base, path, init = {}) {
    await authReady;
    const tok = authToken();
    const headers = { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) };
    const r = await fetch(base + path, { ...init, headers });
    const body = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(body?.error || `HTTP ${r.status}`); e.status = r.status; e.body = body; throw e; }
    return body;
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────────
export async function loadMonths() {
    live.months = await call(API, '/api/live/months').catch(() => []);
    if (!live.months.some((m) => m.month === live.month)) {
        const synced = live.months.filter((m) => m.synced_at);
        live.month = (synced.at(-1) || live.months.at(-1))?.month || null;
    }
    return live.months;
}
export async function loadPanels(month = live.month) {
    live.month = month;
    if (!month) { live.panels = {}; return live.panels; }
    const r = await call(API, `/api/live/panels?month=${encodeURIComponent(month)}`).catch(() => ({ panels: {}, lastRun: null }));
    live.panels = r.panels || {};
    live.lastRun = r.lastRun || null;
    return live.panels;
}
const P = (name) => live.panels[name]?.data || null;
const syncedAt = () => {
    const t = Object.values(live.panels).map((p) => p.synced_at).filter(Boolean).sort().at(-1);
    return t ? new Date(t) : null;
};
const fmtTime = (d) => d ? d.toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

// ── formatting ───────────────────────────────────────────────────────────────────────────────────
const n0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString('en-SG'));
const sgd = (v) => (v == null ? '–' : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}k` : `$${v.toLocaleString('en-SG', { maximumFractionDigits: 2 })}`);
const pct = (v) => (v == null ? '–' : `${v.toFixed(1)}%`);
const none = (what) => `<div class="note-box">No live data yet for ${esc(what)}. Press <b>Sync</b> to ask the live agent.</div>`;

// ── Sync button (nav bar) ────────────────────────────────────────────────────────────────────────
let pollTimer = null;
let onSynced = () => {};
export function mountSync(el, { onDone } = {}) {
    if (!el) return;
    if (onDone) onSynced = onDone;
    el.innerHTML = `<button type="button" class="nav-sync" id="live-sync-btn" title="Ask the live agent for this month's dashboard data">⟳ Sync</button>
      <span class="nav-sync-st" id="live-sync-st" aria-live="polite"></span>`;
    el.querySelector('#live-sync-btn').addEventListener('click', startSync);
    paintSync();
    call(LIVE, '/sync/status').then((st) => { live.sync = st; paintSync(); if (st.state === 'running') poll(); }).catch(() => {});
}
function paintSync() {
    const btn = document.getElementById('live-sync-btn'), st = document.getElementById('live-sync-st');
    if (!btn || !st) return;
    const s = live.sync;
    const running = s?.state === 'running';
    btn.disabled = running;
    btn.textContent = running ? '⟳ Syncing…' : '⟳ Sync';
    if (running) {
        const ps = Object.values(s.panels || {});
        st.textContent = `${ps.filter((p) => p.state === 'ok' || p.state === 'failed').length} of ${ps.length}`;
        st.title = 'Asking the live agent one question per panel';
    } else if (s?.error && !s.syncId) {
        st.textContent = 'Sync failed'; st.title = s.error;
    } else {
        const failed = Object.entries(s?.panels || {}).filter(([, p]) => p.state === 'failed');
        const at = syncedAt();
        st.textContent = at ? `Synced ${fmtTime(at)}${failed.length && s?.month === live.month ? ` · ${failed.length} failed` : ''}` : 'Not synced';
        st.title = failed.length ? `Failed: ${failed.map(([k, p]) => `${p.title || k} (${p.error})`).join('; ')}` : '';
    }
}
async function startSync() {
    try {
        live.sync = await call(LIVE, '/sync', { method: 'POST', body: JSON.stringify(live.month ? { month: live.month } : {}) });
        paintSync(); poll();
    } catch (e) {
        if (e.status === 409 && e.body?.run) { live.sync = e.body.run; paintSync(); poll(); return; }
        live.sync = { state: 'failed', error: e.status === 403 ? 'Your role may not start a live sync' : `Sync failed: ${e.message}` };
        paintSync();
    }
}
function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
        try { live.sync = await call(LIVE, '/sync/status'); } catch { /* keep polling */ }
        paintSync();
        if (live.sync?.state === 'running') return poll();
        if (live.sync?.month) live.month = live.sync.month;
        await loadMonths(); await loadPanels(live.month);
        paintSync(); onSynced();
    }, POLL_MS);
}
export const stopSyncPolling = () => clearTimeout(pollTimer);

// ── Live overview window ─────────────────────────────────────────────────────────────────────────
const charts = [];
export function openOverview({ onSchool } = {}) {
    for (const c of charts.splice(0)) c.destroy();
    const at = syncedAt();
    const body = openWindow({ id: 'live-overview', title: 'Live overview', wide: true,
        sub: `${monthLabel(live.month) || 'no month'}${at ? ` · synced ${fmtTime(at)}` : ''} · from the live agent` });
    if (!body) return;
    if (!Object.keys(live.panels).length) {
        body.innerHTML = `<div class="note-box live-empty"><b>No live data yet — press Sync.</b><br>
          Sync asks the live agent (Redshift) for ${live.month ? esc(monthLabel(live.month)) : 'the newest month'} and stores the answers here.
          It can take a few minutes; the dashboard never asks the agent on its own.</div>`;
        return;
    }
    const k = P('kpis'), top = P('top_schools'), daily = P('daily'), term = P('terminals'), food = P('food'), wear = P('wearables');
    const foodTotal = food?.rows?.reduce((a, r) => a + (r.spend_sgd || 0), 0) || 0;
    body.innerHTML = `
      ${k ? `<div class="stats">
        <div class="stat"><div class="v">${sgd(k.spend_sgd)}</div><div class="l">spend</div></div>
        <div class="stat"><div class="v">${n0(k.txns)}</div><div class="l">transactions</div></div>
        <div class="stat"><div class="v">${n0(k.active_cards)}</div><div class="l">active cards</div></div>
        <div class="stat"><div class="v">${sgd(k.avg_ticket_sgd)}</div><div class="l">avg ticket</div></div>
        <div class="stat"><div class="v">${pct(k.error_pct)}</div><div class="l">error rate</div></div>
        <div class="stat"><div class="v">${n0(k.schools)}</div><div class="l">schools</div></div>
      </div>` : none('the key figures')}
      <h5>Daily spend</h5>
      ${daily ? '<div class="cwrap" style="height:150px"><canvas id="live-daily"></canvas></div>' : none('daily spend')}
      <h5>Top schools by spend</h5>
      ${top ? `<table class="mini"><tr><th>#</th><th>School</th><th style="text-align:right">Spend</th><th style="text-align:right">Txns</th></tr>
        ${top.rows.map((r, i) => `<tr class="click" role="button" tabindex="0" data-live-sid="${esc(r.school_id)}"><td>${i + 1}</td>
          <td><b>${esc(r.name || r.school_id)}</b></td><td class="num">${sgd(r.spend_sgd)}</td><td class="num">${n0(r.txns)}</td></tr>`).join('')}</table>`
        : none('top schools')}
      <h5>Terminals needing attention</h5>
      ${term ? `<table class="mini"><tr><th>Terminal</th><th>School</th><th style="text-align:right">Txns</th><th style="text-align:right">Errors</th><th style="text-align:right">Avg time</th></tr>
        ${term.rows.map((r) => `<tr><td>${esc(r.terminal_id)}</td><td>${esc(r.school_id || '–')}</td><td class="num">${n0(r.txns)}</td>
          <td class="num">${pct(r.error_pct)}</td><td class="num">${r.avg_ms == null ? '–' : `${(r.avg_ms / 1000).toFixed(1)}s`}</td></tr>`).join('')}</table>`
        : none('terminals')}
      <h5>Food category mix</h5>
      ${food ? `<table class="mini live-share"><tr><th>Category</th><th style="text-align:right">Spend</th><th style="text-align:right">Share</th></tr>
        ${food.rows.map((r) => { const s = foodTotal ? (100 * (r.spend_sgd || 0)) / foodTotal : 0;
          return `<tr><td>${esc(r.category)}</td><td class="num">${sgd(r.spend_sgd)}</td>
            <td class="num"><span class="live-bar" style="width:${Math.round(s)}%"></span>${s.toFixed(0)}%</td></tr>`; }).join('')}</table>`
        : none('the food mix')}
      <h5>Wearables</h5>
      ${wear ? `<div class="stats">
        <div class="stat"><div class="v">${n0(wear.active_users)}</div><div class="l">active users</div></div>
        <div class="stat"><div class="v">${n0(wear.avg_steps)}</div><div class="l">avg steps / day</div></div>
        <div class="stat"><div class="v">${wear.avg_hr == null ? '–' : `${Math.round(wear.avg_hr)} bpm`}</div><div class="l">avg heart rate</div></div>
      </div>${wear.rows?.length ? '<div class="cwrap" style="height:130px"><canvas id="live-wear"></canvas></div>' : ''}` : none('wearables')}
      <div class="cap live-foot">Answers from the live agent over Redshift, as of the last sync — not real-time.
        ${live.lastRun?.state === 'partial' ? `Last sync could not fill: ${esc(Object.keys(live.lastRun.failed || {}).join(', '))} (shown from an earlier sync, or empty).` : ''}</div>`;
    const day = (d) => d.slice(8);
    if (daily) charts.push(mk(body.querySelector('#live-daily'), { type: 'bar',
        data: { labels: daily.rows.map((r) => day(r.date)), datasets: [{ label: 'Spend (SGD)', data: daily.rows.map((r) => r.spend_sgd), ...bar(C.blue) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
    if (wear?.rows?.length) charts.push(mk(body.querySelector('#live-wear'), { type: 'line',
        data: { labels: wear.rows.map((r) => day(r.date)), datasets: [{ label: 'Avg steps', data: wear.rows.map((r) => r.avg_steps), ...line(C.aqua) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
    body.querySelectorAll('[data-live-sid]').forEach((tr) => tr.addEventListener('click', () => onSchool?.(tr.dataset.liveSid)));
}

// ── live map markers (a separate set from Demo's; Demo's are hidden by body.mode-live) ───────────
const liveMarkers = [];
const SCALE = ['#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];     // spend quintiles, light → dark
export function drawMap(map, maplibregl) {
    clearMap();
    const rows = P('map')?.rows || [];
    const spends = rows.map((r) => r.spend_sgd || 0).sort((a, b) => a - b);
    const q = (v) => { if (!spends.length) return 0; const i = spends.findIndex((x) => x >= v); return Math.min(4, Math.floor((5 * (i < 0 ? spends.length - 1 : i)) / spends.length)); };
    if (map) for (const r of rows) {
        const el = document.createElement('div');
        el.className = 'lmk';
        el.style.background = SCALE[q(r.spend_sgd || 0)];
        el.tabIndex = 0; el.setAttribute('role', 'button');
        el.title = `${r.name || r.school_id} — ${sgd(r.spend_sgd)} · ${n0(r.txns)} txns`;
        el.setAttribute('aria-label', el.title);
        const popup = new maplibregl.Popup({ offset: 10, closeButton: false }).setHTML(
            `<b>${esc(r.name || r.school_id)}</b><br>${esc(r.level || '')}${r.level ? ' · ' : ''}${esc(sgd(r.spend_sgd))} · ${esc(n0(r.txns))} txns`);
        liveMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).setPopup(popup).addTo(map));
    }
    paintLegend(rows.length, spends);
    return rows;
}
export function clearMap() {
    for (const m of liveMarkers.splice(0)) m.remove();
    document.getElementById('live-legend')?.remove();
}
export function flyTo(map, sid) {
    const r = P('map')?.rows?.find((x) => x.school_id === sid);
    if (!r || !map) return;
    map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 14) });
    liveMarkers.find((m) => m.getLngLat().lat === r.lat && m.getLngLat().lng === r.lng)?.togglePopup();
}
function paintLegend(n, spends) {
    const host = document.querySelector('.mapbl');
    if (!host) return;
    const lg = document.createElement('div');
    lg.id = 'live-legend'; lg.className = 'legend live-legend';
    lg.innerHTML = n
        ? `<div class="lg-title">Live · spend</div>${SCALE.map((c, i) => `<div class="li"><span class="dot" style="background:${c}"></span>${i === 0 ? 'lowest' : i === 4 ? 'highest' : ''}</div>`).join('')}
           <div class="foot">${n} schools · ${esc(monthLabel(live.month))}</div>`
        : `<div class="lg-title">Live</div><div class="li">${P('map') === null && Object.keys(live.panels).length ? 'Live map unavailable for this month' : 'No live map yet — press Sync'}</div>`;
    host.appendChild(lg);
}
