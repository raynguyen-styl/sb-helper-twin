/**
 * mode.js — the dashboard's Demo | Live mode (central-specs change dashboard-demo-live-modes).
 *
 * Demo: the uploaded ClickHouse extract with the demo SAM agent; Upload is offered.
 * Live: the live SAM agent; no Upload. Only the chat topics and the Upload entry differ — the views
 * read the same ClickHouse extract either way.
 *
 * Resolution order: `#mode=` in the URL hash → the browser's stored choice (localStorage `sb-mode`) →
 * the build-time default (VITE_SB_DEFAULT_MODE, passed in by main.js) → 'demo'; unknown values are
 * skipped. A switch stores the choice and notifies listeners; main.js writes the hash, re-renders the
 * nav and re-routes the chat.
 */

export const MODES = ['demo', 'live'];
const KEY = 'sb-mode';
const valid = (v) => (MODES.includes(v) ? v : null);

// Pure (no browser globals), so it can be checked in plain Node: hash > stored > default > 'demo'.
export function resolveMode(hashValue, storedValue, defaultValue) {
    return valid(hashValue) || valid(storedValue) || valid(defaultValue) || 'demo';
}

let mode = null;
const listeners = new Set();
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const store = (m) => { try { localStorage.setItem(KEY, m); } catch { /* private window / blocked storage */ } };

export function initMode({ defaultMode, hashValue } = {}) {
    mode = resolveMode(hashValue, read(), defaultMode);
    if (valid(hashValue) && read() !== mode) store(mode);   // a deep link becomes the stored choice
    return mode;
}
export function getMode() { return mode || 'demo'; }
export function setMode(m) {
    if (!valid(m) || m === mode) return false;
    mode = m; store(m);
    for (const fn of listeners) { try { fn(m); } catch (e) { console.warn('[mode] listener failed:', e); } }
    return true;
}
export function onModeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
