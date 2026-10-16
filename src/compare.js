// Compare: pin up to 4 schools, stalls OR terminals (one type per set) to a slim tray over the map; "Compare ▸" opens
// the comparison in the drawer, one topic at a time (Spend / Errors / Speed / Network / Food). The topic and the map's
// "Colour by" follow each other, so the map and the charts tell one story. Graphs first (a bar chart per measure, lines
// over time, 100% bars for shares); the exact numbers sit behind "Show numbers". An item keeps one colour + letter
// everywhere (chip, chart, table column, map badge).
import { openWindow, closeView, esc } from './windowing.js';
import { mk, opts, ax, line, CAT_COLOR, C } from './charts.js';

const MAX = 4;
const COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7'];   // Okabe-Ito; validated — letters + table carry identity too
const LETTERS = 'ABCD';
const slots = Array(MAX).fill(null);                            // fixed slots → a pin keeps its letter
let kind = null;
let topic = null;
let getData = () => ({ schools: {}, stalls: { stalls: [], terminals: [] }, mode: 'level' });
export const setCompareData = (fn) => { getData = fn; };

const fmt = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString('en-SG', { minimumFractionDigits: d, maximumFractionDigits: d });
const F = { $: (v) => v == null ? '–' : '$' + fmt(v, 2), $0: (v) => v == null ? '–' : '$' + fmt(v), n: (v) => fmt(v),
    pct: (v) => v == null ? '–' : `${fmt(v, 1)}%`, s: (v) => v == null ? '–' : `${(v / 1000).toFixed(1)}s`, t: (v) => esc(v ?? '–') };
const CATS = ['Drinks', 'Snacks & Desserts', 'Cooked Food', 'Mixed', 'Bookshop & Supplies', 'Unclassified'];
const BAND_RAMP = ['#7fb3db', '#4a8cc4', '#1f5f9e', '#0b2f5c'];   // ordered price bands: one hue, light → dark (validated)
const wk = (arr, key, k = 1) => [...(arr || [])].sort((a, b) => a.week.localeCompare(b.week)).map((w) => [w.week.slice(5, 10), w[key] == null ? null : w[key] / k]);
const days = (arr, k = 1) => (arr || []).map((v, i) => [i + 1, v == null ? null : v / k]);
// Error rate of a stall's machines, weighted by their transactions.
const stallErr = (st, D) => { const t = D.stalls.terminals.filter((x) => st.terms.includes(x.id));
    const n = t.reduce((a, x) => a + x.n, 0); return n ? +(t.reduce((a, x) => a + x.err_pct * x.n, 0) / n).toFixed(1) : null; };

const TOPIC = { spend: 'Spend', errors: 'Errors', speed: 'Speed', network: 'Network', food: 'Food & menu' };
// Rows: g = topic, l = label, v = value, f = format, b = better (1 higher, -1 lower, 0 neither), card = on the tray card,
// text = words (facts table, not a chart), max = fixed axis end, stack = charted together as a 100% bar (see stacks).
// stacks: part-to-whole per item. trends: over time, one line per item. note: what a topic can't show, and why.
const KINDS = {
    school: {
        label: 'schools', id: (s) => s.id, name: (s) => s.name || s.id, sid: (s) => s.id,
        find: (D, id) => (Object.hasOwn(D.schools, id) ? D.schools[id] : null),
        open: (s) => window.SB.openSchool(s.id), topics: ['spend', 'errors', 'speed', 'network', 'food'],
        rows: [
            { g: 'spend', l: 'Spend per card per day', v: (s) => s.spend_day, f: F.$, b: 1, card: 1 },
            { g: 'spend', l: 'Revenue', v: (s) => s.sgd, f: F.$0, b: 1 },
            { g: 'spend', l: 'Avg ticket', v: (s) => s.avg_ticket, f: F.$, b: 0 },
            { g: 'spend', l: 'Transactions', v: (s) => s.n, f: F.n, b: 1 },
            { g: 'spend', l: 'Cards', v: (s) => s.cards, f: F.n, b: 0 },
            { g: 'errors', l: 'Error rate', v: (s) => s.err_pct, f: F.pct, b: -1, card: 1 },
            { g: 'errors', l: 'Offline share', v: (s) => s.offline_pct, f: F.pct, b: -1 },
            { g: 'speed', l: 'Median transaction time', v: (s) => s.med_ms, f: F.s, b: -1, card: 1 },
            { g: 'speed', l: 'Slowest 5% (p95)', v: (s) => s.p95_ms, f: F.s, b: -1 },
            { g: 'network', l: 'Signal (0–31)', v: (s) => s.med_sig, f: F.n, b: 1, max: 31 },
            { g: 'network', l: 'Terminals', v: (s) => s.terminals, f: F.n, b: 0 },
            { g: 'network', l: 'Wi-Fi terminals', v: (s) => s.wifi_terms, f: F.n, b: 0 },
            { g: 'food', l: 'Stalls', v: (s) => s.stores, f: F.n, b: 0 },
            ...CATS.map((c) => ({ g: 'food', l: `${c} share`, stack: 'mix', f: F.pct, b: 0,
                v: (s) => s.mix?.[c] == null ? null : +(s.mix[c] * 100).toFixed(1) })),
        ],
        stacks: [{ g: 'food', id: 'mix', t: 'Transactions by stall category (%)', parts: () => CATS,
            colors: () => CATS.map((c) => CAT_COLOR[c] || C.muted), v: (s) => CATS.map((c) => (s.mix?.[c] ?? 0) * 100) }],
        trends: [{ g: 'spend', t: 'Weekly revenue ($)', p: (s) => wk(s.wk_spend, 'sgd') },
                 { g: 'speed', t: 'Weekly median transaction time (s)', p: (s) => wk(s.wk_speed, 'med_ms', 1000) }],
        note: { errors: 'Errors over time exist per terminal, not per school — compare terminals for daily error lines.' },
    },
    stall: {
        label: 'stalls', id: (s) => s.id, name: (s) => s.name, sid: (s) => s.school,
        find: (D, id) => D.stalls.stalls.find((s) => s.id === id),
        open: (s) => window.SB.openStall(s.id), topics: ['spend', 'errors', 'food'],
        rows: [
            { g: 'spend', l: 'Revenue', v: (s) => s.rev, f: F.$0, b: 1, card: 1 },
            { g: 'spend', l: 'Transactions', v: (s) => s.n, f: F.n, b: 1, card: 1 },
            { g: 'spend', l: 'Avg ticket', v: (s) => s.ticket, f: F.$, b: 0, card: 1 },
            { g: 'errors', l: 'Error rate (its machines)', v: stallErr, f: F.pct, b: -1 },
            { g: 'errors', l: 'Machines', v: (s) => s.terms.length, f: F.n, b: 0 },
            { g: 'food', l: 'Category', v: (s) => s.cat, f: F.t, text: 1 },
            { g: 'food', l: 'Most-sold price', v: (s) => s.prices?.[0] ? s.prices[0][0] / 100 : null, f: F.$, b: 0 },
            { g: 'food', l: 'Healthier choice (receipts)', v: (s) => s.receipt?.healthy_sh, f: F.pct, b: 1, max: 100 },
            ...[0, 1, 2, 3].map((i) => ({ g: 'food', l: (D) => `Price ${D.stalls.bands?.[i] || `band ${i + 1}`}`, stack: 'bands',
                v: (s) => s.bands?.[i], f: F.pct, b: 0 })),
        ],
        stacks: [{ g: 'food', id: 'bands', t: 'Transactions by price band (%)', parts: (D) => D.stalls.bands || ['1', '2', '3', '4'],
            colors: () => BAND_RAMP, v: (s) => s.bands || [] }],
        trends: [{ g: 'spend', t: 'Daily revenue ($)', p: (s) => days(s.daily) },
                 { g: 'spend', t: 'Revenue by hour of day ($)', p: (s) => (s.hourly || []).map((v, h) => [`${h + 5}:00`, v]) }],
    },
    terminal: {
        label: 'terminals', id: (t) => t.id, name: (t) => '…' + t.id.slice(-12), sid: (t) => t.school,
        find: (D, id) => D.stalls.terminals.find((t) => t.id === id),
        open: (t) => window.SB.openTerminal(t.id), topics: ['errors', 'speed', 'network', 'spend'],
        rows: [
            { g: 'errors', l: 'Verdict', v: (t) => t.verdict, f: F.t, text: 1 },
            { g: 'errors', l: 'Problems', v: (t) => t.problems?.join(', ') || 'none', f: F.t, text: 1 },
            { g: 'errors', l: 'Error rate', v: (t) => t.err_pct, f: F.pct, b: -1, card: 1 },
            { g: 'errors', l: 'Offline share', v: (t) => t.off_pct, f: F.pct, b: -1 },
            { g: 'speed', l: 'Median transaction time', v: (t) => t.med_ms, f: F.s, b: -1, card: 1 },
            { g: 'speed', l: 'Slowest 5% (p95)', v: (t) => t.p95_ms, f: F.s, b: -1 },
            { g: 'network', l: 'Network', v: (t) => t.net, f: F.t, text: 1 },
            { g: 'network', l: 'Signal (0–31)', v: (t) => t.sig, f: F.n, b: 1, card: 1, max: 31 },
            { g: 'spend', l: 'Transactions', v: (t) => t.n, f: F.n, b: 1 },
            { g: 'spend', l: 'Stall', v: (t) => t.storeName || t.store, f: F.t, text: 1 },
        ],
        trends: [{ g: 'errors', t: 'Daily error rate (%)', p: (t) => days(t.daily_err) },
                 { g: 'speed', t: 'Daily median transaction time (s)', p: (t) => days(t.daily_ms, 1000) }],
    },
};

