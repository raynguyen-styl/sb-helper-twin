// The details drawer (central-specs capability dashboard-shell): one view at a time. Opening a view pushes it;
// earlier views stay underneath, hidden but alive (same tab, scroll and charts), so Back and the breadcrumbs
// return to them. A side panel on wide screens, a card over the map's right part on compact ones (720–1099 px),
// and below 720 px a bottom sheet with a handle and three heights — peek, half and full. `wide` = a wider
// drawer for the dense views. `float` = a centred card over the map. Below 1100 px the chat and the drawer
// replace each other (smartbuddy:chat); each keeps its state.
import { chapterFor } from './tour.js';
import { icon } from './ui.js';

const dock = document.getElementById('dock');
const stage = dock.parentElement;
const views = dock.querySelector('.dock-views');
const bar = dock.querySelector('.dock-bar');
const handle = dock.querySelector('.dock-handle');
const stack = () => [...views.children];
const type = (id) => /^(school|stall|term)-/.exec(id || '')?.[1];
const PHONE = matchMedia('(max-width: 719px)');
const NARROW = matchMedia('(max-width: 1099px)');
// Feed text (school / stall / store names…) is data, never markup: escape it wherever it goes into innerHTML.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The source systems each view draws on (central-specs decision 0004; the same mapping as the Source
// column of backend/redshift/SEEDING.md §1). Keyed by window id, or by its prefix for school/stall/term.
const SOURCES = {
    overview: 'iSchool', schools: 'iSchool', eng: 'iSchool', items: 'iSchool', stalls: 'iSchool', route: 'iSchool',
    school: 'iSchool', stall: 'iSchool', term: 'iSchool',
    savings: 'SMART Buddy · iSchool', feb: 'SMART Buddy', subsidy: 'SSS · iSchool', playback: 'iSchool · SMART Buddy',
};
const sourceOf = (id) => SOURCES[id] || SOURCES[type(id)];
// The selected month, shown above every view's title (main.js sets it when a month loads).
let monthText = '';
export const setViewMonth = (label) => { monthText = label || ''; };

export function openWindow({ id, title, sub, chips = [], onClose, wide = false, float = false }) {
    const existing = document.querySelector(`[data-win="${CSS.escape(id)}"]`);
    if (existing) { if (views.contains(existing)) keep(stack().indexOf(existing) + 1, true); return null; }
    // A school/stall/terminal replaces one of its own kind on top instead of stacking → short breadcrumbs (NN/g: ≤2 levels).
    const top = views.lastElementChild;
    if (!float && type(id) && type(top?.dataset.win) === type(id)) { top.remove(); top._onClose?.(); }

    const win = document.createElement('div');
    win.className = float ? 'tw tw-float' : 'tw';
    win.dataset.win = id;
    if (wide) win.dataset.wide = '';
    win._onClose = onClose;
    const src = sourceOf(id);
    win.innerHTML = `
      <div class="tw-head">
        ${!float && monthText ? `<span class="eyebrow">${esc(monthText)}</span>` : ''}
        <h2 class="t">${esc(title)}</h2>
        ${src ? `<span class="chip" title="Source system">${esc(src)}</span>` : ''}
        ${chips.join('')}
        <span class="acts">${!float && chapterFor(id) ? `<button class="btn tw-tour" data-tour="${chapterFor(id)}" title="A short guided tour of this view">${icon('playback')}Tour</button>` : ''}
          ${float ? `<button class="tw-close icon-btn" aria-label="Close">${icon('close')}</button>` : ''}</span>
        ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}
      </div>
      <div class="tw-body"></div>`;
    if (float) {
        document.getElementById('tw-layer').appendChild(win);
        win.querySelector('.tw-close').addEventListener('click', () => { win.remove(); onClose?.(); });
    } else {
        const was = !!top;
        views.appendChild(win);
        if (!was) snap = 'half';                 // a sheet opens at half
        layout(true);
    }
    return win.querySelector('.tw-body');
}

// Keep the bottom n views, close the rest (top first).
function keep(n, pushed = false) {
    for (const w of stack().slice(n).reverse()) { w.remove(); w._onClose?.(); }
    layout(pushed);
}
// Close one view only (an unpinned comparison, a re-planned route) — views opened on top of it stay.
export const closeView = (id) => {
    const w = views.querySelector(`[data-win="${CSS.escape(id)}"]`);
    if (w) { w.remove(); w._onClose?.(); layout(); }
};
export const closeAll = () => keep(0);
export const openIds = () => stack().map((w) => w.dataset.win);

function layout(pushed = false) {
    const all = stack(), top = all.at(-1);
    all.forEach((w) => w.classList.toggle('under', w !== top));
    dock.classList.toggle('open', !!top);
    dock.classList.toggle('wide', top?.dataset.wide != null);
    const name = (w) => esc(w.querySelector('.tw-head .t').textContent);
    // one view: no breadcrumb (its own heading names it), just ✕
    bar.innerHTML = !top ? '' : `
      ${all.length > 1 ? `<button class="dock-back" title="Back" aria-label="Back">${icon('back')}</button>
      <nav class="crumbs" aria-label="Breadcrumb">${all.map((w, i) => w === top
          ? `<span aria-current="page">${name(w)}</span>`
          : `<button data-i="${i}">${name(w)}</button>`).join('<span class="sep" aria-hidden="true">›</span>')}</nav>` : ''}
      <button class="dock-x" title="Close panel" aria-label="Close panel">${icon('close')}</button>
      ${all.length > 1 && !localStorage.getItem('sb-tip-back') ? `<div class="dock-tip" role="note">Back returns to the
        previous view, with its tab and scroll kept — or press a name to jump. <button class="dock-tip-ok">Got it</button></div>` : ''}`;
    if (top && PHONE.matches) sizeSheet();
    insets(pushed);
}

