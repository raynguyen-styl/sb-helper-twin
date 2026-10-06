// Engineering — terminal (machine) fleet health. Filter by problem tag / network /
// school; click a machine for the machine-vs-location diagnostic; tick machines → "Plan route" gives
// service staff an ordered visit list. Month-aware (uses the selected month).
// Verdicts were precomputed against school peers: bad unit + healthy peers = the
// machine; bad unit + struggling peers = the site (location/network).
import { openWindow, info } from './windowing.js';
import { mk, opts, ax, bar, line, C } from './charts.js';
import { vchip } from './stall-window.js';
import { monthLabel } from './sbData.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;
const dayLabels = (arr) => (arr || []).map((_, i) => i + 1);   // 1..N days, matches the month's data length
const secs = (ms) => ms == null ? '–' : (ms / 1000).toFixed(1) + 's';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);   // feed text is data
// problem tags (bundles built before tags existed fall back to the verdict)
const probs = (t) => t.problems || (t.verdict && t.verdict !== 'ok' ? [t.verdict] : []);
const TAG = { machine: ['bad', 'MACHINE FAULT'], site: ['warn', 'SITE ISSUE'], check: ['other', 'NO PEERS'],
    slow: ['warn', 'SLOW'], stopped: ['bad', 'STOPPED'], offline: ['other', 'OFFLINE'], retrieved: ['flag', 'RETRIEVED'] };
const pchips = (t) => probs(t).length
    ? probs(t).map((p) => `<span class="chip chip-${(TAG[p] || ['other'])[0]}">${(TAG[p] || [0, esc(p)])[1]}</span>`).join(' ')
    : '<span class="chip chip-good">OK</span>';

// Service routes start here (OneMap coords for postal 408705). Keep in sync with mcp-service SERVICE_START.
const START = { name: 'STYL Service Center', address: '3015A Ubi Road 1, #06-02, Singapore 408705', lat: 1.328343, lng: 103.893102 };
// From the start, always go to the nearest unvisited school. Same rule as mcp-service plan_service_route.
// ponytail: greedy nearest-next on straight-line km, not road routing — OneMap routing API if drive times matter.
const km = (a, b) => {
    const r = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
};
function orderStops(start, stops) {
    const out = [], left = [...stops];
    let at = start, total = 0;
    while (left.length) {
        let i = 0;
        left.forEach((s, j) => { if (km(at, s) < km(at, left[i])) i = j; });
        const [s] = left.splice(i, 1), leg = km(at, s);
        total += leg;
        out.push({ ...s, leg_km: +leg.toFixed(1), cum_km: +total.toFixed(1) });
        at = s;
    }
    return out;
}

