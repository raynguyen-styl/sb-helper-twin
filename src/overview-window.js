// Overview (central-specs capability dashboard-views): the month in one paragraph built only from the bundles
// (a figure the bundles lack drops its clause), four KPI cards, then the topics Network health, Speed, Food and
// School spending as sections with a takeaway. Rows and bars act: open the terminal, fly to the school, filter
// by type. Holiday days and weeks are shaded from the wearable bundle's detected `special` days.
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, line, shade, C, ST, CAT_COLOR } from './charts.js';
import { monthLabel, monthName, isCNYMonth } from './sbData.js';
import { openEng } from './eng-window.js';
import { kpis, section, chart, tableCard, tabs, panes, wireTabs, emptyNote, fmt, money, big, pct } from './ui.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON3[d.getUTCMonth()]}`; };
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const probs = (t) => t.problems || (t.verdict && t.verdict !== 'ok' ? [t.verdict] : []);

// The month's headline figures from the bundles; each is null when its source field is missing.
// School days = days with at least a quarter of the busiest day's taps (weekends and holidays fall below).
export function monthFigures(G, STALLS) {
    const m = G?.meta;
    if (!m) return null;
    const d = (G.daily || []).filter((r) => num(r.n));
    const n = d.reduce((a, r) => a + r.n, 0);
    const maxN = Math.max(0, ...d.map((r) => r.n));
    const withSgd = d.filter((r) => num(r.sgd));
    const withErr = d.filter((r) => num(r.err_pct));
    const errN = withErr.reduce((a, r) => a + r.n, 0);
    const T = STALLS?.terminals || [];
    return {
        month: m.month,
        sgd: num(m.sgd) ? m.sgd : null,
        txns: num(m.txns) ? m.txns : null,
        schools: num(m.schools_total) ? m.schools_total : null,
        mapped: num(m.schools_mapped) ? m.schools_mapped : null,
        schoolDays: d.length && maxN ? d.filter((r) => r.n >= maxN / 4).length : null,
        busiest: withSgd.length ? withSgd.reduce((a, r) => (r.sgd > a.sgd ? r : a)) : null,
        err: errN && n ? withErr.reduce((a, r) => a + r.n * r.err_pct, 0) / errN : null,
        attention: T.length ? T.filter((t) => probs(t).length).length : null,
    };
}

function paragraph(f) {
    const M = monthLabel(f.month);
    const out = [];
    if (f.sgd != null || f.txns != null) {
        out.push(`In ${M}, ${f.sgd != null ? `students spent <b>${money(f.sgd)}</b>` : 'students paid'}${f.txns != null ? ` in <b>${big(f.txns)} taps</b>` : ''}` +
            `${f.schools != null ? ` at <b>${fmt(f.schools)} schools</b>` : ''}${f.schoolDays != null ? ` over <b>${f.schoolDays} school days</b>` : ''}.`);
    } else if (f.schools != null) out.push(`In ${M}, <b>${fmt(f.schools)} schools</b> reported payments.`);
    if (f.busiest) out.push(`The busiest day was <b>${dayLabel(f.busiest.date)}</b> (${money(f.busiest.sgd)}).`);
    const att = f.attention != null ? `<button type="button" class="linkish" data-go="eng"><b>${fmt(f.attention)} terminals</b></button> need attention` : '';
    if (f.err != null) out.push(`<b>${pct(f.err)}</b> of payments returned an error${att ? `, and ${att}` : ''}.`);
    else if (att) out.push(`${att.replace(/^./, (c) => c.toUpperCase())}.`);
    return out.join(' ');
}

