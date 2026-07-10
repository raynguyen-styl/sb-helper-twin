// Upload-data window — (re)load a SMART Buddy table into the shared ClickHouse via the
// ingestion-service (POST /smartbuddy-ingest/ingest). The file is transformed + PII-hashed
// server-side; the target table is replaced and the Playback aggregates rebuilt. Keycloak-gated
// (the browser's Bearer is validated at the client nginx before reaching the ingest service).
import { openWindow } from './windowing.js';
import { authReady, authToken } from './auth.js';

const INGEST = '/smartbuddy-ingest';   // same-origin; client nginx proxies to smartbuddy-ingest

// Supported target tables (must match ingestion-service /datasets). Friendly label + hint.
const DATASETS = [
  { id: 'feb_txn',          label: 'Canteen transactions',        hint: 'card ids are hashed on the server; rebuilds tx + Playback (school daily).' },
  { id: 'feb_health',       label: 'Wearable activity (30-min)',  hint: 'user ids hashed; rebuilds Playback (wearable daily).' },
  { id: 'feb_heart_rate',   label: 'Heart rate (hourly)',         hint: 'user_id + sync_id hashed.' },
  { id: 'txn_perf_202602',  label: 'Transaction network speed',   hint: 'no personal ids.' },
  { id: 'schools',          label: 'School dimension (MOE)',      hint: 'no personal ids.' },
];

const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`);

export function openUpload() {
  const body = openWindow({ id: 'upload', title: 'Upload data', sub: 'load a table into ClickHouse', chips: [] });
  if (!body) return;
  const tw = body.closest('.tw'); tw.style.width = '460px';

  body.innerHTML = `
    <div class="cap">Upload a <b>Parquet</b> or <b>CSV</b> to (re)load a table. The server transforms it,
    <b>hashes personal ids</b> (card/user ids are never stored raw), <b>replaces</b> the table, and rebuilds
    the Playback aggregates. Requires sign-in.</div>

    <h5>Dataset</h5>
    <select class="finput up-dataset" style="width:100%">
      ${DATASETS.map((d) => `<option value="${d.id}">${d.label} &nbsp;(${d.id})</option>`).join('')}
    </select>
    <div class="cap up-hint" style="margin-top:5px"></div>

    <h5>File</h5>
    <div class="up-drop"><span class="big">⬆</span>Drop a .parquet / .csv here, or click to choose</div>
    <input type="file" class="up-input" accept=".parquet,.csv" hidden />
    <div class="up-file" hidden><span class="up-name"></span><button class="x" title="Remove">✕</button></div>

    <div class="up-bar"><i></i></div>

    <div style="display:flex;gap:10px;align-items:center;margin-top:12px">
      <button class="up-btn" disabled>Upload &amp; ingest</button>
      <span class="up-status cap"></span>
    </div>
    <div class="up-result" style="margin-top:12px"></div>`;

  const $ = (s) => body.querySelector(s);
  const dsSel = $('.up-dataset'); const hint = $('.up-hint');
  const drop = $('.up-drop'); const input = $('.up-input');
  const fileRow = $('.up-file'); const fileName = $('.up-name'); const removeBtn = $('.up-file .x');
  const bar = $('.up-bar'); const barFill = $('.up-bar > i');
  const btn = $('.up-btn'); const status = $('.up-status'); const result = $('.up-result');

  let file = null;
  const showHint = () => { hint.textContent = DATASETS.find((d) => d.id === dsSel.value)?.hint || ''; };
  showHint();
  dsSel.onchange = showHint;

  function setFile(f) {
    file = f || null;
    if (file) {
      fileName.textContent = `${file.name} · ${fmtBytes(file.size)}`;
      fileRow.hidden = false; btn.disabled = false;
    } else {
      fileRow.hidden = true; btn.disabled = true; input.value = '';
    }
    result.innerHTML = ''; barFill.style.width = '0'; bar.classList.remove('show'); status.textContent = '';
  }

  drop.onclick = () => input.click();
  input.onchange = () => setFile(input.files[0]);
  removeBtn.onclick = () => setFile(null);
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (ev) => { if (ev.dataTransfer.files[0]) setFile(ev.dataTransfer.files[0]); });

  btn.onclick = async () => {
    if (!file) return;
    await authReady;
    btn.disabled = true; dsSel.disabled = true; result.innerHTML = '';
    bar.classList.add('show'); barFill.style.width = '0'; status.textContent = 'Uploading…';

    const fd = new FormData();
    fd.append('dataset', dsSel.value);
    fd.append('mode', 'replace');
    fd.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${INGEST}/ingest`);
    const tok = authToken(); if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) barFill.style.width = `${Math.round((e.loaded / e.total) * 92)}%`; };
    xhr.onload = () => {
      barFill.style.width = '100%';
      dsSel.disabled = false; btn.disabled = false;
      let res; try { res = JSON.parse(xhr.responseText); } catch { res = { error: xhr.responseText || `HTTP ${xhr.status}` }; }
      if (xhr.status >= 200 && xhr.status < 300 && !res.error) {
        status.textContent = 'Done';
        result.innerHTML = `<div class="callout-ok"><b>Loaded ${Number(res.rows || 0).toLocaleString()} rows</b>
          into <code>${res.table || dsSel.value}</code>.${res.rebuilt?.length ? ` Rebuilt: ${res.rebuilt.join(', ')}.` : ''}</div>`;
      } else {
        status.textContent = 'Failed';
        const msg = res.error || res.detail || `HTTP ${xhr.status}`;
        result.innerHTML = `<div class="callout-bad"><b>Upload failed</b> — ${String(msg)}${res.hint ? `<br><span class="cap">${res.hint}</span>` : ''}</div>`;
      }
    };
    xhr.onerror = () => {
      dsSel.disabled = false; btn.disabled = false; status.textContent = 'Failed';
      result.innerHTML = `<div class="callout-bad"><b>Network/error</b> — could not reach the ingest service (are you signed in?).</div>`;
    };
    xhr.send(fd);
  };
}
