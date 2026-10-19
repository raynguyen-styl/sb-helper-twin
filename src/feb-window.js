// Wearables & Health — a month where wearable and payment data overlap: activity, wear and adoption, heart rate,
// canteen spending and the month's calendar story. Every filter re-slices the precomputed `wearable` bundle.
// Shared anatomy (central-specs capability dashboard-views).
import { openWindow, esc } from './windowing.js';
import { mk, opts, ax, bar, line, C, CAT_COLOR } from './charts.js';
import { monthName } from './sbData.js';
import { kpis, moreKpis, section, chart, tableCard, tabs, panes, wireTabs, emptyNote, chipBar, fmt, money } from './ui.js';

const DT_COLOR = { School: C.blue, Weekend: C.violet, CNY: C.red, Holiday: C.red, All: C.ink2 };
const SLOTS = [...Array(48).keys()].map((i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const HOURS = [...Array(24).keys()].map((h) => h + ':00');
const charts = {};   // pane -> [Chart]; destroyed on re-render

function kill(pane) { (charts[pane] || []).forEach((c) => c.destroy()); charts[pane] = []; }
function keep(pane, c) { (charts[pane] ||= []).push(c); return c; }

export function openFeb(FEB, tab) {
    const body = openWindow({ id: 'feb', title: 'Wearables & Health', sub: 'Activity, heart rate and canteen spend', chips: [], wide: true });
    if (!body) return;
    if (!FEB || !FEB.meta) {
        body.innerHTML = emptyNote('No wearable or heart-rate data for this month: the store holds no <b>wearable</b> bundle for it.');
        return;
    }
    const m = FEB.meta;
    const SP = FEB.special;                       // per-month calendar story (CNY / school break) or null
    const TOPICS = [['act', 'Activity'], ['wear', 'Wear & adoption'], ['hr', 'Heart rate'], ['spend', 'Spending'], ...(SP ? [['special', SP.label]] : [])];
    body.innerHTML = `
      ${kpis([{ l: 'Wearable users', v: fmt(m.h_users) }, { l: 'Activity rows', v: `${(m.h_rows / 1e6).toFixed(1)}M` },
          { l: 'Heart-rate rows', v: `${(m.r_rows / 1e6).toFixed(1)}M` }, { l: `${monthName(m.month)} canteen spend`, v: money(m.t_rev) }])}
      ${moreKpis([{ l: 'Days in the month', v: m.days || SP?.periods?.length || '–' }])}
      ${tabs(TOPICS.map(([k, t]) => [k, esc(t)]))}
      ${panes(TOPICS)}`;
    const pick = wireTabs(body);
    renderAct(body.querySelector('[data-pane="act"]'), FEB);
    renderWear(body.querySelector('[data-pane="wear"]'), FEB);
    renderHR(body.querySelector('[data-pane="hr"]'), FEB);
    renderSpend(body.querySelector('[data-pane="spend"]'), FEB);
    if (SP) renderSpecial(body.querySelector('[data-pane="special"]'), FEB);
    if (tab) pick(tab);
}

/* ================= ACTIVITY ================= */
function renderAct(el, FEB) {
    let dt = 'All', sg = 'All';
    el.replaceChildren(
        chipBar('Day type', [['All', 'All days'], ['School', 'School days'], ['Weekend', 'Weekends'], ...(FEB.special ? [[FEB.special.daytype, FEB.special.daytype_label]] : [])], dt, (v) => { dt = v; paint(); }),
        chipBar('Segment', [['All', 'All users'], ...FEB.segments.map((s) => [String(s.id), s.name])], sg, (v) => { sg = v; paint(); }));
    const box = document.createElement('div'); box.className = 'stack'; el.appendChild(box);

    const paint = () => {
        kill('act');
        const S = FEB.activity[`${dt}|${sg}`];
        const REF = FEB.activity['All|All'];
        if (!S) { box.innerHTML = emptyNote('No users in this slice.'); return; }
        const segInfo = sg === 'All' ? null : FEB.segments[+sg];
        const b = S.budget || {};
        box.innerHTML = `
          ${kpis([{ l: 'Steps per user-day', v: fmt(S.steps) }, { l: 'kcal per user-day', v: fmt(S.kcal) },
              { l: 'Users in this slice', v: fmt(S.users) }, { l: 'Active hours', v: `${(b.active ?? 0).toFixed(1)} h`, s: 'over 500 steps an hour' }])}
          ${segInfo ? `<p class="take">${esc(segInfo.name)}: ${fmt(segInfo.users)} users · median ${fmt(segInfo.steps)} steps a day · wears ${segInfo.wear_days} days (${segInfo.wk_days} at weekends) · resting heart rate ${segInfo.rhr ?? '–'}</p>` : ''}
          ${section({ title: 'Movement through the day', take: 'Steps per 30 minutes per user: this slice against all users on all days (dashed).', body: chart({ tall: true }) })}
          ${section({ title: 'How worn hours are spent', take: 'Average hours per user-day: sedentary (under 50 steps an hour), light, active (over 500).', body: chart({ h: 150 }) })}
          ${section({ title: 'Daily steps spread — all users', take: `Median (line), middle half (band), 10th–90th percentile (faint). Weekend dates in purple${FEB.special ? `; ${esc(FEB.special.daytype.toLowerCase())} days in red` : ''}.`, body: chart() })}`;
        const [c1, c2, c3] = box.querySelectorAll('canvas');
        const col = DT_COLOR[dt] || C.blue;
        keep('act', mk(c1, { type: 'line', numbers: { label: 'Time' }, data: { labels: SLOTS, datasets: [
            { label: 'This slice', data: S.intraday, ...line(col, { fill: true, backgroundColor: col + '22' }) },
            { label: 'All users, all days', data: REF.intraday, ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }) },
        ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 10 } }), y: ax({ title: { display: true, text: 'steps per 30 min', font: { size: 10.5 } } }) } }) }));

        const dts = ['School', 'Weekend', ...(FEB.special ? [FEB.special.daytype] : [])];
        const bud = (z) => dts.map((d) => (FEB.activity[`${d}|${sg}`]?.budget || {})[z] ?? 0);
        keep('act', mk(c2, { type: 'bar', numbers: { label: 'Day type', fmt: (v) => `${(v ?? 0).toFixed(1)} h` }, data: { labels: dts, datasets: [
            { label: 'Sedentary', data: bud('sed'), ...bar(C.muted + '88') },
            { label: 'Light', data: bud('light'), ...bar(C.yellow) },
            { label: 'Active', data: bud('active'), ...bar(C.aqua) },
        ] }, options: opts({ legend: true, indexMode: true, indexAxis: 'y', scales: {
            x: { stacked: true, ...ax({ title: { display: true, text: 'hours', font: { size: 10.5 } } }) }, y: { stacked: true, ...ax({ grid: { display: false } }) } } }) }));

        const D = FEB.daily;
        keep('act', mk(c3, { type: 'line', numbers: { label: 'Day' }, data: { labels: D.map((x) => x.dow[0] + ' ' + +x.d.slice(8)), datasets: [
            { label: '90th percentile', data: D.map((x) => x.p90), ...line('transparent'), fill: '+4', backgroundColor: C.blue + '14' },
            { label: '75th percentile', data: D.map((x) => x.p75), ...line('transparent'), fill: '+2', backgroundColor: C.blue + '2e' },
            { label: 'Median', data: D.map((x) => x.p50), ...line(C.blue) },
            { label: '25th percentile', data: D.map((x) => x.p25), ...line('transparent') },
            { label: '10th percentile', data: D.map((x) => x.p10), ...line('transparent') },
        ] }, options: opts({ indexMode: true, scales: {
            x: ax({ ticks: { autoSkip: false, font: { size: 9 }, color: D.map((x) => x.daytype === 'Weekend' ? C.violet : x.daytype === 'School' ? C.mutedText : C.red) } }),
            y: ax() } }) }));
    };
    paint();
}

