// Stall Explorer — browse every canteen stall by school, category, price band or
// machine number; click through to a per-stall detail window. Month-aware (uses the selected month).
// Filtering is client-side over the precomputed stalls array (no backend).
import { openWindow, info } from './windowing.js';
import { mk, opts, ax, bar, line, C, CAT_COLOR } from './charts.js';
import { monthLabel, monthName, isCNYMonth } from './sbData.js';

const fmt = (n) => Number(n).toLocaleString('en-SG');
const fmt$ = (v) => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3).toLocaleString() + 'K' : '$' + Math.round(v);
const CAT_CHIP = (c) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CAT_COLOR[c] || C.muted};margin-right:5px"></span>`;
const mach = (t) => t.length > 12 ? '…' + t.slice(-12) : t;
let charts = [];

export function openStallExplorer(DATA, preset = {}) {
    const body = openWindow({ id: 'stalls', title: 'Stall Explorer', sub: `every stall & machine · ${monthLabel(DATA.meta.month)}`, chips: ['<span class="chip chip-sec">F&B</span>'] });
    if (!body) {
        // window already open — re-apply preset filters if given
        const w = document.querySelector('[data-win="stalls"] .tw-body');
        if (w && preset.school) { w.querySelector('#st-q').value = preset.school; w.querySelector('#st-q').dispatchEvent(new Event('input')); }
        return;
    }
    const tw = body.closest('.tw');
    tw.style.width = '680px'; tw.style.left = '46px'; tw.style.top = '20px';

    const m = DATA.meta;
    let cat = 'All', band = -1, sort = 'rev', qtext = preset.school || '';

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt(m.stalls)}</div><div class="l">stalls</div></div>
        <div class="stat"><div class="v">${fmt(m.terminals)}</div><div class="l">machines</div></div>
        <div class="stat"><div class="v">${m.schools}</div><div class="l">schools</div></div>
        <div class="stat"><div class="v">${fmt$(m.rev)}</div><div class="l">revenue</div></div>
      </div>
      <div class="fbar"><span class="fl">Search</span>
        <input id="st-q" class="finput" placeholder="school ID, stall name or machine number…" value="${qtext}"></div>
      <div class="fbar" id="st-cats"><span class="fl">Category</span></div>
      <div class="fbar" id="st-bands"><span class="fl">Price</span></div>
      <div class="fbar"><span class="fl">Sort by</span>
        <button data-sort="rev" class="on">Revenue</button><button data-sort="n">Transactions</button>
        <button data-sort="ticket">Avg ticket</button></div>
      <div class="cap" id="st-count" style="margin:6px 0 4px"></div>
      <div id="st-list"></div>
      <div class="cap" style="margin-top:8px">Category = from the stall's name ${info(`A stall's category comes only from its
        registered name (and prices can't contradict it); generic or bare company names stay Unclassified, never guessed;
        two-food-group names count as Mixed. Where receipts exist (March), open a stall to see what it actually sold.
        Price bands are the factual proxy for menu items.`)}</div>`;

    const catsBar = body.querySelector('#st-cats');
    ['All', ...DATA.cats].forEach((c) => {
        const b = document.createElement('button');
        b.textContent = c === 'All' ? 'All categories' : c;
        if (c === 'All') b.classList.add('on');
        b.addEventListener('click', () => { cat = c; onPill(catsBar, b); paint(); });
        catsBar.appendChild(b);
    });
    const bandsBar = body.querySelector('#st-bands');
    ['Any price', ...DATA.bands].forEach((lab, i) => {
        const b = document.createElement('button');
        b.textContent = lab;
        if (i === 0) b.classList.add('on');
        b.addEventListener('click', () => { band = i - 1; onPill(bandsBar, b); paint(); });
        bandsBar.appendChild(b);
    });
    body.querySelectorAll('[data-sort]').forEach((b) =>
        b.addEventListener('click', () => { sort = b.dataset.sort; onPill(b.parentElement, b); paint(); }));
    body.querySelector('#st-q').addEventListener('input', (e) => { qtext = e.target.value.trim().toLowerCase(); paint(); });

    const list = body.querySelector('#st-list');
    const count = body.querySelector('#st-count');

    function paint() {
        let rows = DATA.stalls;
        if (cat !== 'All') rows = rows.filter((s) => s.cat === cat);
        if (band >= 0) rows = rows.filter((s) => s.bands[band] >= 40);   // band-dominant stalls
        if (qtext) rows = rows.filter((s) =>
            s.school.toLowerCase().includes(qtext) || s.name.toLowerCase().includes(qtext) ||
            s.terms.some((t) => t.toLowerCase().includes(qtext)));
        const tot = { rev: rows.reduce((a, s) => a + s.rev, 0), n: rows.reduce((a, s) => a + s.n, 0) };
        rows = [...rows].sort((a, b) => b[sort] - a[sort]);
        count.textContent = `${fmt(rows.length)} stalls match · ${fmt$(tot.rev)} · ${fmt(tot.n)} txns — showing top ${Math.min(40, rows.length)}`;
        list.innerHTML = `<table class="mini"><tr><th>Stall</th><th>School</th><th>Machine</th><th>Category</th>
          <th style="text-align:right">Revenue</th><th style="text-align:right">Txns</th><th style="text-align:right">Ticket</th></tr>
          ${rows.slice(0, 40).map((s) => `<tr style="cursor:pointer" data-sid="${s.id}">
            <td><b>${s.name}</b></td><td>${s.school}</td>
            <td style="font-size:10.5px">${s.terms.map(mach).join('<br>')}</td>
            <td style="white-space:nowrap">${CAT_CHIP(s.cat)}${s.cat}</td>
            <td class="num">${fmt$(s.rev)}</td><td class="num">${fmt(s.n)}</td>
            <td class="num">$${s.ticket.toFixed(2)}</td></tr>`).join('')}</table>`;
        list.querySelectorAll('tr[data-sid]').forEach((tr) =>
            tr.addEventListener('click', () => openStall(DATA, tr.dataset.sid)));
    }
    paint();
}

