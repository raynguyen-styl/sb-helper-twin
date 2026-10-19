// Saving vs Spending — how much students saved against what they spent, from the monthly per-student saving and
// spending totals, the wallet ↔ ledger cross-check, and POSB Smiley Stamps. Reads the precomputed `savings` bundle.
// Shared anatomy (central-specs capability dashboard-views).
import { openWindow, info, esc } from './windowing.js';
import { mk, opts, ax, bar, C } from './charts.js';
import { kpis, moreKpis, section, chart, tableCard, emptyNote, fmt, money } from './ui.js';

let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };
const histLabels = (rows) => rows.map((r) => `S$${r.lo}${r.lo >= 200 ? '+' : ''}`);
const modeOf = (rows) => rows.length ? rows.reduce((a, r) => (r.n > a.n ? r : a)) : null;
const band = (r) => (r.lo >= 200 ? 'S$200 or more' : `S$${r.lo}–${r.lo + 10}`);

export function openSavings(SAV) {
    const body = openWindow({ id: 'savings', title: 'Saving vs Spending', sub: 'Per-student monthly saving and spending', chips: [], onClose: kill, wide: true });
    if (!body) return;
    if (!SAV || !SAV.totals) {
        body.innerHTML = emptyNote('No saving and spending data for this month: the store holds no <b>savings</b> bundle for it.');
        return;
    }
    const t = SAV.totals;
    const rate = t.saving + t.spending ? Math.round((100 * t.saving) / (t.saving + t.spending)) : null;
    const r = SAV.reconcile, stp = SAV.stamps;
    const sh = SAV.saving_hist || [], ph = SAV.spending_hist || [], rh = SAV.rate_hist || [];
    const stTot = stp?.by_channel?.length ? stp.by_channel.reduce((a, x) => ({ txns: a.txns + x.txns, sgd: a.sgd + x.sgd }), { txns: 0, sgd: 0 }) : null;
    const ms = modeOf(sh), mp = modeOf(ph);
    body.innerHTML = `
      ${kpis([{ l: 'Students', v: fmt(t.students) }, { l: 'Saved', v: money(t.saving) }, { l: 'Spent', v: money(t.spending) },
          { l: 'Saving rate', v: rate == null ? '–' : `${rate}%`, s: 'saved ÷ (saved + spent)' }])}
      ${moreKpis([{ l: 'Average saved per student', v: t.avg_saving == null ? '–' : money(t.avg_saving) }])}
      ${r ? section({ title: 'Do the feeds agree? Wallet and ledger', id: 'reconcile',
          take: `The ledger's spending (${money(r.savings_spending)}) and the wallet's canteen payments (${money(r.wallet_rail)}) match to <b>${r.wallet_vs_savings_pct ?? '–'}%</b>.`,
          tip: `Two independent feeds: the saving/spending ledger's total spending against the canteen "Smart Buddy/ATM" wallet payments. The wallet is ${r.wallet_share_of_canteen_pct ?? '–'}% of all canteen spend (${money(r.all_canteen)}); the rest is paid with other cards. Aggregate only — no link between a wallet and any person.`,
          body: '' }) : ''}
      ${stTot ? section({ title: 'Smiley Stamps', id: 'stamps',
          take: `Savings, not purchases: ${fmt(stTot.txns)} buys, ${money(stTot.sgd)} (about ${fmt(Math.round(stTot.sgd / 0.5))} stamps).
            <a href="https://isomer-user-content.by.gov.sg/698/c036a9d2-0410-4b8d-9329-f4bb60d78da4/07_POSB_Smart_Buddy.pdf" target="_blank" rel="noopener">POSB letter</a>`,
          tip: `POSB Stamp Savings Programme (parent letter): a child taps Smart Buddy to buy digital Smiley Stamps at S$0.50 each; a full card of 20 in a month earns a 10% bonus, credited to the child's account by the 10th of the next month. Terms may have changed since. Counted from the feed's own stampValue field. Most are paid from the wallet with no card ID, so completed cards per child can't be counted. Points = distinct store IDs; "Self Serve Stamps" is the feed's own name for vendor ID SSSTM.`,
          body: tableCard('<tr><th>Sold at</th><th class="num">Points</th><th class="num">Buys</th><th class="num">Value</th></tr>',
              stp.by_channel.map((x) => `<tr><td>${esc(x.channel)}</td><td class="num">${fmt(x.points)}</td>
                <td class="num">${fmt(x.txns)}</td><td class="num">${money(x.sgd)}</td></tr>`).join('')) + (stp.daily?.length ? chart({ h: 150 }) : '') }) : ''}
      ${section({ title: 'Saving per student', id: 'saving', take: ms ? `Most students saved <b>${band(ms)}</b> this month.` : '',
          tip: 'Number of students in each S$10 band; S$200+ is grouped.', body: sh.length ? chart() : emptyNote('No saving figures in this bundle.') })}
      ${section({ title: 'Spending per student', id: 'spending', take: mp ? `Most students spent <b>${band(mp)}</b> this month.` : '',
          body: ph.length ? chart() : emptyNote('No spending figures in this bundle.') })}
      ${section({ title: 'Saving rate', id: 'rate', take: 'Saved ÷ (saved + spent), per student.', body: rh.length ? chart({ h: 170 }) : emptyNote('No saving rates in this bundle.') })}`;

    const cv = (id) => body.querySelector(`[data-sec="${id}"] canvas`);
    const stc = cv('stamps');
    if (stc) charts.push(mk(stc, { type: 'bar', numbers: { label: 'Day', fmt: (v) => money(v) },
        data: { labels: stp.daily.map((x) => x.date.slice(5, 10)), datasets: [{ ...bar(C.save), label: 'Stamp value', data: stp.daily.map((x) => x.sgd) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true, ticks: { callback: (v) => money(v) } }) } }) }));
    const hist = (id, rows, colour, label, xs) => { const c = cv(id); if (c) charts.push(mk(c, { type: 'bar', numbers: { label, fmt: (v) => fmt(v) },
        data: { labels: xs, datasets: [{ ...bar(colour), label: 'Students', data: rows.map((x) => x.n) }] },
        options: opts({ scales: { x: ax(), y: ax({ beginAtZero: true }) } }) })); };
    hist('saving', sh, C.save, 'Saved', histLabels(sh));
    hist('spending', ph, C.money, 'Spent', histLabels(ph));
    hist('rate', rh, C.aqua, 'Saving rate', rh.map((x) => Math.round(x.rate * 100) + '%'));
}
