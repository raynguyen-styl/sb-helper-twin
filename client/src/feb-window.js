// Wearables & Health window — the month where wearable + transaction data overlap (Feb only).
// Every filter re-slices the precomputed `wearable` insight bundle (built from ClickHouse).
import { openWindow } from './windowing.js';
import { mk, opts, ax, bar, line, C, CAT_COLOR } from './charts.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const fmt$ = (v) => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v);
const SEG_COLOR = [C.blue, C.aqua, C.yellow, C.muted];
const DT_COLOR = { School: C.blue, Weekend: C.violet, CNY: C.red, All: C.ink2 };
const SLOTS = [...Array(48).keys()].map((i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const HOURS = [...Array(24).keys()].map((h) => h + ':00');
const charts = {};   // pane -> [Chart]; destroyed on re-render

function kill(pane) { (charts[pane] || []).forEach((c) => c.destroy()); charts[pane] = []; }
function keep(pane, c) { charts[pane].push(c); return c; }

function fbar(el, name, items, cur, onPick) {
    const div = document.createElement('div');
    div.className = 'fbar';
    div.innerHTML = `<span class="fl">${name}</span>` + items.map((it) =>
        `<button data-v="${it.v}" class="${it.v === cur ? 'on' : ''}">${it.t}</button>`).join('');
    div.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
            div.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
            onPick(b.dataset.v);
        }));
    el.appendChild(div);
}

