// A school's view (central-specs capability dashboard-views): its level and MOE chips, four KPI cards (spend per
// card per day, taps, error rate, median speed), Compare, "More numbers", then the topics Spending and Terminals.
// Month-aware (uses the selected month).
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, line, C, CAT_COLOR } from './charts.js';
import { vchip } from './stall-window.js';
import { monthName } from './sbData.js';
import { pinButton } from './compare.js';
import { kpis, moreKpis, section, chart, tableCard, tabs, panes, wireTabs, emptyNote, fmt, money, pct, secs } from './ui.js';

const LV_CHIP = { Primary: 'chip-pri', Secondary: 'chip-sec', 'Junior College': 'chip-jc', Other: 'chip-other' };
const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;
// 0–31 cellular reported-signal scale (3GPP CSQ) → plain words.
const sigQual = (v) => v == null ? null : v >= 20 ? 'Excellent' : v >= 15 ? 'Good' : v >= 10 ? 'Fair' : 'Poor';
const SIG_STYLE = { Excellent: 'pill-good', Good: 'pill-good', Fair: 'pill-warn', Poor: 'pill-bad' };
const sev = (v, warn, bad) => (v == null ? '' : v >= bad ? 'bad' : v >= warn ? 'warn' : '');
const titleCase = (x) => String(x || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function openSchool(s, GLOBAL, STALLS) {
    const chips = [`<span class="chip ${LV_CHIP[s.level] || 'chip-other'}">${esc(s.level)}</span>`];
    if (s.moe_type === 'INDEPENDENT SCHOOL') chips.push('<span class="chip chip-indep">Independent</span>');
    if (s.ip) chips.push('<span class="chip chip-flag">IP</span>');
    if (s.gifted) chips.push('<span class="chip chip-flag">GEP</span>');
    if (s.sap) chips.push('<span class="chip chip-flag">SAP</span>');

    const body = openWindow({
        id: `school-${s.id}`,
        title: s.name || s.id,
        sub: [s.name ? s.id : '', s.area ? titleCase(s.area) : '', s.zone ? titleCase(s.zone) : ''].filter(Boolean).join(' · '),
        chips,
    });
    if (!body) return;
    pinButton(body, 'school', s);

    const TOPICS = [['spend', 'Spending'], ['terms', 'Terminals']];
    const errTone = sev(s.err_pct, 5, 10);
    body.innerHTML = `
      ${kpis([
          { l: 'Per card per day', v: s.spend_day != null ? money(s.spend_day) : '–' },
          { l: `${monthName(GLOBAL.meta?.month) || 'Month'} taps`, v: fmt(s.n) },
          { l: 'Error rate', v: pct(s.err_pct), tone: errTone, s: errTone === 'bad' ? 'High: over 10%' : errTone === 'warn' ? 'Watch: 5–10%' : s.err_pct != null ? 'Under 5%' : '' },
          { l: 'Median payment', v: s.med_ms ? secs(s.med_ms) : '–' },
      ])}
      ${moreKpis([
          { l: 'Average ticket', v: s.avg_ticket != null ? money(s.avg_ticket) : '–' },
          { l: 'Cards', v: s.cards ? fmt(s.cards) : '–' },
          { l: 'Revenue', v: s.sgd != null ? money(s.sgd) : '–' },
          { l: 'Offline share', v: pct(s.offline_pct) },
      ])}
      ${tabs(TOPICS)}
      ${panes(TOPICS)}`;
    wireTabs(body);
    renderSpend(body.querySelector('[data-pane="spend"]'), s, STALLS);
    renderTerms(body.querySelector('[data-pane="terms"]'), s, STALLS);
}

function renderSpend(el, s, STALLS) {
    const stalls = STALLS.stalls.filter((st) => st.school === s.id).sort((a, b) => b.rev - a.rev);
    const named = stalls.filter((st) => st.cat !== 'Unclassified');
    const books = STALLS.stalls.filter((st) => st.host === s.id);   // PBS shop(s) whose name code == this schoolId
    const maybe = STALLS.stalls.filter((st) => st.candidate === s.id);   // flagged: shared primary/secondary campus
    const MON = monthName(STALLS.meta?.month);
    const wk = [...(s.wk_spend || [])].sort((a, b) => a.week.localeCompare(b.week));
    const top = stalls[0], tot = stalls.reduce((a, st) => a + st.rev, 0);
    el.innerHTML = section({ title: 'Weekly revenue',
            take: wk.length ? `Weeks start on Monday; the best week took <b>${money(Math.max(...wk.map((r) => r.sgd)))}</b>.` : '',
            body: wk.length ? chart() : emptyNote(`No weekly figures for this school in ${MON}.`) }) +
        section({ title: 'Revenue by stall',
            take: top ? `<b>${esc(top.name)}</b> took ${pct((100 * top.rev) / tot, 0)} of ${MON}'s revenue. ${stalls.length} stalls, ${named.length} with a descriptive name. Press a bar to open the stall.` : '',
            tip: `Colour = category from the stall's registered name. Grey = the name gives no trustworthy category (generic "Stall 1", a bare company name, or prices that contradict the name) — never guessed. Mixed = a name covering two food groups. Revenue is exact either way.`,
            body: stalls.length ? chart({ h: Math.max(140, 30 + stalls.length * 24) }) : emptyNote(`No stall payments at this school in ${MON}.`) }) +
        books.map((b) => `<button type="button" class="note-box note-link" data-stall="${esc(b.id)}"><b>Bookshop here:</b> ${esc(b.name)} · ${money(b.rev)} · ${fmt(b.n)} taps
            ${info('Run by Pacific Bookstores and filed under vendor ID PBS, so it is not counted in this school\'s canteen figures above. Press to open.')}</button>`).join('') +
        maybe.map((b) => `<button type="button" class="note-box note-link" data-stall="${esc(b.id)}"><span class="pill-warn">Unconfirmed</span> ${esc(b.name)} may be this campus's bookshop ${info(b.evidence || '')}</button>`).join('');
    el.querySelectorAll('[data-stall]').forEach((d) => d.addEventListener('click', (e) => { if (!e.target.closest('.info')) window.SB?.openStall(d.dataset.stall); }));
    const [c1, c2] = el.querySelectorAll('canvas');
    if (c1) mk(c1, { type: 'line', numbers: { label: 'Week of', fmt: (v) => money(v) },
        data: { labels: wk.map((r) => r.week.slice(5, 10)), datasets: [{ ...line(C.money), label: 'Revenue', data: wk.map((r) => r.sgd) }] },
        options: opts({ indexMode: true, tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.y)} · ${fmt(wk[c.dataIndex].n)} taps` } },
            scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => 'S$' + (v >= 1000 ? v / 1000 + 'k' : v) } }) } }) });
    if (c2) mk(c2, { type: 'bar', numbers: { label: 'Stall', fmt: (v) => money(v) },
        data: { labels: stalls.map((st) => st.name), datasets: [{
            label: 'Revenue', data: stalls.map((st) => st.rev),
            backgroundColor: stalls.map((st) => CAT_COLOR[st.cat] || C.muted), borderRadius: 3, maxBarThickness: 18 }] },
        options: { ...opts({ indexAxis: 'y', tooltip: { callbacks: {
                title: (i) => stalls[i[0].dataIndex].name,
                label: (c) => { const st = stalls[c.dataIndex];
                    return ` ${money(st.rev)} · ${fmt(st.n)} taps · ${money(st.ticket)} average — ${st.cat}`; } } },
            scales: { x: ax({ beginAtZero: true, ticks: { callback: (v) => money(v) } }),
                y: ax({ grid: { display: false }, ticks: { autoSkip: false, callback(v) { const l = String(this.getLabelForValue(v)); return l.length > 22 ? l.slice(0, 21) + '…' : l; } } }) } }),
            onClick: (e, els) => { if (els.length) window.SB?.openStall(stalls[els[0].index].id); },
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } } });
}

function renderTerms(el, s, STALLS) {
    const terms = STALLS.terminals.filter((t) => t.school === s.id)
        .sort((a, b) => rank(b) - rank(a) || (b.err_pct ?? 0) - (a.err_pct ?? 0));
    const nBad = terms.filter((t) => t.verdict === 'machine').length;
    const nSite = terms.filter((t) => t.verdict === 'site').length;
    const q = sigQual(s.med_sig);
    el.innerHTML = kpis([
            { l: 'Machines', v: fmt(terms.length) },
            { l: 'Machine faults', v: fmt(nBad), tone: nBad ? 'bad' : '' },
            { l: 'Site issues', v: fmt(nSite), tone: nSite ? 'warn' : '' },
            { l: 'Typical 4G signal', v: q ? `<span class="${SIG_STYLE[q]}">${q}</span>` : '–' },
        ]) +
        section({ title: 'Every machine, with its diagnosis',
            take: terms.length ? `Problems first. Press a row for the machine's daily errors against the school.` : '',
            tip: 'Diagnosis compares each machine with its school peers: machine fault = service the unit; site issue = the location (signal, network) is the problem.',
            body: terms.length ? tableCard(`<tr><th>Machine</th><th>Stall</th><th>Net</th><th>Signal</th>
                  <th class="num">Taps</th><th class="num">Median</th><th class="num">Errors</th><th>Diagnosis</th></tr>`,
                terms.map((t) => { const sq = t.net === 'WIFI' ? null : sigQual(t.sig);
                    return `<tr class="click" role="button" tabindex="0" data-tid="${esc(t.id)}">
                      <td><b class="mono">${esc(mach(t.id))}</b></td>
                      <td><span class="trunc">${esc(t.storeName || '–')}</span></td><td>${esc(t.net) || '–'}</td>
                      <td>${t.net === 'WIFI' ? (t.rssi != null ? t.rssi + ' dBm' : '–') : sq ? `<span class="${SIG_STYLE[sq]}">${sq}</span>` : '–'}</td>
                      <td class="num">${fmt(t.n)}</td><td class="num">${secs(t.med_ms)}</td>
                      <td class="num"><span class="${t.err_pct >= 12 ? 'pill-bad' : t.err_pct >= 8 ? 'pill-warn' : ''}">${pct(t.err_pct ?? 0)}</span></td>
                      <td>${vchip(t.verdict)}</td></tr>`; }).join(''))
                : emptyNote(`No terminals recorded at this school in ${monthName(STALLS.meta?.month)}.`) });
    el.querySelectorAll('tr[data-tid]').forEach((tr) => tr.addEventListener('click', () => window.SB?.openTerminal(tr.dataset.tid)));
}

const rank = (t) => t.verdict === 'machine' ? 3 : t.verdict === 'site' ? 2 : t.verdict === 'check' ? 1 : 0;
