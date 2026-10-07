// Docked drawer on the map's right edge: one view at a time. Opening a view pushes it; earlier views stay
// underneath, hidden but alive (same tab, scroll and charts), so Back and the breadcrumbs return to them.
// `wide` = a wider drawer for the dense views. `float` = a centred card over the map (the first-run role hub).
import { chapterFor } from './tour.js';

const dock = document.getElementById('dock');
const views = dock.querySelector('.dock-views');
const bar = dock.querySelector('.dock-bar');
const stack = () => [...views.children];
const type = (id) => /^(school|stall|term)-/.exec(id || '')?.[1];
// Feed text (school / stall / store names…) is data, never markup: escape it wherever it goes into innerHTML.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
    win.innerHTML = `
      <div class="tw-head">
        <span class="t">${esc(title)}</span>
        ${chips.join('')}
        <span class="sub">${esc(sub)}</span>
        ${!float && chapterFor(id) ? `<button class="tw-tour" data-tour="${chapterFor(id)}" title="A short guided tour of this view">▶ Tour</button>` : ''}
        ${float ? '<button class="tw-close" title="Close">✕</button>' : ''}
      </div>
      <div class="tw-body"></div>`;
    if (float) {
        document.getElementById('tw-layer').appendChild(win);
        win.querySelector('.tw-close').addEventListener('click', () => { win.remove(); onClose?.(); });
    } else {
        views.appendChild(win);
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

function layout(pushed = false) {
    const all = stack(), top = all.at(-1);
    all.forEach((w) => w.classList.toggle('under', w !== top));
    dock.classList.toggle('open', !!top);
    dock.classList.toggle('wide', top?.dataset.wide != null);
    const name = (w) => esc(w.querySelector('.tw-head .t').textContent);
    // one view: no breadcrumb (its own heading names it), just ✕
    bar.innerHTML = !top ? '' : `
      ${all.length > 1 ? `<button class="dock-back" title="Back" aria-label="Back">‹</button>
      <nav class="crumbs" aria-label="Breadcrumb">${all.map((w, i) => w === top
          ? `<span aria-current="page">${name(w)}</span>`
          : `<button data-i="${i}">${name(w)}</button>`).join('<span class="sep" aria-hidden="true">›</span>')}</nav>` : ''}
      <button class="dock-x" title="Close panel" aria-label="Close panel">✕</button>
      ${all.length > 1 && !localStorage.getItem('sb-tip-back') ? `<div class="dock-tip" role="note">‹ Back returns to the
        previous view, with its tab and scroll kept — or click a name to jump. <button class="dock-tip-ok">Got it</button></div>` : ''}`;
    insets(pushed);
}

// What the drawer covers (right edge, or bottom as a sheet) → CSS vars that keep the pills/legend clear of it,
// and a 'dock' event main.js uses to pad the map (and fold SAM when a view was just opened).
function insets(pushed = false) {
    const open = dock.classList.contains('open');
    const s = dock.parentElement.getBoundingClientRect(), d = dock.getBoundingClientRect();
    const sheet = open && d.top > s.top + 1;
    const right = open && !sheet ? Math.round(s.right - d.left) : 0;
    const bottom = sheet ? Math.round(s.bottom - d.top) : 0;
    dock.parentElement.style.setProperty('--dock-r', `${right}px`);
    dock.parentElement.style.setProperty('--dock-b', `${bottom}px`);
    dispatchEvent(new CustomEvent('dock', { detail: { open, pushed, right, bottom } }));
}
addEventListener('resize', () => insets());

// Esc = Back one view (closes the drawer at the last one) — not while typing, nor when the menu, Upload, the tour or the
// role picker or a dialog (Keyboard & mouse) is open (they own Esc). Capture phase, so it decides before their own handlers run.
addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack().length || e.target.closest?.('input:not([type=checkbox], [type=radio]), textarea, select')) return;
    let menuOpen = false;
    try { menuOpen = !!document.querySelector(':popover-open'); } catch { /* browser without popovers */ }
    if (menuOpen || document.querySelector('.up-overlay, .tour-card, [data-win="hub"], dialog[open]')) return;
    keep(stack().length - 1);
    (bar.querySelector('.dock-back, .dock-x') || document.querySelector('.maplibregl-canvas'))?.focus();   // keep keyboard focus: drawer, else the map
}, true);

// "▶ Tour" in a view's header → that view's tour chapter (main.js listens)
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
// scrolling window) and to screen readers (aria-label). Usage: `<h5>Title ${info('detail…')}</h5>`.
export const info = (text) => {
    const t = String(text).replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<span class="info" tabindex="0" role="note" aria-label="${t}" title="${t}">ⓘ</span>`;
};