export function openOverview(GLOBAL, SCHOOLS, SPECIAL, STALLS) {
    if (!GLOBAL || !GLOBAL.meta) {
        const b = openWindow({ id: 'overview', title: 'Network Overview', chips: [] });
        if (b) b.innerHTML = emptyNote('No transaction data loaded for this month yet.');
        return;
    }
    const body = openWindow({ id: 'overview', title: 'Network Overview', chips: [], wide: true });
    if (!body) return;

    const f = monthFigures(GLOBAL, STALLS);
    const TOPICS = [['net', 'Network health'], ['speed', 'Speed'], ['food', 'Food'], ['atas', 'School spending']];
    body.innerHTML = `
      <p class="lead">${paragraph(f)} ${info('Built from the month\'s bundles only. School days = days with at least a quarter of the busiest day\'s taps. Error rate = errors ÷ payments over the month. Terminals needing attention = machines with a problem tag (fault, site issue, stopped, slow or high offline).')}</p>
      ${kpis([
          f.sgd != null && { l: 'Spend', v: money(f.sgd) },
          f.txns != null && { l: 'Taps', v: big(f.txns) },
          f.schools != null && { l: 'Schools', v: fmt(f.schools), s: f.mapped != null ? `${fmt(f.mapped)} on the map` : '' },
          f.err != null && { l: 'Error rate', v: pct(f.err), tone: f.err >= 10 ? 'bad' : f.err >= 5 ? 'warn' : '',
              s: f.err >= 10 ? 'High: over 10%' : f.err >= 5 ? 'Watch: 5–10%' : 'Under 5%' },
      ])}
      ${tabs(TOPICS)}
      ${panes(TOPICS)}`;
    wireTabs(body);
    body.querySelector('[data-go="eng"]')?.addEventListener('click', () => openEng(STALLS, { verdict: 'bad' }));

    const hol = holidays(GLOBAL.meta.month, SPECIAL);
    renderNet(body.querySelector('[data-pane="net"]'), GLOBAL, hol);
    renderSpeed(body.querySelector('[data-pane="speed"]'), GLOBAL, hol);
    renderFood(body.querySelector('[data-pane="food"]'), GLOBAL, hol);
    renderAtas(body.querySelector('[data-pane="atas"]'), GLOBAL, SCHOOLS);
}

// Holiday shading from the month's detected calendar story (CNY / school break) — no hard-coded dates.
// day(label 'YYYY-MM-DD') / week(raw week-start string) say whether to shade; key = the heading tag.
function holidays(month, SP) {
    const days = new Set((SP?.marked_days || []).map((d) => `${month}-${String(d).padStart(2, '0')}`));
    const week = (w) => { const t0 = Date.parse(w.slice(0, 10));
        return [...days].some((d) => { const t = Date.parse(d); return t >= t0 && t < t0 + 7 * 864e5; }); };
    const name = esc(SP?.daytype_label || SP?.label);
    return { day: (l) => days.has(l), week,
        key: days.size ? ` <span class="hol-key" title="Shaded: ${name}">▮ ${name}</span>` : '' };
}
// Clickable table rows: role=button + tabindex so Enter/Space works (handled in main.js).
const rowAttrs = (title) => `role="button" tabindex="0" title="${title}"`;

