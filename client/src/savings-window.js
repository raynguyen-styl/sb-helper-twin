// Saving vs Spending window (March+) — how much students saved vs spent, from the monthly
// per-student saving/spending totals. Reads the precomputed `savings` bundle (build_insights.py →
// ClickHouse). Empty/absent → a friendly note.
import { openWindow, info } from './windowing.js';
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
    const heading = (txt, tip) => {
        const d = document.createElement('div'); d.className = 'cap'; d.style.margin = '10px 0 2px';
        d.innerHTML = `<b>${txt}</b>${tip ? ' ' + info(tip) : ''}`; pane.appendChild(d);
    };
    const canvas = (h = 190) => {
        const wrap = document.createElement('div'); wrap.style.cssText = `position:relative;height:${h}px;margin:4px 0`;
        const c = document.createElement('canvas'); wrap.appendChild(c); pane.appendChild(wrap); return c;
    };
    const histLabels = (rows) => rows.map((r) => `$${r.lo}${r.lo >= 200 ? '+' : ''}`);

    // Wallet ↔ savings reconciliation — two independent feeds agreeing (the "data links together" beat).
    if (SAV.reconcile) {
        const r = SAV.reconcile;
        pane.insertAdjacentHTML('beforeend', `<div class="cap" style="margin:8px 0 2px">
          <b>Do the feeds agree? — wallet ↔ savings</b> <span class="chip chip-flag">CROSS-CHECK</span>
          ${info(`Two independent feeds: the saving/spending ledger's total spending vs the canteen "Smart Buddy/ATM" wallet
          payments. The wallet is ${r.wallet_share_of_canteen_pct ?? '–'}% of all canteen spend (${fmt$(r.all_canteen)}); the
          rest is paid with other cards. Aggregate only — no link between a wallet and any person.`)}</div>
          <div class="cap" style="margin-bottom:4px">Ledger ${fmt$(r.savings_spending)} vs wallet payments ${fmt$(r.wallet_rail)} —
          <b>${r.wallet_vs_savings_pct ?? '–'}% match</b></div>`);
    }

    // POSB Smiley Stamps — wording follows the POSB parent letter; rows = the feed's stampValue > 0.
    const stp = SAV.stamps;
    if (stp?.by_channel?.length) {
        const tot = stp.by_channel.reduce((a, r) => ({ txns: a.txns + r.txns, sgd: a.sgd + r.sgd }), { txns: 0, sgd: 0 });
        pane.insertAdjacentHTML('beforeend', `<div class="cap" style="margin:10px 0 2px"><b>Smiley Stamps</b>
          ${info(`POSB Stamp Savings Programme (parent letter): a child taps Smart Buddy to buy digital Smiley Stamps at S$0.50
          each; a full card of 20 in a month earns a 10% bonus, credited to the child's account by the 10th of the next month.
          Terms may have changed since. Counted from the feed's own stampValue field. Most are paid from the wallet with no
          card ID, so completed cards per child can't be counted.`)}
          <a href="https://isomer-user-content.by.gov.sg/698/c036a9d2-0410-4b8d-9329-f4bb60d78da4/07_POSB_Smart_Buddy.pdf"
          target="_blank" rel="noopener">source</a></div>
          <div class="cap" style="margin-bottom:4px">Savings, not purchases · ${fmt(tot.txns)} buys · $${tot.sgd.toFixed(2)}
          (≈${fmt(Math.round(tot.sgd / 0.5))} stamps)</div>
          <table class="mini"><tr><th>Sold at</th><th style="text-align:right">Points</th>
            <th style="text-align:right">Txns</th><th style="text-align:right">Value</th></tr>
            ${stp.by_channel.map((r) => `<tr><td>${r.channel}</td><td class="num">${fmt(r.points)}</td>
              <td class="num">${fmt(r.txns)}</td><td class="num">$${r.sgd.toFixed(2)}</td></tr>`).join('')}</table>
          <div class="cap" style="margin-top:4px">Points = distinct store IDs ${info(`"Self Serve Stamps" is the feed's own name
          for vendor ID SSSTM; each point is filed under a school's name, and March receipts show they sell only Smiley Stamps.`)}</div>`);
        heading('Stamp value per day (S$)');
        const sd = stp.daily || [];
        charts.push(mk(canvas(150), { type: 'bar',
            data: { labels: sd.map((r) => r.date.slice(5, 10)), datasets: [{ ...bar(C.violet), data: sd.map((r) => r.sgd) }] },
            options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
    }

    heading('Saving per student (S$ this month)', 'Number of students in each $10 band; $200+ is grouped.');
    const sh = SAV.saving_hist || [];
    charts.push(mk(canvas(), { type: 'bar',
        data: { labels: histLabels(sh), datasets: [{ ...bar(C.aqua), data: sh.map((r) => r.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));

    heading('Spending per student (S$ this month)');
    const ph = SAV.spending_hist || [];
    charts.push(mk(canvas(), { type: 'bar',
        data: { labels: histLabels(ph), datasets: [{ ...bar(C.blue), data: ph.map((r) => r.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));

    heading('Saving rate', 'Saved ÷ (saved + spent), per student.');
    const rh = SAV.rate_hist || [];
    charts.push(mk(canvas(160), { type: 'bar',
        data: { labels: rh.map((r) => Math.round(r.rate * 100) + '%'), datasets: [{ ...bar(C.violet), data: rh.map((r) => r.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
}