/* ---------- the phone sheet: three heights, a handle to drag, ↑ ↓ on the handle ---------- */
const SNAPS = { peek: 0.22, half: 0.55, full: 0.92 };
const ORDER = ['peek', 'half', 'full'];
let snap = 'half';
const sheetPx = () => Math.round(stage.clientHeight * SNAPS[snap]);
function sizeSheet() {
    dock.style.setProperty('--sheet-h', `${sheetPx()}px`);
    handle.setAttribute('aria-label', `Resize details (${snap === 'peek' ? 'peek' : snap === 'half' ? 'half height' : 'full height'}) — up or down arrow`);
}
function setSnap(name) {
    if (name === 'close') return closeAll();
    snap = name; sizeSheet(); insets();
}
handle.addEventListener('keydown', (e) => {
    const at = ORDER.indexOf(snap);
    if (e.key === 'ArrowUp') { e.preventDefault(); setSnap(ORDER[Math.min(at + 1, ORDER.length - 1)]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSnap(at === 0 ? 'close' : ORDER[at - 1]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSnap(snap === 'full' ? 'half' : 'full'); }
});
handle.addEventListener('pointerdown', (e) => {
    if (!PHONE.matches || e.button > 0) return;
    e.preventDefault();
    const H = stage.clientHeight, y0 = e.clientY, h0 = dock.getBoundingClientRect().height;
    let h = h0, moved = false;
    handle.setPointerCapture(e.pointerId);
    dock.classList.add('dragging');
    const move = (ev) => {
        if (Math.abs(ev.clientY - y0) > 4) moved = true;
        h = Math.max(0, Math.min(H * SNAPS.full, h0 - (ev.clientY - y0)));
        dock.style.setProperty('--sheet-h', `${Math.round(h)}px`);
    };
    const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        dock.classList.remove('dragging');
        if (!moved) return setSnap(snap === 'full' ? 'half' : 'full');        // a tap: half ↔ full
        const f = h / H;
        if (f < SNAPS.peek - 0.08) return setSnap('close');                   // dragged down past peek
        setSnap(ORDER.reduce((a, b) => (Math.abs(SNAPS[b] - f) < Math.abs(SNAPS[a] - f) ? b : a)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
});

// What the drawer covers — the right edge (wide, compact) or the bottom (the phone sheet) → --dock-r / --dock-b,
// which keep the map's furniture and the chat clear of it, and a 'dock' event main.js uses to pad the map.
function insets(pushed = false) {
    const open = dock.classList.contains('open') && !dock.classList.contains('away');
    let right = 0, bottom = 0;
    if (open && PHONE.matches) bottom = sheetPx();
    else if (open) right = Math.max(0, Math.round(stage.getBoundingClientRect().right - dock.getBoundingClientRect().left));
    stage.style.setProperty('--dock-r', `${right}px`);
    stage.style.setProperty('--dock-b', `${bottom}px`);
    dispatchEvent(new CustomEvent('dock', { detail: { open, pushed, right, bottom, ids: openIds() } }));
}
// Below 1100 px the chat and the drawer replace each other; the drawer keeps its views while away.
let chatOpen = false;
const away = () => { dock.classList.toggle('away', chatOpen && NARROW.matches); insets(); };
document.addEventListener('smartbuddy:chat', (e) => { chatOpen = !!e.detail?.open; away(); });
NARROW.addEventListener('change', away);
PHONE.addEventListener('change', () => { if (PHONE.matches && stack().length) sizeSheet(); else dock.style.removeProperty('--sheet-h'); insets(); });
addEventListener('resize', () => { if (PHONE.matches && stack().length) sizeSheet(); insets(); });

// Esc = Back one view (closes the drawer at the last one) — not while typing, nor when something else owns Esc:
// the menu, the tour, a dialog, search, the More sheet, the phone's Map key or the chat. Capture phase, so it
// decides before their own handlers run.
addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack().length || dock.classList.contains('away')) return;
    if (e.target.closest?.('input:not([type=checkbox], [type=radio]), textarea, select, #sam-panel')) return;
    let menuOpen = false;
    try { menuOpen = !!document.querySelector(':popover-open'); } catch { /* browser without popovers */ }
    if (menuOpen || document.querySelector('.tour-card, dialog[open], #search-panel:not([hidden]), #more-sheet:not([hidden]), .stage.key-open')) return;
    keep(stack().length - 1);
    (bar.querySelector('.dock-back, .dock-x') || document.querySelector('.maplibregl-canvas'))?.focus();   // keep keyboard focus: drawer, else the map
}, true);

// "Tour" in a view's header → that view's tour chapter (main.js listens)
views.addEventListener('click', (e) => {
    const b = e.target.closest('.tw-tour');
    if (b) document.dispatchEvent(new CustomEvent('smartbuddy:tour', { detail: b.dataset.tour }));
});

bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.classList.contains('dock-tip-ok')) { localStorage.setItem('sb-tip-back', '1'); return layout(); }   // one-time tip
    if (b) keep(b.classList.contains('dock-x') ? 0 : b.dataset.i != null ? +b.dataset.i + 1 : stack().length - 1);
});

// ⓘ tip: one-line captions on screen, method/caveat detail on hover (native title — never clipped by a
// scrolling window) and to screen readers (aria-label). Usage: `<h2>Title ${info('detail…')}</h2>`.
export const info = (text) => {
    const t = String(text).replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<span class="info" tabindex="0" role="note" aria-label="${t}" title="${t}">ⓘ</span>`;
};