/* ================= WEAR & ADOPTION ================= */
function renderWear(el, FEB) {
    const W = FEB.wear;
    kill('wear');
    const top = [...W.cohorts].sort((a, b) => b.users - a.users)[0];
    el.innerHTML = section({ title: 'Adoption cohorts', take: top ? `<b>${esc(top.cohort)}</b> is the largest cohort: ${fmt(top.users)} users.` : 'Who actually wears the band.',
            body: tableCard('<tr><th>Cohort</th><th class="num">Users</th><th class="num">Steps a day</th><th class="num">Weekend wear</th></tr>',
                W.cohorts.map((c) => `<tr><td><b>${esc(c.cohort)}</b></td><td class="num">${fmt(c.users)}</td>
                  <td class="num">${fmt(c.steps)}</td><td class="num">${c.weekend_pct}%</td></tr>`).join('')) }) +
        section({ title: `Days worn in ${monthName(FEB.meta.month)}`, take: 'Users by how many days they wore the band.', body: chart() }) +
        section({ title: 'Users syncing per day', take: 'Line: users active that day. Bars: users seen for the first time.', body: chart() }) +
        section({ title: 'Weekend against school-day movement', take: 'Each user\'s weekend steps as a share of their school-day steps.', tip: 'Users who wore it at least 3 school days and 2 weekend days.', body: chart() });
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    keep('wear', mk(c1, { type: 'bar', numbers: { label: 'Days worn' }, data: { labels: W.days_hist.map((x) => x.days),
        datasets: [{ label: 'Users', data: W.days_hist.map((x) => x.n), ...bar(C.wear) }] },
        options: opts({ scales: { x: ax({ title: { display: true, text: 'days worn', font: { size: 10.5 } } }), y: ax() } }) }));
    keep('wear', mk(c2, { numbers: { label: 'Day' }, data: { labels: W.daily_active.map((x) => +x.d.slice(8)), datasets: [
        { type: 'line', label: 'Active users', data: W.daily_active.map((x) => x.users), ...line(C.wear) },
        { type: 'bar', label: 'New users', data: W.daily_active.map((x) => x.new_users), ...bar(C.aqua) },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax() } }) }));
    keep('wear', mk(c3, { type: 'bar', numbers: { label: 'Weekend share' }, data: { labels: FEB.wkend_contrast.map((x) => Math.round(x.ratio * 100) + '%'),
        datasets: [{ label: 'Users', data: FEB.wkend_contrast.map((x) => x.n), ...bar(C.violet) }] },
        options: opts({ scales: { x: ax({ title: { display: true, text: 'weekend steps as % of school-day steps', font: { size: 10.5 } } }), y: ax() } }) }));
}

