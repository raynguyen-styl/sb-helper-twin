// Opt-in spotlight tours, in short chapters — never start by themselves (the menu → Tours, the checklist, or the "Tour"
// button on a view). Each chapter works on real data (it flies to a real school, opens views,
// clicks tabs): learn by doing. Research: user-started tours of ≤ ~6 steps finish far more often, so the whole dashboard
// is split into chapters instead of one long tour; "n of N"; Back + Skip on every step; the highlighted element stays
// clickable (non-modal); focus moves into the card and returns at the end; Esc always exits (NN/g, Atlassian, Material).
// Step: t = headline, b = body, before(c) = act first (open / click a tab), target(c) = element to spotlight (none → centred),
// when() = include the step only while it returns true (checked when the chapter starts and in the Tours list).
// A chapter with `view` reopens that view before every step, so wandering off mid-chapter doesn't break the next step.
const top = (sel) => document.querySelector(`#dock .tw:not(.under) ${sel}`);
const tab = (name) => top(`.tabs button[data-tab="${name}"]`)?.click();
const pane = (name) => top(`[data-pane="${name}"]`);
const phone = () => matchMedia('(max-width: 719px)').matches;
const sec = (text) => [...document.querySelectorAll('#dock .tw:not(.under) .sec')].find((el) => el.querySelector('h2')?.textContent.includes(text));
// The Map key: a card to unfold on wide screens, a sheet behind the Map key button on phones.
const legendOpen = () => {
    if (phone()) { if (!document.querySelector('.stage.key-open')) document.getElementById('key-btn')?.click(); return; }
    if (document.querySelector('.legend.closed')) document.querySelector('button.lg-head')?.click();
};

