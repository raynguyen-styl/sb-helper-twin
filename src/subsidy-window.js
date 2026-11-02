// SSS Subsidies — how much of the month's canteen spend the subsidy system (SSS) paid for, where and when, and the
// SSS schemes live in the month. Reads the precomputed `subsidy` bundle (backend/redshift/seed_from_csv.py; shape:
// central-specs change cover-three-source-systems, D2). Aggregates only: no card, student or scheme name ever
// reaches this view. Shared anatomy (central-specs capability dashboard-views).
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, line, C, LV_COLOR } from './charts.js';
import { kpis, moreKpis, section, chart, tableCard, emptyNote, fmt, money, pct } from './ui.js';

const TYPE_LABEL = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', DYNAMIC_MONTHLY: 'Monthly (dynamic)', PRE_ORDER: 'Pre-order' };
const p = (v) => (v == null ? '–' : `${v}%`);
let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };

export function openSubsidy(SUB) {
    const body = openWindow({ id: 'subsidy', title: 'SSS Subsidies', sub: 'Subsidy-funded canteen taps', chips: [], onClose: kill, wide: true });
    if (!body) return;
    if (!SUB || !SUB.meta) {
        body.innerHTML = emptyNote('No subsidy data for this month: the store holds no <b>subsidy</b> bundle for it.');
        return;
    }
    const m = SUB.meta;
    const d = SUB.daily || [], h = SUB.hour || [], lv = SUB.by_level || [], sc = SUB.schools || [], s = SUB.schemes;
    const peakH = h.length ? h.reduce((a, r) => (r.n > a.n ? r : a)) : null;
    const topLv = [...lv].sort((a, b) => (b.share_pct ?? 0) - (a.share_pct ?? 0))[0];
    body.innerHTML = `
      ${kpis([
          { l: 'Paid by SSS', v: money(m.sgd) },
          { l: 'Share of canteen spend', v: p(m.share_sgd_pct) },
          { l: 'SSS taps', v: fmt(m.taps), s: `${p(m.share_taps_pct)} of taps` },
          { l: 'Schools', v: fmt(m.schools) },
      ])}
      ${moreKpis([{ l: 'Cards', v: typeof m.cards === 'number' ? fmt(m.cards) : esc(m.cards) }, { l: 'Average ticket', v: m.avg_ticket == null ? '–' : money(m.avg_ticket) },
          { l: 'Failed SSS taps', v: p(m.err_pct) }, { l: 'With an SSS reference', v: p(m.linked_pct) }])}
      <p class="take">Student traffic only, the same filter as Playback. ${info(`SSS is the subsidy system: a tap it pays for shows in iSchool
        with source of funds "SSS". ${m.units_note || ''} ${p(m.linked_pct)} of SSS taps carry an SSS transaction reference; ${p(m.err_pct)}
        failed. Cards are hashed tokens, counted only for the whole month.`)}</p>
      ${section({ title: 'SSS spend per day', id: 'daily', take: 'Bars: S$ paid by SSS. Line: its share of that day\'s canteen spend.', body: d.length ? chart() : emptyNote('No daily figures in this bundle.') })}
      ${section({ title: 'When SSS is used', id: 'hour', take: peakH ? `Most SSS taps come at <b>${String(peakH.h).padStart(2, '0')}:00</b>.` : '', tip: 'SSS taps per hour (SGT) and the SSS share of all taps in that hour.', body: h.length ? chart({ h: 170 }) : emptyNote('No hourly figures in this bundle.') })}
      ${lv.length ? section({ title: 'By school level', take: topLv ? `SSS pays the largest share at <b>${esc(topLv.level)}</b> schools (${p(topLv.share_pct)}).` : '',
          body: tableCard('<tr><th>Level</th><th class="num">SSS taps</th><th class="num">SSS S$</th><th class="num">Share of spend</th></tr>',
              lv.map((r) => `<tr><td><span class="dot" style="background:${LV_COLOR[r.level] || C.muted}"></span> ${esc(r.level)}</td>
                <td class="num">${fmt(r.n)}</td><td class="num">${money(r.sgd)}</td><td class="num">${p(r.share_pct)}</td></tr>`).join('')) }) : ''}
      ${sc.length ? section({ title: `Schools by SSS spend`, take: `The top ${Math.min(25, sc.length)} of ${fmt(sc.length)}. Press a school to open it on the map.`,
          body: tableCard('<tr><th>School</th><th class="num">SSS taps</th><th class="num">SSS S$</th><th class="num">Share of its spend</th></tr>',
              sc.slice(0, 25).map((r) => `<tr class="click" role="button" tabindex="0" data-sid="${esc(r.id)}"><td><span class="trunc">${esc(r.name)}</span></td>
                <td class="num">${fmt(r.n)}</td><td class="num">${money(r.sgd)}</td><td class="num">${p(r.share_pct)}</td></tr>`).join('')) }) : ''}
      ${section({ title: 'SSS schemes live this month',
          take: s ? `<b>${fmt(s.live)}</b> schemes at <b>${fmt(s.schools)}</b> schools · ${fmt(s.schools_without_scheme)} schools had SSS taps but no live scheme · ${fmt(s.schools_no_taps)} had a live scheme but no SSS tap · ${p(s.time_window_pct)} limit the time of day, ${p(s.day_limit_pct)} the days of the week.` : '',
          tip: 'From the SSS export (fund sources): active, not deleted, and valid during the month. The export is the latest state of each scheme, not its history.',
          body: !s ? emptyNote('The seed had no SSS export, so no scheme figures.')
              : tableCard(`<tr><th>Allowance</th><th class="num">Schemes</th><th class="num">Schools</th><th class="num">Median allowance ${info('S$, assuming the export stores the allowance in cents. Dynamic schemes set the amount per student, so they have none.')}</th></tr>`,
                  (s.by_type || []).map((r) => `<tr><td>${esc(TYPE_LABEL[r.type] || r.type)}</td><td class="num">${fmt(r.n)}</td>
                    <td class="num">${fmt(r.schools)}</td><td class="num">${r.median_allowance_sgd == null ? '–' : money(r.median_allowance_sgd)}</td></tr>`).join('')) })}
      ${s?.by_sponsor?.length ? section({ title: 'Sponsor', id: 'sponsor', take: 'Schemes by who sponsors them.', tip: 'Grouped from the scheme\'s sponsor field: "MOE" when it names MOE, "Not stated" when blank, otherwise "School & other".', body: chart({ h: 130 }) }) : ''}`;

    body.querySelectorAll('tr[data-sid]').forEach((tr) => tr.addEventListener('click', () => window.SB?.focusSchool(tr.dataset.sid)));
    const cv = (id) => body.querySelector(`[data-sec="${id}"] canvas`);
    const c1 = cv('daily'), c2 = cv('hour'), c3 = cv('sponsor');
    if (c1) charts.push(mk(c1, { numbers: { label: 'Day', fmt: (v, ds) => (ds.label === 'S$' ? money(v) : p(v)) },
        data: { labels: d.map((r) => r.date.slice(5, 10)), datasets: [
            { type: 'bar', label: 'S$', ...bar(C.money), data: d.map((r) => r.sgd), yAxisID: 'y' },
            { type: 'line', label: 'Share %', ...line(C.ink2), data: d.map((r) => r.share_pct), yAxisID: 'y1' },
        ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => money(v) } }),
            y1: ax({ position: 'right', beginAtZero: true, max: 100, grid: { display: false }, ticks: { callback: (v) => v + '%' } }) } }) }));
    if (c2) charts.push(mk(c2, { numbers: { label: 'Hour', fmt: (v, ds) => (ds.label === 'Taps' ? fmt(v) : p(v)) },
        data: { labels: h.map((r) => `${String(r.h).padStart(2, '0')}:00`), datasets: [
            { type: 'bar', label: 'Taps', ...bar(C.money), data: h.map((r) => r.n), yAxisID: 'y' },
            { type: 'line', label: 'Share %', ...line(C.ink2), data: h.map((r) => r.share_pct), yAxisID: 'y1' },
        ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true }),
            y1: ax({ position: 'right', beginAtZero: true, max: 100, grid: { display: false }, ticks: { callback: (v) => v + '%' } }) } }) }));
    const sp = s?.by_sponsor || [];
    if (c3) charts.push(mk(c3, { type: 'bar', numbers: { label: 'Sponsor', fmt: (v) => fmt(v) },
        data: { labels: sp.map((r) => r.group), datasets: [{ ...bar(C.yellow), label: 'Schemes', data: sp.map((r) => r.n) }] },
        options: opts({ indexAxis: 'y', scales: { x: ax({ beginAtZero: true }), y: ax({ grid: { display: false } }) } }) }));
}