/* ================= HEART RATE ================= */
function renderHR(el, FEB) {
    let fw = 'All', dt = 'All';
    el.replaceChildren();
    // firmware_version isn't in the current raw feed → only show the filter when there's a real choice
    if ((FEB.hr.firmwares || []).length > 1)
        el.append(chipBar('Firmware', FEB.hr.firmwares.map((f) => [f, f === 'All' ? 'All firmware' : f]), fw, (v) => { fw = v; paint(); }));
    el.append(chipBar('Day type', [['All', 'All days'], ['School', 'School'], ['Weekend', 'Weekend'], ...(FEB.special ? [[FEB.special.daytype, FEB.special.daytype]] : [])], dt, (v) => { dt = v; paint(); }));
    const box = document.createElement('div'); box.className = 'stack'; el.appendChild(box);

    const paint = () => {
        kill('hr');
        const cur = FEB.hr.curves[`${fw}|${dt}`];
        const ref = FEB.hr.curves['All|All'];
        if (!cur) { box.innerHTML = emptyNote('No heart-rate readings in this slice.'); return; }
        const ft = FEB.hr.fw_table.find((x) => x.fw === fw);
        box.innerHTML = `
          ${ft ? `<p class="take">${esc(fw)}: ${fmt(ft.n)} records · ${fmt(ft.users)} users · <b>${fmt(ft.err255)}</b> whole-record 255 errors · <b>${fmt(ft.lt40)}</b> readings under 40 ${ft.err255 > 0 ? '<span class="chip chip-bad">Faulty</span>' : '<span class="chip chip-good">Clean</span>'}</p>` : ''}
          ${section({ title: 'Average heart rate by hour', take: 'Valid readings only (30–220 bpm); dashed: all firmware, all days.', tip: '23:00 has very few readings, so treat it with care.', body: chart({ tall: true }) })}
          ${section({ title: 'Raised heart rate by hour', take: 'Share of hourly readings at 100 bpm or more, by day type.', body: chart() })}
          ${FEB.hr.fw_table.length ? section({ title: `Firmware fleet — ${monthName(FEB.meta.month)}`, take: 'Faulty firmware sends whole records of 255.',
              body: tableCard('<tr><th>Firmware</th><th class="num">Records</th><th class="num">Users</th><th class="num">255 errors</th><th class="num">Under 40 bpm</th></tr>',
                  FEB.hr.fw_table.map((x) => `<tr><td><b>${esc(x.fw)}</b>${x.err255 > 0 ? ' <span class="chip chip-bad">Faulty</span>' : ''}</td>
                    <td class="num">${fmt(x.n)}</td><td class="num">${fmt(x.users)}</td>
                    <td class="num">${fmt(x.err255)}</td><td class="num">${fmt(x.lt40)}</td></tr>`).join('')) }) : ''}
          ${section({ title: 'Resting heart rate', take: 'Users by resting heart rate, in 5 bpm bands.', body: chart() })}`;
        const [c1, c2, c3] = box.querySelectorAll('canvas');
        keep('hr', mk(c1, { type: 'line', numbers: { label: 'Hour' }, data: { labels: HOURS, datasets: [
            { label: 'This slice', data: cur.bpm, ...line(DT_COLOR[dt] || C.red), spanGaps: true },
            { label: 'All firmware, all days', data: ref.bpm, ...line(C.muted, { borderDash: [4, 4], borderWidth: 1.5 }), spanGaps: true },
        ] }, options: opts({ legend: true, indexMode: true, tooltip: { callbacks: { afterLabel: (c) => c.datasetIndex === 0 ? 'n = ' + fmt(cur.n[c.dataIndex]) : '' } }, scales: { x: ax({ ticks: { maxTicksLimit: 12 } }), y: ax({ title: { display: true, text: 'bpm', font: { size: 10.5 } } }) } }) }));
        keep('hr', mk(c2, { type: 'line', numbers: { label: 'Hour', fmt: (v) => (v == null ? '–' : `${v}%`) }, data: { labels: HOURS, datasets:
            Object.entries(FEB.hr.zones_hourly).map(([k, z]) => {
                const arr = [...Array(24)].map((_, h) => { const f = z.find((x) => x.hh === h); return f ? f.mod : null; });
                return { label: k, data: arr, ...line(DT_COLOR[k] || C.ink2), spanGaps: true };
            }) }, options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 12 } }), y: ax({ title: { display: true, text: '% at 100 bpm or more', font: { size: 10.5 } } }) } }) }));
        keep('hr', mk(c3, { type: 'bar', numbers: { label: 'Resting bpm' }, data: { labels: FEB.hr.resting.map((x) => x.lo + '–' + (x.lo + 4)),
            datasets: [{ label: 'Users', data: FEB.hr.resting.map((x) => x.n), ...bar(C.wear) }] },
            options: opts({ scales: { x: ax({ ticks: { font: { size: 9.5 } } }), y: ax() } }) }));
    };
    paint();
}

