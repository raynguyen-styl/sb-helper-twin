// The eight mesh tests (central-specs/docs/sb_helper_agent_mesh_setup.md §10.1): one per specialist (1–5, each
// reached alone through the entry point by the retry hint in the context) and three for the orchestrator (6–8: one,
// two and three specialists). Publishes each question on the dashboard's chat topic, exactly as the dashboard does
// (src/sam/samClient.js: one JSON envelope, DIRECT, matched by correlationId), waits for the orchestrator's reply and
// checks it against scripts/mesh-tests.json.
//
//   node --env-file=.env scripts/mesh-tests.mjs                 the live entry point
//   node --env-file=.env scripts/mesh-tests.mjs --test          the test entry point
//   node --env-file=.env scripts/mesh-tests.mjs --only 1,3 --out replies.jsonl
//   node scripts/mesh-tests.mjs --direct [--only 2]             print the message to paste when asking a
//                                                               specialist directly in the mesh (no broker)
//
// The broker comes from the dashboard's own values (VITE_SOLACE_URL, _VPN, _USER, _PASSWORD; SOLACE_* also work)
// and is never printed beyond its host. Exit code 0 when every test passes.
import solace from 'solclientjs';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const cfg = JSON.parse(readFileSync(new URL('./mesh-tests.json', import.meta.url), 'utf8'));
const env = (...names) => names.map((n) => process.env[n]).find((v) => v != null && v !== '') || '';
const only = opt('--only') ? new Set(opt('--only').split(',').map(Number)) : null;
const tests = cfg.tests.filter((t) => !only || only.has(t.id));

if (flag('--direct')) {
    // The specialist tests, as the orchestrator would send them: paste into the mesh (Agent Management → the
    // specialist's row → Chat with Agent) and expect the specialist's own object {answer, source, report, steps}.
    for (const t of tests.filter((x) => x.direct)) {
        console.log(`Test ${t.id} · ask ${t.agent} directly · ${t.name}\n${'-'.repeat(72)}\n${t.direct}\n\nexpect: one raw JSON object {answer, source, report, steps}; source names the views; confirm: ${t.confirm}\n`);
    }
    process.exit(0);
}

const base = flag('--test') ? cfg.topics.test : cfg.topics.live;
const TOPIC = flag('--test') || !env('VITE_SAM_TOPIC_REQUEST')
    ? { request: `${base}/request`, response: `${base}/response`, error: `${base}/error` }
    : { request: env('VITE_SAM_TOPIC_REQUEST'), response: env('VITE_SAM_TOPIC_RESPONSE'), error: env('VITE_SAM_TOPIC_ERROR') };
const url = env('SOLACE_URL', 'VITE_SOLACE_URL', 'VITE_SOLACE_HOST');
if (!url) { console.error('No broker: set VITE_SOLACE_URL (run with --env-file=.env from the twin).'); process.exit(2); }

/* ---------- the broker, as the dashboard uses it ---------- */
const fp = new solace.SolclientFactoryProperties();
fp.profile = solace.SolclientFactoryProfiles.version10;
fp.logLevel = solace.LogLevel.ERROR;
solace.SolclientFactory.init(fp);
const session = solace.SolclientFactory.createSession({
    url, vpnName: env('SOLACE_VPN', 'VITE_SOLACE_VPN') || 'default',
    userName: env('SOLACE_USER', 'VITE_SOLACE_USER'), password: env('SOLACE_PASSWORD', 'VITE_SOLACE_PASSWORD', 'VITE_SOLACE_PASS'),
    clientName: `smartbuddy-mesh-tests-${Date.now()}`, connectRetries: 0, reconnectRetries: 0,
});
const inbox = [];            // { topic, at, text }
let wake = () => {};
const decode = (raw) => {
    if (raw == null) return '';
    if (typeof raw === 'string') return [...raw].some((c) => c.charCodeAt(0) > 255) ? raw : Buffer.from(raw, 'latin1').toString('utf8');
    return new TextDecoder('utf-8').decode(raw instanceof ArrayBuffer ? raw : new Uint8Array(raw));
};
session.on(solace.SessionEventCode.MESSAGE, (m) => {
    inbox.push({ topic: m.getDestination()?.getName?.() || '', at: Date.now(), text: decode(m.getBinaryAttachment()) });
    wake();
});
await new Promise((resolve, reject) => {
    session.on(solace.SessionEventCode.UP_NOTICE, resolve);
    session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e) => reject(new Error(`cannot connect to the broker: ${e.message || e.infoStr || e}`)));
    session.connect();
}).catch((e) => { console.error(e.message); process.exit(2); });
const subscribe = (topic) => new Promise((resolve, reject) => {
    const done = (e) => {
        if (e.correlationKey !== topic) return;
        session.removeListener(solace.SessionEventCode.SUBSCRIPTION_OK, done);
        resolve();
    };
    session.on(solace.SessionEventCode.SUBSCRIPTION_OK, done);
    session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (e) => { if (e.correlationKey === topic) reject(new Error(`cannot subscribe ${topic}: ${e.infoStr || ''}`)); });
    session.subscribe(solace.SolclientFactory.createTopicDestination(topic), true, topic, 10000);
});
await subscribe(TOPIC.response);
if (TOPIC.error) await subscribe(TOPIC.error);
const publish = (body) => {
    const m = solace.SolclientFactory.createMessage();
    m.setDestination(solace.SolclientFactory.createTopicDestination(TOPIC.request));
    m.setBinaryAttachment(body);
    m.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
    session.send(m);
};
console.log(`Broker ${url.replace(/\/\/[^@/]*@/, '//')} · request topic ${TOPIC.request}\n`);

