// Purchases & Nutrition — the line-item view: what students actually bought, calories, item types, the top items
// and how receipts link to payments. Reads the precomputed `items` bundle. The menu's healthier flag is shown only
// as "Marked healthier on the menu (unverified)": the menu sets it on most items, books and sweet drinks included,
// so it is never a headline figure or called Healthier Choice (central-specs capability dashboard-views).
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, C, CAT_COLOR } from './charts.js';
import { monthLabel } from './sbData.js';
import { kpis, section, chart, tableCard, tabs, panes, wireTabs, emptyNote, fmt, money, pct, big } from './ui.js';

let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };
const BUCKET = { 'Healthier choice': 'Marked healthier', Everyday: 'Not marked' };
const FLAG_NOTE = 'The menu sets this flag on most items, books and sweet drinks included, so it is not a Healthier Choice rating.';

export function openItems(ITEMS, tab) {
    const body = openWindow({ id: 'items', title: 'Purchases & Nutrition', sub: 'What students bought, item by item', chips: [], onClose: kill, wide: true });
    if (!body) return;
    if (!ITEMS || !ITEMS.meta) {
        body.innerHTML = emptyNote('No purchase-item data for this month: the store holds no <b>items</b> bundle for it.');
        return;
    }
    const m = ITEMS.meta;
    const TOPICS = [['nutri', 'Nutrition'], ['types', 'Item types'], ['top', 'Top items'], ...(ITEMS.top_stalls ? [['linkage', 'Stalls & habits']] : [])];
    body.innerHTML = `
      ${kpis([{ l: 'Line items', v: fmt(m.rows) }, { l: 'Units sold', v: fmt(m.qty) }, { l: 'Item revenue', v: money(m.rev) },
          m.schools != null && { l: 'Schools', v: fmt(m.schools) }])}
      ${tabs(TOPICS)}
      ${panes(TOPICS)}`;
    const pick = wireTabs(body);
    renderNutrition(body.querySelector('[data-pane="nutri"]'), ITEMS);
    renderTypes(body.querySelector('[data-pane="types"]'), ITEMS);
    renderTop(body.querySelector('[data-pane="top"]'), ITEMS);
    if (ITEMS.top_stalls) renderLinkage(body.querySelector('[data-pane="linkage"]'), ITEMS);
    if (tab) pick(tab);
}