/* ================= SPENDING ================= */
function renderSpend(el, FEB) {
    let lv = 'All', ct = 'All';
    const S = FEB.spend;
    el.replaceChildren(
        chipBar('Level', S.levels.map((l) => [l, l === 'All' ? 'All levels' : l]), lv, (v) => { lv = v; paint(); }),
        chipBar('Category', S.cats.map((c) => [c, c === 'All' ? 'All categories' : c]), ct, (v) => { ct = v; paint(); }));
    const box = document.createElement('div'); box.className = 'stack'; el.appendChild(box);
    const MON = monthName(FEB.meta.month);
    const days = [...Array(FEB.meta.days || S.daily['All|All'].length).keys()].map((i) => i + 1);
    const MARKED = new Set((FEB.special && FEB.special.marked_days) || []);

    const paint = () => {
        kill('spend');
        const key = `${lv}|${ct}`;
        const k = S.kpis[key];
        if (!k) { box.innerHTML = emptyNote('No spending in this slice.'); return; }
        const col = ct !== 'All' ? (CAT_COLOR[ct] || C.money) : C.money;
        const mx = S.mix[lv] || [];
        const tot = mx.reduce((a, x) => a + x.sgd, 0);
        box.innerHTML = `
          ${kpis([{ l: 'Revenue', v: money(k.rev) }, { l: 'Taps', v: `${(k.n / 1e3).toFixed(0)}k` }, { l: 'Average ticket', v: k.ticket != null ? money(k.ticket) : '–' }, { l: 'Cards', v: fmt(k.cards) }])}
          ${section({ title: `Daily revenue — ${MON}`, take: MARKED.size ? `${esc(FEB.special.daytype)} days in red.` : 'One bar per day.', body: chart() })}
          ${section({ title: 'Revenue by hour — school days', take: 'When the money is spent.', body: chart() })}
          ${section({ title: `Category mix — ${lv === 'All' ? 'all levels' : esc(lv)}`, take: 'Categories from name-verified stalls only; generic names ("Stall 1") stay Unclassified, never guessed.',
              body: tableCard('<tr><th>Category</th><th class="num">Taps</th><th class="num">Revenue</th><th class="num">Share</th></tr>',
                  mx.map((x) => `<tr${x.mcat === ct ? ' class="hl"' : ''}><td><span class="dot" style="background:${CAT_COLOR[x.mcat] || C.muted}"></span> ${esc(x.mcat)}</td>
                    <td class="num">${fmt(x.n)}</td><td class="num">${money(x.sgd)}</td>
                    <td class="num">${tot ? (100 * x.sgd / tot).toFixed(1) : '–'}%</td></tr>`).join('')) })}`;
        const [c1, c2] = box.querySelectorAll('canvas');
        keep('spend', mk(c1, { type: 'bar', numbers: { label: 'Day', fmt: (v) => money(v) }, data: { labels: days, datasets: [
            { label: 'Revenue', data: S.daily[key], backgroundColor: days.map((d) => MARKED.has(d) ? C.red : col), borderRadius: 2 },
        ] }, options: opts({ tooltip: { callbacks: { label: (c) => money(c.parsed.y) } }, scales: { x: ax(), y: ax({ ticks: { callback: (v) => money(v) } }) } }) }));
        keep('spend', mk(c2, { type: 'bar', numbers: { label: 'Hour', fmt: (v) => money(v) }, data: { labels: [...Array(15).keys()].map((h) => (h + 5) + ':00'), datasets: [
            { label: 'Revenue', data: S.hourly[key], ...bar(col) },
        ] }, options: opts({ tooltip: { callbacks: { label: (c) => money(c.parsed.y) } }, scales: { x: ax(), y: ax({ ticks: { callback: (v) => money(v) } }) } }) }));
    };
    paint();
}

