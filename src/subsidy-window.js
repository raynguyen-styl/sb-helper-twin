// SSS Subsidies window — how much of the month's canteen spend the subsidy system (SSS) paid for, where
// and when, and the SSS schemes live in the month. Reads the precomputed `subsidy` bundle
// (backend/postgres/seed_from_csv.py; shape: central-specs change cover-three-source-systems, D2).
// Aggregates only: no card, student or scheme name ever reaches this window. Absent → a friendly note.
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, line, C, LV_COLOR } from './charts.js';
import { monthLabel } from './sbData.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-SG');
const fmt$ = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v || 0));
const pct = (v) => (v == null ? '–' : v + '%');
const TYPE_LABEL = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', DYNAMIC_MONTHLY: 'Monthly (dynamic)', PRE_ORDER: 'Pre-order' };
let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };

export function openSubsidy(SUB, _preset) {
    const body = openWindow({ id: 'subsidy', title: 'SSS Subsidies',
        sub: SUB?.meta ? `subsidy-funded canteen taps · ${monthLabel(SUB.meta.month)}` : 'no data', chips: [], onClose: kill, wide: true });
    if (!body) return;

    if (!SUB || !SUB.meta) {
        body.innerHTML = `<div class="cap">No subsidy data for this month: the store holds no <b>subsidy</b>
          bundle for it.</div>`;
        return;
    }
    const m = SUB.meta;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt$(m.sgd)}</div><div class="l">paid by SSS</div></div>
        <div class="stat"><div class="v">${pct(m.share_sgd_pct)}</div><div class="l">of canteen spend</div></div>
        <div class="stat"><div class="v">${fmt(m.taps)}</div><div class="l">SSS taps (${pct(m.share_taps_pct)})</div></div>
        <div class="stat"><div class="v">${fmt(m.schools)}</div><div class="l">schools</div></div>
        <div class="stat"><div class="v">${typeof m.cards === 'number' ? fmt(m.cards) : esc(m.cards)}</div><div class="l">cards</div></div>
        <div class="stat"><div class="v">$${m.avg_ticket ?? '–'}</div><div class="l">avg ticket</div></div>
      </div>
      <div class="cap">${info(`SSS is the subsidy system: a tap it pays for shows in iSchool with source of funds "SSS".
        ${esc(m.units_note || '')} ${pct(m.linked_pct)} of SSS taps carry an SSS transaction reference;
        ${pct(m.err_pct)} failed. Cards are hashed tokens, counted only for the whole month.`)}
        Student traffic only, the same filter as Playback.</div>
      <div data-pane="body"></div>`;

    const pane = body.querySelector('[data-pane="body"]');
    const heading = (txt, tip) => {
        const d = document.createElement('div'); d.className = 'cap'; d.style.margin = '10px 0 2px';
        d.innerHTML = `<b>${txt}</b>${tip ? ' ' + info(tip) : ''}`; pane.appendChild(d);
    };
    const canvas = (h = 180) => {
        const wrap = document.createElement('div'); wrap.className = 'cwrap'; wrap.style.cssText = `position:relative;height:${h}px;margin:4px 0`;
        const c = document.createElement('canvas'); wrap.appendChild(c); pane.appendChild(wrap); return c;
    };

    heading('SSS spend per day (S$) and its share of the day', 'Bars: S$ paid by SSS. Line: SSS share of that day\'s canteen spend.');
    const d = SUB.daily || [];
    charts.push(mk(canvas(), { data: { labels: d.map((r) => r.date.slice(5, 10)), datasets: [
        { type: 'bar', label: 'S$', ...bar(C.aqua), data: d.map((r) => r.sgd), yAxisID: 'y' },
        { type: 'line', label: 'share %', ...line(C.violet), data: d.map((r) => r.share_pct), yAxisID: 'y1' },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true }),
        y1: ax({ position: 'right', beginAtZero: true, max: 100, grid: { display: false } }) } }) }));

    heading('When SSS is used (hour of day)', 'SSS taps per hour (SGT) and the SSS share of all taps in that hour.');
    const h = SUB.hour || [];
    charts.push(mk(canvas(150), { data: { labels: h.map((r) => `${String(r.h).padStart(2, '0')}:00`), datasets: [
        { type: 'bar', label: 'taps', ...bar(C.blue), data: h.map((r) => r.n), yAxisID: 'y' },
        { type: 'line', label: 'share %', ...line(C.violet), data: h.map((r) => r.share_pct), yAxisID: 'y1' },
    ] }, options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true }),
        y1: ax({ position: 'right', beginAtZero: true, max: 100, grid: { display: false } }) } }) }));

    const lv = SUB.by_level || [];
    if (lv.length) {
        heading('By school level');
        pane.insertAdjacentHTML('beforeend', `<table class="mini"><tr><th>Level</th><th style="text-align:right">SSS taps</th>
          <th style="text-align:right">SSS S$</th><th style="text-align:right">Share of spend</th></tr>
          ${lv.map((r) => `<tr><td><span style="color:${LV_COLOR[r.level] || C.muted}">●</span> ${esc(r.level)}</td>
            <td class="num">${fmt(r.n)}</td><td class="num">${fmt$(r.sgd)}</td><td class="num">${pct(r.share_pct)}</td></tr>`).join('')}</table>`);
    }

    const sc = SUB.schools || [];
    if (sc.length) {
        heading(`Schools by SSS spend (top ${Math.min(25, sc.length)} of ${fmt(sc.length)})`, 'Click a school to open it on the map.');
        pane.insertAdjacentHTML('beforeend', `<table class="mini sub-schools"><tr><th>School</th><th style="text-align:right">SSS taps</th>
          <th style="text-align:right">SSS S$</th><th style="text-align:right">Share of its spend</th></tr>
          ${sc.slice(0, 25).map((r) => `<tr data-sid="${esc(r.id)}" style="cursor:pointer" tabindex="0"><td>${esc(r.name)}</td>
            <td class="num">${fmt(r.n)}</td><td class="num">${fmt$(r.sgd)}</td><td class="num">${pct(r.share_pct)}</td></tr>`).join('')}</table>`);
        pane.querySelectorAll('.sub-schools tr[data-sid]').forEach((tr) => {
            const go = () => { window.SB?.openSchool(tr.dataset.sid); window.SB?.focusSchool(tr.dataset.sid); };
            tr.addEventListener('click', go);
            tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        });
    }

    const s = SUB.schemes;
    heading('SSS schemes live this month', 'From the SSS export (fund sources): active, not deleted, and valid during the month. The export is the latest state of each scheme, not its history.');
    if (!s) {
        pane.insertAdjacentHTML('beforeend', '<div class="cap">The seed had no SSS export, so no scheme figures.</div>');
        return;
    }
    pane.insertAdjacentHTML('beforeend', `
      <div class="cap" style="margin-bottom:4px"><b>${fmt(s.live)}</b> schemes at <b>${fmt(s.schools)}</b> schools ·
        ${fmt(s.schools_without_scheme)} schools had SSS taps but no live scheme · ${fmt(s.schools_no_taps)} had a live scheme but no SSS tap ·
        ${pct(s.time_window_pct)} limit the time of day, ${pct(s.day_limit_pct)} the days of the week</div>
      <table class="mini"><tr><th>Allowance</th><th style="text-align:right">Schemes</th><th style="text-align:right">Schools</th>
        <th style="text-align:right">Median allowance ${info('S$, assuming the export stores the allowance in cents. Dynamic schemes set the amount per student, so they have none.')}</th></tr>
        ${(s.by_type || []).map((r) => `<tr><td>${esc(TYPE_LABEL[r.type] || r.type)}</td><td class="num">${fmt(r.n)}</td>
          <td class="num">${fmt(r.schools)}</td><td class="num">${r.median_allowance_sgd == null ? '–' : '$' + r.median_allowance_sgd.toFixed(2)}</td></tr>`).join('')}</table>`);
    const sp = s.by_sponsor || [];
    if (sp.length) {
        heading('Sponsor', 'Grouped from the scheme\'s sponsor field: "MOE" when it names MOE, "Not stated" when blank, otherwise "School & other".');
        charts.push(mk(canvas(110), { type: 'bar',
            data: { labels: sp.map((r) => r.group), datasets: [{ ...bar(C.yellow), data: sp.map((r) => r.n) }] },
            options: { ...opts({ scales: { x: ax({ beginAtZero: true }), y: ax() } }), indexAxis: 'y' } }));
    }
}