const pinned = () => slots.map((it, i) => it && { it, i, L: LETTERS[i], c: COLORS[i] }).filter(Boolean);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// best / worst slot for a row (null when it has no direction or the values tie)
function rank(row, vals) {
    const v = vals.map((x, i) => [x, i]).filter(([x]) => isNum(x));
    if (!row.b || v.length < 2) return {};
    v.sort((a, b) => (a[0] - b[0]) * row.b);
    return v[0][0] === v.at(-1)[0] ? {} : { best: v.at(-1)[1], worst: v[0][1] };
}

/* ---------- pin / unpin ---------- */
export function toggle(k, item) {
    const K = KINDS[k];
    const at = kind === k ? slots.findIndex((x) => x && K.id(x) === K.id(item)) : -1;
    if (at >= 0) { slots[at] = null; return changed(); }
    const n = pinned().length;
    if (n && kind !== k) {
        if (!confirm(`Start a new comparison of ${K.label}? This clears the ${n} pinned ${KINDS[kind].label}.`)) return;
        slots.fill(null);
    }
    const free = slots.indexOf(null);
    if (free < 0) return say(`Compare holds ${MAX} — remove one first.`);
    kind = k; slots[free] = item; changed();
}
export function clearCompare() { slots.fill(null); changed(); }
export const pinnedKind = () => kind;
export const isPinned = (k, id) => kind === k && slots.some((x) => x && KINDS[k].id(x) === id);
// The pins as a URL value, `school:RVPS,,MGSP` (empty = a free slot, so letters survive), and back from one.
// The value comes from a link → only ids found in the loaded month's data are pinned; unknown ones are dropped.
export const pinsParam = () => kind ? `${kind}:${slots.map((x) => x ? KINDS[kind].id(x) : '').join(',').replace(/,+$/, '')}` : '';
export function restorePins(param) {
    const [, k, ids] = /^(\w+):(.*)$/.exec(param) || [];
    if (!Object.hasOwn(KINDS, k)) return 0;
    const D = getData();
    slots.fill(null);
    ids.split(',').slice(0, MAX).forEach((id, i, all) => { slots[i] = (id && all.indexOf(id) === i && KINDS[k].find(D, id)) || null; });
    kind = k; changed();
    return pinned().length;
}

// "＋ Compare" toggle in a school / stall / terminal view's header.
export function pinButton(body, k, item) {
    const b = document.createElement('button');
    b.className = 'pin-btn'; b.dataset.pin = `${k}:${KINDS[k].id(item)}`;
    b.title = k === 'school' ? 'Add to comparison — or Shift-click school dots on the map' : 'Add to comparison';
    b.addEventListener('click', () => toggle(k, item));
    body.closest('.tw').querySelector('.tw-head').appendChild(b);
    syncPins();
}
function syncPins() {
    const on = new Map(pinned().map((p) => [`${kind}:${KINDS[kind].id(p.it)}`, p]));
    document.querySelectorAll('[data-pin]').forEach((b) => { const p = on.get(b.dataset.pin);
        b.setAttribute('aria-pressed', !!p); b.textContent = p ? `✓ Comparing ${p.L}` : '＋ Compare';
        b.style.setProperty('--c', p?.c || ''); });
}

