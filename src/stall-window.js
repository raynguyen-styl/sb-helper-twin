// Stalls — the stall explorer (every canteen stall by school, category, price band or machine number) and a
// stall's own view in the shared anatomy (central-specs capability dashboard-views). Month-aware. Filtering is
// client-side over the precomputed stalls array (no backend).
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, C, CAT_COLOR } from './charts.js';
import { monthName, isCNYMonth } from './sbData.js';
import { pinButton } from './compare.js';
import { kpis, section, chart, tableCard, emptyNote, chipBar, fmt, money, pct, secs } from './ui.js';

const CAT_DOT = (c) => `<span class="dot" style="background:${CAT_COLOR[c] || C.muted}"></span>`;
const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;

export function openStallExplorer(DATA, preset = {}) {
    const body = openWindow({ id: 'stalls', title: 'Stall Explorer', sub: 'Every stall and machine', chips: [], wide: true });
    if (!body) {
        // window already open — re-apply preset filters if given
        const w = document.querySelector('[data-win="stalls"] .tw-body');
        if (w && preset.school) { w.querySelector('#st-q').value = preset.school; w.querySelector('#st-q').dispatchEvent(new Event('input')); }
        return;
    }
    const m = DATA.meta;
    let cat = 'All', band = -1, sort = 'rev', qtext = (preset.school || '').toLowerCase();
    body.innerHTML = `
      ${kpis([{ l: 'Stalls', v: fmt(m.stalls) }, { l: 'Machines', v: fmt(m.terminals) }, { l: 'Schools', v: fmt(m.schools) }, { l: 'Revenue', v: money(m.rev) }])}
      <div class="fgrid">
        <input id="st-q" class="finput" type="search" placeholder="School, stall name or machine number…" aria-label="Search stalls" value="${esc(qtext)}">
        <select class="sel" id="st-sort" aria-label="Sort by"><option value="rev">Revenue</option><option value="n">Taps</option><option value="ticket">Average ticket</option></select>
      </div>
      <div data-cats></div><div data-bands></div>
      <p class="count-line" id="st-count" role="status"></p>
      <div id="st-list"></div>
      <p class="take">Category = from the stall's name ${info(`A stall's category comes only from its registered name (and prices can't
        contradict it); generic or bare company names stay Unclassified, never guessed; two-food-group names count as Mixed. Where
        receipts exist, open a stall to see what it actually sold. Price bands are the factual proxy for menu items.`)}</p>`;
    body.querySelector('[data-cats]').replaceWith(chipBar('Category', [['All', 'All categories'], ...DATA.cats.map((c) => [c, c])], cat, (v) => { cat = v; paint(); }));
    body.querySelector('[data-bands]').replaceWith(chipBar('Price', [['-1', 'Any price'], ...DATA.bands.map((b, i) => [String(i), b])], '-1', (v) => { band = +v; paint(); }));
    body.querySelector('#st-sort').addEventListener('change', (e) => { sort = e.target.value; paint(); });
    body.querySelector('#st-q').addEventListener('input', (e) => { qtext = e.target.value.trim().toLowerCase(); paint(); });

    const list = body.querySelector('#st-list'), count = body.querySelector('#st-count');
    function paint() {
        let rows = DATA.stalls;
        if (cat !== 'All') rows = rows.filter((s) => s.cat === cat);
        if (band >= 0) rows = rows.filter((s) => s.bands[band] >= 40);   // band-dominant stalls
        if (qtext) rows = rows.filter((s) =>
            s.school.toLowerCase().includes(qtext) || s.name.toLowerCase().includes(qtext) ||
            s.terms.some((t) => t.toLowerCase().includes(qtext)));
        const tot = { rev: rows.reduce((a, s) => a + s.rev, 0), n: rows.reduce((a, s) => a + s.n, 0) };
        rows = [...rows].sort((a, b) => b[sort] - a[sort]);
        count.textContent = `${fmt(rows.length)} stalls · ${money(tot.rev)} · ${fmt(tot.n)} taps${rows.length > 40 ? ' — showing the first 40' : ''}`;
        list.innerHTML = rows.length ? tableCard(`<tr><th>Stall</th><th>School</th><th>Machine</th><th>Category</th>
              <th class="num">Revenue</th><th class="num">Taps</th><th class="num">Ticket</th></tr>`,
            rows.slice(0, 40).map((s) => `<tr class="click" role="button" tabindex="0" data-stall="${esc(s.id)}" data-sid="${esc(s.school)}">
              <td><b class="trunc">${esc(s.name)}</b></td><td>${esc(s.school)}</td>
              <td class="mono">${s.terms.map((t) => esc(mach(t))).join('<br>')}</td>
              <td class="nowrap">${CAT_DOT(s.cat)} ${esc(s.cat)}</td>
              <td class="num">${money(s.rev)}</td><td class="num">${fmt(s.n)}</td>
              <td class="num">${money(s.ticket)}</td></tr>`).join(''))
            : emptyNote('No stall matches these filters.');
        list.querySelectorAll('tr[data-stall]').forEach((tr) => tr.addEventListener('click', () => openStall(DATA, tr.dataset.stall)));
    }
    paint();
}

export function openStall(DATA, sid) {
    const s = DATA.stalls.find((x) => x.id === sid);
    if (!s) return;
    const body = openWindow({ id: `stall-${sid}`, title: s.name, sub: `${s.id} · ${s.school} · ${s.level}`,
        chips: [`<span class="chip">${CAT_DOT(s.cat)} ${s.school === 'SSSTM' ? 'Stamp point' : esc(s.cat)}</span>`] });
    if (!body) return;
    pinButton(body, 'stall', s);

    const terms = s.terms.map((tid) => DATA.terminals.find((t) => t.id === tid)).filter(Boolean);
    // vendor stall → its host school(s): one ID, both section IDs (campus), or none if unconfirmed
    const homes = s.school === 'PBS' || s.school === 'SSSTM' ? (s.campus || (s.host ? [s.host] : [])) : [s.school];
    const MON = monthName(DATA.meta.month);
    const peakH = s.hourly?.length ? s.hourly.indexOf(Math.max(...s.hourly)) + 5 : null;
    const r = s.receipt;
    body.innerHTML = `
      ${kpis([{ l: 'Revenue', v: money(s.rev) }, { l: 'Taps', v: fmt(s.n) }, { l: 'Average ticket', v: money(s.ticket) },
          { l: s.terms.length > 1 ? 'Machines' : 'Machine', v: fmt(s.terms.length) }])}
      ${r ? section({ title: 'What is sold here', take: `Drink ${r.drink_sh}% · Food ${r.food_sh}% · Book ${r.book_sh}%${r.stamp_sh ? ` · Smiley Stamps ${r.stamp_sh}%` : ''}${r.drink_sh + r.food_sh > 0 && r.healthy_sh != null ? ` · ${r.healthy_sh}% marked healthier on the menu (unverified)` : ''}.`,
          tip: `From ${fmt(r.units)} matched receipt units: the real item-type mix, not guessed from the name. "Marked healthier" is the menu's own flag, set on most items, books and sweet drinks included — not a Healthier Choice rating.`,
          body: `<span class="mixbar tall">${mixSegs(r)}</span>` }) : ''}
      ${section({ title: 'Daily revenue', take: `${MON}, one bar per day.`, body: chart() })}
      ${section({ title: 'Revenue by hour (school days)', take: peakH != null ? `Busiest at <b>${peakH}:00</b>.` : '', body: chart({ h: 170 }) })}
      ${section({ title: 'Payments by price band', take: 'Share of this stall\'s payments in each band.', body: chart({ h: 170 }) })}
      ${section({ title: 'Most common charge amounts', take: 'Price points are the closest factual proxy for menu items.',
          body: s.prices?.length ? tableCard('<tr><th>Amount</th><th class="num">Times charged</th></tr>',
              s.prices.map(([a, n]) => `<tr><td><b>${money(a / 100)}</b></td><td class="num">${fmt(n)}</td></tr>`).join('')) : emptyNote('No charge amounts recorded.') })}
      ${section({ title: terms.length > 1 ? 'This stall\'s machines' : 'This stall\'s machine', take: 'Press a row to open the machine.',
          body: terms.length ? tableCard('<tr><th>Machine</th><th>Net</th><th class="num">Errors</th><th class="num">Median</th><th>Status</th></tr>',
              terms.map((t) => `<tr class="click" role="button" tabindex="0" data-tid="${esc(t.id)}"><td><b class="mono">${esc(mach(t.id))}</b></td>
                <td>${esc(t.net) || '–'}</td><td class="num">${pct(t.err_pct)}</td><td class="num">${secs(t.med_ms)}</td>
                <td>${vchip(t.verdict)}</td></tr>`).join('')) : emptyNote('No machine recorded for this stall.') })}
      ${homes.length ? `<div class="fbar">${homes.map((h) => `<button type="button" class="btn" data-school="${esc(h)}">Open ${esc(h)}</button>`).join('')}</div>` : ''}`;

    const [c1, c2, c3] = body.querySelectorAll('canvas');
    const DL = s.daily.map((_, i) => i + 1);                       // 1..N days (matches this month)
    const cny = isCNYMonth(DATA.meta.month);
    const col = CAT_COLOR[s.cat] || C.money;
    mk(c1, { type: 'bar', numbers: { label: 'Day', fmt: (v) => money(v) }, data: { labels: DL, datasets: [{ label: 'Revenue', data: s.daily,
        backgroundColor: DL.map((d) => cny && d >= 16 && d <= 18 ? C.red : col), borderRadius: 2 }] },
        options: opts({ tooltip: { callbacks: { label: (c) => money(c.parsed.y) } }, scales: { x: ax(), y: ax({ ticks: { callback: (v) => money(v) } }) } }) });
    mk(c2, { type: 'bar', numbers: { label: 'Hour', fmt: (v) => money(v) }, data: { labels: [...Array(15).keys()].map((h) => `${h + 5}:00`), datasets: [{ label: 'Revenue', data: s.hourly, ...bar(col) }] },
        options: opts({ scales: { x: ax(), y: ax({ ticks: { callback: (v) => money(v) } }) } }) });
    mk(c3, { type: 'bar', numbers: { label: 'Band', fmt: (v) => pct(v) }, data: { labels: DATA.bands, datasets: [{ label: '% of payments', data: s.bands, ...bar(C.blue) }] },
        options: opts({ scales: { x: ax(), y: ax({ ticks: { callback: (v) => v + '%' } }) } }) });

    body.querySelectorAll('tr[data-tid]').forEach((tr) => tr.addEventListener('click', () => window.SB?.openTerminal(tr.dataset.tid)));
    body.querySelectorAll('[data-school]').forEach((a) => a.addEventListener('click', () => window.SB?.focusSchool(a.dataset.school)));
}

// Segments of an item-type mix bar (drink/food/book) for a stall's receipt panel.
function mixSegs(r) {
    const seg = (w, c, t) => (w > 0 ? `<span title="${t} ${w}%" style="width:${w}%;background:${c}"></span>` : '');
    return `${seg(r.drink_sh, CAT_COLOR.Drinks, 'Drink')}${seg(r.food_sh, CAT_COLOR['Cooked Food'], 'Food')}${seg(r.book_sh, C.books, 'Book')}${seg(r.stamp_sh, C.save, 'Smiley Stamps')}`;
}

// A machine's verdict, in words as well as colour (status never by colour alone).
export function vchip(v) {
    if (v === 'machine') return '<span class="chip chip-bad">Machine fault</span>';
    if (v === 'site') return '<span class="chip chip-warn">Site issue</span>';
    if (v === 'check') return '<span class="chip chip-other">No peers</span>';
    return '<span class="chip chip-good">OK</span>';
}
