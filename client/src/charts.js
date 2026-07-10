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

export function mk(canvas, cfg) { return new Chart(canvas, cfg); }
export { Chart };
