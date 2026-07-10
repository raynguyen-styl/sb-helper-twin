#!/usr/bin/env node
/**
 * sb-upload.mjs — drive the SMART Buddy dashboard's CHUNKED upload from the CLI, exactly like the
 * browser does: POST /uploads → PUT parts → complete → poll. Reads files straight off disk in 32 MB
 * parts (never loads a whole file), and auto-refreshes the Keycloak token so multi-GB uploads that
 * outlast a 5-min access token keep going.
 *
 * Auth (endpoint is Keycloak-gated): put ONE of these in scripts/.sb-auth.json (gitignored):
 *   { "refresh_token": "…" }                    ← recommended (from a logged-in browser session)
 *   { "access_token": "…", "refresh_token": "…" }
 *   { "username": "…", "password": "…" }         ← only if the smart-buddy client allows Direct grants
 *
 * Run:  node scripts/sb-upload.mjs            # upload the built-in manifest (both months)
 *       node scripts/sb-upload.mjs verify     # just re-check what's loaded
 *       node scripts/sb-upload.mjs 2026-03 transactions   # one (month, dataset) from the manifest
 */
import { readFile, writeFile, open, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.env.SB_BASE || 'https://smartbuddy-helper-uat.styl.solutions').replace(/\/$/, '');
const KC = (process.env.SB_KC_URL || 'https://iot-uat.styl.solutions/auth').replace(/\/$/, '');
const REALM = process.env.SB_KC_REALM || 'styl-iot';
const CLIENT = process.env.SB_KC_CLIENT || 'smart-buddy';
const DATA_ROOT = process.env.SB_DATA_ROOT || 'C:/Users/STYLSG/Desktop';
const AUTH_FILE = new URL('./.sb-auth.json', import.meta.url);
const PART = 32 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtB = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.round(n / 1e3)} KB`);

// ── the upload plan (mirrors the dashboard: 1st file of a dataset replaces the month, rest append) ──
const FEB_HR = 'feb2026/Feb Health and Heart Rate data';
const MANIFEST = [
  { month: '2026-03', dataset: 'transactions',    files: ['march2026_transactions/march2026_transactions.csv'] },
  { month: '2026-03', dataset: 'items',           files: ['march2026_transactions/march2026_student_items.csv'] },
  { month: '2026-03', dataset: 'saving_spending', files: ['march2026_transactions/march2026_student_saving_spending.csv'] },
  { month: '2026-02', dataset: 'transactions',    files: ['feb2026/feb2026_transactions.csv'] },
  { month: '2026-02', dataset: 'health',          files: [1,2,3,4,5,6].map((i) => `${FEB_HR}/health_data_202602_part${i}.csv`) },
  { month: '2026-02', dataset: 'heart_rate',      files: [1,2,3,4,5,6].map((i) => `${FEB_HR}/heart_rate_202602_part${i}.csv`) },
];

// ── auth: Keycloak token with auto-refresh ─────────────────────────────────────
let auth = {};
function jwtExp(tok) { try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url')).exp * 1000; } catch { return 0; } }
async function saveAuth() { await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2)); }

async function kcPost(params) {
  const r = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT, ...params }),
  });
  if (!r.ok) throw new Error(`Keycloak token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.json();
  auth.access_token = t.access_token;
  if (t.refresh_token) auth.refresh_token = t.refresh_token;   // persist rotated refresh token
  await saveAuth();
  return auth.access_token;
}
async function token() {
  if (auth.access_token && Date.now() < jwtExp(auth.access_token) - 30000) return auth.access_token;
  if (auth.refresh_token) return kcPost({ grant_type: 'refresh_token', refresh_token: auth.refresh_token });
  if (auth.username && auth.password) return kcPost({ grant_type: 'password', username: auth.username, password: auth.password });
  if (auth.access_token) return auth.access_token;             // last resort: use it until it 401s
  throw new Error('No usable auth in scripts/.sb-auth.json (need refresh_token, or username+password).');
}

async function api(pathname, { method = 'GET', body, json, raw = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = { Authorization: `Bearer ${await token()}` };
    if (json) headers['Content-Type'] = 'application/json';
    const r = await fetch(`${BASE}${pathname}`, { method, headers, body: json ? JSON.stringify(json) : body });
    if (r.status === 401 && attempt === 0) { auth.access_token = null; continue; }   // force refresh once
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!r.ok) throw new Error(`${pathname} → ${r.status}: ${data.error || data.detail || text.slice(0, 200)}`);
    return raw ? text : data;
  }
}

