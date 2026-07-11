// Engineering — terminal (machine) fleet health. Filter by verdict / network /
// school; click a machine for the machine-vs-location diagnostic. February 2026.
// Verdicts were precomputed against school peers: bad unit + healthy peers = the
// machine; bad unit + struggling peers = the site (location/network).
import { openWindow } from './windowing.js';
import { mk, opts, ax, bar, line, C } from './charts.js';
import { vchip } from './stall-window.js';
import { monthLabel } from './sbData.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;
const dayLabels = (arr) => (arr || []).map((_, i) => i + 1);   // 1..N days, matches the month's data length
const secs = (ms) => ms == null ? '–' : (ms / 1000).toFixed(1) + 's';

export function openEng(DATA, preset = {}) {
    const body = openWindow({ id: 'eng', title: 'Terminal Health', sub: `machine-vs-location diagnostics · ${monthLabel(DATA.meta.month)}`, chips: ['<span class="chip chip-flag">ENGINEERING</span>'] });
    if (!body) return;
    const tw = body.closest('.tw');
    tw.style.width = '700px'; tw.style.left = '46px'; tw.style.top = '20px';

    const T = DATA.terminals;
    const nMach = T.filter((t) => t.verdict === 'machine').length;
    const nSite = T.filter((t) => t.verdict === 'site').length;
    const siteSchools = [...new Set(T.filter((t) => t.verdict === 'site').map((t) => t.school))];
    let verdict = preset.verdict || 'bad', net = 'All', qtext = preset.school || '', sort = 'err_pct';

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt(T.length)}</div><div class="l">machines</div></div>
        <div class="stat"><div class="v" style="color:var(--bad)">${nMach}</div><div class="l">machine faults</div></div>
        <div class="stat"><div class="v" style="color:var(--warn)">${nSite}</div><div class="l">site issues (${siteSchools.length} schools)</div></div>
        <div class="stat"><div class="v">${fmt(T.filter((t) => t.verdict === 'ok').length)}</div><div class="l">healthy</div></div>
      </div>
      <div class="fbar"><span class="fl">Search</span>
        <input id="en-q" class="finput" placeholder="school ID, machine number or stall…" value="${qtext}"></div>
      <div class="fbar" id="en-verd"><span class="fl">Status</span>
        <button data-v="bad" class="on">Needs attention</button><button data-v="machine">Machine faults</button>
        <button data-v="site">Site issues</button><button data-v="ok">Healthy</button><button data-v="all">All</button></div>
      <div class="fbar" id="en-net"><span class="fl">Network</span>
        <button data-v="All" class="on">All</button><button data-v="4G">4G</button>
        <button data-v="WIFI">WiFi</button><button data-v="ETHERNET">Ethernet</button></div>
      <div class="fbar"><span class="fl">Sort by</span>
        <button data-s="err_pct" class="on">Error rate</button><button data-s="med_ms">Slowest</button>
        <button data-s="n">Volume</button></div>
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

    const list = body.querySelector('#en-list');
    const count = body.querySelector('#en-count');
    function paint() {
        let rows = T;
        if (verdict === 'bad') rows = rows.filter((t) => t.verdict === 'machine' || t.verdict === 'site');
        else if (verdict !== 'all') rows = rows.filter((t) => t.verdict === verdict);
        if (net !== 'All') rows = rows.filter((t) => t.net === net);
        if (qtext) rows = rows.filter((t) =>
            t.school.toLowerCase().includes(qtext) || t.id.toLowerCase().includes(qtext) ||
            (t.storeName || '').toLowerCase().includes(qtext));
        rows = [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
        count.textContent = `${fmt(rows.length)} machines match — showing top ${Math.min(40, rows.length)}`;
        list.innerHTML = `<table class="mini"><tr><th>Machine</th><th>School</th><th>Stall</th><th>Net</th>
          <th style="text-align:right">Txns</th><th style="text-align:right">Err %</th>
          <th style="text-align:right">Median</th><th>Diagnosis</th></tr>
          ${rows.slice(0, 40).map((t) => `<tr style="cursor:pointer" data-tid="${t.id}">
            <td style="font-size:10.5px"><b>${mach(t.id)}</b></td><td>${t.school}</td>
            <td style="font-size:11px">${t.storeName || '–'}</td><td>${t.net || '–'}</td>
            <td class="num">${fmt(t.n)}</td>
            <td class="num" style="${t.err_pct >= 10 ? 'color:var(--bad);font-weight:600' : ''}">${t.err_pct}%</td>
            <td class="num">${secs(t.med_ms)}</td><td>${vchip(t.verdict)}</td></tr>`).join('')}</table>`;
        list.querySelectorAll('tr[data-tid]').forEach((tr) =>
            tr.addEventListener('click', () => openTerminal(DATA, tr.dataset.tid)));
    }
    paint();
}

export function openTerminal(DATA, tid) {
    const t = DATA.terminals.find((x) => x.id === tid);
    if (!t) return;
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
        <a href="#" data-stall>Open stall window →</a> &nbsp;·&nbsp; <a href="#" data-school>Open ${t.school} →</a></div>`;

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

    body.querySelector('[data-stall]').addEventListener('click', (e) => { e.preventDefault(); window.SB?.openStall(t.store); });
    body.querySelector('[data-school]').addEventListener('click', (e) => { e.preventDefault(); window.SB?.openSchool(t.school); });
}