export function openStall(DATA, sid) {
    const s = DATA.stalls.find((x) => x.id === sid);
    if (!s) return;
    const body = openWindow({ id: `stall-${sid}`, title: s.name, sub: `${s.id} · ${s.school} · ${s.level}`,
        chips: [`<span class="chip chip-sec">${s.school === 'SSSTM' ? 'Stamp point' : s.cat}</span>`] });
    if (!body) return;
    body.closest('.tw').style.width = '560px';

    const terms = s.terms.map((tid) => DATA.terminals.find((t) => t.id === tid)).filter(Boolean);
    // vendor stall → its host school(s): one ID, both section IDs (campus), or none if unconfirmed
    const homes = s.school === 'PBS' || s.school === 'SSSTM' ? (s.campus || (s.host ? [s.host] : [])) : [s.school];
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt$(s.rev)}</div><div class="l">revenue</div></div>
        <div class="stat"><div class="v">${fmt(s.n)}</div><div class="l">transactions</div></div>
        <div class="stat"><div class="v">$${s.ticket.toFixed(2)}</div><div class="l">avg ticket</div></div>
        <div class="stat"><div class="v">${s.terms.length}</div><div class="l">machine${s.terms.length > 1 ? 's' : ''}</div></div>
      </div>
      ${s.receipt ? `<h5>What's sold here <span class="chip chip-flag">RECEIPTS</span> ${info(`From ${fmt(s.receipt.units)}
          matched receipt units: the real item-type mix (not guessed from the name) and Healthier-Choice share.`)}</h5>
        <span class="mixbar tall">${mixSegs(s.receipt)}</span>
        <div class="cap" style="margin:4px 0 6px">Drink ${s.receipt.drink_sh}% · Food ${s.receipt.food_sh}% ·
          Book ${s.receipt.book_sh}%${s.receipt.stamp_sh ? ` · Smiley Stamps ${s.receipt.stamp_sh}%` : ''}
          ${s.receipt.drink_sh + s.receipt.food_sh > 0 ? ` · <b>Healthier ${s.receipt.healthy_sh ?? '–'}%</b>` : ''}</div>` : ''}
      <h5>Daily revenue — ${monthName(DATA.meta.month)}</h5><div class="cwrap"><canvas></canvas></div>
      <h5>Revenue by hour (school days) &amp; price mix</h5>
      <div style="display:flex;gap:10px"><div class="cwrap" style="flex:1.4"><canvas></canvas></div>
      <div class="cwrap" style="flex:1"><canvas></canvas></div></div>
      <h5>Most common charge amounts ${info('Price points are the closest factual proxy for menu items.')}</h5>
      <table class="mini"><tr><th>Amount</th><th style="text-align:right">Times charged</th></tr>
        ${s.prices.map(([a, n]) => `<tr><td><b>$${(a / 100).toFixed(2)}</b></td><td class="num">${fmt(n)}</td></tr>`).join('')}</table>
      <h5 style="margin-top:10px">This stall's machine${terms.length > 1 ? 's' : ''}</h5>
      <table class="mini"><tr><th>Machine</th><th>Net</th><th style="text-align:right">Err %</th>
        <th style="text-align:right">Median</th><th>Status</th></tr>
        ${terms.map((t) => `<tr style="cursor:pointer" data-tid="${t.id}"><td style="font-size:10.5px"><b>${mach(t.id)}</b></td>
          <td>${t.net || '–'}</td><td class="num">${t.err_pct}%</td>
          <td class="num">${t.med_ms ? (t.med_ms / 1000).toFixed(1) + 's' : '–'}</td>
          <td>${vchip(t.verdict)}</td></tr>`).join('')}</table>
      ${homes.map((h) => `<div class="cap" style="margin-top:8px"><a href="#" data-school="${h}">Open ${h} school window →</a></div>`).join('')}`;

    const [c1, c2, c3] = body.querySelectorAll('canvas');
    const DL = s.daily.map((_, i) => i + 1);                       // 1..N days (matches this month)
    const cny = isCNYMonth(DATA.meta.month);
    mk(c1, { type: 'bar', data: { labels: DL, datasets: [{ label: 'rev', data: s.daily,
        backgroundColor: DL.map((d) => cny && d >= 16 && d <= 18 ? C.red : CAT_COLOR[s.cat] || C.yellow), borderRadius: 2 }] },
        options: opts({ tooltip: { callbacks: { label: (c) => fmt$(c.parsed.y) } }, scales: { x: ax(), y: ax({ ticks: { callback: (v) => fmt$(v) } }) } }) });
    mk(c2, { type: 'bar', data: { labels: [...Array(15).keys()].map((h) => h + 5), datasets: [{ label: 'rev', data: s.hourly, ...bar(CAT_COLOR[s.cat] || C.yellow) }] },
        options: opts({ scales: { x: ax(), y: ax({ ticks: { callback: (v) => fmt$(v) } }) } }) });
    mk(c3, { type: 'bar', data: { labels: DATA.bands, datasets: [{ label: '% of txns', data: s.bands, ...bar(C.blue) }] },
        options: opts({ scales: { x: ax({ ticks: { font: { size: 9 } } }), y: ax({ ticks: { callback: (v) => v + '%' } }) } }) });

    body.querySelectorAll('tr[data-tid]').forEach((tr) =>
        tr.addEventListener('click', () => window.SB?.openTerminal(tr.dataset.tid)));
    body.querySelectorAll('[data-school]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.SB?.openSchool(a.dataset.school); }));
}

// Segments of an item-type mix bar (drink/food/book) for a stall's receipt panel.
function mixSegs(r) {
    const seg = (w, c, t) => (w > 0 ? `<span title="${t} ${w}%" style="width:${w}%;background:${c}"></span>` : '');
    return `${seg(r.drink_sh, C.blue, 'Drink')}${seg(r.food_sh, C.aqua, 'Food')}${seg(r.book_sh, C.violet, 'Book')}${seg(r.stamp_sh, '#d6336c', 'Smiley Stamps')}`;
}

export function vchip(v) {
    if (v === 'machine') return '<span class="chip chip-bad">MACHINE FAULT</span>';
    if (v === 'site') return '<span class="chip chip-warn">SITE ISSUE</span>';
    if (v === 'check') return '<span class="chip chip-other">NO PEERS</span>';
    return '<span class="chip chip-good">OK</span>';
}
function onPill(bar, b) { bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }
