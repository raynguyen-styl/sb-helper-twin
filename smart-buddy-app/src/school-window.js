// Per-school detail window: Spending & Food / Network / Speed tabs.
import { openWindow } from './windowing.js';
import { mk, opts, ax, bar, line, C, CAT_COLOR } from './charts.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const CATS = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Fruits', 'Bookshop & Supplies', 'Unclassified'];
const LV_CHIP = { Primary: 'chip-pri', Secondary: 'chip-sec', 'Junior College': 'chip-jc', Other: 'chip-other' };

export function openSchool(s, GLOBAL, netMix) {
    const chips = [`<span class="chip ${LV_CHIP[s.level] || 'chip-other'}">${s.level}</span>`];
    if (s.moe_type === 'INDEPENDENT SCHOOL') chips.push('<span class="chip chip-indep">Independent</span>');
    if (s.ip) chips.push('<span class="chip chip-flag">IP</span>');
    if (s.gifted) chips.push('<span class="chip chip-flag">GEP</span>');
    if (s.sap) chips.push('<span class="chip chip-flag">SAP</span>');

    const body = openWindow({
        id: `school-${s.id}`,
        title: s.name || s.id,
        sub: s.name ? `${s.id}${s.area ? ' · ' + titleCase(s.area) : ''}` : 'ID not matched to MOE directory',
        chips,
    });
    if (!body) return;

    body.innerHTML = `
      <div class="stats">
        ${stat(s.spend_day != null ? '$' + s.spend_day.toFixed(2) : '–', 'spend / card·day')}
        ${stat('$' + s.avg_ticket.toFixed(2), 'avg ticket')}
        ${stat(fmt(s.n), 'transactions')}
        ${stat(s.cards ? fmt(s.cards) : '–', 'cards')}
        ${stat(pctCell(s.err_pct, 5, 10), 'error rate')}
        ${stat(s.med_ms ? (s.med_ms / 1000).toFixed(1) + 's' : '–', 'median txn')}
      </div>
      <div class="tabs">
        <button data-tab="spend" class="on">Spending &amp; Food</button>
        <button data-tab="net">Network</button>
        <button data-tab="speed">Speed</button>
      </div>
      <div data-pane="spend"></div>
      <div data-pane="net" style="display:none"></div>
      <div data-pane="speed" style="display:none"></div>
      <div class="cap" style="margin-top:10px"><a href="#" data-open-stalls>Browse this school's stalls &amp; machines →</a></div>`;
    body.querySelector('[data-open-stalls]').addEventListener('click', (e) => {
        e.preventDefault(); window.SB?.openStalls({ school: s.id });
    });

    body.querySelectorAll('.tabs button').forEach((b) =>
        b.addEventListener('click', () => {
            body.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
            body.querySelectorAll('[data-pane]').forEach((p) =>
                (p.style.display = p.dataset.pane === b.dataset.tab ? '' : 'none'));
        }));

    renderSpend(body.querySelector('[data-pane="spend"]'), s, GLOBAL);
    renderNet(body.querySelector('[data-pane="net"]'), s, GLOBAL);
    renderSpeed(body.querySelector('[data-pane="speed"]'), s, GLOBAL, netMix);
}

const stat = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
const pctCell = (v, warn, bad) =>
    `<span class="${v >= bad ? 'pill-bad' : v >= warn ? 'pill-warn' : 'pill-good'}">${v}%</span>`;
