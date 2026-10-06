// Purchases & Nutrition window (March+) — line-item view: what students actually bought, the
// Healthier-Choice split, calories, item types and the top items. Reads the precomputed `items`
// bundle (ingestion-service/build_insights.py → ClickHouse). Empty/absent → a friendly note.
import { openWindow, info } from './windowing.js';
import { mk, opts, ax, bar, C } from './charts.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-SG');
const fmt$ = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v || 0));
let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };

export function openItems(ITEMS, tab) {
    const body = openWindow({ id: 'items', title: 'Purchases & Nutrition',
        sub: 'what students bought · Healthier Choice · calories', chips: [], onClose: kill });
    if (!body) return;
    const tw = body.closest('.tw'); if (tw) { tw.style.width = '720px'; tw.style.left = '40px'; tw.style.top = '14px'; }

    if (!ITEMS || !ITEMS.meta) {
        body.innerHTML = `<div class="cap">No purchase-item data for this month. Upload the
          <b>Student purchase items</b> dataset, then rebuild insights.</div>`;
        return;
    }
    const m = ITEMS.meta;
    const healthy = ITEMS.healthy || [];
    const hc = healthy.find((h) => h.bucket === 'Healthier choice')?.qty || 0;
    const ev = healthy.find((h) => h.bucket === 'Everyday')?.qty || 0;
    const hcPct = hc + ev ? Math.round((100 * hc) / (hc + ev)) : null;

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt(m.rows)}</div><div class="l">line items</div></div>
        <div class="stat"><div class="v">${fmt(m.qty)}</div><div class="l">units sold</div></div>
        <div class="stat"><div class="v">${fmt$(m.rev)}</div><div class="l">item revenue</div></div>
        <div class="stat"><div class="v">${hcPct == null ? '–' : hcPct + '%'}</div><div class="l">Healthier Choice</div></div>
      </div>
      <div class="tabs">
        <button data-tab="nutri" class="on">Nutrition</button>
        <button data-tab="types">Item types</button>
        <button data-tab="top">Top items</button>
        ${ITEMS.top_stalls ? '<button data-tab="linkage">Stalls &amp; habits</button>' : ''}
      </div>
      <div data-pane="nutri"></div>
      <div data-pane="types" style="display:none"></div>
      <div data-pane="top" style="display:none"></div>
      ${ITEMS.top_stalls ? '<div data-pane="linkage" style="display:none"></div>' : ''}`;

    body.querySelectorAll('.tabs button').forEach((b) =>
        b.addEventListener('click', () => {
            body.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
            body.querySelectorAll('[data-pane]').forEach((p) => (p.style.display = p.dataset.pane === b.dataset.tab ? '' : 'none'));
        }));

    renderNutrition(body.querySelector('[data-pane="nutri"]'), ITEMS);
    renderTypes(body.querySelector('[data-pane="types"]'), ITEMS);
    renderTop(body.querySelector('[data-pane="top"]'), ITEMS);
    if (ITEMS.top_stalls) renderLinkage(body.querySelector('[data-pane="linkage"]'), ITEMS);
    if (tab) body.querySelector(`.tabs button[data-tab="${tab}"]`)?.click();
}

function canvas(pane, h = 200) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:relative;height:${h}px;margin:6px 0 14px`;
    const c = document.createElement('canvas'); wrap.appendChild(c); pane.appendChild(wrap);
    return c;
}
function heading(pane, t) {
    const d = document.createElement('div'); d.className = 'cap'; d.style.margin = '6px 0 2px';
    d.innerHTML = `<b>${t}</b>`; pane.appendChild(d);
}

