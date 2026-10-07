// Upload-data window — CHUNKED, RESUMABLE, size-unlimited upload into the shared ClickHouse via the
// ingestion-service. A file is split into fixed-size PARTS uploaded one by one (peak memory = one
// part, so multi-GB files are fine); the server assembles + loads it (PII hashed) into the chosen
// month's partition, then rebuilds the aggregates. You can select SEVERAL files for one dataset
// (e.g. Feb health ships as 6 parts) — the first REPLACES the month, the rest APPEND, and the
// aggregate rebuild runs once at the end. Keycloak-gated at the client nginx (Bearer).
import { esc } from './windowing.js';
import { authReady, authToken } from './auth.js';

const INGEST = '/smartbuddy-ingest';          // same-origin; client nginx proxies to smartbuddy-ingest
const PART_SIZE = 32 * 1024 * 1024;           // 32 MB parts
const PART_RETRIES = 4;

// Shown instantly so the modal never waits on a network call; refined from /datasets once it arrives.
const DEFAULT_DATASETS = [
  { id: 'transactions', label: 'Canteen transactions', months: 'Feb + March', hint: 'Card/student ids are hashed and names dropped server-side. Also fills network-speed; rebuilds the map, overview, stalls + Playback.' },
  { id: 'items', label: 'Student purchase items', months: 'March', hint: 'Student id hashed. Feeds Purchases & Nutrition (calories, Healthier-Choice).' },
  { id: 'saving_spending', label: 'Student saving vs spending', months: 'March', hint: 'User id hashed. Feeds the Saving vs Spending view.' },
  { id: 'health', label: 'Wearable activity (30-min)', months: 'Feb + March', hint: 'User ids hashed. Rebuilds the wearable Playback series.' },
  { id: 'heart_rate', label: 'Heart rate (hourly)', months: 'Feb + March', hint: 'user_id + sync_id hashed.' },
  { id: 'txn_perf', label: 'Transaction network speed', months: 'Feb + March', hint: 'No personal ids; per-transaction speed components (ms).' },
  { id: 'schools', label: 'School dimension (MOE)', months: 'shared', hint: 'No personal ids; school metadata (level / zone / lat-lng).' },
];