const titleCase = (x) => String(x || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function renderSpend(el, s, GLOBAL) {
    el.innerHTML = `
      <h5>Weekly canteen revenue</h5><div class="cap">Total $ per week at this school.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>What sells here vs the network</h5>
      <div class="cap">Categories from name-verified stalls only; generic-named stalls ("Stall 1") show as
      Unclassified — what they sell is never guessed.</div>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2] = el.querySelectorAll('canvas');
    const wk = [...(s.wk_spend || [])].sort((a, b) => a.week.localeCompare(b.week));
    mk(c1, { type: 'line',
        data: { labels: wk.map((r) => r.week.slice(5, 10)), datasets: [{ ...line(C.blue), label: '$', data: wk.map((r) => r.sgd) }] },
        options: opts({ indexMode: true, tooltip: { callbacks: { label: (c) => ` $${fmt(c.parsed.y)} · ${fmt(wk[c.dataIndex].n)} txns` } },
            scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => '$' + (v >= 1000 ? v / 1000 + 'k' : v) } }) } }) });
    const totalMix = {}; let tot = 0;
    GLOBAL.food_mix.forEach((r) => { totalMix[r.mcat] = r.n; tot += r.n; });
    mk(c2, { type: 'bar',
        data: { labels: CATS, datasets: [
            { ...bar(C.blue), label: s.id, data: CATS.map((c) => 100 * (s.mix[c] || 0)) },
            { ...bar('#d3d2cd'), label: 'Network', data: CATS.map((c) => 100 * (totalMix[c] || 0) / tot) }] },
        options: opts({ legend: true, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } },
            scales: { x: ax({ grid: { display: false }, ticks: { autoSkip: false, maxRotation: 45, font: { size: 9 } } }),
                y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
}

function renderNet(el, s, GLOBAL) {
    const terms = GLOBAL.terminals.filter((t) => t.school === s.id).sort((a, b) => b.err_pct - a.err_pct);
    el.innerHTML = `
      <div class="stats">
        ${stat(s.terminals, 'terminals')}
        ${stat(s.wifi_terms || 0, 'on WiFi')}
        ${stat(s.med_sig != null ? s.med_sig + '/31' : '–', 'median 4G signal')}
        ${stat(pctCell(s.offline_pct, 25, 45), 'offline share')}
      </div>
      <h5>Terminals at this school</h5>
      <div class="cap">Ranked by error rate. Signal is the 0–31 cellular scale; WiFi units show dBm instead.</div>
      <table class="mini"><tr><th>Terminal</th><th>Net</th><th style="text-align:right">Txns</th>
        <th style="text-align:right">Signal</th><th style="text-align:right">Median</th>
        <th style="text-align:right">Err %</th><th style="text-align:right">Offline %</th></tr>
        ${terms.map((t) => `<tr><td style="font-size:10.5px">…${t.terminalId.slice(-11)}</td><td>${t.net || '–'}</td>
          <td class="num">${fmt(t.n)}</td>
          <td class="num">${t.net === 'WIFI' ? (t.med_rssi != null ? t.med_rssi + ' dBm' : '–') : (t.med_sig != null ? t.med_sig : '–')}</td>
          <td class="num">${(t.med_ms / 1000).toFixed(1)}s</td>
          <td class="num">${pctCell(t.err_pct, 8, 12)}</td><td class="num">${t.offline_pct}%</td></tr>`).join('')}
      </table>
      ${terms.length === 0 ? '<div class="note-box">No terminals with ≥200 transactions.</div>' : ''}`;
}

function renderSpeed(el, s, GLOBAL, netMix) {
    el.innerHTML = `
      <h5>Median transaction time — weekly</h5>
      <div class="cap">This school vs the whole network. p95 here: ${s.p95_ms ? (s.p95_ms / 1000).toFixed(1) + 's' : '–'}.</div>
      <div class="cwrap tall"><canvas></canvas></div>
      <div class="note-box">Network medians by connection: ${netMix.map((n) =>
          `${n.posNetworkType} ${(n.med_ms / 1000).toFixed(1)}s`).join(' · ')}. Slow schools usually trace to
          "3.0 ASCAN" readers or weak-signal terminals — check the Network tab.</div>`;
    const wk = [...(s.wk_speed || [])].sort((a, b) => a.week.localeCompare(b.week));
    const gw = {}; // network weekly median from daily data
    GLOBAL.daily.forEach((d) => { const w = weekOf(d.date); (gw[w] ||= []).push(d.med_ms); });
    const labels = wk.map((r) => r.week.slice(0, 10));
    mk(el.querySelector('canvas'), { type: 'line',
        data: { labels: labels.map((l) => l.slice(5)), datasets: [
            { ...line(C.blue), label: s.id, data: wk.map((r) => r.med_ms / 1000) },
            { ...line(C.muted, { borderDash: [5, 3] }), label: 'Network', data: labels.map((l) => {
                const xs = gw[l] || []; return xs.length ? median(xs) / 1000 : null; }) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ ticks: { callback: (v) => v + 's' } }) } }) });
}

const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
function weekOf(dateStr) { // Monday of the ISO week, matching duckdb date_trunc('week')
    const d = new Date(dateStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
}
