// Saving vs Spending window (March+) — how much students saved vs spent, from the monthly
// per-student saving/spending totals. Reads the precomputed `savings` bundle (build_insights.py →
// ClickHouse). Empty/absent → a friendly note.
import { openWindow } from './windowing.js';
import { mk, opts, ax, bar, C } from './charts.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-SG');
const fmt$ = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v || 0));
let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };

export function openSavings(SAV, _preset) {
    const body = openWindow({ id: 'savings', title: 'Saving vs Spending',
        sub: 'per-student monthly saving and spending', chips: [], onClose: kill });
    if (!body) return;
    const tw = body.closest('.tw'); if (tw) { tw.style.width = '680px'; tw.style.left = '40px'; tw.style.top = '14px'; }

    if (!SAV || !SAV.totals) {
        body.innerHTML = `<div class="cap">No saving/spending data for this month. Upload the
          <b>Student saving vs spending</b> dataset, then rebuild insights.</div>`;
        return;
    }
    const t = SAV.totals;
    const rate = t.saving + t.spending ? Math.round((100 * t.saving) / (t.saving + t.spending)) : null;

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${fmt(t.students)}</div><div class="l">students</div></div>
        <div class="stat"><div class="v">${fmt$(t.saving)}</div><div class="l">total saved</div></div>
        <div class="stat"><div class="v">${fmt$(t.spending)}</div><div class="l">total spent</div></div>
        <div class="stat"><div class="v">$${t.avg_saving}</div><div class="l">avg saved/student</div></div>
        <div class="stat"><div class="v">${rate == null ? '–' : rate + '%'}</div><div class="l">saving rate</div></div>
      </div>
      <div data-pane="body"></div>`;

    const pane = body.querySelector('[data-pane="body"]');
    const heading = (txt) => {
        const d = document.createElement('div'); d.className = 'cap'; d.style.margin = '10px 0 2px';
        d.innerHTML = `<b>${txt}</b>`; pane.appendChild(d);
    };
    const canvas = (h = 190) => {
        const wrap = document.createElement('div'); wrap.style.cssText = `position:relative;height:${h}px;margin:4px 0`;
        const c = document.createElement('canvas'); wrap.appendChild(c); pane.appendChild(wrap); return c;
    };
    const histLabels = (rows) => rows.map((r) => `$${r.lo}${r.lo >= 200 ? '+' : ''}`);

    heading('Saving per student (S$ this month)');
    const sh = SAV.saving_hist || [];
    charts.push(mk(canvas(), { type: 'bar',
        data: { labels: histLabels(sh), datasets: [{ ...bar(C.aqua), data: sh.map((r) => r.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));

    heading('Spending per student (S$ this month)');
    const ph = SAV.spending_hist || [];
    charts.push(mk(canvas(), { type: 'bar',
        data: { labels: histLabels(ph), datasets: [{ ...bar(C.blue), data: ph.map((r) => r.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));

    heading('Saving rate — saved ÷ (saved + spent)');
    const rh = SAV.rate_hist || [];
    charts.push(mk(canvas(160), { type: 'bar',
        data: { labels: rh.map((r) => Math.round(r.rate * 100) + '%'), datasets: [{ ...bar(C.violet), data: rh.map((r) => r.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
}