/* ---------- reading a reply ---------- */
// The contract: one raw JSON object. Salvage a fenced or prefixed object only to check the rest (the raw-JSON
// check still fails), as the dashboard's chat would show it.
function parse(text) {
    try { const o = JSON.parse(text); if (o && typeof o === 'object' && !Array.isArray(o)) return { obj: o, raw: true }; } catch { /* salvage */ }
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) try { return { obj: JSON.parse(text.slice(a, b + 1)), raw: false }; } catch { /* not JSON */ }
    return { obj: null, raw: false };
}
const RECEIPT = /^\s*Request received by gateway/i;
const isProgress = (o) => o && /^(working|progress|routing|running|querying)$/i.test(String(o.status || '')) && !o.reply;
const NUM = /(\d[\d,]*(?:\.\d+)?) ?(k|K|M|million)?\b/g;
const numbersIn = (s) => [...String(s || '').matchAll(NUM)]
    .map((m) => Number.parseFloat(m[1].replaceAll(',', '')) * ({ k: 1e3, K: 1e3, M: 1e6, million: 1e6 }[m[2]] || 1));
const near = (v, want, pct) => Math.abs(v - want) <= Math.abs(want) * pct / 100;
const specialists = (o) => (Array.isArray(o.agents) ? o.agents : []).filter((a) => a && a.name !== 'sb_orchestrator' && a.role !== 'orchestrator');
const visuals = (r) => [...(r?.charts || []), ...(r?.tables || [])];

