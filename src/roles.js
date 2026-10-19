// The team workspaces (central-specs capability dashboard-shell): a choice in the menu that filters the list of
// views — guidance, not security. Kept on the device (sb-role); a #role=fnb|eng|mgmt link still picks one.
// The first-visit picker that used to ask for it is retired: a first visit opens the map and Overview.
// Views are also filtered by what the selected month has (main.js viewAvailable), so listing a month-specific
// view here is safe. Playback is in every workspace.
export const ROLES = {
    fnb:  { label: 'F&B / Operations', desc: 'What sells, where and when; subsidies, purchases and savings',
            views: ['overview', 'schools', 'subsidy', 'items', 'savings', 'feb'], primary: 'overview' },
    eng:  { label: 'Engineering', desc: 'Terminal health, faults and service routes',
            views: ['eng', 'overview'], primary: 'eng' },
    mgmt: { label: 'Management', desc: 'Every view',
            views: ['overview', 'schools', 'eng', 'subsidy', 'items', 'savings', 'feb'], primary: 'overview' },
};