function renderNet(el, G, hol) {
    const worst = [...(G.terminals || [])].filter((t) => t.n >= 1000).sort((a, b) => b.err_pct - a.err_pct).slice(0, 8);
    // 0–31 reported-signal scale → plain-language quality bands (3GPP CSQ convention).
    const BANDS = [
        { label: 'Excellent', test: (s) => s >= 20, color: ST.good, desc: 'strong signal — never the bottleneck' },
        { label: 'Good', test: (s) => s >= 15 && s < 20, color: ST.good + '99', desc: 'comfortable margin' },
        { label: 'Fair', test: (s) => s >= 10 && s < 15, color: ST.warn, desc: 'usable, but slowdowns start here' },
        { label: 'Poor', test: (s) => s < 10, color: ST.bad, desc: 'weak — expect slow or failed payments' },
    ];
    const sig = G.signal_dist || [];
    const sigTot = sig.reduce((a, r) => a + r.n, 0);
    const bands = BANDS.map((b) => ({ ...b, n: sig.filter((r) => b.test(r.sig)).reduce((a, r) => a + r.n, 0) }));
    const MON = monthName(G.meta.month);
    const wifi = (G.network_mix || []).find((r) => r.posNetworkType === 'WIFI')?.terminals;
    const d = G.daily || [];
    const peak = d.filter((r) => num(r.err_pct)).reduce((a, r) => (!a || r.err_pct > a.err_pct ? r : a), null);
    const offN = d.reduce((a, r) => a + (num(r.offline_pct) ? r.n : 0), 0);
    const off = offN ? d.reduce((a, r) => a + (num(r.offline_pct) ? r.n * r.offline_pct : 0), 0) / offN : null;
    const share = (b) => (sigTot ? (100 * b.n) / sigTot : 0);
    el.innerHTML = section({ title: `Daily errors and offline payments${hol.key}`, id: 'daily',
            take: peak ? `Errors peaked at <b>${pct(peak.err_pct)}</b> on ${dayLabel(peak.date)}${off != null ? `; <b>${pct(off)}</b> of payments went through offline` : ''}.` : '',
            tip: `Per day: % of payments that returned an error, and % processed offline (stored and sent later).${isCNYMonth(G.meta.month) ? ' 17–18 Feb are the CNY holidays (no school).' : ''}`,
            body: d.length ? chart() : emptyNote(`No daily figures in ${monthLabel(G.meta.month)}.`) }) +
        section({ title: 'Signal at the terminal', id: 'signal',
            take: sigTot ? `<b>${pct(share(bands[0]))}</b> of 4G payments had excellent signal; <b>${pct(share(bands[3]))}</b> poor.` : '',
            tip: `Share of 4G payments by the signal strength the terminal reported at the moment of payment (0–31 scale).${wifi ? ` ${wifi} WiFi terminals measure in dBm and are excluded.` : ''} ${bands.map((b) => `${b.label}: ${b.desc}.`).join(' ')}`,
            body: sigTot ? chart({ h: 140 }) : emptyNote(`No signal readings in ${monthLabel(G.meta.month)}.`) }) +
        section({ title: 'Terminals with the most errors',
            take: worst.length ? `The ${worst.length} machines with 1,000+ ${MON} payments and the highest error rate. Press a row to open it.` : '',
            body: worst.length ? tableCard(`<tr><th>Terminal</th><th>School</th><th class="num">Taps</th><th class="num">Errors</th><th class="num">Median</th></tr>`,
                worst.map((t) => `<tr class="click" data-tid="${esc(t.terminalId)}" data-sid="${esc(t.school)}" ${rowAttrs('Open this terminal')}><td class="mono">…${esc(t.terminalId.slice(-11))}</td>
                  <td><b>${t.school === 'PBS' ? 'PBS bookshop' : t.school === 'SSSTM' ? 'Stamp point' : esc(t.school)}</b></td>
                  <td class="num">${fmt(t.n)}</td><td class="num pill-bad">${pct(t.err_pct)}</td>
                  <td class="num">${(t.med_ms / 1000).toFixed(1)} s</td></tr>`).join(''))
                : emptyNote('No terminal had 1,000 payments this month.') });
    el.querySelectorAll('tr[data-tid]').forEach((tr) => tr.addEventListener('click', () => window.SB.openTerminal(tr.dataset.tid)));
    const c1 = el.querySelector('[data-sec="daily"] canvas'), c2 = el.querySelector('[data-sec="signal"] canvas');
    if (c1) mk(c1, { type: 'line', plugins: [shade(hol.day)], numbers: { label: 'Day', fmt: (v) => pct(v) },
        data: { labels: d.map((r) => r.date), datasets: [
            { ...line(C.red), label: 'Errors %', data: d.map((r) => r.err_pct) },
            { ...line(C.blue, { borderDash: [5, 3] }), label: 'Offline %', data: d.map((r) => r.offline_pct) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax({ ticks: { maxTicksLimit: 7, callback(v) { return String(this.getLabelForValue(v)).slice(8); } } }),
                y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    if (c2) mk(c2, { type: 'bar', numbers: { label: 'Signal', fmt: (v) => pct(v) },
        data: { labels: bands.map((b) => b.label), datasets: [{ label: '% of 4G payments',
            data: bands.map(share), backgroundColor: bands.map((b) => b.color), borderRadius: 3 }] },
        options: opts({ indexAxis: 'y', tooltip: { callbacks: { label: (c) => ` ${c.parsed.x.toFixed(1)}% of payments · ${fmt(bands[c.dataIndex].n)}` } },
            scales: { x: ax({ beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } }), y: ax({ grid: { display: false } }) } }) });
}

function renderSpeed(el, G, hol) {
    const d = G.daily || [];
    const mid = (arr) => { const a = arr.filter(num).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const medDay = mid(d.map((r) => r.med_ms)), p95Day = mid(d.map((r) => r.p95_ms));
    const SW = G.speed_weekly_by_stack || [];
    const stacks = [...new Set(SW.map((r) => r.paymentType))];
    const weeks = [...new Set(SW.map((r) => r.week))].sort();
    const lastWk = weeks.at(-1);
    const lastRows = SW.filter((r) => r.week === lastWk && num(r.med_ms)).sort((a, b) => a.med_ms - b.med_ms);
    const comp = G.speed_components_weekly || [];
    const steps = ['checkSignal', 'openSocket', 'handshake', 'transfer'];
    const STEP = { checkSignal: 'Check signal', openSocket: 'Open socket', handshake: 'Handshake', transfer: 'Transfer' };
    const lastC = comp.at(-1);
    const slowStep = lastC ? steps.reduce((a, s) => ((lastC[s] ?? 0) > (lastC[a] ?? 0) ? s : a)) : null;
    el.innerHTML = section({ title: `Daily median and slowest 5%${hol.key}`, id: 'daily',
            take: medDay != null ? `On a typical day a payment took <b>${(medDay / 1000).toFixed(1)} s</b>; the slowest 5% took <b>${(p95Day / 1000).toFixed(1)} s</b> or more.` : '',
            tip: 'Median = the typical payment; p95 = the slowest 5%, where queues form.',
            body: d.length ? chart() : emptyNote(`No speed data in ${monthLabel(G.meta.month)}.`) }) +
        section({ title: `Weekly median by payment stack${hol.key}`, id: 'stack',
            take: lastRows.length > 1 ? `In the last week <b>${esc(lastRows[0].paymentType)}</b> was fastest (${(lastRows[0].med_ms / 1000).toFixed(1)} s) and <b>${esc(lastRows.at(-1).paymentType)}</b> slowest (${(lastRows.at(-1).med_ms / 1000).toFixed(1)} s).` : '',
            tip: 'One line per card / payment technology. Weeks are labelled by their Monday, so the first week can start in the previous month.',
            body: SW.length ? chart({ tall: true }) : emptyNote(`No speed data in ${monthLabel(G.meta.month)}.`) }) +
        section({ title: 'Where the online time goes', id: 'steps',
            take: slowStep ? `<b>${STEP[slowStep]}</b> took the longest in the last week: ${fmt(lastC[slowStep])} ms.` : '',
            tip: 'Median milliseconds per step of an online payment, by week.',
            body: comp.length ? chart() : emptyNote(`No step timings in ${monthLabel(G.meta.month)}.`) });
    const cv = (id) => el.querySelector(`[data-sec="${id}"] canvas`);
    const c1 = cv('daily'), c2 = cv('stack'), c3 = cv('steps');
    if (c1 && d.length) mk(c1, { type: 'line', plugins: [shade(hol.day)], numbers: { label: 'Day', fmt: (v) => (v == null ? '–' : `${v.toFixed(2)} s`) },
        data: { labels: d.map((r) => r.date), datasets: [
            { ...line(C.blue), label: 'Median', data: d.map((r) => r.med_ms / 1000) },
            { ...line(C.violet, { borderDash: [5, 3] }), label: 'p95', data: d.map((r) => r.p95_ms / 1000) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax({ ticks: { maxTicksLimit: 7, callback(v) { return String(this.getLabelForValue(v)).slice(8); } } }),
                y: ax({ beginAtZero: true, ticks: { callback: (v) => v + ' s' } }) } }) });
    const SC = [C.blue, C.aqua, C.yellow, C.red, C.violet, C.magenta];
    if (c2 && SW.length) mk(c2, { type: 'line', plugins: [shade((l, i) => hol.week(weeks[i]))], numbers: { label: 'Week of', fmt: (v) => (v == null ? '–' : `${v.toFixed(2)} s`) },
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: stacks.map((s, i) => ({
            ...line(SC[i % SC.length]), label: s,
            data: weeks.map((w) => { const r = SW.find((x) => x.week === w && x.paymentType === s);
                return r ? r.med_ms / 1000 : null; }) })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ ticks: { callback: (v) => v + ' s' } }) } }) });
    if (c3 && comp.length) mk(c3, { type: 'bar', numbers: { label: 'Week of', fmt: (v) => (v == null ? '–' : `${fmt(v)} ms`) },
        data: { labels: comp.map((r) => r.week.slice(5, 10)), datasets: steps.map((s, i) => ({
            ...bar([C.muted, C.yellow, C.violet, C.blue][i]), label: STEP[s], data: comp.map((r) => r[s]) })) },
        options: opts({ legend: true, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y} ms` } },
            scales: { x: { ...ax({ grid: { display: false } }), stacked: true }, y: { ...ax({ beginAtZero: true, ticks: { callback: (v) => v + ' ms' } }), stacked: true } } }) });
}

function renderFood(el, G, hol) {
    const mix = G.food_mix || [];
    if (!mix.length) { el.innerHTML = emptyNote(`No food categories in ${monthLabel(G.meta.month)}.`); return; }
    const mixTot = mix.reduce((a, b) => a + b.n, 0);
    const uncl = mix.find((r) => r.mcat === 'Unclassified');
    const verPct = (100 * (mixTot - (uncl?.n || 0)) / mixTot);
    const ver = mix.filter((r) => r.mcat !== 'Unclassified').sort((a, b) => b.n - a.n);
    const verTot = ver.reduce((a, b) => a + b.n, 0);
    const MON = monthName(G.meta.month);
    el.innerHTML = section({ title: 'How much has a known category?',
            take: `<b>${verPct.toFixed(1)}%</b> of ${MON}'s payments have a category from the stall's name; the charts below use only those.`,
            tip: `A stall is classified by its registered name only, and only if its prices don't contradict it (a "cooked food" name trading at a $0.60 modal is not counted). Generic names ("Stall 1") and bare company names stay Unclassified, never guessed. Two-food-group names count as Mixed. Receipt-level item data, where present, is in Purchases.`,
            body: `<div class="split" role="img" aria-label="${verPct.toFixed(1)}% verified, ${(100 - verPct).toFixed(1)}% unclassified">
              <span class="on" style="width:${verPct}%">${verPct.toFixed(1)}% verified</span><span class="off">${(100 - verPct).toFixed(1)}% unclassified</span></div>` }) +
        section({ title: 'What sells',
            take: ver.length ? `<b>${esc(ver[0].mcat)}</b> lead with ${pct((100 * ver[0].n) / verTot)} of verified payments.` : '',
            body: chart() }) +
        section({ title: `Category share by week${hol.key}`, take: 'Share of verified payments per week.',
            tip: 'Weeks with under 2,000 verified payments (holidays) are left blank.', body: chart({ tall: true }) }) +
        section({ title: `Average price by week${hol.key}`, take: 'The average payment per verified category.',
            tip: 'Points under 300 payments are left blank.', body: chart() });
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    mk(c1, { type: 'bar', numbers: { label: 'Category', fmt: (v) => pct(v) },
        data: { labels: ver.map((r) => r.mcat), datasets: [{ ...bar(C.blue), label: '% of verified payments',
            backgroundColor: ver.map((r) => CAT_COLOR[r.mcat] || C.muted), data: ver.map((r) => 100 * r.n / verTot) }] },
        options: opts({ indexAxis: 'y', tooltip: { callbacks: { label: (c) => { const r = ver[c.dataIndex];
            return ` ${fmt(r.n)} payments · ${money(r.sgd)} · average ${money(r.avg_sgd)}`; } } },
            scales: { x: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }), y: ax({ grid: { display: false } }) } }) });
    // weekly shares within name-verified volume (Unclassified excluded from the denominator)
    const fwv = (G.food_weekly || []).filter((r) => r.mcat !== 'Unclassified');
    const weeks = [...new Set(fwv.map((r) => r.week))].sort();
    const wkTot = {}; fwv.forEach((r) => { wkTot[r.week] = (wkTot[r.week] || 0) + r.n; });
    const main = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Mixed', 'Bookshop & Supplies'];
    mk(c2, { type: 'line', plugins: [shade((l, i) => hol.week(weeks[i]))], numbers: { label: 'Week of', fmt: (v) => pct(v) },
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: main.map((cat) => ({
            ...line(CAT_COLOR[cat]), label: cat,
            data: weeks.map((w) => { if ((wkTot[w] || 0) < 2000) return null;   // holiday week: named stalls closed
                const r = fwv.find((x) => x.week === w && x.mcat === cat);
                return r ? 100 * r.n / wkTot[w] : 0; }) })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c3, { type: 'line', plugins: [shade((l, i) => hol.week(weeks[i]))], numbers: { label: 'Week of', fmt: (v) => (v == null ? '–' : money(v)) },
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: ['Drinks', 'Snacks & Desserts', 'Cooked Food'].map((cat) => ({
            ...line(CAT_COLOR[cat]), label: cat,
            data: weeks.map((w) => { const r = fwv.find((x) => x.week === w && x.mcat === cat);
                return (r && r.n >= 300) ? r.avg_cents / 100 : null; }) })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ ticks: { callback: (v) => 'S$' + v.toFixed(2) } }) } }) });
}

