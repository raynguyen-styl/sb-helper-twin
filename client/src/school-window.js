// Per-school detail window: Stalls & Spending / Terminals tabs. Month-aware (uses the selected month).
import { openWindow } from './windowing.js';
import { mk, opts, ax, line, C, CAT_COLOR } from './charts.js';
import { vchip } from './stall-window.js';
import { monthLabel, monthName } from './sbData.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const fmt$ = (v) => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'k' : '$' + Math.round(v);
const LV_CHIP = { Primary: 'chip-pri', Secondary: 'chip-sec', 'Junior College': 'chip-jc', Other: 'chip-other' };
const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;
// 0–31 cellular reported-signal scale (3GPP CSQ) → plain words.
const sigQual = (v) => v == null ? null : v >= 20 ? 'Excellent' : v >= 15 ? 'Good' : v >= 10 ? 'Fair' : 'Poor';
const SIG_STYLE = { Excellent: 'pill-good', Good: 'pill-good', Fair: 'pill-warn', Poor: 'pill-bad' };

export function openSchool(s, GLOBAL, STALLS) {
    const chips = [`<span class="chip ${LV_CHIP[s.level] || 'chip-other'}">${s.level}</span>`];
    if (s.moe_type === 'INDEPENDENT SCHOOL') chips.push('<span class="chip chip-indep">Independent</span>');
    if (s.ip) chips.push('<span class="chip chip-flag">IP</span>');
    if (s.gifted) chips.push('<span class="chip chip-flag">GEP</span>');
    if (s.sap) chips.push('<span class="chip chip-flag">SAP</span>');

    const body = openWindow({
        id: `school-${s.id}`,
        title: s.name || s.id,
        sub: `${s.name ? s.id + ' · ' : ''}${s.area ? titleCase(s.area) + ' · ' : ''}${monthLabel(GLOBAL.meta.month)}`,
        chips,
    });
    if (!body) return;

    body.innerHTML = `
      <div class="stats">
        ${stat(s.spend_day != null ? '$' + s.spend_day.toFixed(2) : '–', 'spend / card·day')}
        ${stat('$' + s.avg_ticket.toFixed(2), 'avg ticket')}
        ${stat(fmt(s.n), `${monthName(GLOBAL.meta.month)} transactions`)}
        ${stat(s.cards ? fmt(s.cards) : '–', 'cards')}
        ${stat(pctCell(s.err_pct, 5, 10), 'error rate')}
        ${stat(s.med_ms ? (s.med_ms / 1000).toFixed(1) + 's' : '–', 'median txn')}
      </div>
      <div class="tabs">
        <button data-tab="spend" class="on">Stalls &amp; Spending</button>
        <button data-tab="terms">Terminals</button>
      </div>
      <div data-pane="spend"></div>
      <div data-pane="terms" style="display:none"></div>`;

    body.querySelectorAll('.tabs button').forEach((b) =>
        b.addEventListener('click', () => {
            body.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
            body.querySelectorAll('[data-pane]').forEach((p) =>
                (p.style.display = p.dataset.pane === b.dataset.tab ? '' : 'none'));
        }));

    renderSpend(body.querySelector('[data-pane="spend"]'), s, STALLS);
    renderTerms(body.querySelector('[data-pane="terms"]'), s, STALLS);
}

const stat = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
const pctCell = (v, warn, bad) =>
    `<span class="${v >= bad ? 'pill-bad' : v >= warn ? 'pill-warn' : 'pill-good'}">${v}%</span>`;
