// Network-wide overview window: KPIs + four tabs. Rows/bars are clickable (open the terminal / fly to the
// school / filter by type); holiday days+weeks are shaded from the wearable bundle's detected `special` days.
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, line, shade, C, ST, CAT_COLOR } from './charts.js';
import { monthLabel, monthName, isCNYMonth } from './sbData.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const CATS = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Mixed', 'Bookshop & Supplies', 'Unclassified'];

export function openOverview(GLOBAL, SCHOOLS, SPECIAL) {
    if (!GLOBAL || !GLOBAL.meta) {
        const b = openWindow({ id: 'overview', title: 'Network Overview', sub: 'no data', chips: [] });
        if (b) b.innerHTML = `<div class="cap">No transaction data loaded for this month yet.</div>`;
        return;
    }
    const body = openWindow({ id: 'overview', title: 'Network Overview', sub: monthLabel(GLOBAL.meta.month), chips: [], wide: true });
    if (!body) return;

    const m = GLOBAL.meta;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">$${(m.sgd / 1e6).toFixed(2)}M</div><div class="l">total spend</div></div>
        <div class="stat"><div class="v">${(m.txns / 1e6).toFixed(1)}M</div><div class="l">transactions</div></div>
        <div class="stat"><div class="v">${m.schools_total}</div><div class="l">schools</div></div>
        <div class="stat"><div class="v">${m.schools_mapped}</div><div class="l">on the map</div></div>
      </div>
      <div class="tabs">
        <button data-tab="net" class="on">Network Health</button>
        <button data-tab="speed">Speed Trends</button>
        <button data-tab="food">Food Trends</button>
        <button data-tab="atas">School Spending</button>
      </div>
      <div data-pane="net"></div><div data-pane="speed" style="display:none"></div>
      <div data-pane="food" style="display:none"></div><div data-pane="atas" style="display:none"></div>`;

    body.querySelectorAll('.tabs button').forEach((b) =>
        b.addEventListener('click', () => {
            body.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
            body.querySelectorAll('[data-pane]').forEach((p) =>
                (p.style.display = p.dataset.pane === b.dataset.tab ? '' : 'none'));
        }));

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
        key: days.size ? `<span class="hol-key" title="Shaded: ${name}">▮ ${name}</span>` : '' };
}
// Clickable table rows: role=button + tabindex so Enter/Space works (handled in main.js).
const rowAttrs = (title) => `role="button" tabindex="0" title="${title}"`;

function renderNet(el, G, hol) {
    const worst = [...G.terminals].filter((t) => t.n >= 1000).sort((a, b) => b.err_pct - a.err_pct).slice(0, 8);
    // 0–31 reported-signal scale → plain-language quality bands (3GPP CSQ convention).
    const BANDS = [
        { label: 'Excellent', test: (s) => s >= 20, color: ST.good, desc: 'strong signal — never the bottleneck' },
        { label: 'Good', test: (s) => s >= 15 && s < 20, color: '#7fcfb8', desc: 'comfortable margin' },
        { label: 'Fair', test: (s) => s >= 10 && s < 15, color: ST.warn, desc: 'usable, but slowdowns start here' },
        { label: 'Poor', test: (s) => s < 10, color: ST.bad, desc: 'weak — expect slow or failed txns' },
    ];
    const sigTot = G.signal_dist.reduce((a, r) => a + r.n, 0);
    const bands = BANDS.map((b) => ({ ...b,
        n: G.signal_dist.filter((r) => b.test(r.sig)).reduce((a, r) => a + r.n, 0) }));
    const MON = monthName(G.meta.month);
    const wifi = (G.network_mix || []).find((r) => r.posNetworkType === 'WIFI')?.terminals;
    el.innerHTML = `
      <h5>Daily error rate &amp; offline share — ${MON} ${info(`Per day: % of payments that returned an error, and % processed
        offline (stored and sent later).${isCNYMonth(G.meta.month) ? ' 17–18 Feb are the CNY holidays (no school).' : ''}`)} ${hol.key}</h5>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Signal quality at the terminal — ${MON} ${info(`Share of 4G payments by the signal strength the terminal reported at
        the moment of payment (0–31 scale).${wifi ? ` ${wifi} WiFi terminals measure in dBm and are excluded.` : ''}
        ${bands.map((b) => `${b.label}: ${b.desc}.`).join(' ')}`)}</h5>
      <div class="cwrap" style="height:130px"><canvas></canvas></div>
      <h5>Terminals needing attention ${info(`Terminals with at least 1,000 ${MON} payments, highest error rate first.
        Click a row to open the terminal; hover to find its school on the map.`)}</h5>
      <table class="mini"><tr><th>Terminal</th><th>School</th><th style="text-align:right">Txns</th>
        <th style="text-align:right">Err %</th><th style="text-align:right">Median</th></tr>
        ${worst.map((t) => `<tr class="click" data-tid="${t.terminalId}" data-sid="${t.school}" ${rowAttrs('Open this terminal')}><td style="font-size:10.5px">…${t.terminalId.slice(-11)}</td>
          <td><b>${t.school === 'PBS' ? 'PBS bookshop' : t.school === 'SSSTM' ? 'Stamp point' : esc(t.school)}</b></td>
          <td class="num">${fmt(t.n)}</td><td class="num pill-bad">${t.err_pct}%</td>
          <td class="num">${(t.med_ms / 1000).toFixed(1)}s</td></tr>`).join('')}</table>`;
    el.querySelectorAll('tr[data-tid]').forEach((tr) =>
        tr.addEventListener('click', () => window.SB.openTerminal(tr.dataset.tid)));
    const [c1, c2] = el.querySelectorAll('canvas');
    const d = G.daily;
    mk(c1, { type: 'line', plugins: [shade(hol.day)],
        data: { labels: d.map((r) => r.date), datasets: [
            { ...line(C.red), label: 'Error %', data: d.map((r) => r.err_pct) },
            { ...line(C.blue, { borderDash: [5, 3] }), label: 'Offline %', data: d.map((r) => r.offline_pct) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax({ ticks: { maxTicksLimit: 7 } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c2, { type: 'bar',
        data: { labels: bands.map((b) => b.label), datasets: [{ label: '% of txns',
            data: bands.map((b) => 100 * b.n / sigTot), backgroundColor: bands.map((b) => b.color), borderRadius: 3 }] },
        options: { ...opts({ tooltip: { callbacks: { label: (c) =>
                ` ${c.parsed.x.toFixed(1)}% of txns · ${fmt(bands[c.dataIndex].n)}` } },
            scales: { x: ax({ beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } }),
                y: ax({ grid: { display: false } }) } }), indexAxis: 'y' } });
}

function renderSpeed(el, G, hol) {
    el.innerHTML = `
      <h5>Daily median &amp; p95 transaction time — ${monthName(G.meta.month)} ${info('Median = the typical payment; p95 = the slowest 5%, where queues form.')} ${hol.key}</h5>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Weekly median by payment stack ${info('One line per card / payment technology. Weeks are labelled by their Monday, so the first week can start in the previous month.')} ${hol.key}</h5>
      <div class="cwrap tall"><canvas></canvas></div>
      <h5>Where the online time goes ${info('Median milliseconds per step of an online payment, by week.')}</h5>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    const d = G.daily;
    mk(c1, { type: 'line', plugins: [shade(hol.day)],
        data: { labels: d.map((r) => r.date), datasets: [
            { ...line(C.blue), label: 'Median', data: d.map((r) => r.med_ms / 1000) },
            { ...line(C.violet, { borderDash: [5, 3] }), label: 'p95', data: d.map((r) => r.p95_ms / 1000) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax({ ticks: { maxTicksLimit: 7 } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + 's' } }) } }) });
    const stacks = [...new Set(G.speed_weekly_by_stack.map((r) => r.paymentType))];
    const weeks = [...new Set(G.speed_weekly_by_stack.map((r) => r.week))].sort();
    const SC = [C.blue, C.aqua, C.yellow, C.red, C.violet, C.magenta];
    mk(c2, { type: 'line', plugins: [shade((l, i) => hol.week(weeks[i]))],
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: stacks.map((s, i) => ({
            ...line(SC[i % SC.length]), label: s,
            data: weeks.map((w) => { const r = G.speed_weekly_by_stack.find((x) => x.week === w && x.paymentType === s);
                return r ? r.med_ms / 1000 : null; }) })) },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ ticks: { callback: (v) => v + 's' } }) } }) });
    const comp = G.speed_components_weekly;
    const steps = ['checkSignal', 'openSocket', 'handshake', 'transfer'];
    mk(c3, { type: 'bar',
        data: { labels: comp.map((r) => 'wk ' + r.week.slice(5, 10)), datasets: steps.map((s, i) => ({
            ...bar([C.muted, C.yellow, C.violet, C.blue][i]), label: s, data: comp.map((r) => r[s]) })) },
        options: opts({ legend: true, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y} ms` } },
            scales: { x: { ...ax({ grid: { display: false } }), stacked: true }, y: { ...ax({ beginAtZero: true, ticks: { callback: (v) => v + 'ms' } }), stacked: true } } }) });
}

function renderFood(el, G, hol) {
    const mixTot = G.food_mix.reduce((a, b) => a + b.n, 0);
    const uncl = G.food_mix.find((r) => r.mcat === 'Unclassified');
    const verPct = (100 * (mixTot - (uncl?.n || 0)) / mixTot);
    const ver = G.food_mix.filter((r) => r.mcat !== 'Unclassified').sort((a, b) => b.n - a.n);
    const verTot = ver.reduce((a, b) => a + b.n, 0);
    const MON = monthName(G.meta.month);
    el.innerHTML = `
      <h5>How much of ${MON} has a known category? ${info(`A stall is classified by its registered name only, and only if its
        prices don't contradict it (a "cooked food" name trading at a $0.60 modal is not counted). Generic names ("Stall 1")
        and bare company names stay Unclassified, never guessed. Two-food-group names count as Mixed. Receipt-level item
        data, where present, is in Purchases & Nutrition.`)}</h5>
      <div style="display:flex;height:22px;border-radius:5px;overflow:hidden;margin:6px 0 2px;font-size:10px;color:#fff">
        <div style="width:${verPct}%;background:${C.blue};display:flex;align-items:center;justify-content:center;white-space:nowrap">${verPct.toFixed(1)}% verified</div>
        <div style="flex:1;background:#b9b8b3;display:flex;align-items:center;justify-content:center">${(100 - verPct).toFixed(1)}% Unclassified — category unknown</div>
      </div>
      <div class="cap" style="margin-bottom:8px">Charts below use only the verified ${verPct.toFixed(0)}%.</div>
      <h5>What sells — share within name-verified volume</h5>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Category share by week — ${MON} ${info('Share of verified payments per week. Weeks with under 2,000 verified payments (holidays) are left blank.')} ${hol.key}</h5>
      <div class="cwrap tall"><canvas></canvas></div>
      <h5>Average price by week — ${MON} ${info('Average payment per verified category. Points under 300 payments are left blank.')} ${hol.key}</h5>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    mk(c1, { type: 'bar',
        data: { labels: ver.map((r) => r.mcat), datasets: [{ ...bar(C.blue),
            backgroundColor: ver.map((r) => CAT_COLOR[r.mcat]), label: '%',
            data: ver.map((r) => 100 * r.n / verTot) }] },
        options: { ...opts({ tooltip: { callbacks: { label: (c) => { const r = ver[c.dataIndex];
            return ` ${fmt(r.n)} txns · $${fmt(r.sgd)} · avg $${r.avg_sgd.toFixed(2)}`; } } },
            scales: { x: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }), y: ax({ grid: { display: false } }) } }), indexAxis: 'y' } });
    // weekly shares within name-verified volume (Unclassified excluded from the denominator)
    const fwv = G.food_weekly.filter((r) => r.mcat !== 'Unclassified');
    const weeks = [...new Set(fwv.map((r) => r.week))].sort();
    const wkTot = {}; fwv.forEach((r) => { wkTot[r.week] = (wkTot[r.week] || 0) + r.n; });
    const main3 = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Mixed', 'Bookshop & Supplies'];
    mk(c2, { type: 'line', plugins: [shade((l, i) => hol.week(weeks[i]))],
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: main3.map((cat) => ({
            ...line(CAT_COLOR[cat]), label: cat,
            data: weeks.map((w) => { if ((wkTot[w] || 0) < 2000) return null;   // holiday week: named stalls closed
                const r = fwv.find((x) => x.week === w && x.mcat === cat);
                return r ? 100 * r.n / wkTot[w] : 0; }) })) },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c3, { type: 'line', plugins: [shade((l, i) => hol.week(weeks[i]))],
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: ['Drinks', 'Snacks & Desserts', 'Cooked Food'].map((cat) => ({
            ...line(CAT_COLOR[cat]), label: cat,
            data: weeks.map((w) => { const r = fwv.find((x) => x.week === w && x.mcat === cat);
                return (r && r.n >= 300) ? r.avg_cents / 100 : null; }) })) },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ ticks: { callback: (v) => '$' + v.toFixed(2) } }) } }) });
}