export function openFeb(FEB, tab) {
    const body = openWindow({ id: 'feb', title: 'Wearables & Health', sub: 'health × transactions · the overlap month', chips: ['<span class="chip chip-flag">NEW DATA</span>'] });
    if (!body) return;
    const tw = body.closest('.tw');
    tw.style.width = '740px'; tw.style.left = '40px'; tw.style.top = '14px';

    if (!FEB || !FEB.meta) {
        body.innerHTML = `<div class="cap">No wearable / heart-rate data for this month. Upload the
          <b>Wearable activity</b> and <b>Heart rate</b> datasets, then rebuild insights.</div>`;
        return;
    }
    const m = FEB.meta;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${(m.h_rows / 1e6).toFixed(1)}M</div><div class="l">activity rows</div></div>
        <div class="stat"><div class="v">${fmt(m.h_users)}</div><div class="l">wearable users</div></div>
        <div class="stat"><div class="v">${(m.r_rows / 1e6).toFixed(1)}M</div><div class="l">HR rows</div></div>
        <div class="stat"><div class="v">${fmt$(m.t_rev)}</div><div class="l">Feb canteen spend</div></div>
        <div class="stat"><div class="v">28</div><div class="l">shared days</div></div>
      </div>
      <div class="tabs">
        <button data-tab="act" class="on">Activity</button>
        <button data-tab="wear">Wear &amp; adoption</button>
        <button data-tab="hr">Heart rate</button>
        <button data-tab="spend">Spending</button>
        <button data-tab="cny">CNY story</button>
      </div>
      <div data-pane="act"></div><div data-pane="wear" style="display:none"></div>
      <div data-pane="hr" style="display:none"></div><div data-pane="spend" style="display:none"></div>
      <div data-pane="cny" style="display:none"></div>`;

    body.querySelectorAll('.tabs button').forEach((b) =>
        b.addEventListener('click', () => {
            body.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
            body.querySelectorAll('[data-pane]').forEach((p) =>
                (p.style.display = p.dataset.pane === b.dataset.tab ? '' : 'none'));
        }));

    renderAct(body.querySelector('[data-pane="act"]'), FEB);
    renderWear(body.querySelector('[data-pane="wear"]'), FEB);
    renderHR(body.querySelector('[data-pane="hr"]'), FEB);
    renderSpend(body.querySelector('[data-pane="spend"]'), FEB);
    renderCNY(body.querySelector('[data-pane="cny"]'), FEB);
    if (tab) body.querySelector(`.tabs button[data-tab="${tab}"]`)?.click();
}

/* ================= ACTIVITY ================= */
function renderAct(el, FEB) {
    let dt = 'All', sg = 'All';
    el.innerHTML = '';
    fbar(el, 'Day type', [{ v: 'All', t: 'All days' }, { v: 'School', t: 'School days' },
        { v: 'Weekend', t: 'Weekends' }, { v: 'CNY', t: 'CNY 16–18' }], dt, (v) => { dt = v; paint(); });
    fbar(el, 'Segment', [{ v: 'All', t: 'All users' },
        ...FEB.segments.map((s) => ({ v: String(s.id), t: s.name }))], sg, (v) => { sg = v; paint(); });
    const box = document.createElement('div'); el.appendChild(box);

    const paint = () => {
        kill('act');
        const S = FEB.activity[`${dt}|${sg}`];
        const REF = FEB.activity['All|All'];
        const segInfo = sg === 'All' ? null : FEB.segments[+sg];
        const b = S.budget || {};
        box.innerHTML = `
          <div class="stats">
            <div class="stat"><div class="v">${fmt(S.steps)}</div><div class="l">steps / user-day</div></div>
            <div class="stat"><div class="v">${fmt(S.kcal)}</div><div class="l">kcal / user-day</div></div>
            <div class="stat"><div class="v">${fmt(S.users)}</div><div class="l">users in slice</div></div>
            <div class="stat"><div class="v">${(b.active ?? 0).toFixed(1)}h</div><div class="l">active hrs (&gt;500 steps/h)</div></div>
          </div>
          ${segInfo ? `<div class="cap" style="margin:2px 0 6px">${segInfo.name}: ${fmt(segInfo.users)} users · median ${fmt(segInfo.steps)} steps/day · wears ${segInfo.wear_days} days (${segInfo.wk_days} weekend) · resting HR ${segInfo.rhr ?? '–'}</div>` : ''}
          <h5>Movement through the day</h5>
          <div class="cap">Steps per 30 min per user — selected slice vs all users, all days (grey). Filter above.</div>
          <div class="cwrap tall"><canvas></canvas></div>
          <h5>How the day's time is spent (worn hours)</h5>
          <div class="cap">Avg hours per user-day: sedentary (&lt;50 steps/h) · light · active (&gt;500 steps/h). Selected segment across day types.</div>
          <div class="cwrap" style="height:130px"><canvas></canvas></div>
          <h5>The spread — daily steps percentiles (all users)</h5>
          <div class="cap">Median (line), p25–p75 (band), p10–p90 (faint). Weekends dip; CNY days marked red on the axis.</div>
          <div class="cwrap"><canvas></canvas></div>`;
        const [c1, c2, c3] = box.querySelectorAll('canvas');

        keep('act', mk(c1, { type: 'line', data: { labels: SLOTS, datasets: [
            { label: 'selected', data: S.intraday, ...line(DT_COLOR[dt] || C.blue, { fill: true, backgroundColor: (DT_COLOR[dt] || C.blue) + '22' }) },
            { label: 'all users · all days', data: REF.intraday, ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }) },
        ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 10 } }), y: ax({ title: { display: true, text: 'steps/30min', font: { size: 10 } } }) } }) }));

        const dts = ['School', 'Weekend', 'CNY'];
        const bud = (z) => dts.map((d) => (FEB.activity[`${d}|${sg}`].budget || {})[z] ?? 0);
        keep('act', mk(c2, { type: 'bar', data: { labels: dts, datasets: [
            { label: 'sedentary', data: bud('sed'), ...bar(C.muted + '88') },
            { label: 'light', data: bud('light'), ...bar(C.yellow) },
            { label: 'active', data: bud('active'), ...bar(C.aqua) },
        ] }, options: { ...opts({ legend: true, indexMode: true, scales: {
            x: { stacked: true, ...ax() }, y: { stacked: true, ...ax({ title: { display: true, text: 'hours', font: { size: 10 } } }) } } }), indexAxis: 'y' } }));

        const D = FEB.daily;
        keep('act', mk(c3, { type: 'line', data: { labels: D.map((x) => x.dow[0] + ' ' + +x.d.slice(8)), datasets: [
            { label: 'p90', data: D.map((x) => x.p90), ...line('transparent'), fill: '+4', backgroundColor: C.blue + '14' },
            { label: 'p75', data: D.map((x) => x.p75), ...line('transparent'), fill: '+2', backgroundColor: C.blue + '2e' },
            { label: 'median', data: D.map((x) => x.p50), ...line(C.blue) },
            { label: 'p25', data: D.map((x) => x.p25), ...line('transparent') },
            { label: 'p10', data: D.map((x) => x.p10), ...line('transparent') },
        ] }, options: opts({ indexMode: true, scales: {
            x: ax({ ticks: { autoSkip: false, font: { size: 8.5 }, color: D.map((x) => x.daytype === 'CNY' ? C.red : x.daytype === 'Weekend' ? C.violet : '#898781') } }),
            y: ax() } }) }));
    };
    paint();
}

/* ================= WEAR & ADOPTION ================= */
function renderWear(el, FEB) {
    const W = FEB.wear;
    charts['wear'] = [];
    el.innerHTML = `
      <h5>Adoption cohorts — who actually wears the band</h5>
      <table class="mini"><tr><th>Cohort</th><th style="text-align:right">Users</th>
        <th style="text-align:right">Steps/day</th><th style="text-align:right">Weekend wear</th></tr>
        ${W.cohorts.map((c) => `<tr><td><b>${c.cohort}</b></td><td class="num">${fmt(c.users)}</td>
          <td class="num">${fmt(c.steps)}</td><td class="num">${c.weekend_pct}%</td></tr>`).join('')}</table>
      <h5 style="margin-top:14px">Days worn in February</h5>
      <div class="cap">Bimodal: a committed daily-wear core vs a long tail that tried it a few days. School-day count (17–20) is the natural ceiling for weekday-only wearers.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Users syncing per day — and who is new</h5>
      <div class="cap">Blue: users active that day. Green: first-ever appearance (adoption). Watch the weekend troughs and the CNY dip.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>Weekend vs school-day movement, per user</h5>
      <div class="cap">Ratio of a user's weekend steps to their school-day steps (users worn ≥3 school + ≥2 weekend days). Most students move far less on weekends — a right tail stays just as active.</div>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    keep('wear', mk(c1, { type: 'bar', data: { labels: W.days_hist.map((x) => x.days),
        datasets: [{ label: 'users', data: W.days_hist.map((x) => x.n), ...bar(C.blue) }] },
        options: opts({ scales: { x: ax({ title: { display: true, text: 'days worn', font: { size: 10 } } }), y: ax() } }) }));
    keep('wear', mk(c2, { data: { labels: W.daily_active.map((x) => +x.d.slice(8)), datasets: [
        { type: 'line', label: 'active users', data: W.daily_active.map((x) => x.users), ...line(C.blue) },
        { type: 'bar', label: 'new users', data: W.daily_active.map((x) => x.new_users), ...bar(C.aqua) },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax() } }) }));
    keep('wear', mk(c3, { type: 'bar', data: { labels: FEB.wkend_contrast.map((x) => Math.round(x.ratio * 100) + '%'),
        datasets: [{ label: 'users', data: FEB.wkend_contrast.map((x) => x.n), ...bar(C.violet) }] },
        options: opts({ scales: { x: ax({ title: { display: true, text: 'weekend steps as % of school-day steps', font: { size: 10 } } }), y: ax() } }) }));
}

