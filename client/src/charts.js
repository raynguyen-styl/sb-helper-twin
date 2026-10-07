// Shared Chart.js helpers — thin marks, hairline grids, muted axes (design system).
import Chart from 'chart.js/auto';

export const C = {
    blue: '#2a78d6', aqua: '#1baf7a', yellow: '#eda100', violet: '#7d5fd3',
    red: '#e34948', magenta: '#e87ba4', muted: '#8e8e93',
    grid: '#ececea', axis: '#c3c2b7', ink2: '#52514e',
};
// Taxonomy v2 (7 Jul): 'Mixed' = names naming 2+ food groups ("Hot Drinks and Snacks").
// Pure 'Fruits' no longer occurs (every fruit stall is a combo → Mixed). Consumers
// use CAT_COLOR[c] || C.muted, so unknown/stale categories fall back to grey.
export const CAT_COLOR = {
    'Drinks': C.blue, 'Snacks & Desserts': C.yellow, 'Cooked Food': C.red,
    'Mixed': C.aqua, 'Bookshop & Supplies': C.violet, 'Unclassified': C.muted,
};
export const LV_COLOR = { Primary: C.blue, Secondary: C.aqua, 'Junior College': C.violet, Other: C.muted };
// Status (good / watch / bad) for map dots + chart marks — Okabe-Ito, readable with colour-blindness
// (old red/green was not). Text uses the darker --good/--warn/--bad tokens in theme.css (≥4.5:1).
export const ST = { good: '#009E73', warn: '#E69F00', bad: '#D55E00' };

// Shade x-axis categories (holiday days/weeks) behind the data. `hit(label)` → true to shade.
// No plugin dependency: fills each hit category's slot in beforeDatasetsDraw.
export const shade = (hit) => ({
    id: 'shade',
    beforeDatasetsDraw(ch) {
        const { ctx, chartArea: a, scales: { x } } = ch;
        const labels = ch.data.labels || [];
        const step = labels.length > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) : a.right - a.left;
        ctx.save(); ctx.fillStyle = 'rgba(125,95,211,.10)';
        labels.forEach((l, i) => {
            if (!hit(l, i)) return;
            const px = x.getPixelForValue(i), l0 = Math.max(a.left, px - step / 2), r0 = Math.min(a.right, px + step / 2);
            ctx.fillRect(l0, a.top, r0 - l0, a.bottom - a.top);
        });
        ctx.restore();
    },
});

Chart.defaults.font.family = 'system-ui,-apple-system,"Segoe UI",sans-serif';
Chart.defaults.font.size = 10.5;
Chart.defaults.color = '#898781';

export function opts(o = {}) {
    return {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: o.indexMode ? 'index' : 'nearest', intersect: false },
        plugins: {
            legend: o.legend
                ? { position: 'top', align: 'end', labels: { color: C.ink2, boxWidth: 12, boxHeight: 7, font: { size: 10.5 } } }
                : { display: false },
            tooltip: { backgroundColor: '#fff', titleColor: '#1d1d1f', bodyColor: C.ink2,
                borderColor: C.grid, borderWidth: 1, padding: 9, cornerRadius: 8, ...(o.tooltip || {}) },
        },
        scales: o.scales,
    };
}
export const ax = (e = {}) => ({ grid: { color: C.grid, drawTicks: false }, border: { color: C.axis },
    ticks: { maxRotation: 0, autoSkip: true, font: { size: 10 }, ...(e.ticks || {}) }, ...e });
export const bar = (c) => ({ backgroundColor: c, borderRadius: 3, borderSkipped: 'start',
    categoryPercentage: 0.72, barPercentage: 1, maxBarThickness: 26 });
export const line = (c, e = {}) => ({ borderColor: c, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    pointHoverBackgroundColor: c, tension: 0.25, fill: false, ...e });

// Every chart gets role=img + its heading as the accessible name (screen readers skip bare canvases).
export function mk(canvas, cfg) {
    const h = canvas.closest('.cwrap')?.previousElementSibling;
    canvas.setAttribute('role', 'img');
    if (h && !canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', h.textContent.replace(/ⓘ/g, '').trim());
    return new Chart(canvas, cfg);
}
export { Chart };