// Where a pin sits on the map: a PBS / stamp shop (or its machine) at its own square / diamond (`at`), else its school's dot.
function place(it, D) {
    const st = kind === 'stall' ? it : kind === 'terminal' ? D.stalls.stalls.find((s) => s.id === it.store) : null;
    if (st?.at) return { shop: st.id, pt: st.at.slice(0, 2) };
    const s = D.schools[KINDS[kind].sid(it)];
    return { pt: s?.lat != null ? [s.lat, s.lng] : null };
}

function changed() {
    if (!pinned().length) kind = null;
    renderCards(); syncPins();
    const body = document.querySelector('[data-win="compare"] .tw-body');
    if (body) { if (pinned().length < 2 || body.dataset.kind !== kind) closeView('compare'); else renderDetail(body); }
    // map (main.js): a letter + ring on each pin's marker, and zoom to fit them
    const D = getData();
    dispatchEvent(new CustomEvent('compare', { detail: pinned().map((p) => ({ sid: KINDS[kind].sid(p.it), ...place(p.it, D), L: p.L, c: p.c })) }));
}

/* ---------- slim tray over the map; each pin's card peeks on hover / focus ---------- */
const row = document.getElementById('compare-row');
function spark(pts, c) {
    const v = pts.map((p) => p[1]).filter(isNum);
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), W = 180, H = 26;
    const xy = v.map((y, i) => `${(i * W / (v.length - 1)).toFixed(1)},${(H - 2 - (hi > lo ? (y - lo) / (hi - lo) : 0.5) * (H - 4)).toFixed(1)}`);
    return `<svg class="cmp-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${xy.join(' ')}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderCards() {
    const P = pinned();
    if (!P.length) { row.innerHTML = ''; return; }
    const K = KINDS[kind], D = getData(), cardRows = K.rows.filter((r) => r.card);
    const ranks = cardRows.map((r) => rank(r, P.map((p) => r.v(p.it, D))));
    row.innerHTML = `<div class="cmp-tray"><span class="cmp-t">Compare</span>${P.map((p, k) => `
      <span class="cmp-pin" style="--c:${p.c}">
        <button class="cmp-chip" data-slot="${p.i}" data-sid="${esc(K.sid(p.it))}" title="Open ${esc(K.name(p.it))}">
          <span class="cmp-l">${p.L}</span><span class="cmp-n">${esc(K.name(p.it))}</span></button>
        <div class="cmp-card" data-slot="${p.i}" data-sid="${esc(K.sid(p.it))}">
          <div class="cmp-h"><span class="cmp-l">${p.L}</span><b>${esc(K.name(p.it))}</b>
            <button class="cmp-x" data-x="${p.i}" aria-label="Remove ${esc(K.name(p.it))} from compare">✕</button></div>
          <div class="cmp-m">${cardRows.map((r, j) => `<span>${r.l}</span>
            <span class="${ranks[j].best === k ? 'pill-good' : ranks[j].worst === k ? 'pill-bad' : ''}">${r.f(r.v(p.it, D))}</span>`).join('')}</div>
          ${spark(K.trends[0].p(p.it), p.c)}<div class="cmp-cap">${K.trends[0].t}</div>
        </div>
      </span>`).join('')}
      ${P.length < 2 ? `<span class="cmp-hint">Pin 1 more to compare${kind === 'school' ? ' — or Shift-click a dot' : ''}</span>`
          : `<button class="cmp-go">Compare ${P.length} ▸</button>`}
      <button class="cmp-clear" title="Clear comparison" aria-label="Clear comparison">✕</button>
      <span class="cmp-msg" role="status"></span></div>`;
}
function say(msg) {
    const m = row.querySelector('.cmp-msg');
    if (m) { m.textContent = msg; setTimeout(() => { m.textContent = ''; }, 3500); }
}
row.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]'), card = e.target.closest('[data-slot]');
    if (x) { slots[+x.dataset.x] = null; changed(); }
    else if (e.target.closest('.cmp-go')) openDetail();
    else if (e.target.closest('.cmp-clear')) clearCompare();
    else if (card) KINDS[kind].open(slots[+card.dataset.slot]);
});

/* ---------- comparison in the drawer: one topic, graphs first ---------- */
let charts = [];
const kill = () => { charts.forEach((c) => c.destroy()); charts = []; };
const modeFor = (t) => (t === 'errors' || t === 'speed' ? t : 'level');   // map "Colour by" for a topic

// Map → comparison (main.js setColorMode): Errors/Speed pick that topic; Level leaves a non-error/speed topic alone.
export function followMap(mode) {
    const K = KINDS[kind];
    if (!K) return;
    const next = mode !== 'level' && K.topics.includes(mode) ? mode
        : mode === 'level' && (topic === 'errors' || topic === 'speed') ? K.topics.find((t) => modeFor(t) === 'level') : topic;
    if (next === topic) return;
    topic = next;
    const body = document.querySelector('[data-win="compare"] .tw-body');
    if (body) renderDetail(body);
}
// Comparison → map: main.js recolours the map (and calls followMap, which is then a no-op).
const tellMap = () => dispatchEvent(new CustomEvent('compare-topic', { detail: modeFor(topic) }));

export function openDetail() {
    const K = KINDS[kind];
    if (!K || pinned().length < 2) return;
    const body = openWindow({ id: 'compare', title: `Compare ${K.label}`, chips: [], wide: true, onClose: kill });
    if (!body) return;                // already open → brought back on top as it was (same topic)
    const mode = getData().mode;
    topic = mode !== 'level' && K.topics.includes(mode) ? mode : K.topics[0];
    renderDetail(body);
    tellMap();
}

// Value at the end of each bar (text ink, not the series colour), so no value hides in a tooltip.
const endLabels = (text) => ({ id: 'endLabels', afterDatasetsDraw(ch) {
    const { ctx } = ch;
    ctx.save(); ctx.font = '600 11px system-ui, -apple-system, sans-serif'; ctx.fillStyle = '#1d1d1f'; ctx.textBaseline = 'middle';
    ch.getDatasetMeta(0).data.forEach((b, i) => ctx.fillText(text(i), (Number.isFinite(b.x) ? b.x : ch.scales.x.left) + 6, b.y));
    ctx.restore();
} });
const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

function renderDetail(body) {
    kill();
    body.dataset.kind = kind;
    const K = KINDS[kind], D = getData(), P = pinned();
    if (!K.topics.includes(topic)) topic = K.topics[0];
    const label = (r) => typeof r.l === 'function' ? r.l(D) : r.l;
    const rows = K.rows.filter((r) => r.g === topic && P.some((p) => r.v(p.it, D) != null));
    const bars = rows.filter((r) => !r.text && !r.stack);
    const facts = rows.filter((r) => r.text);
    const stacks = (K.stacks || []).filter((s) => s.g === topic);
    const trends = K.trends.filter((t) => t.g === topic);
    const short = (p) => { const n = K.name(p.it); return n.length > 22 ? n.slice(0, 21) + '…' : n; };
    const head = (cls = '') => `<tr><th></th>${P.map((p) => `<th class="cmp-col ${cls}" style="--c:${p.c}"><span class="cmp-l">${p.L}</span>
      <a href="#" data-open="${p.i}">${esc(K.name(p.it))}</a></th>`).join('')}</tr>`;
    const cell = (r, j, vals, rk) => `<td class="num"><span class="${rk.best === j ? 'pill-good' : rk.worst === j ? 'pill-bad' : ''}">${r.f(vals[j])}</span></td>`;
    const tableRows = (list) => list.map((r) => { const vals = P.map((p) => r.v(p.it, D)), rk = rank(r, vals);
        return `<tr><td>${label(r)}</td>${P.map((_, j) => cell(r, j, vals, rk)).join('')}</tr>`; }).join('');
    const barH = P.length * 30 + 30;

    body.innerHTML = `
      <div class="tabs cmp-topics" role="tablist" aria-label="Topic">${K.topics.map((t) => `<button role="tab" data-t="${t}"
        aria-selected="${t === topic}" tabindex="${t === topic ? 0 : -1}" class="${t === topic ? 'on' : ''}">${TOPIC[t]}</button>`).join('')}</div>
      <div class="cap">${modeFor(topic) === 'level' ? 'Map coloured by school level.' : `The map is coloured by ${TOPIC[topic].toLowerCase()} too.`}</div>
      <div class="cmp-keys">${P.map((p) => `<span class="cmp-key" style="--c:${p.c}"><span class="cmp-l">${p.L}</span>${esc(K.name(p.it))}</span>`).join('')}</div>
      ${facts.length ? `<table class="mini cmp cmp-facts">${head()}${facts.map((r) => `<tr><td>${label(r)}</td>${P.map((p) => `<td class="num">${r.f(r.v(p.it, D))}</td>`).join('')}</tr>`).join('')}</table>` : ''}
      ${bars.length ? `<div class="cmp-grid">${bars.map((r, i) => `<div><h5>${label(r)}</h5>
        <div class="cmp-chart" style="height:${barH}px"><canvas data-bar="${i}" aria-label="${esc(label(r))} by item"></canvas></div></div>`).join('')}</div>` : ''}
      ${stacks.map((s, i) => `<h5>${s.t}</h5><div class="cmp-chart" style="height:${P.length * 30 + 64}px">
        <canvas data-stack="${i}" aria-label="${esc(s.t)}"></canvas></div>`).join('')}
      ${trends.map((t, i) => `<h5>${t.t}</h5><div class="cwrap"><canvas data-trend="${i}" aria-label="${esc(t.t)}"></canvas></div>`).join('')}
      ${K.note?.[topic] ? `<div class="cap" style="margin-top:8px">${K.note[topic]}</div>` : ''}
      <details class="cmp-numbers"><summary>Show numbers</summary>
        <table class="mini cmp"><thead>${head()}</thead><tbody>${tableRows(rows)}</tbody></table></details>`;

    // one bar chart per measure (comparing size): an item per bar in its colour, value at the bar end
    body.querySelectorAll('[data-bar]').forEach((cv) => {
        const r = bars[+cv.dataset.bar], vals = P.map((p) => r.v(p.it, D));
        charts.push(mk(cv, { type: 'bar',
            data: { labels: P.map((p) => `${p.L}  ${short(p)}`), datasets: [{ data: vals, backgroundColor: P.map((p) => p.c),
                borderRadius: 4, borderSkipped: 'start', categoryPercentage: 0.78, barPercentage: 1, maxBarThickness: 20 }] },
            options: { ...opts({ tooltip: { callbacks: { label: (c) => plain(r.f(c.raw)) } },
                scales: { x: ax({ beginAtZero: true, max: r.max, ticks: { maxTicksLimit: 4, callback: (v) => plain(r.f(v)) } }),
                          y: ax({ grid: { display: false } }) } }), indexAxis: 'y', layout: { padding: { right: 52 } } },
            plugins: [endLabels((i) => plain(r.f(vals[i])))] }));
    });
    // part-to-whole: a 100% bar per item, segments = categories / ordered price bands, 2px surface gap between them
    body.querySelectorAll('[data-stack]').forEach((cv) => {
        const s = stacks[+cv.dataset.stack], parts = s.parts(D), colors = s.colors(D);
        charts.push(mk(cv, { type: 'bar',
            data: { labels: P.map((p) => `${p.L}  ${short(p)}`), datasets: parts.map((part, j) => ({ label: part,
                data: P.map((p) => s.v(p.it)[j] ?? 0), backgroundColor: colors[j], borderColor: '#fff',
                borderWidth: { right: 2 }, borderSkipped: false, categoryPercentage: 0.78, barPercentage: 1, maxBarThickness: 20 })) },
            options: { ...opts({ legend: true, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw, 1)}%` } },
                scales: { x: ax({ stacked: true, max: 100, ticks: { maxTicksLimit: 5, callback: (v) => `${v}%` } }),
                          y: ax({ stacked: true, grid: { display: false } }) } }), indexAxis: 'y' } }));
    });
    // over time: one line per item in its colour
    body.querySelectorAll('[data-trend]').forEach((cv) => {
        const T = trends[+cv.dataset.trend], series = P.map((p) => new Map(T.p(p.it)));
        const labels = [...new Set(series.flatMap((m) => [...m.keys()]))]
            .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        charts.push(mk(cv, { type: 'line', data: { labels, datasets: P.map((p, j) => ({ label: `${p.L} ${K.name(p.it)}`,
            data: labels.map((l) => series[j].get(l) ?? null), spanGaps: true, ...line(p.c) })) },
            options: opts({ legend: true, indexMode: true, scales: { x: ax(), y: ax({ beginAtZero: true }) } }) }));
    });
    const pick = (t, focus) => { if (t === topic) return; topic = t; renderDetail(body); tellMap();
        if (focus) body.querySelector('.cmp-topics .on').focus(); };
    body.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.t)));
    body.querySelector('.cmp-topics').addEventListener('keydown', (e) => {    // tabs pattern: arrows move, Home / End jump
        const T = K.topics, at = T.indexOf(topic);
        const n = { ArrowRight: (at + 1) % T.length, ArrowLeft: (at - 1 + T.length) % T.length, Home: 0, End: T.length - 1 }[e.key];
        if (n === undefined) return;
        e.preventDefault(); pick(T[n], true);
    });
    body.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); K.open(slots[+a.dataset.open]); }));
}
