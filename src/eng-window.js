// Terminals — the machine fleet's health (central-specs capability dashboard-views). Health cards (Healthy, Needs
// attention, Machine fault, Site issue) filter the list; search, problem, network and sort narrow it; ticked
// machines collect in a sticky bar whose "Plan route (n)" gives service staff an ordered visit list. A machine opens
// its machine-vs-location diagnostic. Month-aware. Verdicts were precomputed against school peers: bad unit +
// healthy peers = the machine; bad unit + struggling peers = the site (location/network).
import { openWindow, closeView, info, esc } from './windowing.js';
import { mk, opts, ax, bar, line, C } from './charts.js';
import { vchip } from './stall-window.js';
import { monthLabel } from './sbData.js';
import { pinButton } from './compare.js';
import { kpis, moreKpis, section, chart, tableCard, emptyNote, icon, fmt, pct, secs } from './ui.js';

const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;
const dayLabels = (arr) => (arr || []).map((_, i) => i + 1);   // 1..N days, matches the month's data length
// problem tags (bundles built before tags existed fall back to the verdict)
const probs = (t) => t.problems || (t.verdict && t.verdict !== 'ok' ? [t.verdict] : []);
const TAG = { machine: ['bad', 'Machine fault'], site: ['warn', 'Site issue'], check: ['other', 'No peers'],
    slow: ['warn', 'Slow'], stopped: ['bad', 'Stopped'], offline: ['other', 'High offline'], retrieved: ['flag', 'Retrieved'] };
const pchips = (t) => probs(t).length
    ? probs(t).map((p) => `<span class="chip chip-${(TAG[p] || ['other'])[0]}">${TAG[p]?.[1] || esc(p)}</span>`).join(' ')
    : '<span class="chip chip-good">OK</span>';