function renderNutrition(pane, ITEMS) {
    const h = ITEMS.healthy || [];
    const hq = h.reduce((a, x) => a + (x.qty || 0), 0);
    const marked = h.find((x) => x.bucket === 'Healthier choice')?.qty || 0;
    const cal = ITEMS.calories || [];
    const calN = cal.reduce((a, x) => a + (x.n || 0), 0);
    const cover = ITEMS.meta.rows ? (100 * calN) / ITEMS.meta.rows : null;
    const cat = (ITEMS.by_category || []).slice(0, 12);
    pane.innerHTML = section({ title: 'Marked healthier on the menu (unverified)',
            take: hq ? `<b>${pct((100 * marked) / hq, 0)}</b> of units carry the menu's healthier mark. ${FLAG_NOTE}` : FLAG_NOTE,
            tip: 'The flag is the menu\'s own field (ITEM.healthyChoice), set when the item is created. It has not been checked against the Health Promotion Board\'s Healthier Choice criteria.',
            body: h.length ? chart({ h: 140 }) : emptyNote('No menu flags in this bundle.') }) +
        section({ title: 'Calories per item',
            take: cover != null ? `Only <b>${pct(cover, cover < 10 ? 1 : 0)}</b> of line items (${fmt(calN)} of ${fmt(ITEMS.meta.rows)}) have a calorie value; the bands describe those.` : '',
            body: cal.length ? chart({ h: 170 }) : emptyNote('No calorie values in this bundle.') }) +
        section({ title: 'Top nutrition categories', take: 'Units sold per category; the share marked healthier is on hover and under Numbers.',
            body: cat.length ? chart({ h: 240 }) : emptyNote('No categories in this bundle.') });
    const [c1, c2, c3] = pane.querySelectorAll('canvas');
    if (c1) charts.push(mk(c1, { type: 'bar', numbers: { label: 'Menu flag', fmt: (v) => fmt(v) },
        data: { labels: h.map((x) => BUCKET[x.bucket] || x.bucket), datasets: [{ ...bar(C.ink2), label: 'Units', data: h.map((x) => x.qty) }] },
        options: opts({ indexAxis: 'y', scales: { x: ax({ beginAtZero: true, ticks: { callback: (v) => big(v) } }), y: ax({ grid: { display: false } }) } }) }));
    if (c2) charts.push(mk(c2, { type: 'bar', numbers: { label: 'Calories', fmt: (v) => fmt(v) },
        data: { labels: cal.map((x) => x.band), datasets: [{ ...bar(C.violet), label: 'Line items', data: cal.map((x) => x.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => big(v) } }) } }) }));
    if (c3) charts.push(mk(c3, { type: 'bar', numbers: { label: 'Category', fmt: (v, ds) => (ds.label === 'Marked healthier %' ? (v == null ? '–' : `${v}%`) : fmt(v)) },
        data: { labels: cat.map((x) => x.category), datasets: [
            { ...bar(C.blue), label: 'Units', data: cat.map((x) => x.qty) },
            { label: 'Marked healthier %', data: cat.map((x) => x.healthy_pct), hidden: true }] },
        options: opts({ indexAxis: 'y', scales: { x: ax({ beginAtZero: true }), y: ax({ grid: { display: false } }) },
            tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { afterLabel: (ctx) => `Marked healthier: ${cat[ctx.dataIndex]?.healthy_pct ?? '–'}%` } } }) }));
}

