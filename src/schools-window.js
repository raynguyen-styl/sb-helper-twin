// Schools (central-specs capability dashboard-views): the month's schools ranked — level, spend per card per day,
// revenue, taps, error rate and median speed. Sort by any of them (a school without the figure sorts last, shown
// "–"), filter by level, zone and school type, search by name or code. 50 rows, then "Show more". A row opens its
// school and flies the map to it; hovering or focusing a row lights its dot (main.js, data-sid).
import { openWindow, esc } from './windowing.js';
import { emptyNote, chipBar, fmt, money, pct, secs } from './ui.js';
import { typeName } from './overview-window.js';
import { LV_COLOR } from './charts.js';

const PAGE = 50;
const LEVELS = ['Primary', 'Secondary', 'Junior College', 'Other'];
// Sortable columns: the key, its header, how a cell reads, and which way is "first" (all: highest first —
// the most spend, the most errors, the slowest).
const COLS = [
    { k: 'spend_day', l: 'Per card·day', f: (s) => money(s.spend_day), sort: 'Spend per card per day' },
    { k: 'sgd', l: 'Revenue', f: (s) => money(s.sgd), sort: 'Revenue' },
    { k: 'n', l: 'Taps', f: (s) => fmt(s.n), sort: 'Taps' },
    { k: 'err_pct', l: 'Errors', f: (s) => s.err_pct == null ? '–' : `<span class="${s.err_pct >= 10 ? 'pill-bad' : s.err_pct >= 5 ? 'pill-warn' : ''}">${pct(s.err_pct)}</span>`, sort: 'Error rate (highest first)' },
    { k: 'med_ms', l: 'Median', f: (s) => secs(s.med_ms), sort: 'Median speed (slowest first)' },
];
const has = (v) => typeof v === 'number' && Number.isFinite(v);

export function openSchools(SCHOOLS, preset = {}) {
    const all = Object.values(SCHOOLS || {});
    const body = openWindow({ id: 'schools', title: 'Schools', chips: [], wide: true });
    if (!body) return;
    if (!all.length) { body.innerHTML = emptyNote('No schools loaded for this month.'); return; }

    let level = preset.level || 'All', zone = preset.zone || 'All', type = preset.type || 'All', q = '', sort = preset.sort || 'spend_day', shown = PAGE;
    const zones = [...new Set(all.map((s) => s.zone).filter(Boolean))].sort();
    const types = [...new Set(all.map((s) => s.moe_type).filter(Boolean))].sort();
    body.innerHTML = `
      <div class="fgrid">
        <input class="finput" id="sc-q" type="search" placeholder="Search a school name or code…" aria-label="Search schools" autocomplete="off">
        <select class="sel" id="sc-zone" aria-label="Zone"><option value="All">All zones</option>${zones.map((z) => `<option value="${esc(z)}">${esc(z[0] + z.slice(1).toLowerCase())}</option>`).join('')}</select>
        <select class="sel" id="sc-type" aria-label="School type"><option value="All">All types</option>${types.map((t) => `<option value="${esc(t)}">${esc(typeName(t))}</option>`).join('')}</select>
        <select class="sel" id="sc-sort" aria-label="Sort by">${COLS.map((c) => `<option value="${c.k}">${c.sort}</option>`).join('')}</select>
      </div>
      <div data-levels></div>
      <p class="count-line" id="sc-count" role="status"></p>
      <div id="sc-list"></div>`;
    body.querySelector('[data-levels]').replaceWith(chipBar('Level', [['All', 'All levels'], ...LEVELS.map((l) => [l, l])], level, (v) => { level = v; shown = PAGE; paint(); }));
    const zoneSel = body.querySelector('#sc-zone'), typeSel = body.querySelector('#sc-type'), sortSel = body.querySelector('#sc-sort');
    zoneSel.value = zone; typeSel.value = type; sortSel.value = sort;
    zoneSel.addEventListener('change', () => { zone = zoneSel.value; shown = PAGE; paint(); });
    typeSel.addEventListener('change', () => { type = typeSel.value; shown = PAGE; paint(); });
    sortSel.addEventListener('change', () => { sort = sortSel.value; paint(); });
    body.querySelector('#sc-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); shown = PAGE; paint(); });

    const list = body.querySelector('#sc-list'), count = body.querySelector('#sc-count');
    function paint() {
        let rows = all;
        if (level !== 'All') rows = rows.filter((s) => s.level === level);
        if (zone !== 'All') rows = rows.filter((s) => s.zone === zone);
        if (type !== 'All') rows = rows.filter((s) => s.moe_type === type);
        if (q) rows = rows.filter((s) => s.id.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q));
        rows = [...rows].sort((a, b) => (has(b[sort]) - has(a[sort])) || (has(a[sort]) ? b[sort] - a[sort] : 0) || String(a.name || a.id).localeCompare(String(b.name || b.id)));
        const filters = [level !== 'All' && level, zone !== 'All' && zone[0] + zone.slice(1).toLowerCase(), type !== 'All' && typeName(type), q && `“${q}”`].filter(Boolean);
        count.textContent = `${fmt(rows.length)} school${rows.length === 1 ? '' : 's'}${filters.length ? ` · ${filters.join(' · ')}` : ''}`;
        if (!rows.length) { list.innerHTML = emptyNote('No school matches these filters.'); return; }
        const th = (c) => `<th class="num" aria-sort="${c.k === sort ? 'descending' : 'none'}"><button type="button" class="th-sort${c.k === sort ? ' on' : ''}" data-sort="${c.k}">${c.l}</button></th>`;
        list.innerHTML = `<div class="tbl-card"><table class="mini"><thead><tr><th>School · level</th>${COLS.map(th).join('')}</tr></thead><tbody>
          ${rows.slice(0, shown).map((s) => `<tr class="click" role="button" tabindex="0" data-sid="${esc(s.id)}" title="Open ${esc(s.name || s.id)} and fly to it">
            <td><b class="trunc">${esc(s.name || s.id)}</b><div class="sub-id"><span class="dot" style="background:${LV_COLOR[s.level] || LV_COLOR.Other}"></span>
              ${esc(s.level)} · ${esc(s.id)}${s.lat == null ? ' · not on the map' : ''}</div></td>
            ${COLS.map((c) => `<td class="num">${c.f(s)}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>
          ${rows.length > shown ? `<button type="button" class="btn more-rows" data-more>Show ${Math.min(PAGE, rows.length - shown)} more <span class="muted">(${fmt(rows.length - shown)} left)</span></button>` : ''}`;
        list.querySelectorAll('tr[data-sid]').forEach((tr) => tr.addEventListener('click', () => window.SB.focusSchool(tr.dataset.sid)));
        list.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { sort = b.dataset.sort; sortSel.value = sort; paint(); list.querySelector(`[data-sort="${sort}"]`)?.focus(); }));
        list.querySelector('[data-more]')?.addEventListener('click', () => { shown += PAGE; paint(); });
    }
    paint();
}