/* ================= HEART RATE ================= */
function renderHR(el, FEB) {
    let fw = 'All', dt = 'All';
    el.innerHTML = '';
    // firmware_version isn't in the current raw feed → only show the filter when there's a real choice
    if ((FEB.hr.firmwares || []).length > 1)
        fbar(el, 'Firmware', FEB.hr.firmwares.map((f) => ({ v: f, t: f === 'All' ? 'All firmware' : f })), fw, (v) => { fw = v; paint(); });
    fbar(el, 'Day type', [{ v: 'All', t: 'All days' }, { v: 'School', t: 'School' },
        { v: 'Weekend', t: 'Weekend' }, { v: 'CNY', t: 'CNY' }], dt, (v) => { dt = v; paint(); });
    const box = document.createElement('div'); el.appendChild(box);

    const paint = () => {
        kill('hr');
        const cur = FEB.hr.curves[`${fw}|${dt}`];
        const ref = FEB.hr.curves['All|All'];
        const ft = FEB.hr.fw_table.find((x) => x.fw === fw);
        box.innerHTML = `
          ${ft ? `<div class="cap" style="margin:2px 0 6px">${fw}: ${fmt(ft.n)} records · ${fmt(ft.users)} users · <b>${fmt(ft.err255)}</b> whole-record 255 errors · <b>${fmt(ft.lt40)}</b> sub-40 readings ${ft.err255 > 0 ? '<span class="chip chip-indep">FAULTY</span>' : '<span class="chip chip-sec">CLEAN</span>'}</div>` : ''}
          <h5>Average bpm by hour</h5>
          <div class="cap">Valid readings (30–220 bpm, Feb payload dates). 23:00 is a known sparse-sampling artifact. Grey: all firmware, all days.</div>
          <div class="cwrap tall"><canvas></canvas></div>
          <h5>Share of readings in elevated zones, by hour</h5>
          <div class="cap">% of hourly readings ≥100 bpm on school days vs weekends vs CNY — PE &amp; recess hours light up on school days.</div>
          <div class="cwrap"><canvas></canvas></div>
          ${FEB.hr.fw_table.length ? `<h5>Firmware fleet — February</h5>
          <table class="mini"><tr><th>Firmware</th><th style="text-align:right">Records</th>
            <th style="text-align:right">Users</th><th style="text-align:right">255-errors</th>
            <th style="text-align:right">&lt;40 bpm</th></tr>
            ${FEB.hr.fw_table.map((x) => `<tr><td><b>${x.fw}</b>${x.err255 > 0 ? ' <span class="chip chip-indep">FAULTY</span>' : ''}</td>
              <td class="num">${fmt(x.n)}</td><td class="num">${fmt(x.users)}</td>
              <td class="num">${fmt(x.err255)}</td><td class="num">${fmt(x.lt40)}</td></tr>`).join('')}</table>` : ''}
          <h5 style="margin-top:12px">Resting heart rate</h5>
          <div class="cwrap"><canvas></canvas></div>`;
        const [c1, c2, c3] = box.querySelectorAll('canvas');
        keep('hr', mk(c1, { type: 'line', data: { labels: HOURS, datasets: [
            { label: 'selected', data: cur.bpm, ...line(DT_COLOR[dt] || C.red), spanGaps: true },
            { label: 'all · all', data: ref.bpm, ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }), spanGaps: true },
        ] }, options: opts({ legend: true, indexMode: true, tooltip: { callbacks: { afterLabel: (c) => c.datasetIndex === 0 ? 'n = ' + fmt(cur.n[c.dataIndex]) : '' } }, scales: { x: ax({ ticks: { maxTicksLimit: 12 } }), y: ax({ title: { display: true, text: 'bpm', font: { size: 10 } } }) } }) }));
        keep('hr', mk(c2, { type: 'line', data: { labels: HOURS, datasets:
            Object.entries(FEB.hr.zones_hourly).map(([k, z]) => {
                const arr = [...Array(24)].map((_, h) => { const f = z.find((x) => x.hh === h); return f ? f.mod : null; });
                return { label: k, data: arr, ...line(DT_COLOR[k]), spanGaps: true };
            }) }, options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 12 } }), y: ax({ title: { display: true, text: '% ≥100 bpm', font: { size: 10 } } }) } }) }));
        keep('hr', mk(c3, { type: 'bar', data: { labels: FEB.hr.resting.map((x) => x.lo + '–' + (x.lo + 4)),
            datasets: [{ label: 'users', data: FEB.hr.resting.map((x) => x.n), ...bar(C.aqua) }] },
            options: opts({ scales: { x: ax({ ticks: { font: { size: 9 } } }), y: ax() } }) }));
    };
    paint();
}