function renderTypes(pane, ITEMS) {
    const t = ITEMS.by_type || [];
    const top = [...t].sort((a, b) => b.qty - a.qty)[0];
    pane.innerHTML = section({ title: 'Units sold by item type',
            take: top ? `<b>${esc(top.type)}</b> sold the most units: ${fmt(top.qty)}.` : '',
            body: t.length ? chart({ h: 200 }) : emptyNote('No item types in this bundle.') }) +
        (t.length ? section({ title: 'Item types in numbers', take: 'Average calories only where an item has a value.',
            body: tableCard(`<tr><th>Type</th><th class="num">Items</th><th class="num">Units</th><th class="num">Revenue</th>
                <th class="num">Average cal</th><th class="num">Marked healthier</th></tr>`,
                t.map((x) => `<tr><td><b>${esc(x.type)}</b></td><td class="num">${fmt(x.n)}</td>
                  <td class="num">${fmt(x.qty)}</td><td class="num">${money(x.rev)}</td>
                  <td class="num">${x.avg_cal ?? '–'}</td><td class="num">${x.healthy_pct == null ? '–' : x.healthy_pct + '%'}</td></tr>`).join('')) }) : '');
    const c = pane.querySelector('canvas');
    if (c) charts.push(mk(c, { type: 'bar', numbers: { label: 'Type', fmt: (v) => fmt(v) },
        data: { labels: t.map((x) => x.type), datasets: [{ ...bar(C.blue), label: 'Units', data: t.map((x) => x.qty) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
}

// Thin inline stacked bar for a stall's item-type mix (drink / food / book %).
function mixBar(d, f, b) {
    const seg = (w, c, t) => (w > 0 ? `<span title="${t} ${w}%" style="width:${w}%;background:${c}"></span>` : '');
    return `<span class="mixbar">${seg(d, CAT_COLOR.Drinks, 'Drink')}${seg(f, CAT_COLOR['Cooked Food'], 'Food')}${seg(b, C.books, 'Book')}</span>`;
}

function renderLinkage(pane, ITEMS) {
    const h = ITEMS.habits || {};
    const stalls = ITEMS.top_stalls || [];
    const mh = h.mostly_healthy_pct ?? 0, mu = h.mostly_unhealthy_pct ?? 0, mid = Math.max(0, +(100 - mh - mu).toFixed(1));
    pane.innerHTML = section({ title: 'How receipts link to payments',
            take: `<b>${h.match_pct ?? '–'}%</b> of receipts link to a payment; ${h.single_card_pct ?? '–'}% to one anonymised card.`,
            tip: 'Each receipt is matched to its payment by school, stall and exact second, showing what was actually bought per stall and per card — with no link between a card and any person.',
            body: kpis([{ l: 'Cards linked', v: fmt(h.cards) }, { l: 'Median baskets per card', v: h.med_baskets ?? '–' },
                { l: 'Median stalls per card', v: h.med_stalls ?? '–' }, { l: 'Average stall loyalty', v: h.avg_loyalty == null ? '–' : `${h.avg_loyalty}%` }]) }) +
        section({ title: 'Cards by share marked healthier (unverified)',
            take: `${mh}% of linked cards buy mostly marked items, ${mid}% a mix, <b>${mu}%</b> mostly unmarked. ${FLAG_NOTE}`,
            tip: 'Per linked card: mostly marked = at least 80% of units carry the menu\'s healthier flag; mostly unmarked = under 50%. Aggregate, hashed cards only.',
            body: `<div class="mixbar tall" role="img" aria-label="${mh}% mostly marked, ${mid}% mixed, ${mu}% mostly unmarked">
                <span title="Mostly marked (80%+ of units)" style="width:${mh}%;background:${C.aqua}"></span>
                <span title="Mixed" style="width:${mid}%;background:${C.none}"></span>
                <span title="Mostly unmarked (under 50%)" style="width:${mu}%;background:${C.yellow}"></span></div>` }) +
        section({ title: 'Top stalls — what they actually sell', take: 'Press a stall to open it.',
            body: stalls.length ? tableCard(`<tr><th>Stall</th><th>School</th><th class="num">Units</th><th class="num">Revenue</th>
                <th>Drink · food · book</th><th class="num">Marked healthier</th></tr>`,
                stalls.map((s) => `<tr class="click" role="button" tabindex="0" data-stall="${esc(s.storeId)}" data-sid="${esc(s.schoolId)}">
                  <td><span class="trunc">${esc(s.name || s.storeId)}</span></td><td>${esc(s.schoolId)}</td><td class="num">${fmt(s.units)}</td>
                  <td class="num">${money(s.rev)}</td><td>${mixBar(s.drink_sh, s.food_sh, s.book_sh)}</td>
                  <td class="num">${s.healthy_sh == null ? '–' : s.healthy_sh + '%'}</td></tr>`).join(''))
                : emptyNote('No stall linkage in this bundle.') });
    pane.querySelectorAll('tr[data-stall]').forEach((tr) => tr.addEventListener('click', () => window.SB?.openStall?.(tr.dataset.stall)));
}

function renderTop(pane, ITEMS) {
    const t = ITEMS.top_items || [];
    pane.innerHTML = section({ title: 'Top items by units sold',
        take: `The ${t.length} best sellers of ${monthLabel(ITEMS.month || ITEMS.meta.month) || 'the month'}. Names are till buttons, so read them as types, not dishes.`,
        body: t.length ? tableCard(`<tr><th>Item</th><th class="num">Units</th><th class="num">Revenue</th><th class="num">Average cal</th><th>Marked healthier</th></tr>`,
            t.map((x) => `<tr><td><span class="trunc">${esc(x.name)}</span></td><td class="num">${fmt(x.qty)}</td>
              <td class="num">${money(x.rev)}</td><td class="num">${x.avg_cal ?? '–'}</td>
              <td>${x.healthy === 1 ? 'Yes' : ''}</td></tr>`).join(''))
            : emptyNote('No items in this bundle.') });
}