const PROBLEMS = [['bad', 'Needs attention'], ['machine', 'Machine fault'], ['site', 'Site issue'], ['slow', 'Slow'],
    ['stopped', 'Stopped'], ['offline', 'High offline'], ['retrieved', 'Retrieved'], ['ok', 'Healthy'], ['all', 'All machines']];

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
        const b = openWindow({ id: 'eng', title: 'Terminal Health', chips: [] });
        if (b) b.innerHTML = emptyNote('No terminal data loaded for this month yet.');
        return;
    }
    const body = openWindow({ id: 'eng', title: 'Terminal Health', chips: [], wide: true });
    if (!body) return;

    const T = DATA.terminals;
    const count = (v) => T.filter((t) => v === 'bad' ? probs(t).length : v === 'ok' ? !probs(t).length : probs(t).includes(v)).length;
    const siteSchools = new Set(T.filter((t) => probs(t).includes('site')).map((t) => t.school)).size;
    let verdict = preset.verdict || 'bad', net = 'All', qtext = (preset.school || '').toLowerCase(), sort = 'err_pct';
    const picked = new Set();      // machines chosen for a service route
    let matching = [];
    const CARDS = [
        ['ok', 'Healthy', 'healthy', `of ${fmt(T.length)} machines`],
        ['bad', 'Needs attention', 'attention', 'any problem tag'],
        ['machine', 'Machine fault', 'fault', 'service the unit'],
        ['site', 'Site issue', 'site', `${fmt(siteSchools)} school${siteSchools === 1 ? '' : 's'}`],
    ];

    body.innerHTML = `
      <div class="health" id="en-verd" role="group" aria-label="Filter by health">${CARDS.map(([v, l, ic, s]) => `
        <button type="button" class="hc" data-v="${v}" aria-pressed="${v === verdict}">
          <span class="l">${icon(ic)}${l}</span><span class="v">${fmt(count(v))}</span><span class="s">${s}</span></button>`).join('')}</div>
      ${section({ title: 'Machines', id: 'machines',
          take: `<span id="en-take"></span>`,
          tip: 'Diagnosis compares each machine with the other machines at its school: machine fault = service the unit; site issue = the location (signal, network) is the problem. Tick machines to plan a service route.',
          body: `<div class="fgrid">
              <input id="en-q" class="finput" type="search" placeholder="School, machine number or stall…" aria-label="Search machines" value="${esc(qtext)}">
              <select class="sel" id="en-prob" aria-label="Problem">${PROBLEMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
              <select class="sel" id="en-net" aria-label="Network"><option value="All">All networks</option><option value="4G">4G</option><option value="WIFI">Wi-Fi</option><option value="ETHERNET">Ethernet</option></select>
              <select class="sel" id="en-sort" aria-label="Sort by"><option value="err_pct">Error rate</option><option value="med_ms">Slowest</option><option value="n">Most taps</option></select>
            </div>
            <p class="count-line" id="en-count" role="status"></p>
            <div id="en-list"></div>` })}
      <div class="route-bar" id="en-routebar">
        <span class="grow" id="en-picked">No machines ticked</span>
        <button type="button" class="btn" id="en-all" title="Tick every machine that matches the filters">Tick all</button>
        <button type="button" class="btn" id="en-none">Clear</button>
        <button type="button" class="btn primary" id="en-route" disabled>${icon('route')}Plan route (0)</button>
      </div>`;

    const probSel = body.querySelector('#en-prob'), netSel = body.querySelector('#en-net'), sortSel = body.querySelector('#en-sort');
    probSel.value = verdict;
    const setVerdict = (v) => {
        verdict = v; probSel.value = v;
        body.querySelectorAll('#en-verd .hc').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
        paint();
    };
    body.querySelector('#en-verd').addEventListener('click', (e) => { const b = e.target.closest('.hc'); if (b) setVerdict(b.dataset.v); });
    probSel.addEventListener('change', () => setVerdict(probSel.value));
    netSel.addEventListener('change', () => { net = netSel.value; paint(); });
    sortSel.addEventListener('change', () => { sort = sortSel.value; paint(); });
    body.querySelector('#en-q').addEventListener('input', (e) => { qtext = e.target.value.trim().toLowerCase(); paint(); });
    const routeBtn = body.querySelector('#en-route'), pickedEl = body.querySelector('#en-picked');
    const repick = () => {
        routeBtn.lastChild.textContent = `Plan route (${picked.size})`;
        routeBtn.disabled = !picked.size;
        pickedEl.textContent = picked.size ? `${picked.size} machine${picked.size > 1 ? 's' : ''} ticked` : 'No machines ticked';
    };
    body.querySelector('#en-all').addEventListener('click', () => { matching.forEach((t) => picked.add(t.id)); repick(); paint(); });
    body.querySelector('#en-none').addEventListener('click', () => { picked.clear(); repick(); paint(); });
    routeBtn.addEventListener('click', () => { if (picked.size) openRoute(DATA, [...picked]); });

    const list = body.querySelector('#en-list'), countEl = body.querySelector('#en-count'), take = body.querySelector('#en-take');
    function paint() {
        let rows = T;
        if (verdict === 'bad') rows = rows.filter((t) => probs(t).length);
        else if (verdict === 'ok') rows = rows.filter((t) => !probs(t).length);
        else if (verdict !== 'all') rows = rows.filter((t) => probs(t).includes(verdict));
        if (net !== 'All') rows = rows.filter((t) => t.net === net);
        if (qtext) rows = rows.filter((t) =>
            t.school.toLowerCase().includes(qtext) || t.id.toLowerCase().includes(qtext) || (t.storeName || '').toLowerCase().includes(qtext));
        rows = [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
        matching = rows;
        const label = PROBLEMS.find(([v]) => v === verdict)[1];
        take.innerHTML = `<b>${fmt(count('bad'))}</b> of ${fmt(T.length)} machines need attention in ${monthLabel(DATA.meta.month)}. Tick machines to plan a visit.`;
        countEl.textContent = `${fmt(rows.length)} machine${rows.length === 1 ? '' : 's'} · ${label}${rows.length > 40 ? ' — showing the first 40' : ''}`;
        list.innerHTML = rows.length ? tableCard(`<tr><th>Machine</th><th>School</th><th>Stall</th><th>Net</th>
              <th class="num">Taps</th><th class="num">Errors</th><th class="num">Median</th><th>Problems</th></tr>`,
            rows.slice(0, 40).map((t) => `<tr class="click" role="button" tabindex="0" data-tid="${esc(t.id)}" data-sid="${esc(t.school)}">
              <td><label class="pick" title="Add to the route"><input type="checkbox" class="cb" data-pick="${esc(t.id)}" aria-label="Add ${esc(t.id)} to the route" ${picked.has(t.id) ? 'checked' : ''}>
                <b class="mono">${esc(mach(t.id))}</b></label></td>
              <td title="${esc(t.school_name)}">${esc(t.school)}</td>
              <td><span class="trunc">${esc(t.storeName) || '–'}</span></td><td>${esc(t.net) || '–'}</td>
              <td class="num">${fmt(t.n)}</td>
              <td class="num"><span class="${t.err_pct >= 10 ? 'pill-bad' : ''}">${pct(t.err_pct)}</span></td>
              <td class="num">${secs(t.med_ms)}</td><td>${pchips(t)}</td></tr>`).join(''))
            : emptyNote('No machine matches these filters.');
        list.querySelectorAll('tr[data-tid]').forEach((tr) =>
            tr.addEventListener('click', (e) => { if (!e.target.closest('.pick')) openTerminal(DATA, tr.dataset.tid); }));
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
    pinButton(body, 'terminal', t);

    const diag = t.verdict === 'machine'
        ? `<b>This unit is the problem.</b> It runs ${pct(t.err_pct)} errors while the other machines at
           ${esc(t.school)} average ${pct(t.peer_err)} — the location is fine. Service or replace this reader.`
        : t.verdict === 'site'
        ? `<b>The location is the problem.</b> This unit runs ${pct(t.err_pct)} errors, but its school peers also
           average ${pct(t.peer_err)} — the whole site struggles (signal, network, environment); swapping the machine
           won't fix it. Check ${esc(t.school)}'s connectivity.`
        : t.verdict === 'check'
        ? `Elevated readings, but there are too few other machines at ${esc(t.school)} to separate machine from
           location. Needs a field check.`
        : `Operating normally — ${pct(t.err_pct)} errors against a school average of ${pct(t.peer_err)}, median ${secs(t.med_ms)}.`;

    body.innerHTML = `
      <div class="callout-${t.verdict === 'machine' ? 'bad' : t.verdict === 'site' ? 'warn' : 'ok'}">${diag}</div>
      <div class="fbar">${pchips(t)}<span class="count-line">${t.last_day ? `Last payment ${esc(t.last_day)}${t.silent ? ` (${t.silent} school day${t.silent > 1 ? 's' : ''} silent)` : ''}${t.sites > 1 ? ` · moved this month (${t.sites} sites; shown at the latest)` : ''}` : ''}${t.postal ? ` · ${esc(t.school_name)}, S${esc(t.postal)}` : ''}</span></div>
      ${kpis([
          { l: 'Taps', v: fmt(t.n) },
          { l: 'Errors', v: pct(t.err_pct), s: `school ${pct(t.peer_err)}`, tone: t.err_pct >= 10 ? 'bad' : '' },
          { l: 'Median', v: secs(t.med_ms), s: `school ${secs(t.peer_ms)}` },
          { l: 'Offline', v: pct(t.off_pct) },
      ])}
      ${moreKpis([
          { l: 'Slowest 5% (p95)', v: secs(t.p95_ms) },
          { l: 'Network · signal', v: `${esc(t.net) || '–'}${t.sig != null ? ' · ' + t.sig : ''}${t.rssi != null ? ' · ' + t.rssi + ' dBm' : ''}` },
      ])}
      ${section({ title: 'Daily errors against the school', take: `The dashed line is the school's average (${pct(t.peer_err)}).`, body: chart() })}
      ${section({ title: 'Daily median speed', take: `The dashed line is the school's median (${secs(t.peer_ms)}).`, body: chart() })}
      ${section({ title: 'Where the time goes', take: 'Median milliseconds per phase of a payment.', body: chart({ h: 150 }) })}
      <div class="fbar">${st ? '<button type="button" class="btn" data-stall>Open the stall</button>' : ''}${homes.map((h) => `<button type="button" class="btn" data-school="${esc(h)}">Open ${esc(h)}</button>`).join('')}</div>`;

    const [c1, c2, c3] = body.querySelectorAll('canvas');
    const DL = dayLabels(t.daily_err?.length ? t.daily_err : t.daily_ms);
    mk(c1, { type: 'line', numbers: { label: 'Day', fmt: (v) => pct(v) }, data: { labels: DL, datasets: [
        { label: 'This machine', data: t.daily_err, ...line(C.red), spanGaps: true },
        { label: 'School average', data: DL.map(() => t.peer_err), ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }), numbersHide: true },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c2, { type: 'line', numbers: { label: 'Day', fmt: (v) => secs(v) }, data: { labels: DL, datasets: [
        { label: 'This machine', data: t.daily_ms, ...line(C.blue), spanGaps: true },
        { label: 'School median', data: DL.map(() => t.peer_ms), ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }), numbersHide: true },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ ticks: { callback: (v) => (v / 1000) + ' s' } }) } }) });
    const comp = t.comp || {};
    mk(c3, { type: 'bar', numbers: { label: 'Phase', fmt: (v) => (v == null ? '–' : `${fmt(v)} ms`) },
        data: { labels: ['Check signal', 'Open socket', 'Handshake', 'Transfer', 'Tap to finish'],
            datasets: [{ label: 'Median ms', data: [comp.sigck, comp.sock, comp.hshake, comp.xfer, comp.tap], ...bar(C.violet) }] },
        options: opts({ indexAxis: 'y', scales: { x: ax({ beginAtZero: true }), y: ax({ grid: { display: false } }) } }) });

    body.querySelector('[data-stall]')?.addEventListener('click', () => window.SB?.openStall(t.store));
    body.querySelectorAll('[data-school]').forEach((a) => a.addEventListener('click', () => window.SB?.focusSchool(a.dataset.school)));
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
    closeView('route');      // re-plan replaces the old route
    const body = openWindow({ id: 'route', title: 'Service route', sub: `${stops.length} stops · ${sel.length} machines`, chips: [], wide: true });
    if (!body) return;
    body.innerHTML = `
      ${kpis([{ l: 'Stops', v: fmt(stops.length) }, { l: 'Machines', v: fmt(sel.length) }, { l: 'Distance', v: `${total} km`, s: 'straight line' }])}
      ${section({ title: 'Visit order',
          take: `From <b>${START.name}</b>, ${START.address}, to the nearest next school each time.`,
          tip: `Distances are straight-line, not driving routes. Problems describe ${monthLabel(DATA.meta.month)}'s data, not today.`,
          body: stops.length ? tableCard(`<tr><th>Stop</th><th>Postal</th><th class="num">Leg</th><th>Machines to fix</th></tr>`,
            stops.map((s, i) => `<tr data-sid="${esc(s.school)}"><td><b>${i + 1}.</b> <button type="button" class="linkish" data-school="${esc(s.school)}">${esc(s.name || s.school)}</button>
                <div class="sub-id">${esc(s.school)}${s.zone ? ' · ' + esc(s.zone) : ''}</div></td>
              <td>${s.postal ? 'S' + esc(s.postal) : '–'}</td><td class="num">${s.leg_km} km</td>
              <td>${s.machines.map((m) => `<div class="route-m"><button type="button" class="linkish mono" data-tid="${esc(m.id)}">${esc(m.id)}</button>
                · ${esc(m.storeName || m.store)} ${pchips(m)}</div>`).join('')}</td></tr>`).join(''))
            : emptyNote('None of the ticked machines has a service location.') })}
      ${off.length ? `<div class="note-box"><b>Not routed (${off.length})</b> — no confirmed service location yet (PBS bookshop and
        stamp machines): ${off.map((m) => `${esc(m.id)} (${esc(m.storeName || m.store)})`).join(', ')}</div>` : ''}`;
    body.querySelectorAll('[data-school]').forEach((a) => a.addEventListener('click', () => window.SB?.focusSchool(a.dataset.school)));
    body.querySelectorAll('[data-tid]').forEach((a) => a.addEventListener('click', () => openTerminal(DATA, a.dataset.tid)));
}
