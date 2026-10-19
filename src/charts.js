// Shared Chart.js helpers — thin marks, hairline grids, muted axes. Every colour is a design token
// (src/styles/tokens.css), read once at start-up, so a token change reaches Chart.js (central-specs change
// overhaul-dashboard-and-agent-replies, D2 and D7). mk() also puts a "Numbers" table under every chart,
// built from the chart's own labels and datasets, and phones get the legend under the chart.
import Chart from 'chart.js/auto';

const css = getComputedStyle(document.documentElement);
export const token = (name) => css.getPropertyValue(name).trim();

// Generic series colours (the views' older names) mapped onto the token families. Hex tokens, so a view
// may append an alpha pair (C.blue + '22').
export const C = {
    blue: token('--lv-p'), aqua: token('--lv-j'), orange: token('--lv-s'), yellow: token('--save'), violet: token('--money'),
    red: token('--st-bad'), magenta: token('--wear'), muted: token('--st-none'), none: token('--none'), books: token('--books'),
    money: token('--money'), wear: token('--wear'), save: token('--save'),
    grid: token('--grid'), axis: token('--axis'), ink: token('--ink'), ink2: token('--ink-2'), mutedText: token('--muted'),
    surface: token('--surface'), shade: token('--shade'),
};
// Food families (taxonomy v2, 7 Jul: 'Mixed' = names naming 2+ food groups). Consumers use CAT_COLOR[c] || C.muted.
export const CAT_COLOR = {
    'Drinks': token('--food-drinks'), 'Snacks & Desserts': token('--food-snacks'), 'Cooked Food': token('--food-cooked'),
    'Mixed': token('--food-mixed'), 'Bookshop & Supplies': C.books, 'Unclassified': C.none,
};
export const LV_COLOR = { Primary: token('--lv-p'), Secondary: token('--lv-s'), 'Junior College': token('--lv-j'), Other: token('--lv-o') };
// Status (good / watch / bad) for map dots and chart marks — Okabe-Ito, readable with colour-blindness. Text
// uses the darker --good / --warn / --bad tokens (>= 4.5:1).
export const ST = { good: token('--st-good'), warn: token('--st-warn'), bad: token('--st-bad'), none: token('--st-none') };
export const PIN = ['--pin-a', '--pin-b', '--pin-c', '--pin-d'].map(token);
export const BAND = ['--band-1', '--band-2', '--band-3', '--band-4'].map(token);

const phone = () => matchMedia('(max-width: 719px)').matches;

// Shade x-axis categories (holiday days/weeks) behind the data. `hit(label)` → true to shade.
export const shade = (hit) => ({
    id: 'shade',
    beforeDatasetsDraw(ch) {
        const { ctx, chartArea: a, scales: { x } } = ch;
        const labels = ch.data.labels || [];
        const step = labels.length > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) : a.right - a.left;
        ctx.save(); ctx.fillStyle = C.shade;
        labels.forEach((l, i) => {
            if (!hit(l, i)) return;
            const px = x.getPixelForValue(i), l0 = Math.max(a.left, px - step / 2), r0 = Math.min(a.right, px + step / 2);
            ctx.fillRect(l0, a.top, r0 - l0, a.bottom - a.top);
        });
        ctx.restore();
    },
});

Chart.defaults.font.family = token('--font');
Chart.defaults.font.size = 11;
Chart.defaults.color = C.mutedText;

export function opts(o = {}) {
    return {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: o.indexMode ? 'index' : 'nearest', intersect: false },
        plugins: {
            legend: o.legend
                ? { position: phone() ? 'bottom' : 'top', align: phone() ? 'start' : 'end',
                    labels: { color: C.ink2, boxWidth: 12, boxHeight: 7, font: { size: 11 } } }
                : { display: false },
            tooltip: { backgroundColor: C.surface, titleColor: C.ink, bodyColor: C.ink2,
                borderColor: C.grid, borderWidth: 1, padding: 9, cornerRadius: 8, ...(o.tooltip || {}) },
            ...(o.plugins || {}),
        },
        scales: o.scales,
        ...(o.indexAxis ? { indexAxis: o.indexAxis } : {}),
    };
}
export const ax = (e = {}) => ({ grid: { color: C.grid, drawTicks: false }, border: { color: C.axis },
    ticks: { maxRotation: 0, autoSkip: true, font: { size: 10.5 }, ...(e.ticks || {}) }, ...e });
export const bar = (c) => ({ backgroundColor: c, borderRadius: 3, borderSkipped: 'start',
    categoryPercentage: 0.72, barPercentage: 1, maxBarThickness: 26 });
export const line = (c, e = {}) => ({ borderColor: c, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    pointHoverBackgroundColor: c, tension: 0.25, fill: false, ...e });

// Every chart gets role=img + its section title as the accessible name (screen readers skip bare canvases),
// and a "Numbers" table under it (cfg.numbers: { label, fmt } to name the first column and format values;
// false for none). The table is built when first opened, from the chart's own data.
export function mk(canvas, cfg) {
    const wrap = canvas.closest('.cwrap');
    const h = canvas.closest('.sec')?.querySelector('.sec-h h2') || wrap?.previousElementSibling;
    canvas.setAttribute('role', 'img');
    if (h && !canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', h.textContent.replace(/ⓘ/g, '').trim());
    const { numbers: num, ...rest } = cfg;
    const chart = new Chart(canvas, rest);
    if (wrap && num !== false) numbers(wrap, chart, num || {});
    return chart;
}

const plainNum = (v) => v == null || v === '' ? '–' : typeof v === 'number' ? v.toLocaleString('en-SG', { maximumFractionDigits: 2 }) : String(v);
function numbers(wrap, chart, o) {
    let d = wrap.nextElementSibling;
    if (!d?.matches?.('details.nums')) {
        d = document.createElement('details');
        d.className = 'nums';
        const s = document.createElement('summary');
        s.textContent = 'Numbers';
        const card = document.createElement('div');
        card.className = 'tbl-card';
        d.append(s, card);
        wrap.after(d);
        d.addEventListener('toggle', () => { if (d.open) fill(d); });
    }
    d._chart = chart; d._o = o;
    if (d.open) fill(d);
}
// Labels and dataset names can be feed text (stall names): built with textContent, never as markup.
function fill(d) {
    const ch = d._chart, o = d._o, f = o.fmt || plainNum;
    const sets = ch.data.datasets.filter((ds) => !ds.numbersHide);
    const t = document.createElement('table');
    t.className = 'mini';
    const cell = (tag, text, cls) => { const c = document.createElement(tag); c.textContent = text; if (cls) c.className = cls; return c; };
    const hr = document.createElement('tr');
    hr.append(cell('th', o.label || 'Category'), ...sets.map((ds) => cell('th', ds.label || 'Value', 'num')));
    const head = document.createElement('thead'); head.append(hr);
    const body = document.createElement('tbody');
    (ch.data.labels || []).forEach((l, i) => {
        const tr = document.createElement('tr');
        tr.append(cell('td', Array.isArray(l) ? l.join(' ') : String(l)), ...sets.map((ds) => cell('td', f(ds.data[i], ds), 'num')));
        body.append(tr);
    });
    t.append(head, body);
    d.querySelector('.tbl-card').replaceChildren(t);
}
export { Chart };
