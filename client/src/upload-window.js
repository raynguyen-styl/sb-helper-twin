// Upload-data window — CHUNKED, RESUMABLE, size-unlimited upload into the shared ClickHouse via the
// ingestion-service. A file is split into fixed-size PARTS uploaded one by one (peak memory = one
// part, so multi-GB files are fine); the server assembles + loads it (PII hashed) into the chosen
// month's partition, then rebuilds the aggregates. You can select SEVERAL files for one dataset
// (e.g. Feb health ships as 6 parts) — the first REPLACES the month, the rest APPEND, and the
// aggregate rebuild runs once at the end. Keycloak-gated at the client nginx (Bearer).
import { openWindow } from './windowing.js';
import { authReady, authToken } from './auth.js';

const INGEST = '/smartbuddy-ingest';          // same-origin; client nginx proxies to smartbuddy-ingest
const PART_SIZE = 32 * 1024 * 1024;           // 32 MB parts
const PART_RETRIES = 4;

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

export async function openUpload(onDone) {
    const body = openWindow({ id: 'upload', title: 'Upload data', sub: 'load a month into ClickHouse', chips: [] });
    if (!body) return;
    const tw = body.closest('.tw'); if (tw) tw.style.width = '480px';

    let datasets = [{ id: 'transactions', label: 'Canteen transactions' }];
    try { const d = await api('/datasets'); if (d.datasets?.length) datasets = d.datasets; } catch { /* gate/offline */ }

    body.innerHTML = `
      <div class="cap">Upload a <b>Parquet</b> or <b>CSV</b> (any size — split into parts automatically).
      The server <b>hashes personal ids</b> (card/user ids never stored raw; names dropped), loads it
      into the chosen <b>month</b>, and rebuilds the dashboard aggregates. Requires sign-in.</div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
        <div style="flex:1;min-width:150px"><h5>Month</h5>
          <input type="month" class="finput up-month" style="width:100%" /></div>
        <div style="flex:2;min-width:200px"><h5>Dataset</h5>
          <select class="finput up-dataset" style="width:100%">
            ${datasets.map((d) => `<option value="${d.id}">${d.label}${d.months ? ` · ${d.months}` : ''}</option>`).join('')}
          </select></div>
      </div>
      <div class="cap up-hint" style="margin-top:5px"></div>

      <h5>File(s)</h5>
      <div class="up-drop"><span class="big">⬆</span>Drop .parquet / .csv here, or click to choose.
        <br><span class="cap">Pick several files for one dataset (e.g. Feb health = 6 parts) — first replaces the month, rest append.</span></div>
      <input type="file" class="up-input" accept=".parquet,.csv" multiple hidden />
      <div class="up-files"></div>

      <div class="up-bar"><i></i></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:12px">
        <button class="up-btn" disabled>Upload &amp; ingest</button>
        <span class="up-status cap"></span>
      </div>
      <div class="up-result" style="margin-top:12px"></div>`;

    const $ = (s) => body.querySelector(s);
    const monthEl = $('.up-month'), dsSel = $('.up-dataset'), hint = $('.up-hint');
    const drop = $('.up-drop'), input = $('.up-input'), filesEl = $('.up-files');
    const bar = $('.up-bar'), barFill = $('.up-bar > i'), btn = $('.up-btn'), status = $('.up-status'), result = $('.up-result');

    let files = [];
    const showHint = () => { hint.textContent = datasets.find((d) => d.id === dsSel.value)?.hint || ''; };
    showHint(); dsSel.onchange = showHint;

    const renderFiles = () => {
        filesEl.innerHTML = files.map((f, i) =>
            `<div class="up-file"><span class="up-name">${f.name} · ${fmtBytes(f.size)}</span>
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
            btn.disabled = dsSel.disabled = monthEl.disabled = input.disabled = false;
        }
    };
}