const titleCase = (x) => String(x || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function renderSpend(el, s, STALLS) {
    const stalls = STALLS.stalls.filter((st) => st.school === s.id).sort((a, b) => b.rev - a.rev);
    const named = stalls.filter((st) => st.cat !== 'Unclassified');
    const MON = monthName(STALLS.meta.month);
    el.innerHTML = `
      <h5>Weekly canteen revenue — ${MON}</h5><div class="cap">Total $ per week at this school (weeks starting Mon).</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Revenue by stall — ${MON}</h5>
      <div class="cap">Each bar is one store. Colour = category from the stall's registered name;
      grey = the name gives no trustworthy category (generic "Stall 1", a bare company name, or prices
      that contradict the name) — never guessed. Teal = a name covering two food groups (Mixed).
      Revenue is exact either way. Click a bar to open the stall.</div>
      <div class="cwrap" style="height:${Math.max(120, 26 + stalls.length * 21)}px"><canvas></canvas></div>
      <div class="cap" style="margin-top:4px">${stalls.length} stalls · ${named.length} with a descriptive name.</div>`;
    const [c1, c2] = el.querySelectorAll('canvas');
    const wk = [...(s.wk_spend || [])].sort((a, b) => a.week.localeCompare(b.week));
    mk(c1, { type: 'line',
        data: { labels: wk.map((r) => r.week.slice(5, 10)), datasets: [{ ...line(C.blue), label: '$', data: wk.map((r) => r.sgd) }] },
        options: opts({ indexMode: true, tooltip: { callbacks: { label: (c) => ` $${fmt(c.parsed.y)} · ${fmt(wk[c.dataIndex].n)} txns` } },
            scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => '$' + (v >= 1000 ? v / 1000 + 'k' : v) } }) } }) });
    const stallChart = mk(c2, { type: 'bar',
        data: { labels: stalls.map((st) => st.name), datasets: [{
            label: 'revenue', data: stalls.map((st) => st.rev),
            backgroundColor: stalls.map((st) => CAT_COLOR[st.cat] || C.muted), borderRadius: 2 }] },
        options: { ...opts({ tooltip: { callbacks: {
                title: (i) => stalls[i[0].dataIndex].name,
                label: (c) => { const st = stalls[c.dataIndex];
                    return ` ${fmt$(st.rev)} · ${fmt(st.n)} txns · $${st.ticket.toFixed(2)} avg — ${st.cat}`; } } },
            scales: { x: ax({ beginAtZero: true, ticks: { callback: (v) => fmt$(v) } }),
                y: ax({ grid: { display: false }, ticks: { autoSkip: false, font: { size: 10 } } }) } }),
            indexAxis: 'y',
            onClick: (e, els) => { if (els.length) window.SB?.openStall(stalls[els[0].index].id); },
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } } });
}

function renderTerms(el, s, STALLS) {
    const terms = STALLS.terminals.filter((t) => t.school === s.id)
        .sort((a, b) => rank(b) - rank(a) || (b.err_pct ?? 0) - (a.err_pct ?? 0));
    const nBad = terms.filter((t) => t.verdict === 'machine').length;
    const nSite = terms.filter((t) => t.verdict === 'site').length;
    el.innerHTML = `
      <div class="stats">
        ${stat(terms.length, 'machines')}
        ${stat(nBad ? `<span style="color:var(--bad)">${nBad}</span>` : 0, 'machine faults')}
        ${stat(nSite ? `<span style="color:var(--warn)">${nSite}</span>` : 0, 'site issues')}
        ${stat(s.med_sig != null ? `<span class="${SIG_STYLE[sigQual(s.med_sig)]}">${sigQual(s.med_sig)}</span>` : '–', 'typical 4G signal')}
      </div>
      <h5>Every machine, tagged to its stall</h5>
      <div class="cap">Problem units first. Diagnosis compares each machine with its school peers —
      machine fault = service the unit; site issue = the location (signal/network) is the problem.
      Click a row for the full per-machine diagnostic.</div>
      <table class="mini"><tr><th>Machine</th><th>Stall</th><th>Net</th><th>Signal</th>
        <th style="text-align:right">Txns</th><th style="text-align:right">Median</th>
        <th style="text-align:right">Err %</th><th>Diagnosis</th></tr>
        ${terms.map((t) => { const q = t.net === 'WIFI' ? null : sigQual(t.sig);
            return `<tr style="cursor:pointer" data-tid="${t.id}">
          <td style="font-size:10.5px"><b>${mach(t.id)}</b></td>
          <td style="font-size:11px">${t.storeName || '–'}</td><td>${t.net || '–'}</td>
          <td>${t.net === 'WIFI' ? (t.rssi != null ? t.rssi + ' dBm' : '–')
              : q ? `<span class="${SIG_STYLE[q]}">${q}</span>` : '–'}</td>
          <td class="num">${fmt(t.n)}</td>
          <td class="num">${t.med_ms ? (t.med_ms / 1000).toFixed(1) + 's' : '–'}</td>
          <td class="num">${pctCell(t.err_pct ?? 0, 8, 12)}</td><td>${vchip(t.verdict)}</td></tr>`; }).join('')}
      </table>
      ${terms.length === 0 ? `<div class="note-box">No terminals recorded at this school in ${monthName(STALLS.meta.month)}.</div>` : ''}`;
    el.querySelectorAll('tr[data-tid]').forEach((tr) =>
        tr.addEventListener('click', () => window.SB?.openTerminal(tr.dataset.tid)));
}

const rank = (t) => t.verdict === 'machine' ? 3 : t.verdict === 'site' ? 2 : t.verdict === 'check' ? 1 : 0;