/* ================= SPENDING ================= */
function renderSpend(el, FEB) {
    let lv = 'All', ct = 'All';
    const S = FEB.spend;
    el.innerHTML = '';
    fbar(el, 'Level', S.levels.map((l) => ({ v: l, t: l === 'All' ? 'All levels' : l })), lv, (v) => { lv = v; paint(); });
    fbar(el, 'Category', S.cats.map((c) => ({ v: c, t: c === 'All' ? 'All categories' : c })), ct, (v) => { ct = v; paint(); });
    const pol = document.createElement('div'); pol.className = 'cap';
    pol.innerHTML = 'Categories come from name-verified stalls only; generic-named stalls ("Stall 1") are ' +
        '<b>Unclassified</b> — most of the volume, never guessed.';
    el.appendChild(pol);
    const box = document.createElement('div'); el.appendChild(box);
    const days = [...Array(28).keys()].map((i) => i + 1);
    const CNYD = new Set([16, 17, 18]);

    const paint = () => {
        kill('spend');
        const key = `${lv}|${ct}`;
        const k = S.kpis[key];
        const col = ct !== 'All' ? (CAT_COLOR[ct] || C.yellow) : C.yellow;
        box.innerHTML = `
          <div class="stats">
            <div class="stat"><div class="v">${fmt$(k.rev)}</div><div class="l">revenue</div></div>
            <div class="stat"><div class="v">${(k.n / 1e3).toFixed(0)}K</div><div class="l">transactions</div></div>
            <div class="stat"><div class="v">${k.ticket != null ? '$' + k.ticket.toFixed(2) : '–'}</div><div class="l">avg ticket</div></div>
            <div class="stat"><div class="v">${fmt(k.cards)}</div><div class="l">cards</div></div>
          </div>
          <h5>Daily revenue — February</h5>
          <div class="cap">CNY days in red (eve half-day 16th, holidays 17–18th). Weekends are near-zero by design — school canteens.</div>
          <div class="cwrap"><canvas></canvas></div>
          <h5>Revenue by hour — school days</h5>
          <div class="cap">The recess economy: 9–11am carries about half of school-day revenue.</div>
          <div class="cwrap"><canvas></canvas></div>
          <h5>Category mix — ${lv === 'All' ? 'all levels' : lv}</h5>
          <table class="mini"><tr><th>Category</th><th style="text-align:right">Txns</th><th style="text-align:right">Revenue</th><th style="text-align:right">Share</th></tr>
            ${(() => { const mx = S.mix[lv]; const tot = mx.reduce((a, x) => a + x.sgd, 0);
                return mx.map((x) => `<tr${x.mcat === ct ? ' style="background:var(--parchment)"' : ''}><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CAT_COLOR[x.mcat] || C.muted};margin-right:6px"></span>${x.mcat}</td>
                  <td class="num">${fmt(x.n)}</td><td class="num">${fmt$(x.sgd)}</td>
                  <td class="num">${(100 * x.sgd / tot).toFixed(1)}%</td></tr>`).join(''); })()}</table>`;
        const [c1, c2] = box.querySelectorAll('canvas');
        keep('spend', mk(c1, { type: 'bar', data: { labels: days, datasets: [
            { label: 'revenue', data: S.daily[key], backgroundColor: days.map((d) => CNYD.has(d) ? C.red : col), borderRadius: 2 },
        ] }, options: opts({ tooltip: { callbacks: { label: (c) => fmt$(c.parsed.y) } }, scales: { x: ax(), y: ax({ ticks: { callback: (v) => fmt$(v) } }) } }) }));
        keep('spend', mk(c2, { type: 'bar', data: { labels: [...Array(15).keys()].map((h) => (h + 5) + ':00'), datasets: [
            { label: 'revenue', data: S.hourly[key], ...bar(col) },
        ] }, options: opts({ tooltip: { callbacks: { label: (c) => fmt$(c.parsed.y) } }, scales: { x: ax(), y: ax({ ticks: { callback: (v) => fmt$(v) } }) } }) }));
    };
    paint();
}

