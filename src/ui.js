// The shared pieces every view builds from (central-specs capability dashboard-views, design D1): KPI cards,
// a section with its takeaway, a chart block (charts.js adds its "Numbers" table), a table card that scrolls
// with its first column kept in view, a topic switch, chips and an empty note; plus the frame's icons.
// They return HTML strings like the views always have. Text from the data is escaped by the caller (esc).
import { info } from './windowing.js';

// 24-px line icons (stroke = currentColor); class .ic in base.css.
const ICONS = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    schools: '<path d="M2.5 9.5 12 4.5l9.5 5-9.5 5Z"/><path d="M6.5 11.6v4.4c0 1.6 2.5 3.2 5.5 3.2s5.5-1.6 5.5-3.2v-4.4M21.5 9.5v5"/>',
    eng: '<rect x="5.5" y="2.5" width="13" height="19" rx="2.5"/><rect x="8.5" y="5.5" width="7" height="5" rx="1"/><path d="M9 14h.01M12 14h.01M15 14h.01M9 17.5h.01M12 17.5h.01M15 17.5h.01"/>',
    subsidy: '<path d="M3 7.5h18v3.2a2 2 0 0 0 0 3.6v3.2H3v-3.2a2 2 0 0 0 0-3.6Z"/><path d="M9.5 9.5v1M9.5 13v1"/>',
    items: '<path d="M4 9.5h16l-1.6 9.8a1.6 1.6 0 0 1-1.6 1.2H7.2a1.6 1.6 0 0 1-1.6-1.2Z"/><path d="m8.5 9.5 3.5-5.5 3.5 5.5M10 13.5v3.5M14 13.5v3.5"/>',
    savings: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
    feb: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="m9 6 .6-3.5h4.8L15 6M9 18l.6 3.5h4.8L15 18M12 9.5V12l1.6 1.6"/>',
    playback: '<circle cx="12" cy="12" r="9"/><path d="m10 8.6 5.2 3.4-5.2 3.4Z"/>',
    map: '<path d="m9 4-6 2.4v13.6l6-2.4 6 2.4 6-2.4V4l-6 2.4Z"/><path d="M9 4v13.6M15 6.4V20"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    ask: '<path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7.5a3 3 0 0 1-3 3h-6.8L6 20.5v-4H7a3 3 0 0 1-3-3Z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    back: '<path d="m14.5 18-6-6 6-6"/>',
    layers: '<path d="m12 3.5 9 5-9 5-9-5Z"/><path d="m3 13.5 9 5 9-5"/>',
    expand: '<path d="M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5 14 10M3.5 20.5 10 14"/>',
    send: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>',
    keys: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
    tours: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1Z"/>',
    signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    mark: '<path d="M8.5 2.5h7l1 4.5v10l-1 4.5h-7l-1-4.5V7Z"/><circle cx="12" cy="12" r="2.6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    healthy: '<circle cx="12" cy="12" r="9"/><path d="m8 12.4 3 3 5.2-6"/>',
    attention: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.4h.01"/>',
    fault: '<path d="M12 3.5 2.5 20.5h19Z"/><path d="M12 10v4.5M12 17.4h.01"/>',
    site: '<path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9.2 16.4a4 4 0 0 1 5.6 0M12 19.5h.01"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18h6a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
};
export const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