export function openEng(DATA, preset = {}) {
    if (!DATA || !DATA.meta || !(DATA.terminals && DATA.terminals.length)) {
        const b = openWindow({ id: 'eng', title: 'Terminal Health', sub: 'no data', chips: ['<span class="chip chip-flag">ENGINEERING</span>'] });
        if (b) b.innerHTML = `<div class="cap">No terminal / transaction data loaded for this month yet.</div>`;
        return;
    }
    const body = openWindow({ id: 'eng', title: 'Terminal Health', sub: `machine-vs-location diagnostics · ${monthLabel(DATA.meta.month)}`, chips: ['<span class="chip chip-flag">ENGINEERING</span>'] });
    if (!body) return;
    const tw = body.closest('.tw');
    tw.style.width = '700px'; tw.style.left = '46px'; tw.style.top = '20px';

    const T = DATA.terminals;
    const nMach = T.filter((t) => t.verdict === 'machine').length;
    const nSite = T.filter((t) => t.verdict === 'site').length;
    const siteSchools = [...new Set(T.filter((t) => t.verdict === 'site').map((t) => t.school))];
    let verdict = preset.verdict || 'bad', net = 'All', qtext = preset.school || '', sort = 'err_pct';
    const picked = new Set();      // machines chosen for a service route
    let matching = [];

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt(T.length)}</div><div class="l">machines</div></div>
        <div class="stat"><div class="v" style="color:var(--bad)">${nMach}</div><div class="l">machine faults</div></div>
        <div class="stat"><div class="v" style="color:var(--warn)">${nSite}</div><div class="l">site issues (${siteSchools.length} schools)</div></div>
        <div class="stat"><div class="v">${fmt(T.filter((t) => t.verdict === 'ok').length)}</div><div class="l">healthy</div></div>
      </div>
      <div class="fbar"><span class="fl">Search</span>
        <input id="en-q" class="finput" placeholder="school ID, machine number or stall…" value="${qtext}"></div>
      <div class="fbar" id="en-verd"><span class="fl">Problem</span>
        <button data-v="bad" class="on">Needs attention</button><button data-v="machine">Machine fault</button>
        <button data-v="site">Site issue</button><button data-v="slow">Slow</button><button data-v="stopped">Stopped</button>
        <button data-v="offline">High offline</button><button data-v="retrieved">Retrieved</button>
        <button data-v="ok">Healthy</button><button data-v="all">All</button></div>
      <div class="fbar" id="en-net"><span class="fl">Network</span>
        <button data-v="All" class="on">All</button><button data-v="4G">4G</button>
        <button data-v="WIFI">WiFi</button><button data-v="ETHERNET">Ethernet</button></div>
      <div class="fbar"><span class="fl">Sort by</span>
        <button data-s="err_pct" class="on">Error rate</button><button data-s="med_ms">Slowest</button>
        <button data-s="n">Volume</button></div>
      <div class="fbar"><span class="fl">Route</span>
        <button id="en-all">Select all matching</button><button id="en-none">Clear</button>
        <button id="en-route" class="on">Plan route (0)</button></div>
      <div class="cap" id="en-count" style="margin:6px 0 4px"></div>
      <div id="en-list"></div>`;

    body.querySelector('#en-q').addEventListener('input', (e) => { qtext = e.target.value.trim().toLowerCase(); paint(); });
    body.querySelectorAll('#en-verd button').forEach((b) =>
        b.addEventListener('click', () => { verdict = b.dataset.v; onPill(b); paint(); }));
    body.querySelectorAll('#en-net button').forEach((b) =>
        b.addEventListener('click', () => { net = b.dataset.v; onPill(b); paint(); }));
    body.querySelectorAll('[data-s]').forEach((b) =>
        b.addEventListener('click', () => { sort = b.dataset.s; onPill(b); paint(); }));
    function onPill(b) { b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }
    const routeBtn = body.querySelector('#en-route');
    const repick = () => { routeBtn.textContent = `Plan route (${picked.size})`; };
    body.querySelector('#en-all').addEventListener('click', () => { matching.forEach((t) => picked.add(t.id)); repick(); paint(); });
    body.querySelector('#en-none').addEventListener('click', () => { picked.clear(); repick(); paint(); });
    routeBtn.addEventListener('click', () => { if (picked.size) openRoute(DATA, [...picked]); });

    const list = body.querySelector('#en-list');
    const count = body.querySelector('#en-count');
    function paint() {
        let rows = T;
        if (verdict === 'bad') rows = rows.filter((t) => probs(t).length);
        else if (verdict === 'ok') rows = rows.filter((t) => !probs(t).length);
        else if (verdict !== 'all') rows = rows.filter((t) => probs(t).includes(verdict));
        if (net !== 'All') rows = rows.filter((t) => t.net === net);
        if (qtext) rows = rows.filter((t) =>
            t.school.toLowerCase().includes(qtext) || t.id.toLowerCase().includes(qtext) ||
            (t.storeName || '').toLowerCase().includes(qtext));
        rows = [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
        matching = rows;
        count.textContent = `${fmt(rows.length)} machines match — showing top ${Math.min(40, rows.length)} · tick machines to plan a route`;
        list.innerHTML = `<table class="mini"><tr><th></th><th>Machine</th><th>School</th><th>Stall</th><th>Net</th>
          <th style="text-align:right">Txns</th><th style="text-align:right">Err %</th>
          <th style="text-align:right">Median</th><th>Problems</th></tr>
          ${rows.slice(0, 40).map((t) => `<tr style="cursor:pointer" data-tid="${t.id}">
            <td><input type="checkbox" data-pick="${t.id}" aria-label="Add ${t.id} to route" ${picked.has(t.id) ? 'checked' : ''}></td>
            <td style="font-size:10.5px"><b>${mach(t.id)}</b></td><td title="${esc(t.school_name)}">${t.school}</td>
            <td style="font-size:11px">${esc(t.storeName) || '–'}</td><td>${t.net || '–'}</td>
            <td class="num">${fmt(t.n)}</td>
            <td class="num" style="${t.err_pct >= 10 ? 'color:var(--bad);font-weight:600' : ''}">${t.err_pct}%</td>
            <td class="num">${secs(t.med_ms)}</td><td>${pchips(t)}</td></tr>`).join('')}</table>`;
        list.querySelectorAll('tr[data-tid]').forEach((tr) =>
            tr.addEventListener('click', (e) => { if (!e.target.closest('input')) openTerminal(DATA, tr.dataset.tid); }));
        list.querySelectorAll('input[data-pick]').forEach((cb) => cb.addEventListener('change', () => {
            if (cb.checked) picked.add(cb.dataset.pick); else picked.delete(cb.dataset.pick);
            repick();
        }));
    }
    paint();
}

export function openTerminal(DATA, tid) {
    const t = DATA && DATA.terminals && DATA.terminals.find((x) => x.id === tid);
    if (!t) return;
    // vendor machine (PBS/SSSTM) → its stall's host school(s); none if unconfirmed
    const st = DATA.stalls?.find((x) => x.id === t.store);
    const homes = t.school === 'PBS' || t.school === 'SSSTM' ? (st?.campus || (st?.host ? [st.host] : [])) : [t.school];
    const body = openWindow({ id: `term-${tid}`, title: mach(t.id), sub: `${t.storeName || t.store} · ${t.school}`,
        chips: [vchip(t.verdict)] });
    if (!body) return;
    body.closest('.tw').style.width = '560px';

    const diag = t.verdict === 'machine'
        ? `<b>This unit is the problem.</b> It runs ${t.err_pct}% errors while the other machines at
           ${t.school} average ${t.peer_err}% — the location is fine. Recommend servicing/replacing this reader.`
        : t.verdict === 'site'
        ? `<b>The location is the problem.</b> This unit runs ${t.err_pct}% errors, but its school peers also
           average ${t.peer_err}% — the whole site struggles (signal/network/environment), swapping the machine
           won't fix it. Investigate ${t.school}'s connectivity.`
        : t.verdict === 'check'
        ? `Elevated readings, but there are too few peer machines at ${t.school} to separate machine from
           location. Needs a field check.`
        : `Operating normally — ${t.err_pct}% errors vs ${t.peer_err ?? '–'}% school average, median ${secs(t.med_ms)}.`;

    body.innerHTML = `
      <div class="callout-${t.verdict === 'machine' ? 'bad' : t.verdict === 'site' ? 'warn' : 'ok'}">${diag}</div>
      <div class="cap" style="margin:6px 0">${pchips(t)}${t.last_day ? ` &nbsp;Last transaction ${t.last_day}${t.silent ? ` (${t.silent} school day${t.silent > 1 ? 's' : ''} silent)` : ''}${t.sites > 1 ? ` · moved this month (${t.sites} sites; shown at the latest)` : ''}` : ''}${t.postal ? ` · ${esc(t.school_name)}, S${t.postal}` : ''}</div>
      <div class="stats">
        <div class="stat"><div class="v">${fmt(t.n)}</div><div class="l">txns</div></div>
        <div class="stat"><div class="v" style="${t.err_pct >= 10 ? 'color:var(--bad)' : ''}">${t.err_pct}%</div><div class="l">errors (school ${t.peer_err ?? '–'}%)</div></div>
        <div class="stat"><div class="v">${secs(t.med_ms)}</div><div class="l">median (school ${secs(t.peer_ms)})</div></div>
        <div class="stat"><div class="v">${secs(t.p95_ms)}</div><div class="l">p95</div></div>
        <div class="stat"><div class="v">${t.off_pct}%</div><div class="l">offline</div></div>
        <div class="stat"><div class="v">${t.net || '–'}${t.sig != null ? ' · ' + t.sig : ''}${t.rssi != null ? ' · ' + t.rssi + 'dBm' : ''}</div><div class="l">network · signal</div></div>
      </div>
      <h5>Daily error rate vs school peers</h5>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Daily median speed</h5>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Where the time goes (median ms per phase)</h5>
      <div class="cwrap" style="height:120px"><canvas></canvas></div>
      <div class="cap" style="margin-top:8px">
        ${st ? '<a href="#" data-stall>Open stall window →</a>' : ''}${homes.map((h, i) => `${st || i ? ' &nbsp;·&nbsp; ' : ''}<a href="#" data-school="${h}">Open ${h} →</a>`).join('')}</div>`;

    const [c1, c2, c3] = body.querySelectorAll('canvas');
    const DL = dayLabels(t.daily_err.length ? t.daily_err : t.daily_ms);
    mk(c1, { type: 'line', data: { labels: DL, datasets: [
        { label: 'this machine', data: t.daily_err, ...line(C.red), spanGaps: true },
        { label: `school avg (${t.peer_err ?? '–'}%)`, data: DL.map(() => t.peer_err), ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }) },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c2, { type: 'line', data: { labels: DL, datasets: [
        { label: 'median ms', data: t.daily_ms, ...line(C.blue), spanGaps: true },
        { label: `school (${secs(t.peer_ms)})`, data: DL.map(() => t.peer_ms), ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }) },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ ticks: { callback: (v) => (v / 1000) + 's' } }) } }) });
    const comp = t.comp || {};
    mk(c3, { type: 'bar', data: { labels: ['check signal', 'open socket', 'handshake', 'transfer', 'tap→finish'],
        datasets: [{ label: 'ms', data: [comp.sigck, comp.sock, comp.hshake, comp.xfer, comp.tap], ...bar(C.violet) }] },
        options: { ...opts({ scales: { x: ax(), y: ax({ ticks: { font: { size: 9 } } }) } }), indexAxis: 'y' } });

    body.querySelector('[data-stall]')?.addEventListener('click', (e) => { e.preventDefault(); window.SB?.openStall(t.store); });
    body.querySelectorAll('[data-school]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.SB?.openSchool(a.dataset.school); }));
}

// Ordered visit list for the machines a service staff member ticked: one stop per school, nearest-next
// from the Service Center. Vendor (PBS/SSSTM) machines have no service location yet → listed, not routed.
export function openRoute(DATA, ids) {
    const pick = new Set(ids);
    const sel = DATA.terminals.filter((t) => pick.has(t.id));
    const bySchool = new Map(), off = [];
    for (const t of sel) {
        if (t.lat == null || t.lng == null) { off.push(t); continue; }
        if (!bySchool.has(t.school)) bySchool.set(t.school, { school: t.school, name: t.school_name, postal: t.postal,
            zone: t.zone, lat: t.lat, lng: t.lng, machines: [] });
        bySchool.get(t.school).machines.push(t);
    }
    const stops = orderStops(START, [...bySchool.values()]);
    const total = stops.length ? stops[stops.length - 1].cum_km : 0;
    document.querySelector('[data-win="route"]')?.remove();      // re-plan replaces the old route
    const body = openWindow({ id: 'route', title: 'Service route',
        sub: `${stops.length} stops · ${sel.length} machines · ${monthLabel(DATA.meta.month)}`,
        chips: ['<span class="chip chip-flag">ENGINEERING</span>'] });
    if (!body) return;
    body.closest('.tw').style.width = '640px';
    body.innerHTML = `
      <div class="cap" style="margin-bottom:6px">Start: <b>${START.name}</b>, ${START.address} → nearest next school each time.
        <b>${total} km</b> straight-line ${info(`Distances are straight-line, not driving routes. Problems describe ${monthLabel(DATA.meta.month)}'s data, not today.`)}</div>
      <table class="mini"><tr><th>#</th><th>School</th><th>Postal</th><th style="text-align:right">Leg</th><th>Machines to fix</th></tr>
        ${stops.map((s, i) => `<tr><td class="num">${i + 1}</td>
          <td><a href="#" data-school="${s.school}">${esc(s.name || s.school)}</a>
            <div style="font-size:10.5px;color:var(--ink-muted-48)">${s.school}${s.zone ? ' · ' + esc(s.zone) : ''}</div></td>
          <td>${s.postal ? 'S' + esc(s.postal) : '–'}</td><td class="num">${s.leg_km} km</td>
          <td>${s.machines.map((m) => `<div style="font-size:11px;margin:2px 0"><a href="#" data-tid="${m.id}">${m.id}</a>
            · ${esc(m.storeName || m.store)} ${pchips(m)}</div>`).join('')}</td></tr>`).join('')}
      </table>
      ${off.length ? `<div class="note-box" style="margin-top:8px"><b>Not routed (${off.length})</b> — no confirmed service
        location yet (PBS bookshop / stamp machines): ${off.map((m) => `${m.id} (${esc(m.storeName || m.store)})`).join(', ')}</div>` : ''}`;
    body.querySelectorAll('[data-school]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.SB?.openSchool(a.dataset.school); }));
    body.querySelectorAll('[data-tid]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openTerminal(DATA, a.dataset.tid); }));
}
