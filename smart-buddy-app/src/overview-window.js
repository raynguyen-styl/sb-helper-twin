// Network-wide overview window: opened on load. KPIs + the five requested views.
import { openWindow } from './windowing.js';
import { mk, opts, ax, bar, line, C, CAT_COLOR, LV_COLOR } from './charts.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const CATS = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Fruits', 'Bookshop & Supplies', 'Unclassified'];

export function openOverview(GLOBAL, SCHOOLS, onOpenSchool) {
    const body = openWindow({ id: 'overview', title: 'Network Overview', sub: 'Feb – Apr 2026', chips: [] });
    if (!body) return;
    body.closest('.tw').style.width = '700px';
    body.closest('.tw').style.left = 'calc(100vw - 740px)';
    body.closest('.tw').style.top = '18px';

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

    renderNet(body.querySelector('[data-pane="net"]'), GLOBAL);
    renderSpeed(body.querySelector('[data-pane="speed"]'), GLOBAL);
    renderFood(body.querySelector('[data-pane="food"]'), GLOBAL);
    renderAtas(body.querySelector('[data-pane="atas"]'), GLOBAL, SCHOOLS, onOpenSchool);
}

function renderNet(el, G) {
    const worst = [...G.terminals].filter((t) => t.n >= 2000).sort((a, b) => b.err_pct - a.err_pct).slice(0, 8);
    el.innerHTML = `
      <h5>Daily error rate &amp; offline share</h5>
      <div class="cap">Errors hold a flat 6–9% school-day baseline; offline processing ~30%. Spikes are low-volume event days.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>4G signal quality across terminals (0–31 scale)</h5>
      <div class="cap">Distribution of reported signal on cellular terminals. 45 WiFi terminals report dBm instead (excluded).</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Terminals needing attention (≥2k txns, worst error rate)</h5>
      <table class="mini"><tr><th>Terminal</th><th>School</th><th style="text-align:right">Txns</th>
        <th style="text-align:right">Err %</th><th style="text-align:right">Median</th></tr>
        ${worst.map((t) => `<tr><td style="font-size:10.5px">…${t.terminalId.slice(-11)}</td><td><b>${t.school}</b></td>
          <td class="num">${fmt(t.n)}</td><td class="num pill-bad">${t.err_pct}%</td>
          <td class="num">${(t.med_ms / 1000).toFixed(1)}s</td></tr>`).join('')}</table>`;
    const [c1, c2] = el.querySelectorAll('canvas');
    const d = G.daily;
    mk(c1, { type: 'line',
        data: { labels: d.map((r) => r.date), datasets: [
            { ...line(C.red), label: 'Error %', data: d.map((r) => r.err_pct) },
            { ...line(C.blue, { borderDash: [5, 3] }), label: 'Offline %', data: d.map((r) => r.offline_pct) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax({ ticks: { maxTicksLimit: 7 } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c2, { type: 'bar',
        data: { labels: G.signal_dist.map((r) => r.sig), datasets: [{ ...bar(C.blue), label: 'Txns', data: G.signal_dist.map((r) => r.n) }] },
        options: opts({ tooltip: { callbacks: { label: (c) => ` signal ${G.signal_dist[c.dataIndex].sig}: ${fmt(c.parsed.y)} txns` } },
            scales: { x: ax({ grid: { display: false } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => v / 1e6 + 'M' } }) } }) });
}

function renderSpeed(el, G) {
    el.innerHTML = `
      <h5>Daily median &amp; p95 transaction time</h5>
      <div class="cap">Stable ~2.3s median all quarter — no degradation trend. The p95 tail is where queues form.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Weekly median by payment stack</h5>
      <div class="cap">The 3.0 ASCAN stack runs ~2× slower than 2.0 — consistently, not episodically.</div>
      <div class="cwrap tall"><canvas></canvas></div>
      <h5>Where the online time goes (median ms per step, by month)</h5>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    const d = G.daily;
    mk(c1, { type: 'line',
        data: { labels: d.map((r) => r.date), datasets: [
            { ...line(C.blue), label: 'Median', data: d.map((r) => r.med_ms / 1000) },
            { ...line(C.violet, { borderDash: [5, 3] }), label: 'p95', data: d.map((r) => r.p95_ms / 1000) }] },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax({ ticks: { maxTicksLimit: 7 } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + 's' } }) } }) });
    const stacks = [...new Set(G.speed_weekly_by_stack.map((r) => r.paymentType))];
    const weeks = [...new Set(G.speed_weekly_by_stack.map((r) => r.week))].sort();
    const SC = [C.blue, C.aqua, C.yellow, C.red, C.violet, C.magenta];
    mk(c2, { type: 'line',
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: stacks.map((s, i) => ({
            ...line(SC[i % SC.length]), label: s,
            data: weeks.map((w) => { const r = G.speed_weekly_by_stack.find((x) => x.week === w && x.paymentType === s);
                return r ? r.med_ms / 1000 : null; }) })) },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ ticks: { callback: (v) => v + 's' } }) } }) });
    const comp = G.speed_components_monthly;
    const steps = ['checkSignal', 'openSocket', 'handshake', 'transfer'];
    mk(c3, { type: 'bar',
        data: { labels: comp.map((r) => r.month), datasets: steps.map((s, i) => ({
            ...bar([C.muted, C.yellow, C.violet, C.blue][i]), label: s, data: comp.map((r) => r[s]) })) },
        options: opts({ legend: true, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y} ms` } },
            scales: { x: { ...ax({ grid: { display: false } }), stacked: true }, y: { ...ax({ beginAtZero: true, ticks: { callback: (v) => v + 'ms' } }), stacked: true } } }) });
}