/* ================= CNY STORY ================= */
function renderCNY(el, FEB) {
    const Y = FEB.cny;
    const PC = [C.blue, C.red, C.yellow, C.aqua];
    charts['cny'] = [];
    const kp = Y.periods.map((p) => Y.kpis[p]);
    el.innerHTML = `
      <div class="cap" style="margin-bottom:8px">Four weekday windows around Chinese New Year (17–18 Feb, public holidays;
      16 Feb was a half-day). How students spent their time — and money — before, during, and after.</div>
      <table class="mini"><tr><th>Window</th><th style="text-align:right">Steps/user-day</th>
        <th style="text-align:right">Users</th><th style="text-align:right">Canteen revenue</th></tr>
        ${Y.periods.map((p, i) => `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${PC[i]};margin-right:6px"></span><b>${p}</b></td>
          <td class="num">${fmt(kp[i].steps)}</td><td class="num">${fmt(kp[i].users)}</td>
          <td class="num">${fmt$(kp[i].rev)}</td></tr>`).join('')}</table>
      <h5 style="margin-top:12px">The shape of the day, window by window</h5>
      <div class="cap">Steps per 30 min. During CNY the school-day skeleton vanishes: no 7am commute spike, movement starts late and spreads flat — visiting-day rhythm, not timetable rhythm.</div>
      <div class="cwrap tall"><canvas></canvas></div>
      <h5>Heart rate through the day</h5>
      <div class="cap">CNY mornings run lower (sleeping in), evenings match school-day levels.</div>
      <div class="cwrap"><canvas></canvas></div>
      <h5>What the money bought</h5>
      <div class="cap">Spend share by category. CNY-break trading is tiny ($20K, mostly the eve half-day) but shifts toward drinks &amp; snacks; the full-meal share recovers with the timetable.</div>
      <div class="cwrap"><canvas></canvas></div>`;
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    keep('cny', mk(c1, { type: 'line', data: { labels: SLOTS, datasets: Y.periods.map((p, i) =>
        ({ label: p, data: Y.intraday[p], ...line(PC[i], i === 1 ? { borderWidth: 2.5 } : {}) })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 10 } }), y: ax({ title: { display: true, text: 'steps/30min', font: { size: 10 } } }) } }) }));
    keep('cny', mk(c2, { type: 'line', data: { labels: HOURS, datasets: Y.periods.map((p, i) =>
        ({ label: p, data: Y.hr[p], ...line(PC[i]), spanGaps: true })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 12 } }), y: ax({ title: { display: true, text: 'bpm', font: { size: 10 } } }) } }) }));
    const cats = Object.keys(CAT_COLOR);
    keep('cny', mk(c3, { type: 'bar', data: { labels: Y.periods, datasets: cats.map((c) =>
        ({ label: c, data: Y.periods.map((p) => Y.catmix[p][c] ?? 0), ...bar(CAT_COLOR[c]) })) },
        options: opts({ legend: true, indexMode: true, scales: {
            x: { stacked: true, ...ax() }, y: { stacked: true, ...ax({ title: { display: true, text: '% of spend', font: { size: 10 } }, max: 100 }) } } }) }));
}