function renderAtas(el, G, SCHOOLS) {
    const T = G.atas?.by_type || [];
    if (!T.length) { el.innerHTML = emptyNote(`No school-type figures in ${monthLabel(G.meta.month)}.`); return; }
    const ranked = Object.values(SCHOOLS).filter((s) => s.spend_day && s.cards >= 200).sort((a, b) => b.spend_day - a.spend_day);
    const ind = T.find((r) => r.type === 'INDEPENDENT SCHOOL'), gov = T.find((r) => r.type === 'GOVERNMENT SCHOOL');
    el.innerHTML = section({ title: 'Spend by school type',
            take: ind && gov ? `Independent schools: <b>${money(ind.spend_day)}</b> per student per day (${money(ind.avg_ticket)} ticket); government schools: <b>${money(gov.spend_day)}</b> (${money(gov.avg_ticket)}). Press a bar to list that type.` : 'Press a bar to list that type.',
            tip: `S$ per student per active day and average ticket, by MOE school type. Based on ${G.atas.coverage?.matched ?? '–'} of ${G.atas.coverage?.total ?? '–'} schools matched to the MOE directory.`,
            body: chart() }) + '<div data-top></div>';
    let sel = null;                                   // selected MOE type (bar click), null = all
    const top = el.querySelector('[data-top]');
    const renderTop = () => {
        const rows = ranked.filter((s) => !sel || s.moe_type === sel).slice(0, 12);
        top.innerHTML = section({ title: `Top spenders${sel ? ` · ${typeName(sel)}` : ''}`,
            acts: sel ? '<button class="linkbtn" data-clear>Show all</button>' : '',
            take: 'S$ per student per day. Press a row to fly to the school and open it.',
            tip: 'Schools with at least 200 cards this month. Spend = all SMART Buddy payments at the school\'s own stalls; Pacific Bookstores and Self Serve Stamps are vendors filed under their own IDs, so they are not included.',
            body: rows.length ? tableCard(`<tr><th>School</th><th>Level</th><th>Type</th><th class="num">Per day</th><th class="num">Ticket</th></tr>`,
                rows.map((s, i) => `<tr class="click" data-sid="${esc(s.id)}" ${rowAttrs('Fly to this school and open it')}>
                  <td><b>${i + 1}. ${esc(s.name || s.id)}</b></td><td>${esc(s.level)}</td>
                  <td>${s.moe_type ? typeName(s.moe_type) : '–'}</td>
                  <td class="num"><b>${money(s.spend_day)}</b></td><td class="num">${money(s.avg_ticket)}</td></tr>`).join(''))
                : emptyNote('No school of this type has 200+ cards this month.') });
        top.querySelectorAll('tr[data-sid]').forEach((tr) => tr.addEventListener('click', () => window.SB.focusSchool(tr.dataset.sid)));
        top.querySelector('[data-clear]')?.addEventListener('click', () => pick(null));
    };
    // fade the unselected types so the picked bar pair stands out
    const fill = (c) => T.map((r) => (!sel || r.type === sel ? c : c + '40'));
    const ch = mk(el.querySelector('canvas'), { type: 'bar', numbers: { label: 'School type', fmt: (v) => money(v) },
        data: { labels: T.map((r) => typeName(r.type).split(' ')),     // 2-line labels → all 6 types fit
            datasets: [
                { ...bar(C.money), label: 'Per student-day', data: T.map((r) => r.spend_day), backgroundColor: fill(C.money) },
                { ...bar(C.blue), label: 'Average ticket', data: T.map((r) => r.avg_ticket), backgroundColor: fill(C.blue) }] },
        options: { ...opts({ legend: true, tooltip: { callbacks: { afterBody: (i) => [`${T[i[0].dataIndex].schools} schools · press to list them`] } },
            scales: { x: ax({ grid: { display: false }, ticks: { autoSkip: false } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => 'S$' + v } }) } }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : ''; },
            onClick: (e, els) => { if (els.length) pick(T[els[0].index].type); } } });
    const pick = (type) => {
        sel = sel === type ? null : type;             // same bar again = clear
        ch.data.datasets[0].backgroundColor = fill(C.money);
        ch.data.datasets[1].backgroundColor = fill(C.blue);
        ch.update(); renderTop();
    };
    renderTop();
}

// 'SPECIALISED INDEPENDENT SCHOOL' → 'Specialised independent', 'SPED SCHOOL' → 'SPED'
export const typeName = (t) => t.replace(/ SCH(OOL)?$/, '').toLowerCase().replace(/\bsped\b/, 'SPED').replace(/^./, (c) => c.toUpperCase());