function renderFood(el, G) {
    el.innerHTML = `
      <h5>What sells — category share of purchases</h5>
      <div class="cap">Categories from name-verified stalls only (no item data exists); generic-named stalls
      show as Unclassified — what they sell is never guessed.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Category share by week — name-verified stalls</h5>
      <div class="cap">Share within verified volume; stable in every teaching week. The mid-March gap is the
      school-holiday week — named stalls barely trade, so no honest share exists.</div>
      <div class="cwrap tall"><canvas></canvas></div>
      <h5>Average price by week per verified category</h5>
      <div class="cap">Flat in term time — no canteen inflation. Low-volume weeks are gapped, not charted.</div>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    const mixTot = G.food_mix.reduce((a, b) => a + b.n, 0);
    mk(c1, { type: 'bar',
        data: { labels: G.food_mix.map((r) => r.mcat), datasets: [{ ...bar(C.blue),
            backgroundColor: G.food_mix.map((r) => CAT_COLOR[r.mcat]), label: '%',
            data: G.food_mix.map((r) => 100 * r.n / mixTot) }] },
        options: { ...opts({ tooltip: { callbacks: { label: (c) => { const r = G.food_mix[c.dataIndex];
            return ` ${fmt(r.n)} txns · $${fmt(r.sgd)} · avg $${r.avg_sgd.toFixed(2)}`; } } },
            scales: { x: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }), y: ax({ grid: { display: false } }) } }), indexAxis: 'y' } });
    // weekly shares within name-verified volume (Unclassified excluded from the denominator)
    const fwv = G.food_weekly.filter((r) => r.mcat !== 'Unclassified');
    const weeks = [...new Set(fwv.map((r) => r.week))].sort();
    const wkTot = {}; fwv.forEach((r) => { wkTot[r.week] = (wkTot[r.week] || 0) + r.n; });
    const main3 = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Bookshop & Supplies'];
    mk(c2, { type: 'line',
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: main3.map((cat) => ({
            ...line(CAT_COLOR[cat]), label: cat,
            data: weeks.map((w) => { if ((wkTot[w] || 0) < 2000) return null;   // holiday week: named stalls closed
                const r = fwv.find((x) => x.week === w && x.mcat === cat);
                return r ? 100 * r.n / wkTot[w] : 0; }) })) },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => v + '%' } }) } }) });
    mk(c3, { type: 'line',
        data: { labels: weeks.map((w) => w.slice(5, 10)), datasets: ['Drinks', 'Snacks & Desserts', 'Cooked Food'].map((cat) => ({
            ...line(CAT_COLOR[cat]), label: cat,
            data: weeks.map((w) => { const r = fwv.find((x) => x.week === w && x.mcat === cat);
                return (r && r.n >= 300) ? r.avg_cents / 100 : null; }) })) },
        options: opts({ legend: true, indexMode: true,
            scales: { x: ax(), y: ax({ ticks: { callback: (v) => '$' + v.toFixed(2) } }) } }) });
}

function renderAtas(el, G, SCHOOLS, onOpenSchool) {
    const ranked = Object.values(SCHOOLS).filter((s) => s.spend_day && s.cards >= 200)
        .sort((a, b) => b.spend_day - a.spend_day);
    el.innerHTML = `
      <h5>Do "atas" schools spend more? (MOE-matched schools only)</h5>
      <div class="cap">Independent schools average $${G.atas.by_type.find((r) => r.type === 'INDEPENDENT SCHOOL')?.spend_day.toFixed(2)}
        per student-day with a $${G.atas.by_type.find((r) => r.type === 'INDEPENDENT SCHOOL')?.avg_ticket.toFixed(2)} ticket —
        vs $${G.atas.by_type.find((r) => r.type === 'GOVERNMENT SCHOOL')?.spend_day.toFixed(2)} / $${G.atas.by_type.find((r) => r.type === 'GOVERNMENT SCHOOL')?.avg_ticket.toFixed(2)}
        at government schools. Based on ${G.atas.coverage.matched} of ${G.atas.coverage.total} schools matched to the MOE directory.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Top spenders — $ per student per active day (≥200 cards)</h5>
      <table class="mini"><tr><th>#</th><th>School</th><th>Level</th><th>Type</th>
        <th style="text-align:right">$/day</th><th style="text-align:right">Ticket</th></tr>
        ${ranked.slice(0, 12).map((s, i) => `<tr style="cursor:pointer" data-sid="${s.id}"><td>${i + 1}</td>
          <td><b>${s.name || s.id}</b></td><td>${s.level}</td>
          <td>${s.moe_type ? s.moe_type.replace(' SCHOOL', '').replace('-AIDED SCH', '-aided').toLowerCase() : '–'}</td>
          <td class="num"><b>$${s.spend_day.toFixed(2)}</b></td><td class="num">$${s.avg_ticket.toFixed(2)}</td></tr>`).join('')}
      </table>
      <div class="note-box">Click a row to open the school. "Spend" is canteen + bookshop spending through SMART Buddy —
      independent-school students both pay more per item and buy pricier categories.</div>`;
    mk(el.querySelector('canvas'), { type: 'bar',
        data: { labels: G.atas.by_type.map((r) => r.type.replace(' SCHOOL', '').replace(' SCH', '')),
            datasets: [
                { ...bar(C.blue), label: '$ / student-day', data: G.atas.by_type.map((r) => r.spend_day) },
                { ...bar(C.aqua), label: 'avg ticket $', data: G.atas.by_type.map((r) => r.avg_ticket) }] },
        options: opts({ legend: true, tooltip: { callbacks: { afterBody: (i) =>
            [`${G.atas.by_type[i[0].dataIndex].schools} schools`] } },
            scales: { x: ax({ grid: { display: false } }), y: ax({ beginAtZero: true, ticks: { callback: (v) => '$' + v } }) } }) });
    el.querySelectorAll('tr[data-sid]').forEach((tr) =>
        tr.addEventListener('click', () => onOpenSchool(tr.dataset.sid)));
}
