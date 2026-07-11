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

export function openHub(onPick) {
    const body = openWindow({ id: 'hub', title: 'SMART Buddy Insights', sub: 'pick your workspace', chips: [] });
    if (!body) return;
    const tw = body.closest('.tw');
    tw.style.width = '520px';
    tw.style.left = 'calc(50vw - 260px)'; tw.style.top = '15vh';

    body.innerHTML = `
      <div class="cap" style="margin-bottom:10px">Choose the view set for your team — the top bar keeps only
      what you need. You can switch roles anytime from the top bar; nothing is locked.</div>
      ${Object.entries(ROLES).map(([id, r]) => `
        <div class="role-card" data-role="${id}" style="border-left:3px solid ${r.color}">
          <div class="role-icon">${r.icon}</div>
          <div><b>${r.label}</b><div class="cap">${r.desc}</div></div>
          <div class="role-go">→</div>
        </div>`).join('')}
      <div class="cap" style="margin-top:10px">Tip: everything is deep-linkable —
      <code>#role=eng</code>, <code>#school=TKGS</code>, <code>#stall=ACSBR.011</code>, <code>#feb=cny</code>.</div>`;

    body.querySelectorAll('.role-card').forEach((c) =>
        c.addEventListener('click', () => {
            tw.remove();
            onPick(c.dataset.role);
        }));
}