function renderAtas(el, G, SCHOOLS) {
    const ranked = Object.values(SCHOOLS).filter((s) => s.spend_day && s.cards >= 200)
        .sort((a, b) => b.spend_day - a.spend_day);
    el.innerHTML = `
      <h5>Spend by school type ${info(`$ per student per active day and average ticket, by MOE school type. Based on
        ${G.atas.coverage.matched} of ${G.atas.coverage.total} schools matched to the MOE directory.`)}</h5>
      <div class="cap">Independent $${G.atas.by_type.find((r) => r.type === 'INDEPENDENT SCHOOL')?.spend_day.toFixed(2)}/day
        ($${G.atas.by_type.find((r) => r.type === 'INDEPENDENT SCHOOL')?.avg_ticket.toFixed(2)} ticket) ·
        Government $${G.atas.by_type.find((r) => r.type === 'GOVERNMENT SCHOOL')?.spend_day.toFixed(2)}/day
        ($${G.atas.by_type.find((r) => r.type === 'GOVERNMENT SCHOOL')?.avg_ticket.toFixed(2)} ticket)</div>
      <div class="cap">Click a bar to list only that type</div>
      <div class="cwrap"><canvas></canvas></div>
      <div data-top></div>
      <div class="cap">Click a row to fly to the school and open it ${info(`Spend = all SMART Buddy payments at the school's own stalls.
        Pacific Bookstores and Self Serve Stamps are vendors filed under their own IDs, so they are not included.`)}</div>`;
    const T = G.atas.by_type;
    let sel = null;                                   // selected MOE type (bar click), null = all
    const top = el.querySelector('[data-top]');
    const renderTop = () => {
        const rows = ranked.filter((s) => !sel || s.moe_type === sel).slice(0, 12);
        top.innerHTML = `<h5>Top spenders — $ per student per day${sel ? ` · ${typeName(sel)} only
            <button class="linkbtn" data-clear>show all</button>` : ''} ${info('Schools with at least 200 cards this month.')}</h5>
          <table class="mini"><tr><th>#</th><th>School</th><th>Level</th><th>Type</th>
            <th style="text-align:right">$/day</th><th style="text-align:right">Ticket</th></tr>
            ${rows.map((s, i) => `<tr class="click" data-sid="${s.id}" ${rowAttrs('Fly to this school and open it')}><td>${i + 1}</td>
              <td><b>${esc(s.name || s.id)}</b></td><td>${s.level}</td>
              <td>${s.moe_type ? typeName(s.moe_type) : '–'}</td>
              <td class="num"><b>$${s.spend_day.toFixed(2)}</b></td><td class="num">$${s.avg_ticket.toFixed(2)}</td></tr>`).join('')}
          </table>${rows.length ? '' : '<div class="note-box">No school of this type has 200+ cards this month.</div>'}`;
        top.querySelectorAll('tr[data-sid]').forEach((tr) =>
            tr.addEventListener('click', () => window.SB.focusSchool(tr.dataset.sid)));
        top.querySelector('[data-clear]')?.addEventListener('click', () => pick(null));
    };
    // fade the unselected types so the picked bar pair stands out
    const fill = (c) => T.map((r) => (!sel || r.type === sel ? c : c + '40'));
    const chart = mk(el.querySelector('canvas'), { type: 'bar',
        data: { labels: T.map((r) => typeName(r.type).split(' ')),     // 2-line labels → all 6 types fit
            datasets: [
                { ...bar(C.blue), label: '$ / student-day', data: T.map((r) => r.spend_day), backgroundColor: fill(C.blue) },
                { ...bar(C.aqua), label: 'avg ticket $', data: T.map((r) => r.avg_ticket), backgroundColor: fill(C.aqua) }] },
        options: { ...opts({ legend: true, tooltip: { callbacks: { afterBody: (i) =>
            [`${T[i[0].dataIndex].schools} schools · click to list them`] } },
            scales: { x: ax({ grid: { display: false }, ticks: { autoSkip: false } }),
                y: ax({ beginAtZero: true, ticks: { callback: (v) => '$' + v } }) } }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : ''; },
            onClick: (e, els) => { if (els.length) pick(T[els[0].index].type); } } });
    const pick = (type) => {
        sel = sel === type ? null : type;             // same bar again = clear
        chart.data.datasets[0].backgroundColor = fill(C.blue);
        chart.data.datasets[1].backgroundColor = fill(C.aqua);
        chart.update(); renderTop();
    };
    renderTop();
}

// 'SPECIALISED INDEPENDENT SCHOOL' → 'Specialised independent', 'SPED SCHOOL' → 'SPED'
const typeName = (t) => t.replace(/ SCH(OOL)?$/, '').toLowerCase().replace(/\bsped\b/, 'SPED').replace(/^./, (c) => c.toUpperCase());
