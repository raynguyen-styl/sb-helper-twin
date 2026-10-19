// "Keyboard & mouse" list — from the menu or the "?" key (screens 720 px wide or more). A native modal <dialog>: focus
// stays inside, Esc closes, focus returns to where it was. Keep in step with the real handlers (main.js, windowing.js,
// compare.js, tour.js, sam/samPanel.js).
const GROUPS = [
    ['Map', [
        ['Click a dot', 'Open the school (squares / diamonds: the shop)'],
        ['<kbd>Shift</kbd> + click a dot', 'Add it to Compare (or remove it)'],
        ['Drag', 'Move the map'],
        ['Scroll, or double-click', 'Zoom in (<kbd>Shift</kbd> + double-click: out)'],
        ['<kbd>Shift</kbd> + drag on empty map', 'Zoom to the box you draw'],
        ['<kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd> · <kbd>+</kbd> <kbd>−</kbd>', 'Move / zoom (click the map first)'],
        ['<kbd>Tab</kbd> to a dot, <kbd>Enter</kbd>', 'Open it · <kbd>Shift</kbd> + <kbd>Enter</kbd>: add to Compare'],
    ]],
    ['Details', [
        ['<kbd>Esc</kbd>', 'Back one view (closes the details at the last one)'],
        ['Back, or a name at the top', 'Return to an earlier view'],
        ['Hover or focus a row', 'Highlights its dot on the map'],
        ['<kbd>Enter</kbd> / <kbd>Space</kbd> on a row', 'Open it'],
        ['<kbd>←</kbd> <kbd>→</kbd> on a view\'s topics', 'Switch topic'],
        ['On a phone: drag the sheet\'s handle', 'Peek, half or full height; down past peek closes it'],
        ['<kbd>↑</kbd> <kbd>↓</kbd> on the sheet\'s handle', 'Grow or shrink the sheet'],
    ]],
    ['Search', [
        ['<kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd>, or <kbd>/</kbd>', 'Search schools, stalls and machines'],
        ['<kbd>↑</kbd> <kbd>↓</kbd> · <kbd>Enter</kbd>', 'Pick a match · open it'],
        ['<kbd>Esc</kbd>', 'Close search'],
    ]],
    ['Compare', [
        ['Hover or <kbd>Tab</kbd> to a chip', 'Preview its numbers'],
        ['<kbd>←</kbd> <kbd>→</kbd> · <kbd>Home</kbd> <kbd>End</kbd> on the topics', 'Switch topic (the map colour follows)'],
    ]],
    ['SMART Buddy chat', [
        ['Ask in the top bar', 'Open or close the chat'],
        ['<kbd>Enter</kbd> · <kbd>Shift</kbd> + <kbd>Enter</kbd>', 'Send · new line'],
        ['<kbd>Esc</kbd> in the chat', 'Close it (the conversation stays until New)'],
    ]],
    ['Anywhere', [
        ['<kbd>?</kbd>', 'This list'],
        ['<kbd>Esc</kbd>', 'Close the menu, the tour, search or this list'],
        ['Menu → Tours', 'Short guided tours, one per area'],
        ['“Tour” on a view', 'A guided tour of that view'],
    ]],
];

export function openShortcuts() {
    let d = document.getElementById('keys');
    if (!d) {
        d = document.createElement('dialog');
        d.id = 'keys'; d.className = 'keys'; d.setAttribute('aria-labelledby', 'keys-t');
        d.innerHTML = `<div class="keys-in">
          <div class="keys-h"><h2 id="keys-t">Keyboard &amp; mouse</h2><button class="keys-x" aria-label="Close"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
          <div class="keys-grid">${GROUPS.map(([g, rows]) => `<section><h3>${g}</h3><dl>${rows.map(([k, v]) =>
              `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>`).join('')}</div></div>`;
        document.body.appendChild(d);
        // ✕, or a click on the dimmed backdrop (the dialog box itself, outside its content), closes it
        d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('.keys-x')) d.close(); });
    }
    if (!d.open) d.showModal();
}