const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body, json } = {}) {
    await authReady;
    const headers = {};
    const tok = authToken(); if (tok) headers.Authorization = `Bearer ${tok}`;
    if (json) headers['Content-Type'] = 'application/json';
    const r = await fetch(`${INGEST}${path}`, { method, headers, body: json ? JSON.stringify(json) : body });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`);
    return data;
}

// Upload ONE file through the chunked protocol. onProg(fraction, phaseLabel). Returns the final status.
async function uploadFile(file, { dataset, month, mode, rebuild, onProg }) {
    const totalParts = Math.max(1, Math.ceil(file.size / PART_SIZE));
    const s = await api('/uploads', { method: 'POST', json: {
        dataset, month, mode, rebuild, filename: file.name, size: file.size,
        part_size: PART_SIZE, total_parts: totalParts } });
    const id = s.id;

    for (let i = 0; i < totalParts; i += 1) {
        const blob = file.slice(i * PART_SIZE, Math.min((i + 1) * PART_SIZE, file.size));
        let ok = false, lastErr;
        for (let attempt = 0; attempt < PART_RETRIES && !ok; attempt += 1) {
            try { await api(`/uploads/${id}/parts/${i}`, { method: 'PUT', body: blob }); ok = true; }
            catch (e) { lastErr = e; await sleep(500 * (attempt + 1)); }
        }
        if (!ok) throw new Error(`part ${i + 1}/${totalParts}: ${lastErr?.message || 'upload failed'}`);
        onProg((i + 1) / totalParts * 0.85, `Uploading… ${i + 1}/${totalParts} parts`);
    }

    await api(`/uploads/${id}/complete`, { method: 'POST', json: {} });
    // poll the server-side load job
    for (;;) {
        await sleep(1500);
        const st = await api(`/uploads/${id}`);
        const phase = st.phase || 'processing';
        if (phase === 'done') { onProg(1, 'Done'); return st; }
        if (phase === 'error') throw new Error(st.error || 'load failed');
        const label = { queued: 'Queued…', assembling: 'Assembling…', loading: 'Loading into ClickHouse…',
                        rebuilding: 'Rebuilding aggregates…' }[phase] || `${phase}…`;
        const frac = phase === 'loading' && st.load_rows ? 0.9 : phase === 'rebuilding' ? 0.97 : 0.88;
        onProg(frac, label + (st.load_rows ? ` (${Number(st.load_rows).toLocaleString()} rows)` : ''));
    }
}

export function openUpload(onDone) {
    if (document.querySelector('.up-overlay')) return;              // single instance

    // Build + show the modal IMMEDIATELY — no awaiting the network, so it appears the instant you click.
    const overlay = document.createElement('div');
    overlay.className = 'up-overlay';
    overlay.innerHTML = `<div class="up-backdrop"></div>
      <div class="up-modal" role="dialog" aria-modal="true" aria-label="Upload data">
        <div class="up-modal-head">
          <span class="ico">⬆</span>
          <div><div class="t">Upload data</div><span class="sub">load a month into ClickHouse</span></div>
          <button class="up-x" title="Close (Esc)">✕</button>
        </div>
        <div class="up-modal-body">
          <p class="up-intro">Any size — the file is split into parts automatically. Personal ids are
            <b>hashed</b> server-side (never stored raw, names dropped), and the month's dashboard
            rebuilds when the upload finishes.</p>

          <div class="up-grid">
            <label class="up-field"><span class="up-label">Month</span>
              <input type="month" class="up-in up-month" /></label>
            <label class="up-field"><span class="up-label">Dataset</span>
              <select class="up-in up-dataset"></select></label>
          </div>
          <p class="up-hint"></p>

          <div class="up-field">
            <span class="up-label">File(s)</span>
            <div class="up-drop">
              <span class="big">⬆</span>
              <span class="up-drop-main">Drop files here, or <u>click to choose</u></span>
              <span class="up-drop-sub">Parquet or CSV. Add several files for one dataset (e.g. Feb health = 6 parts) — the first replaces the month, the rest append.</span>
            </div>
            <input type="file" class="up-input" accept=".parquet,.csv" multiple hidden />
            <div class="up-files"></div>
          </div>

          <div class="up-bar"><i></i></div>
          <div class="up-actions">
            <button class="up-btn" disabled>Upload &amp; ingest</button>
            <span class="up-status"></span>
          </div>
          <div class="up-result"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';                        // lock scroll behind
    requestAnimationFrame(() => overlay.classList.add('show'));     // backdrop + card fade in together

    const body = overlay.querySelector('.up-modal-body');
    const xBtn = overlay.querySelector('.up-x');
    let busy = false;                                               // block close during an active upload
    const close = () => {
        if (busy) return;
        overlay.classList.remove('show');
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.remove(), 200);
    };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.up-backdrop').addEventListener('click', close);
    xBtn.addEventListener('click', close);

    const $ = (s) => body.querySelector(s);
    const monthEl = $('.up-month'), dsSel = $('.up-dataset'), hint = $('.up-hint');
    const drop = $('.up-drop'), input = $('.up-input'), filesEl = $('.up-files');
    const bar = $('.up-bar'), barFill = $('.up-bar > i'), btn = $('.up-btn'), status = $('.up-status'), result = $('.up-result');

    let files = [];
    let datasets = DEFAULT_DATASETS.slice();
    const showHint = () => { hint.textContent = datasets.find((d) => d.id === dsSel.value)?.hint || ''; };
    const fillDatasets = () => {
        const cur = dsSel.value;
        dsSel.innerHTML = datasets.map((d) => `<option value="${d.id}">${d.label}${d.months ? ` · ${d.months}` : ''}</option>`).join('');
        if (cur) dsSel.value = cur;
        showHint();
    };
    fillDatasets(); dsSel.onchange = showHint;
    // refine labels/hints from the server; the modal is already usable meanwhile
    api('/datasets').then((d) => { if (d?.datasets?.length) { datasets = d.datasets; fillDatasets(); } }).catch(() => {});

    const renderFiles = () => {
        filesEl.innerHTML = files.map((f, i) =>
            `<div class="up-file"><span class="up-name">${esc(f.name)} · ${fmtBytes(f.size)}</span>
             <button class="x" data-i="${i}" title="Remove">✕</button></div>`).join('');
        filesEl.querySelectorAll('.x').forEach((b) =>
            b.addEventListener('click', () => { files.splice(+b.dataset.i, 1); renderFiles(); }));
        btn.disabled = !(files.length && /^\d{4}-\d{2}$/.test(monthEl.value));
        result.innerHTML = ''; barFill.style.width = '0'; bar.classList.remove('show'); status.textContent = '';
    };
    const addFiles = (list) => { files.push(...[...list].filter((f) => /\.(parquet|csv)$/i.test(f.name))); renderFiles(); };

    drop.onclick = () => input.click();
    input.onchange = () => addFiles(input.files);
    monthEl.onchange = renderFiles;
    ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (ev) => addFiles(ev.dataTransfer.files));

    btn.onclick = async () => {
        const month = monthEl.value;
        if (!files.length || !/^\d{4}-\d{2}$/.test(month)) return;
        busy = true; xBtn.disabled = true;                          // don't let the modal close mid-upload
        btn.disabled = dsSel.disabled = monthEl.disabled = input.disabled = true;
        result.innerHTML = ''; bar.classList.add('show'); barFill.style.width = '0';
        const dataset = dsSel.value;
        let loadedTotal = 0, lastRebuilt = [];
        try {
            for (let fi = 0; fi < files.length; fi += 1) {
                const mode = fi === 0 ? 'replace' : 'append';         // first file replaces the month, rest append
                const rebuild = fi === files.length - 1;              // rebuild aggregates once, at the end
                status.textContent = `File ${fi + 1}/${files.length}: ${files[fi].name}`;
                const st = await uploadFile(files[fi], { dataset, month, mode, rebuild, onProg: (frac, label) => {
                    barFill.style.width = `${Math.round(((fi + frac) / files.length) * 100)}%`;
                    status.textContent = `File ${fi + 1}/${files.length} — ${label}`;
                } });
                loadedTotal += Number(st.rows || 0);
                if (st.rebuilt?.length) lastRebuilt = st.rebuilt;
            }
            barFill.style.width = '100%'; status.textContent = 'Done';
            result.innerHTML = `<div class="callout-ok"><b>Loaded ${loadedTotal.toLocaleString()} rows</b> into
              <code>${dataset}</code> for <code>${month}</code>.${lastRebuilt.length ? ` Rebuilt: ${lastRebuilt.join(', ')}.` : ''}
              ${files.length > 1 ? `<br><span class="cap">${files.length} files (1 replace + ${files.length - 1} append).</span>` : ''}</div>`;
            files = []; renderFiles();
            if (typeof onDone === 'function') { try { await onDone(); } catch { /* refresh best-effort */ } }
        } catch (e) {
            status.textContent = 'Failed';
            result.innerHTML = `<div class="callout-bad"><b>Upload failed</b> — ${String(e.message || e)}</div>`;
        } finally {
            busy = false; xBtn.disabled = false;
            btn.disabled = dsSel.disabled = monthEl.disabled = input.disabled = false;
        }
    };
}
