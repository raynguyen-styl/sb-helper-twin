// Draggable, closable, stackable windows on the tw-layer (tree-digital-twin pattern).
let z = 1100;
let offset = 0;

export function openWindow({ id, title, sub, chips = [], onClose }) {
    const layer = document.getElementById('tw-layer');
    const existing = layer.querySelector(`[data-win="${id}"]`);
    if (existing) { existing.style.zIndex = ++z; return null; }

    const win = document.createElement('div');
    win.className = 'tw';
    win.dataset.win = id;
    win.style.left = `${60 + (offset % 6) * 44}px`;
    win.style.top = `${24 + (offset % 6) * 34}px`;
    offset++;
    win.style.zIndex = ++z;
    win.innerHTML = `
      <div class="tw-head">
        <span class="t">${title}</span>
        ${chips.join('')}
        <span class="sub">${sub || ''}</span>
        <button class="tw-close" title="Close">✕</button>
      </div>
      <div class="tw-body"></div>`;
    layer.appendChild(win);

    win.addEventListener('mousedown', () => { win.style.zIndex = ++z; });
    win.querySelector('.tw-close').addEventListener('click', () => { win.remove(); onClose?.(); });

    const head = win.querySelector('.tw-head');
    head.addEventListener('mousedown', (e) => {
        if (e.target.closest('.tw-close')) return;
        const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
        const move = (ev) => {
            win.style.left = `${Math.max(-200, ev.clientX - sx)}px`;
            win.style.top = `${Math.max(0, ev.clientY - sy)}px`;
        };
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
        e.preventDefault();
    });
    return win.querySelector('.tw-body');
}

// ⓘ tip: one-line captions on screen, method/caveat detail on hover (native title — never clipped by a
// scrolling window) and to screen readers (aria-label). Usage: `<h5>Title ${info('detail…')}</h5>`.
export const info = (text) => {
    const t = String(text).replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<span class="info" tabindex="0" role="note" aria-label="${t}" title="${t}">ⓘ</span>`;
};