export const CHAPTERS = {
    basics: { title: 'Basics', steps: [
        { t: 'Each dot is a school', b: 'A bigger dot = more spend per card per day. Press a dot to open its details.',
          before: (c) => c.show(), target: (c) => c.marker() },
        { t: 'Colour and filter', b: 'Colour dots by level, errors or speed. Press a row to hide or show it.',
          before: (c) => { legendOpen(); c.colour(); }, target: () => document.getElementById('legend') },
        { t: 'Details open here', b: 'Back, or the names on top, return to where you were.',
          before: (c) => c.open(), target: () => document.getElementById('dock') },
        { t: 'Compare up to four', b: '“＋ Compare” or Shift-click dots to add. “Compare” shows them side by side.',
          before: (c) => c.pin(), target: () => document.querySelector('.cmp-tray') || top('.pin-btn') },
        { t: 'Views, months, search', b: 'Every view is in this list. Switch the month at the top; search any school, stall or machine (Ctrl K).',
          target: () => document.getElementById(phone() ? 'tabbar' : 'rail') },
        { t: 'Ask SMART Buddy', b: 'Ask about the data in plain English. More tours: the menu → Tours, or “Tour” on a view.',
          target: () => document.getElementById('ask-btn') },
    ] },
    map: { title: 'Map & Map key', end: (c) => c.colour(), steps: [
        { t: 'Colour by', b: 'Level shows school type. Errors and Speed show how payments run there.',
          before: () => legendOpen(), target: () => document.querySelector('#legend .mode') },
        { t: 'Reading the colours', b: 'Errors: green under 5%, amber 5–10%, red over 10% with a dark ring. Grey = no data.',
          before: (c) => { legendOpen(); c.colour('errors'); }, target: () => document.getElementById('legend') },
        { t: 'Show and hide layers', b: 'Press a row to show or hide it. PBS Bookstores are squares; Stamp points are diamonds.',
          before: () => legendOpen(), target: () => document.querySelector('#legend .lg-row[data-l="pbs"]')?.parentElement },
        { t: 'Every bookshop', b: '“list” shows all PBS shops, placed or still needing a decision.',
          before: () => legendOpen(), target: () => document.getElementById('books-btn') },
        { t: 'Back to the default', b: '“filtered” marks a changed view; Reset view returns to the default.',
          before: () => legendOpen(), target: () => document.querySelector('#legend .lg-reset') || document.querySelector('#legend .lg-head') },
        { t: 'Move and zoom', b: 'Drag to move, scroll, pinch or + − to zoom, Shift-drag to zoom to a box. The map stays flat.',
          target: () => document.querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group') },
    ] },
    details: { title: 'School details', steps: [
        { t: 'A school, opened', b: 'Name, level and area on top, with Compare and the tour. The map stays visible beside it.',
          before: (c) => c.open(), target: () => top('.tw-head') },
        { t: 'Headline numbers', b: 'Spend per card per day, taps, error rate, speed. “More numbers” adds the rest.',
          before: (c) => c.open(), target: () => top('.kpis') },
        { t: 'Spending', b: 'Weekly revenue and one bar per stall. Press a bar to open that stall.',
          before: (c) => { c.open(); tab('spend'); }, target: () => pane('spend') },
        { t: 'Terminals', b: 'Every machine here with its diagnosis. Press a row to open it.',
          before: (c) => { c.open(); tab('terms'); }, target: () => pane('terms') },
        { t: 'Going back', b: 'Back, Esc or a name at the top returns to the earlier view, same tab and scroll.',
          before: (c) => { c.open(); c.openStall(); }, target: () => document.querySelector('#dock .dock-bar') },
    ] },
    compare: { title: 'Compare', steps: [
        { t: 'Add to Compare', b: '“＋ Compare” pins this school. Shift-click dots on the map does the same.',
          before: (c) => c.open(), target: () => top('.pin-btn') },
        { t: 'The compare tray', b: 'Up to 4 of one kind. Each gets a letter and colour, here and on its map dot.',
          before: (c) => { c.pin(); c.pin(2); }, target: () => document.querySelector('.cmp-tray') },
        { t: 'One topic at a time', b: 'Errors and Speed recolour the map too; the map’s Colour by switches the topic.',
          before: (c) => c.compare(), target: () => top('.cmp-topics') },
        { t: 'Graphs first', b: 'One bar per item for each measure; lines show change over the month.',
          before: (c) => c.compare(), target: () => top('.cmp-grid') || top('.cwrap') },
        { t: 'The exact numbers', b: '“Show numbers” opens the table behind the graphs.',
          before: (c) => c.compare(), target: () => top('details.cmp-numbers') },
        { t: 'Share or clear', b: 'The page link keeps the pins: copy it to share this comparison. ✕ clears them.',
          target: () => document.querySelector('.cmp-tray') },
    ] },
    overview: { title: 'Overview', view: 'overview', steps: [
        { t: 'The month at a glance', b: 'One paragraph from the month’s data: spend, taps, schools, the busiest day, errors and terminals needing attention.',
          target: () => top('.lead') },
        { t: 'Network health', b: 'Daily errors and offline payments, signal quality, and the machines with the most errors.',
          before: () => tab('net'), target: () => pane('net') },
        { t: 'Speed', b: 'Typical and slowest payment times per day, by payment stack, and where the time goes.',
          before: () => tab('speed'), target: () => pane('speed') },
        { t: 'Food', b: 'What sells by stall category, the weekly mix and the average price. “Numbers” under a chart shows its table.',
          before: () => tab('food'), target: () => pane('food') },
        { t: 'School spending', b: 'Press a school type to filter. Press a top spender to fly to it and open it.',
          before: () => tab('atas'), target: () => pane('atas') },
    ] },
    schools: { title: 'Schools', view: 'schools', steps: [
        { t: 'Every school, ranked', b: 'Spend per card per day first. Press a column to sort by it; a school without that figure goes last.',
          target: () => top('#sc-list') },
        { t: 'Narrow the list', b: 'Search a name or code, pick a zone or a school type, or sort another way.',
          target: () => top('.fgrid') },
        { t: 'By level', b: 'Primary, Secondary, Junior College or Other. The count above the list follows every filter.',
          target: () => top('.fbar') },
        { t: 'Open one', b: 'Press a row to open the school and fly the map to it. Hovering a row lights its dot.',
          target: () => top('#sc-list tbody tr') },
    ] },
    eng: { title: 'Terminals & service route', view: 'eng', steps: [
        { t: 'The whole fleet', b: 'Healthy machines, those needing attention, machine faults and site issues. Press a card to filter the list.',
          target: () => document.getElementById('en-verd') },
        { t: 'Narrow the list', b: 'Search a school or machine, pick any problem or network, sort by errors, speed or taps.',
          target: () => top('.fgrid') },
        { t: 'The machines', b: 'Press a row for its daily errors against its school. Tick boxes pick machines to visit.',
          target: () => document.getElementById('en-list') },
        { t: 'Plan a route', b: 'Tick rows or “Tick all” (every machine matching the filters), then Plan route. Three are ticked for you.',
          before: () => { const p = [...document.querySelectorAll('#en-list [data-pick]')];
              if (!p.some((x) => x.checked)) p.slice(0, 3).forEach((x) => x.click()); },
          target: () => document.getElementById('en-routebar') },
        { t: 'The service route', b: 'Visit order from the STYL Service Center, km per leg. Bookshop machines: not routed.',
          before: () => document.getElementById('en-route')?.click(), target: () => document.querySelector('#dock [data-win="route"]') },
    ] },
    items: { title: 'Purchases', view: 'items', steps: [
        { t: 'Receipt totals', b: 'Line items, units sold and item revenue.',
          target: () => top('.kpis') },
        { t: 'Nutrition', b: 'The menu’s healthier mark (unverified: it is on most items), calories where an item has them, and the top categories.',
          before: () => tab('nutri'), target: () => pane('nutri') },
        { t: 'Item types', b: 'Units, revenue and calories for each type of item.',
          before: () => tab('types'), target: () => pane('types') },
        { t: 'Top items', b: 'The best sellers. Names are till buttons, so read them as types, not dishes.',
          before: () => tab('top'), target: () => pane('top') },
        { t: 'Stalls & habits', b: 'How receipts link to payments, card habits, and top stalls. Press one to open it.',
          before: () => tab('linkage'), target: () => pane('linkage') },
    ] },
    savings: { title: 'Savings', view: 'savings', steps: [
        { t: 'Savings totals', b: 'Students in the savings ledger: saved, spent and the saving rate.',
          target: () => top('.kpis') },
        { t: 'Do the feeds agree?', b: 'Wallet payments checked against the savings ledger.',
          target: () => sec('Do the feeds agree') },
        { t: 'Smiley Stamps', b: 'POSB stamps bought by tapping Smart Buddy: savings, not spending.',
          target: () => sec('Smiley Stamps') },
        { t: 'Per student', b: 'How saving, spending and the saving rate spread across students.',
          target: () => sec('Saving per student') },
    ] },
    feb: { title: 'Wearables', view: 'feb', steps: [
        { t: 'Wearable data', b: 'Users, activity and heart-rate rows, and the month’s canteen spend.',
          target: () => top('.kpis') },
        { t: 'Activity', b: 'Steps through the day. Filter by day type or user group above the charts.',
          before: () => tab('act'), target: () => pane('act') },
        { t: 'Wear & adoption', b: 'Who wears and syncs the band, days worn, weekends vs school days.',
          before: () => tab('wear'), target: () => pane('wear') },
        { t: 'Heart rate', b: 'Average and raised heart rate by hour; firmware compared when there are several.',
          before: () => tab('hr'), target: () => pane('hr') },
        { t: 'Spending and the story', b: 'Canteen spend by level and category. The last tab tells the month’s story.',
          before: () => tab('spend'), target: () => top('.tabs') },
    ] },
    playback: { title: 'Playback', view: 'playback', steps: [
        { t: 'What to play', b: 'Pick a school’s canteen or the wearable fleet, then the measure.',
          target: () => top('.fgrid') },
        { t: 'Day by day', b: 'The whole month; the marked point is the day being played.',
          target: () => top('.pb-canvas') },
        { t: 'Play it', b: 'Play, drag the slider to any day, or change the speed.',
          target: () => top('.pb-bar') },
    ] },
    sam: { title: 'SMART Buddy chat', steps: [
        { t: 'Meet SMART Buddy', b: 'Ask about this data in plain English. It hands the question to a specialist agent and answers with real numbers, a chart or a table; add “as a report” for a full report.',
          before: (c) => c.sam(true), target: () => document.getElementById('sam-panel') },
        { t: 'Ask a question', b: 'Start from a suggestion or type your own. Enter sends, Shift+Enter adds a line.',
          before: (c) => c.sam(true), target: () => document.querySelector('#sam-thread .sam-empty-state:not([hidden])') || document.getElementById('sam-footer') },
        { t: 'Start over', b: '“New” starts a fresh chat. ✕ or Esc closes it; the conversation stays until New.',
          before: (c) => c.sam(true), target: () => document.getElementById('sam-new-chat') },
    ] },
    menu: { title: 'Menu & keys', steps: [
        { t: 'The menu', b: 'Switch workspace, pick a tour, see every key and mouse action, or sign out.',
          target: () => document.getElementById('menu-btn') },
        { t: 'Keys and mouse', b: 'Press ? for the full list: Esc goes back, Shift-click compares, Ctrl K or / searches.',
          target: () => document.getElementById('menu-btn') },
    ] },
};

let ctx, ch, steps, list, i = 0, active = false, raf = 0, launcher = null, ring, card, live;
// A chapter's steps for the current state: a step with `when` is left out while it returns false.
const visibleSteps = (key) => CHAPTERS[key].steps.filter((s) => { try { return !s.when || s.when(); } catch { return true; } });
const doneSet = () => { try { return new Set(JSON.parse(localStorage.getItem('sb-tours') || '[]')); } catch { return new Set(); } };

// key = chapter; keys = the chapters this viewer can take (role + month), in order — sets "Next: …" on the last step.
export function startTour(key, c, keys) {
    if (active || !CHAPTERS[key]) return;
    ctx = c; ch = key; list = keys; steps = visibleSteps(key); active = true; launcher = document.activeElement;
    document.body.classList.add('touring');
    ring = Object.assign(document.createElement('div'), { className: 'tour-ring' });
    card = Object.assign(document.createElement('div'), { className: 'tour-card' });
    live = Object.assign(document.createElement('div'), { className: 'sr-only' });
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false'); card.setAttribute('aria-labelledby', 'tour-t');
    live.setAttribute('aria-live', 'polite');
    document.body.append(ring, card, live);
    card.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b?.dataset.go === 'next') i === steps.length - 1 ? end(true) : show(i + 1);
        else if (b?.dataset.go === 'back') show(i - 1);
        else if (b?.dataset.go === 'skip') end(false);
        else if (b?.dataset.go === 'chapter') { const n = nextKey(); end(true); startTour(n, ctx, list); }
    });
    addEventListener('keydown', onKey, true);
    show(0);
    (function loop() { if (!active) return; place(); raf = requestAnimationFrame(loop); })();   // follows moving targets (map, drawer)
}
const nextKey = () => list?.slice(list.indexOf(ch) + 1).find((k) => !doneSet().has(k)) || null;

