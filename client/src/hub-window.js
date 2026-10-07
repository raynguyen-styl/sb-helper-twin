// Role hub — "who are you?" landing. Picking a role filters the nav to that
// team's views (switchable anytime; guidance, not security) and opens its
// primary window. Persisted in localStorage; deep link #role=fnb|eng|mgmt.
import { openWindow } from './windowing.js';

// NOTE: the Stall Explorer view is shelved (no item/SKU data yet) — stall detail
// lives inside each school window instead. Re-add 'stalls' here when it returns.
// Views are filtered to what the selected month actually has (main.js viewAvailable), so listing a
// month-specific view here is safe — it just doesn't show in a month that lacks it.
export const ROLES = {
    fnb:  { label: 'F&B / Operations', icon: '🍜', color: '#1baf7a',
            desc: 'What sells, price points, revenue by school, stall and hour — plus nutrition & savings.',
            views: ['overview', 'items', 'savings', 'feb'], primary: 'overview' },
    eng:  { label: 'Engineering', icon: '🔧', color: '#2a78d6',
            desc: 'Terminal fleet health, machine-vs-location fault diagnosis, network, speed, signal.',
            views: ['eng', 'overview'], primary: 'eng' },
    mgmt: { label: 'Management', icon: '📊', color: '#7d5fd3',
            desc: 'Everything — network overview, school spending, terminals, nutrition & savings.',
            views: ['overview', 'eng', 'items', 'savings', 'feb'], primary: 'overview' },
};

// onPick(role) · onPick(null) = "Skip — show all views" · onPick(undefined) = closed with ✕. onTour (first visit only)
// = all views + start the opt-in tour.
export function openHub(onPick, onTour) {
    const body = openWindow({ id: 'hub', title: 'SMART Buddy Insights', sub: 'pick your workspace', chips: [], float: true,
        onClose: () => onPick(undefined) });
    if (!body) return;
    const tw = body.closest('.tw');

    body.innerHTML = `
      <div class="cap" style="margin-bottom:10px">Pick your team's views — switch anytime from the top bar.</div>
      ${Object.entries(ROLES).map(([id, r]) => `
        <div class="role-card" role="button" tabindex="0" data-role="${id}" style="border-left:3px solid ${r.color}">
          <div class="role-icon">${r.icon}</div>
          <div><b>${r.label}</b><div class="cap">${r.desc}</div></div>
          <div class="role-go">→</div>
        </div>`).join('')}
      <div class="hub-alt">${onTour ? '<button class="hub-tour">Take the 1-minute tour</button>' : ''}
        <button class="hub-skip">Skip — show all views</button></div>
      <div class="cap" style="margin-top:10px">Tip: everything is deep-linkable —
      <code>#role=eng</code>, <code>#school=TKGS</code>, <code>#stall=ACSBR.011</code>, <code>#feb=cny</code>.</div>`;

    body.querySelector('.hub-skip').addEventListener('click', () => { tw.remove(); onPick(null); });
    body.querySelector('.hub-tour')?.addEventListener('click', () => { tw.remove(); onPick(null); onTour(); });
    body.querySelectorAll('.role-card').forEach((c) =>
        c.addEventListener('click', () => {
            tw.remove();
            onPick(c.dataset.role);
        }));
}