// Numbers: tabular figures come from the CSS; these fix the units the views share.
export const fmt = (n, d = 0) => n == null || !Number.isFinite(+n) ? '–'
    : Number(n).toLocaleString('en-SG', { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = (v) => v == null || !Number.isFinite(+v) ? '–'
    : Math.abs(v) >= 1e6 ? `S$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `S$${(v / 1e3).toFixed(1)}k`
    : Math.abs(v) >= 100 ? `S$${fmt(v)}` : `S$${fmt(v, 2)}`;
export const big = (v) => v == null || !Number.isFinite(+v) ? '–'
    : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : fmt(v);
export const pct = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : `${(+v).toFixed(d)}%`;
export const secs = (ms) => ms == null || !Number.isFinite(+ms) ? '–' : `${(ms / 1000).toFixed(1)} s`;

// Up to four KPI cards: [{ l: label, v: value (HTML), s: small line, tone: 'warn' | 'bad' }]. Falsy items are skipped.
export const kpis = (items) => `<div class="kpis">${items.filter(Boolean).slice(0, 4).map((k) =>
    `<div class="kpi${k.tone ? ' ' + k.tone : ''}"><div class="l">${k.l}</div><div class="v">${k.v}</div>${k.s ? `<div class="s">${k.s}</div>` : ''}</div>`).join('')}</div>`;
// The figures that did not make the four cards, folded.
export const moreKpis = (items, label = 'More numbers') => items.filter(Boolean).length
    ? `<details class="more-stats"><summary>${label}</summary><div class="kpis">${items.filter(Boolean).map((k) =>
        `<div class="kpi"><div class="l">${k.l}</div><div class="v">${k.v}</div>${k.s ? `<div class="s">${k.s}</div>` : ''}</div>`).join('')}</div></details>` : '';

// A section: title (+ ⓘ), a one-line takeaway, then its body (a chart, a table or a note).
export const section = ({ title, take = '', tip = '', body = '', acts = '', id = '' }) =>
    `<section class="sec"${id ? ` data-sec="${id}"` : ''}><div class="sec-h"><h2>${title}${tip ? ' ' + info(tip) : ''}</h2>${acts ? `<div class="acts">${acts}</div>` : ''}</div>${take ? `<p class="take">${take}</p>` : ''}${body}</section>`;

// A chart's slot. Height in px (else the frame's --chart-h); charts.js mk() adds "Numbers" under it.
export const chart = ({ h, tall = false } = {}) => `<div class="cwrap${tall ? ' tall' : ''}"${h ? ` style="--h:${h}px"` : ''}><canvas></canvas></div>`;

// A table in its card: scrolls sideways inside the card, first column sticky (views.css).
export const tableCard = (head, rows, cls = '') => `<div class="tbl-card"><table class="mini${cls ? ' ' + cls : ''}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;

export const emptyNote = (text) => `<div class="empty-note">${text}</div>`;
export const chip = (text, cls = '') => `<span class="chip${cls ? ' ' + cls : ''}">${text}</span>`;

// A view's topic switch: [[key, label]] → buttons with role=tab; panes are [data-pane="key"] (wireTabs).
export const tabs = (list, cur = list[0]?.[0]) => `<div class="tabs" role="tablist">${list.map(([k, t]) =>
    `<button role="tab" data-tab="${k}" aria-selected="${k === cur}" tabindex="${k === cur ? 0 : -1}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
export const panes = (list, cur = list[0]?.[0]) => list.map(([k]) => `<div data-pane="${k}"${k === cur ? '' : ' hidden'}></div>`).join('');

// Wires a view's topic switch: click, ← → / Home / End (tabs pattern). Returns pick(key) for presets.
export function wireTabs(root, onChange) {
    const bar = root.querySelector('.tabs');
    if (!bar) return () => {};
    const btns = [...bar.querySelectorAll('[data-tab]')];
    const pick = (b, focus = false) => {
        if (!b) return;
        btns.forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
        root.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
        if (focus) b.focus();
        b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        onChange?.(b.dataset.tab);
    };
    btns.forEach((b) => b.addEventListener('click', () => pick(b)));
    bar.addEventListener('keydown', (e) => {
        const at = btns.findIndex((b) => b.classList.contains('on'));
        const n = { ArrowRight: (at + 1) % btns.length, ArrowLeft: (at - 1 + btns.length) % btns.length, Home: 0, End: btns.length - 1 }[e.key];
        if (n === undefined) return;
        e.preventDefault(); pick(btns[n], true);
    });
    return (key) => pick(btns.find((b) => b.dataset.tab === key));
}

// A row of filter chips: [[value, label]] → buttons with aria-pressed; onPick(value). Labels can come from the
// feed (segment names, categories), so they go in as text, never as markup.
export function chipBar(label, list, cur, onPick) {
    const div = document.createElement('div');
    div.className = 'fbar';
    const fl = document.createElement('span');
    fl.className = 'fl'; fl.textContent = label;
    div.append(fl, ...list.map(([v, t]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.v = v; b.textContent = t;
        b.className = v === cur ? 'on' : ''; b.setAttribute('aria-pressed', v === cur);
        return b;
    }));
    div.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        div.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
        onPick(b.dataset.v);
    });
    return div;
}