function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
    else if (card.contains(e.target) && e.key === 'ArrowRight' && i < steps.length - 1) show(i + 1);
    else if (card.contains(e.target) && e.key === 'ArrowLeft' && i > 0) show(i - 1);
}

async function show(n) {
    i = n;
    const s = steps[i], last = i === steps.length - 1, view = CHAPTERS[ch].view, next = last && nextKey();
    card.classList.add('busy');
    try { if (view) ctx.view(view); await s.before?.(ctx); } catch { /* a step that can't act still explains itself */ }
    await new Promise((r) => setTimeout(r, 60));          // let the view / tab paint before measuring the target
    if (!active || i !== n) return;                       // closed, or the user clicked on while this step was loading
    card.classList.remove('busy');
    card.innerHTML = `<div class="tour-n">${CHAPTERS[ch].title} · ${i + 1} of ${steps.length}</div><h3 id="tour-t">${s.t}</h3><p>${s.b}</p>
      <div class="tour-btns">${last ? '' : '<button data-go="skip" class="tour-skip">Skip tour</button>'}<span></span>
        ${i ? '<button data-go="back">‹ Back</button>' : ''}<button data-go="next" class="tour-next">${last ? 'Done' : 'Next ›'}</button></div>
      ${next ? `<button data-go="chapter" class="tour-chapter">Next tour: ${CHAPTERS[next].title} ›</button>` : ''}`;
    live.textContent = `${CHAPTERS[ch].title}, step ${i + 1} of ${steps.length}: ${s.t}. ${s.b}`;
    card.querySelector('.tour-next').focus();
}