/* ============ CALENDAR STORY (CNY for Feb, school break for other months) ============ */
function renderSpecial(el, FEB) {
    const Y = FEB.special;
    const PC = [C.blue, C.red, C.yellow, C.aqua];
    kill('special');
    const kp = Y.periods.map((p) => Y.kpis[p]);
    el.innerHTML = `<p class="lead">${esc(Y.intro)}</p>` +
        section({ title: 'The windows side by side', take: 'Steps, users and canteen revenue per window.',
            body: tableCard('<tr><th>Window</th><th class="num">Steps per user-day</th><th class="num">Users</th><th class="num">Canteen revenue</th></tr>',
                Y.periods.map((p, i) => `<tr><td><span class="dot" style="background:${PC[i % PC.length]}"></span> <b>${esc(p)}</b></td>
                  <td class="num">${fmt(kp[i].steps)}</td><td class="num">${fmt(kp[i].users)}</td>
                  <td class="num">${money(kp[i].rev)}</td></tr>`).join('')) }) +
        section({ title: 'Movement through the day, by window', take: 'Steps per 30 minutes per user, one line per window.', body: chart({ tall: true }) }) +
        section({ title: 'Heart rate through the day', take: 'Average bpm by hour, one line per window.', body: chart() }) +
        section({ title: 'What the money bought', take: 'Spend share by category, name-verified stalls only, per window.', body: chart() });
    const [c1, c2, c3] = el.querySelectorAll('canvas');
    keep('special', mk(c1, { type: 'line', numbers: { label: 'Time' }, data: { labels: SLOTS, datasets: Y.periods.map((p, i) =>
        ({ label: p, data: Y.intraday[p], ...line(PC[i % PC.length], i === 1 ? { borderWidth: 2.5 } : {}) })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 10 } }), y: ax({ title: { display: true, text: 'steps per 30 min', font: { size: 10.5 } } }) } }) }));
    keep('special', mk(c2, { type: 'line', numbers: { label: 'Hour' }, data: { labels: HOURS, datasets: Y.periods.map((p, i) =>
        ({ label: p, data: Y.hr[p], ...line(PC[i % PC.length]), spanGaps: true })) },
        options: opts({ legend: true, indexMode: true, scales: { x: ax({ ticks: { maxTicksLimit: 12 } }), y: ax({ title: { display: true, text: 'bpm', font: { size: 10.5 } } }) } }) }));
    const cats = Object.keys(CAT_COLOR);
    keep('special', mk(c3, { type: 'bar', numbers: { label: 'Window', fmt: (v) => (v == null ? '–' : `${v}%`) }, data: { labels: Y.periods, datasets: cats.map((c) =>
        ({ label: c, data: Y.periods.map((p) => Y.catmix[p]?.[c] ?? 0), ...bar(CAT_COLOR[c]) })) },
        options: opts({ legend: true, indexMode: true, scales: {
            x: { stacked: true, ...ax() }, y: { stacked: true, ...ax({ title: { display: true, text: '% of spend', font: { size: 10.5 } }, max: 100 }) } } }) }));
}
