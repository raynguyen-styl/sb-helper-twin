// Getting-started checklist for new viewers: 3 real tasks that tick themselves off as they happen — learn by doing,
// no tour (NN/g: tutorials get skipped; Shopify: ≤5 steps, dismissible, auto-completed). Per-viewer state only.
import { setSamExpanded } from './sam/samPanel.js';

const KEY = 'sb-onboard';
const STEPS = [
    { id: 'school', t: 'Open a school', h: 'Click any dot on the map.' },
    { id: 'compare', t: 'Compare two schools', h: '“＋ Compare” in a school, or Shift-click dots.' },
    { id: 'sam', t: 'Ask the assistant a question', h: '<button class="ob-sam">Open the chat</button> — plain English, real numbers.' },
];
let st;
try { st = JSON.parse(localStorage.getItem(KEY)) || { done: [] }; } catch { st = { done: [] }; }
const save = () => localStorage.setItem(KEY, JSON.stringify(st));
let started = false;

export function initOnboarding() { if (!started && !st.off) { started = true; render(); } }
export function tick(id) {
    if (st.off || st.done.includes(id)) return;
    st.done.push(id); save();
    if (started) render();
}

function render() {
    let el = document.getElementById('onboard');
    const all = st.done.length === STEPS.length;
    if (all) { st.off = true; save(); }
    el.hidden = false;
    el.innerHTML = all ? '<b>You’re all set ✓</b>' : `
      <div class="ob-h"><b>Getting started</b><span class="ob-n">${st.done.length}/${STEPS.length}</span>
        <button class="ob-x" aria-label="Dismiss getting started" title="Dismiss">✕</button></div>
      <button class="ob-tour">▶ Take the 1-minute tour</button>
      ${STEPS.map((s) => { const done = st.done.includes(s.id);
          return `<div class="ob-s${done ? ' done' : ''}"><span class="ob-c" aria-hidden="true">${done ? '✓' : ''}</span>
            <div><b>${s.t}</b>${done ? '' : `<div class="ob-hint">${s.h}</div>`}</div></div>`; }).join('')}`;
    if (all) setTimeout(() => { el.hidden = true; }, 3000);
    el.onclick = (e) => {
        if (e.target.closest('.ob-x')) { st.off = true; save(); el.hidden = true; }
        else if (e.target.closest('.ob-sam')) setSamExpanded(true);
        else if (e.target.closest('.ob-tour')) document.dispatchEvent(new CustomEvent('smartbuddy:tour'));
    };
}