// Spotlight the target; card beside it (right → left → below → above), centred if the target is missing,
// docked at the bottom on narrow screens.
function place() {
    const el = steps[i].target(ctx), r = el?.getBoundingClientRect();
    const on = !!(r && r.width && r.height);
    ring.hidden = !on;
    if (on) Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const W = innerWidth, H = innerHeight, cw = card.offsetWidth, chh = card.offsetHeight, g = 16;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    let x = (W - cw) / 2, y = (H - chh) / 2;
    if (on && W < 720) y = H - chh - 12;
    else if (on) {
        const fit = [[r.right + g, clamp(r.top, 8, H - chh - 8), r.right + g + cw <= W - 8],
                     [r.left - g - cw, clamp(r.top, 8, H - chh - 8), r.left - g - cw >= 8],
                     [clamp(r.left, 8, W - cw - 8), r.bottom + g, r.bottom + g + chh <= H - 8],
                     [clamp(r.left, 8, W - cw - 8), r.top - g - chh, r.top - g - chh >= 8]].find((p) => p[2]);
        if (fit) [x, y] = fit;
    }
    card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
}

function end(done) {
    active = false; cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey, true);
    ring.remove(); card.remove(); live.remove();
    document.body.classList.remove('touring');
    try { CHAPTERS[ch].end?.(ctx); } catch { /* best effort */ }
    if (done) { const d = doneSet(); d.add(ch); localStorage.setItem('sb-tours', JSON.stringify([...d])); }
    if (ch === 'basics') localStorage.setItem('sb-tour', done ? 'done' : 'skipped');
    if (ch === 'basics' ? i >= 2 : ch === 'details') localStorage.setItem('sb-tip-back', '1');   // Back already explained
    if (launcher?.isConnected) launcher.focus();
}