// ── one file through the chunked protocol ──────────────────────────────────────
async function uploadFile(abs, { dataset, month, mode, rebuild }) {
  const size = (await stat(abs)).size;
  const totalParts = Math.max(1, Math.ceil(size / PART));
  const name = path.basename(abs);
  process.stdout.write(`    ${name} (${fmtB(size)}, ${totalParts} parts, mode=${mode}) `);
  const { id } = await api('/smartbuddy-ingest/uploads', { method: 'POST', json: {
    dataset, month, mode, rebuild, filename: name, size, part_size: PART, total_parts: totalParts } });

  const fd = await open(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(PART);
    for (let i = 0; i < totalParts; i += 1) {
      const len = Math.min(PART, size - i * PART);
      await fd.read(buf, 0, len, i * PART);
      let ok = false;
      for (let a = 0; a < 4 && !ok; a += 1) {
        try { await api(`/smartbuddy-ingest/uploads/${id}/parts/${i}`, { method: 'PUT', body: buf.subarray(0, len) }); ok = true; }
        catch (e) { if (a === 3) throw e; await sleep(600 * (a + 1)); }
      }
      process.stdout.write(`\r    ${name} — uploaded ${i + 1}/${totalParts} parts   `);
    }
  } finally { await fd.close(); }

  await api(`/smartbuddy-ingest/uploads/${id}/complete`, { method: 'POST', json: {} });
  for (;;) {
    await sleep(2000);
    const st = await api(`/smartbuddy-ingest/uploads/${id}`);
    if (st.phase === 'done') { console.log(`\r    ${name} — done: ${Number(st.rows || 0).toLocaleString()} rows${st.rebuilt?.length ? `, rebuilt ${st.rebuilt.join('/')}` : ''}          `); return st; }
    if (st.phase === 'error') throw new Error(`load failed: ${st.error}`);
    process.stdout.write(`\r    ${name} — ${st.phase}${st.load_rows ? ` (${Number(st.load_rows).toLocaleString()} rows)` : ''}          `);
  }
}

async function uploadDataset({ month, dataset, files }) {
  console.log(`\n▶ ${month} · ${dataset} (${files.length} file${files.length > 1 ? 's' : ''})`);
  const abss = files.map((f) => path.join(DATA_ROOT, f));
  for (const a of abss) if (!existsSync(a)) throw new Error(`missing file: ${a}`);
  let total = 0, rebuilt = [];
  for (let i = 0; i < abss.length; i += 1) {
    const st = await uploadFile(abss[i], { dataset, month, mode: i === 0 ? 'replace' : 'append', rebuild: i === abss.length - 1 });
    total += Number(st.rows || 0); if (st.rebuilt?.length) rebuilt = st.rebuilt;
  }
  console.log(`  ✓ ${dataset} ${month}: ${total.toLocaleString()} rows loaded${rebuilt.length ? `; bundles ${rebuilt.join(', ')}` : ''}`);
}

// ── verification ────────────────────────────────────────────────────────────────
async function verify() {
  console.log('\n═══ verify ═══');
  const months = await api('/smartbuddy-api/api/months');
  console.log('months in ClickHouse:', JSON.stringify(months));
  for (const m of months) {
    for (const kind of m.kinds) {
      try {
        const b = await api(`/smartbuddy-api/api/insights?month=${m.month}&kind=${kind}`);
        const meta = b.meta || {};
        const note = kind === 'global' ? `${meta.txns?.toLocaleString?.() || '?'} txns, $${Math.round(meta.sgd || 0).toLocaleString()}, ${meta.schools_mapped}/${meta.schools_total} mapped`
          : kind === 'stalls' ? `${b.stalls?.length || 0} stalls, ${b.terminals?.length || 0} terminals`
          : kind === 'schools' ? `${Object.keys(b.schools || {}).length} schools`
          : kind === 'items' ? `${(b.meta?.rows || 0).toLocaleString()} items, ${(b.by_type || []).length} types`
          : kind === 'savings' ? `${b.totals?.students?.toLocaleString?.() || 0} students, save-rate hist ${(b.rate_hist || []).length}`
          : 'ok';
        console.log(`  ${m.month}/${kind}: ${note}`);
      } catch (e) { console.log(`  ${m.month}/${kind}: ERROR ${e.message}`); }
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(new URL('.', AUTH_FILE)) || !existsSync(AUTH_FILE)) {
    console.error(`Create ${path.basename(AUTH_FILE.pathname)} in scripts/ with a refresh_token (see header).`); process.exit(1);
  }
  auth = JSON.parse(await readFile(AUTH_FILE, 'utf8'));
  const args = process.argv.slice(2);
  if (args[0] === 'verify') { await verify(); return; }

  let plan = MANIFEST;
  if (args.length === 2) plan = MANIFEST.filter((x) => x.month === args[0] && x.dataset === args[1]);
  if (!plan.length) { console.error('nothing matched; args: [month dataset] | verify'); process.exit(1); }

  console.log(`Uploading ${plan.length} dataset(s) to ${BASE}`);
  for (const item of plan) await uploadDataset(item);
  await verify();
  console.log('\n✓ all done');
}
main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