function check(t, reply, elapsed) {
    const out = [];
    const ok = (name, pass, detail = '') => out.push({ name, pass: !!pass, detail });
    const e = t.expect;
    if (!reply) { ok('a reply arrives in time', false, `nothing within ${t.timeoutSeconds || cfg.timeoutSeconds} s`); return out; }
    if (reply.error) { ok('no error on the error topic', false, reply.text.slice(0, 200)); return out; }
    const { obj, raw } = parse(reply.text);
    ok('a reply arrives in time', true, `${(elapsed / 1000).toFixed(1)} s`);
    ok('not "I\'m ready / send the JSON question"', !/i'?m ready|send (me )?the (json|question)|waiting for (the|your) (question|input)/i.test(reply.text), reply.text.slice(0, 120));
    ok('one raw JSON object (no fence, nothing around it)', raw, raw ? '' : reply.text.slice(0, 80));
    if (!obj) return out;
    ok('the correlationId is echoed', obj.correlationId === reply.id, obj.correlationId ? `got ${obj.correlationId}` : 'missing');
    const text = String(obj.reply ?? '');
    ok('"reply" is non-empty Markdown text', text.trim().length > 0 && !/<\s*[a-z][^>]*>/i.test(text), /<\s*[a-z][^>]*>/i.test(text) ? 'HTML in reply' : '');
    ok('"actions" is []', Array.isArray(obj.actions) && obj.actions.length === 0);
    ok('no token or id in the reply', !/\bsb_[0-9a-f]{6,}/i.test(reply.text) && !/\b[0-9a-f]{32,}\b/i.test(reply.text));
    ok(`kind "${e.kind}"`, obj.kind === e.kind, `got ${obj.kind}`);
    const agents = Array.isArray(obj.agents) ? obj.agents : [];
    ok('agents lists sb_orchestrator first', agents[0]?.name === 'sb_orchestrator', agents.map((a) => a?.name).join(', '));
    const sp = specialists(obj);
    for (const name of e.specialistsDone || []) {
        const a = sp.find((x) => x.name === name);
        ok(`${name} ran and is done`, a?.status === 'done', a ? `status ${a.status}` : 'not listed');
    }
    if (e.onlySpecialists) {
        const extra = sp.filter((a) => a.status !== 'skipped' && !e.onlySpecialists.includes(a.name)).map((a) => a.name);
        ok(e.onlySpecialists.length ? `no specialist besides ${e.onlySpecialists.join(', ')}` : 'no specialist ran', !extra.length, extra.join(', '));
    }
    for (const s of e.agentSource || []) {
        const a = sp.find((x) => x.name === s.agent);
        ok(`${s.agent} names its source /${s.matches}/`, new RegExp(s.matches, 'i').test(String(a?.source ?? '')), a ? `source ${a.source ?? 'missing'}` : 'not listed');
    }
    const r = obj.report ?? null;
    if (e.report === null) ok('report is null (one figure, or none)', r === null, r ? `mode ${r.mode}` : '');
    else ok(`report.mode "${e.report}"`, r?.mode === e.report, r ? `mode ${r.mode}` : 'report null');
    if (r) {
        const k = (r.kpis || []).length, c = (r.charts || []).length, tb = (r.tables || []).length;
        if (r.mode === 'brief') ok('brief: at most 3 kpis and one chart or one table', k <= 3 && c + tb <= 1, `${k} kpis, ${c} charts, ${tb} tables`);
        if (r.mode === 'report') ok('report: at most 6 kpis, 4 charts, 3 tables', k <= 6 && c <= 4 && tb <= 3, `${k} kpis, ${c} charts, ${tb} tables`);
        ok('every chart and table names its agent', visuals(r).every((v) => v && v.agent));
        ok('figures are numbers', (r.kpis || []).every((x) => typeof x.value === 'number')
            && (r.charts || []).every((ch) => (ch.series || []).every((s) => (s.points || []).every((p) => typeof p[1] === 'number'))));
        if (e.maxKpis != null) ok(`at most ${e.maxKpis} kpis`, k <= e.maxKpis, `${k}`);
        if (e.period) ok(`period ${e.period}`, r.period === e.period, `got ${r.period}`);
        if (e.visualsFrom) for (const a of e.visualsFrom) ok(`a chart or table from ${a}`, visuals(r).some((v) => v.agent === a));
        if (e.figuresFrom) {
            const owners = new Set([...(r.kpis || []), ...visuals(r)].map((v) => v?.agent));
            for (const a of e.figuresFrom) ok(`a kpi, chart or table from ${a}`, owners.has(a), [...owners].join(', '));
        }
        if (e.table) {
            const tbl = (r.tables || [])[0];
            ok(`a table with ${e.table.columns.join(', ')}`, tbl && e.table.columns.every((col, i) => String(tbl.columns?.[i] || '').toLowerCase() === col.toLowerCase()),
                tbl ? (tbl.columns || []).join(', ') : 'no table');
            ok(`at most ${e.table.maxRows} rows, from ${e.table.agent}`, tbl && (tbl.rows || []).length <= e.table.maxRows && (tbl.rows || []).length > 0 && tbl.agent === e.table.agent,
                tbl ? `${(tbl.rows || []).length} rows, agent ${tbl.agent}` : '');
        }
        if (e.top) {
            const v = visuals(r)[0];
            // a chart's first series, or a table's school-name and spend columns (found by their headers)
            const cols = (v?.columns || []).map((c) => String(c).toLowerCase());
            const ni = Math.max(0, cols.findIndex((c) => /school|name/.test(c)));
            const vi = cols.findIndex((c) => /spend|s\$|sgd|revenue|amount/.test(c));
            const rows = v?.series ? (v.series[0]?.points || []).map((p) => [p[0], p[1]])
                : (v?.rows || []).map((row) => [row[ni], vi >= 0 ? row[vi] : row.find((x) => typeof x === 'number')]);
            const [name, value] = rows[0] || [];
            ok(`${e.top.rows} rows from ${e.top.agent}`, rows.length === e.top.rows && v.agent === e.top.agent, `${rows.length} rows, agent ${v?.agent}`);
            ok(`first: ${e.top.name}`, String(name || '').trim().toLowerCase() === e.top.name.toLowerCase(), String(name));
            ok(`its figure within ${e.top.tolerancePct}% of ${e.top.value}${e.top.from ? ` (${e.top.from})` : ''}`, typeof value === 'number' && near(value, e.top.value, e.top.tolerancePct), String(value));
            ok('largest first', rows.every((x, i) => i === 0 || !(typeof x[1] === 'number' && typeof rows[i - 1][1] === 'number') || x[1] <= rows[i - 1][1]));
        }
    }
    for (const re of e.replyMatches || []) ok(`reply says /${re}/`, new RegExp(re, 'i').test(text));
    for (const re of e.replyNotMatches || []) ok(`reply never says /${re}/`, !new RegExp(re, 'i').test(reply.text));
    for (const f of e.figures || []) {
        const nums = [...numbersIn(text), ...(r?.kpis || []).map((x) => x.value)];
        const hit = nums.find((v) => near(v, f.value, f.tolerancePct));
        ok(`${f.label} within ${f.tolerancePct}% of ${f.value}${f.from ? ` (${f.from})` : ''}`, hit != null, hit != null ? String(hit) : `numbers seen: ${nums.slice(0, 6).join(', ')}`);
    }
    if (e.stepsFrom) for (const a of e.stepsFrom) ok(`steps from ${a}`, (obj.steps || []).some((s) => s && s.agent === a));
    if (e.minSuggestions) ok(`at least ${e.minSuggestions} suggestion(s)`, (obj.suggestions || []).length >= e.minSuggestions, `${(obj.suggestions || []).length}`);
    if (e.maxReplyChars) ok(`reply under ${e.maxReplyChars} characters`, text.length <= e.maxReplyChars, `${text.length}`);
    return out;
}

/* ---------- run, one test at a time ---------- */
const results = [], log = [];
for (const t of tests) {
    const id = `mesh-test-${t.id}-${Date.now()}`;
    const wait = (t.timeoutSeconds || cfg.timeoutSeconds) * 1000;
    const start = Date.now();
    inbox.length = 0;
    publish(JSON.stringify({ correlationId: id, text: t.text, context: t.context || '', ts: start }));
    process.stdout.write(`Test ${t.id} · ${t.agent}${t.involves ? ` with ${t.involves} specialist${t.involves > 1 ? 's' : ''}` : ' alone'} · ${t.name}\n  asks: "${t.text}"${t.context ? `  ${t.context}` : ''}\n  waiting… `);
    let reply = null, receipts = 0, progress = 0;
    while (!reply && Date.now() - start < wait) {
        for (const m of inbox.splice(0)) {
            const isErr = m.topic === TOPIC.error;
            const { obj } = parse(m.text);
            if (!isErr && RECEIPT.test(m.text)) { receipts++; continue; }
            if (!isErr && isProgress(obj)) { progress++; continue; }
            const mid = obj?.correlationId;
            if (mid && mid !== id) continue;                       // someone else's question on the shared topic
            reply = { id, text: m.text, error: isErr, idless: !mid };
            break;
        }
        if (!reply) await new Promise((r) => { wake = r; setTimeout(r, 500); });
    }
    const elapsed = Date.now() - start;
    const checks = check(t, reply, elapsed);
    const passed = checks.every((c) => c.pass);
    results.push({ id: t.id, passed });
    log.push({ test: t.id, text: t.text, elapsedMs: elapsed, receipts, progress, reply: reply?.text ?? null });
    console.log(`${passed ? 'PASS' : 'FAIL'}${receipts ? ` (${receipts} receipt)` : ''}${progress ? ` (${progress} progress)` : ''}${reply?.idless ? ' (reply had no correlationId)' : ''}`);
    for (const c of checks) {
        const show = c.detail && (!c.pass || c.name === 'a reply arrives in time');     // details on failures, and the time taken
        console.log(`   ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${show ? ' — ' + c.detail : ''}`);
    }
    console.log(`   confirm: ${t.confirm}\n`);
}
if (opt('--out')) writeFileSync(opt('--out'), log.map((l) => JSON.stringify(l)).join('\n') + '\n');
const n = results.filter((r) => r.passed).length;
console.log(`${n}/${results.length} tests passed${opt('--out') ? ` · replies in ${opt('--out')}` : ''}`);
session.disconnect();
setTimeout(() => process.exit(n === results.length ? 0 : 1), 200);