// The menu → Tours: the chapters this viewer can take, ✓ = finished. A native modal <dialog> like Keyboard & mouse.
export function openTours(keys, onPick) {
    document.getElementById('tours')?.remove();
    const d = document.createElement('dialog');
    const done = doneSet();
    d.id = 'tours'; d.className = 'keys tours'; d.setAttribute('aria-labelledby', 'tours-t');
    d.innerHTML = `<div class="keys-in">
      <div class="keys-h"><h2 id="tours-t">Tours</h2><button class="keys-x" aria-label="Close"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <p class="take">Short guided tours on real data. Each takes under a minute; Esc stops one.</p>
      <ul class="tours-list">${keys.map((k) => `<li><button data-k="${k}"><span class="tours-ok" aria-hidden="true">${done.has(k) ? '✓' : ''}</span>
        ${CHAPTERS[k].title}<span class="fn">${visibleSteps(k).length} steps${done.has(k) ? ' · done' : ''}</span></button></li>`).join('')}</ul></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', (e) => {
        const k = e.target.closest('[data-k]')?.dataset.k;
        if (k) { d.close(); onPick(k); } else if (e.target === d || e.target.closest('.keys-x')) d.close();
    });
    d.addEventListener('close', () => d.remove());
    d.showModal();
}

// Which chapter a drawer view belongs to ("Tour" in its header) — null = no tour for it.
export const chapterFor = (id) => ({ overview: 'overview', schools: 'schools', eng: 'eng', route: 'eng', items: 'items', savings: 'savings',
    feb: 'feb', playback: 'playback', compare: 'compare' })[id] || (/^school-/.test(id) ? 'details' : null);