function renderNutrition(pane, ITEMS) {
    heading(pane, 'Healthier Choice vs Everyday (by units)');
    const h = ITEMS.healthy || [];
    charts.push(mk(canvas(pane, 150), {
        type: 'bar',
        data: { labels: h.map((x) => x.bucket), datasets: [{ ...bar(C.aqua), data: h.map((x) => x.qty) }] },
        options: opts({ indexAxis: 'y', scales: { x: ax({ beginAtZero: true }), y: ax() } }),
    }));
    heading(pane, 'Calories per item');
    const cal = ITEMS.calories || [];
    charts.push(mk(canvas(pane, 170), {
        type: 'bar',
        data: { labels: cal.map((x) => x.band), datasets: [{ ...bar(C.violet), data: cal.map((x) => x.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }),
    }));
    heading(pane, 'Top nutrition categories (Healthier-Choice % on hover)');
    const cat = (ITEMS.by_category || []).slice(0, 12);
    charts.push(mk(canvas(pane, 220), {
        type: 'bar',
        data: { labels: cat.map((x) => x.category), datasets: [{ ...bar(C.blue), data: cat.map((x) => x.qty) }] },
        options: opts({
            indexAxis: 'y', scales: { x: ax({ beginAtZero: true }), y: ax() },
            plugins: { tooltip: { callbacks: { afterLabel: (ctx) =>
                `Healthier: ${cat[ctx.dataIndex]?.healthy_pct ?? '–'}%` } } },
        }),
    }));
}

function renderTypes(pane, ITEMS) {
    const t = ITEMS.by_type || [];
    heading(pane, 'Units sold by item type');
    charts.push(mk(canvas(pane, 200), {
        type: 'bar',
        data: { labels: t.map((x) => x.type), datasets: [{ ...bar(C.blue), data: t.map((x) => x.qty) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }),
    }));
    pane.insertAdjacentHTML('beforeend', `<table class="mini">
      <tr><th>Type</th><th class="num">Items</th><th class="num">Units</th><th class="num">Revenue</th>
      <th class="num">Avg cal</th><th class="num">Healthy %</th></tr>
      ${t.map((x) => `<tr><td><b>${x.type}</b></td><td class="num">${fmt(x.n)}</td>
        <td class="num">${fmt(x.qty)}</td><td class="num">${fmt$(x.rev)}</td>
        <td class="num">${x.avg_cal ?? '–'}</td><td class="num">${x.healthy_pct ?? '–'}</td></tr>`).join('')}</table>`);
}

// Thin inline stacked bar for a stall's item-type mix (drink / food / book %).
function mixBar(d, f, b) {
    const seg = (w, c, t) => (w > 0 ? `<span title="${t} ${w}%" style="width:${w}%;background:${c}"></span>` : '');
    return `<span class="mixbar">${seg(d, C.blue, 'Drink')}${seg(f, C.aqua, 'Food')}${seg(b, C.violet, 'Book')}</span>`;
}

function renderLinkage(pane, ITEMS) {
    const h = ITEMS.habits || {};
    const stalls = ITEMS.top_stalls || [];
    heading(pane, 'How this links');
    pane.insertAdjacentHTML('beforeend', `<div class="cap" style="margin-bottom:8px"><b>${h.match_pct ?? '–'}%</b> of receipts
      link to a payment · ${h.single_card_pct ?? '–'}% to one anonymised card ${info(`Each receipt is matched to its payment by
      school, stall and exact second, showing what was actually bought per stall and per card — with no link between a
      card and any person.`)}</div>`);

    // per-card habits
    pane.insertAdjacentHTML('beforeend', `<div class="stats" style="margin:2px 0 12px">
      <div class="stat"><div class="v">${fmt(h.cards)}</div><div class="l">cards linked</div></div>
      <div class="stat"><div class="v">${h.med_baskets ?? '–'}</div><div class="l">median baskets/card</div></div>
      <div class="stat"><div class="v">${h.med_stalls ?? '–'}</div><div class="l">median stalls/card</div></div>
      <div class="stat"><div class="v">${h.avg_loyalty ?? '–'}%</div><div class="l">avg stall loyalty</div></div>
    </div>`);

    heading(pane, 'Healthier-choice cohorts (per card)');
    const mh = h.mostly_healthy_pct ?? 0, mu = h.mostly_unhealthy_pct ?? 0, mid = Math.max(0, +(100 - mh - mu).toFixed(1));
    pane.insertAdjacentHTML('beforeend', `<div class="mixbar tall" style="margin:6px 0 2px">
        <span title="Mostly healthier (≥80% of units)" style="width:${mh}%;background:${C.aqua}"></span>
        <span title="Mixed" style="width:${mid}%;background:#cfd8dc"></span>
        <span title="Mostly everyday (<50% healthier)" style="width:${mu}%;background:${C.red}"></span>
      </div>
      <div class="cap" style="margin-bottom:12px">${mh}% <b>mostly healthier</b> · ${mid}% mixed · <b>${mu}% mostly everyday</b>
        ${info('Per linked card: mostly healthier = at least 80% of units are Healthier Choice; mostly everyday = under 50%. Aggregate, hashed cards only.')}</div>`);

    heading(pane, 'Top stalls — what they actually sell');
    pane.insertAdjacentHTML('beforeend', `<table class="mini">
      <tr><th>Stall</th><th>School</th><th class="num">Units</th><th class="num">Revenue</th>
      <th>Type mix (drink/food/book)</th><th class="num">Healthy %</th></tr>
      ${stalls.map((s) => `<tr style="cursor:pointer" data-sid="${s.storeId}">
        <td>${s.name || s.storeId}</td><td>${s.schoolId}</td><td class="num">${fmt(s.units)}</td>
        <td class="num">${fmt$(s.rev)}</td><td>${mixBar(s.drink_sh, s.food_sh, s.book_sh)}</td>
        <td class="num">${s.healthy_sh ?? '–'}</td></tr>`).join('')}</table>`);
    pane.querySelectorAll('tr[data-sid]').forEach((tr) =>
        tr.addEventListener('click', () => window.SB?.openStall?.(tr.dataset.sid)));
}

function renderTop(pane, ITEMS) {
    const t = ITEMS.top_items || [];
    pane.insertAdjacentHTML('beforeend', `<div class="cap" style="margin:4px 0 6px">Top 40 items by units sold.</div>
      <table class="mini"><tr><th>Item</th><th class="num">Units</th><th class="num">Revenue</th>
      <th class="num">Avg cal</th><th>HCS</th></tr>
      ${t.map((x) => `<tr><td>${x.name}</td><td class="num">${fmt(x.qty)}</td>
        <td class="num">${fmt$(x.rev)}</td><td class="num">${x.avg_cal ?? '–'}</td>
        <td>${x.healthy === 1 ? '✅' : ''}</td></tr>`).join('')}</table>`);
}
