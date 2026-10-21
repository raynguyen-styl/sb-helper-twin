/**
 * samClient.js — the SMART Buddy chat's client for the backend's chat route (central-specs decision 0007,
 * capabilities chat-bridge and sam-chat). The browser holds no broker login and opens no broker connection:
 * each question is one `POST {VITE_SB_API_URL}/api/sam/ask` with the viewer's CIAM token and the body
 * {text, context}, answered as an event stream —
 *   `received`  the mesh has the question (marks "Received");
 *   `progress`  {agents} while the agents work (the routing card);
 *   `answer`    the reply object, then the stream ends;
 *   `error`     {code, message}, then the stream ends.
 * The route owns the wait (150 s, 300 s for a report question) and the matching; the chat keeps no wait of its
 * own beyond ending a stream that carries nothing — not even a keep-alive — for 30 s.
 *
 * The reply (capability agent-system, decision 0006) is {correlationId, reply (Markdown subset), actions, kind?,
 * agents?, report? (mode "brief" | "report"), suggestions?, steps? [{agent, text}]}. The route checks its shape;
 * everything is still normalised here into bounded plain values, and the panel never reads the raw payload.
 */

import { validToken } from "../auth.js";
import { createSseParser } from "./sse.js";

const API_BASE = (import.meta.env.VITE_SB_API_URL || "").replace(/\/$/, "");
const SILENCE_MS = 30000;                      // twice the route's 15 s keep-alive

// What the panel says for each way a question can fail (sam-chat, "The viewer sees when no agent answers").
// `offline` drives the offline badge; `retry` whether a Retry chip is offered.
export const FAILURES = Object.freeze({
  timeout:          { offline: false, retry: true,  text: "No answer came within the wait. The agents may be busy; try again, or ask a narrower question." },
  broker_down:      { offline: true,  retry: true,  text: "SMART Buddy is offline: the message broker is not reachable. The rest of the dashboard still works; try again in a minute." },
  unreachable:      { offline: true,  retry: true,  text: "SMART Buddy is offline: the chat service did not answer. The rest of the dashboard still works; try again in a minute." },
  reply_unmatched:  { offline: false, retry: true,  text: "The agents answered, but not this question: they did not see it. This is a setup fault on the agents' side, not your question; it has been logged." },
  wrong_question:   { offline: false, retry: true,  text: "The agents answered without seeing this question. This is a setup fault on the agents' side, not your question; it has been logged." },
  invalid_reply:    { offline: false, retry: true,  text: "The agents replied, but their answer could not be read. Try again." },
  mesh_error:       { offline: false, retry: true,  text: "The agents reported an error" },
  unauthorized:     { offline: false, retry: false, text: "Your sign-in has expired. Reload the page to sign in again." },
  auth_unavailable: { offline: false, retry: true,  text: "The sign-in service could not be reached to check your session. Try again in a minute." },
  one_at_a_time:    { offline: false, retry: true,  text: "One question at a time: wait for the current answer, then ask again." },
  too_many:         { offline: false, retry: true,  text: "That is a lot of questions in a minute. Wait a moment, then ask again." },
  busy:             { offline: false, retry: true,  text: "SMART Buddy is busy answering other people. Try again in a minute." },
  bad_request:      { offline: false, retry: false, text: "That question could not be sent: it is empty or longer than 1,000 characters." },
});
const failure = (code, message) => ({ failure: { code: FAILURES[code] ? code : "invalid_reply", message: String(message ?? "").slice(0, 300) } });

// The Event Gateway's own acknowledgement ("Request received by gateway…") is a receipt, never the answer. The
// route turns it into `received`; this check stays for replay() of captured raw exchanges.
const RECEIPT = /^\s*Request received by gateway/i;
function _isReceipt(obj) {
  if (typeof obj === "string") return RECEIPT.test(obj);
  const t = _pickReplyText(obj);
  return typeof t === "string" && RECEIPT.test(t) && !obj?.report;
}
/** Whether a raw message (a captured one, for replay) is the gateway's receipt. */
export function isReceipt(raw) {
  const { obj, plainText } = _normalizeInboundPayload(raw);
  return _isReceipt(plainText ?? obj);
}
const _sanitizeAgentName = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);

function _pickReplyText(obj) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of ["reply", "message", "text", "answer", "content", "output", "result", "body", "response", "assistantMessage", "assistant_response"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function _stripSamCodeFence(str) {
  const trimmed = typeof str === "string" ? str.trim() : "";
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}
function _extractJsonObjectText(str) {
  if (typeof str !== "string") return "";
  const start = str.indexOf("{"), end = str.lastIndexOf("}");
  return start >= 0 && end > start ? str.slice(start, end + 1).trim() : "";
}
function _unescapeSamJsonText(str) {
  if (typeof str !== "string") return "";
  return str.replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
}

function _parseSamObjectCandidate(candidate, depth = 0) {
  if (!candidate || depth > 4) return null;
  if (candidate !== null && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  const stripped = _stripSamCodeFence(trimmed);
  const unescaped = _unescapeSamJsonText(stripped);
  const extracted = _extractJsonObjectText(stripped);
  const extractedUnescaped = _extractJsonObjectText(unescaped);
  const variants = [...new Set([trimmed, stripped, extracted, unescaped, extractedUnescaped].filter(Boolean))];
  for (const value of variants) {
    try {
      const parsed = JSON.parse(value);
      const nested = _parseSamObjectCandidate(parsed, depth + 1);
      if (nested) return nested;
      if (parsed !== null && typeof parsed === "object") return parsed;
    } catch { /* try next */ }
  }
  return null;
}

function _normalizeInboundPayload(raw) {
  if (raw == null) return { obj: null, plainText: undefined };
  if (typeof raw === "string") {
    const salvaged = _parseSamObjectCandidate(raw);
    if (salvaged) return { obj: salvaged, plainText: undefined };
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { obj: { _items: parsed }, plainText: undefined };
      if (typeof parsed === "object" && parsed !== null) return { obj: parsed, plainText: undefined };
      if (typeof parsed === "string") return { obj: { text: parsed }, plainText: parsed };
      return { obj: { text: String(parsed) }, plainText: String(parsed) };
    } catch { return { obj: { text: raw }, plainText: raw }; }
  }
  if (typeof raw === "object") return { obj: raw, plainText: undefined };
  return { obj: { text: String(raw) }, plainText: String(raw) };
}

const _SKIP_DEEP_KEYS = new Set(["correlationId", "correlation_id", "requestId", "type", "status", "code", "id", "timestamp", "version"]);

function _deepLongestString(obj, depth = 0) {
  if (depth > 10 || obj == null) return "";
  if (typeof obj === "string") return obj.length > 8 ? obj : "";
  if (typeof obj !== "object") return "";
  let best = "";
  if (Array.isArray(obj)) {
    for (const el of obj) { const s = _deepLongestString(el, depth + 1); if (s.length > best.length) best = s; }
    return best;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (_SKIP_DEEP_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > best.length && v.length > 8) best = v;
    else if (v && typeof v === "object") { const s = _deepLongestString(v, depth + 1); if (s.length > best.length) best = s; }
  }
  return best;
}

// ── the extended envelope (agents, report, kind, suggestions) ─────────────────
// Everything below coerces untrusted model output into plain values the panel renders with
// textContent: strings are clipped, numbers must be finite, unknown kinds and shapes are dropped.
const REPORT_LIMITS = Object.freeze({ kpis: 6, charts: 4, tables: 3, rows: 50, points: 400, series: 6, columns: 12, notes: 12 });
const _str = (v, max = 200) => (v == null ? "" : String(v)).trim().slice(0, max);
const _num = (v) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : null; };
const _cell = (v) => (typeof v === "number" ? (Number.isFinite(v) ? v : "") : _str(v, 160));
const AGENT_STATUS = new Set(["routing", "querying", "working", "done", "failed", "timeout", "skipped"]);
const REPLY_KINDS = new Set(["answer", "refusal", "scope", "clarify"]);

export function normalizeAgents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 12)) {
    if (!a || typeof a !== "object") continue;
    const name = _sanitizeAgentName(a.name ?? a.agent ?? a.id);
    if (!name) continue;
    const status = _str(a.status, 20).toLowerCase();
    const ms = _num(a.ms ?? a.elapsed_ms ?? a.elapsedMs);
    out.push({
      name,
      display: _str(a.display ?? a.display_name ?? a.displayName, 60) || undefined,
      role: /orch/i.test(_str(a.role, 20)) || name === "sb_orchestrator" ? "orchestrator" : "specialist",
      status: AGENT_STATUS.has(status) ? status : "done",
      source: _str(a.source, 160) || undefined,
      ms: ms != null && ms >= 0 ? ms : undefined,
    });
  }
  return out;
}

function _normalizeSeries(ch) {
  // §5 shape: series[{name, points:[[x,y]]}]; the design's draft shape put `points` on the chart itself.
  const raw = Array.isArray(ch.series) && ch.series.length ? ch.series : (Array.isArray(ch.points) ? [{ name: ch.title, points: ch.points }] : []);
  const series = [];
  let trimmed = false;
  for (const s of raw.slice(0, REPORT_LIMITS.series)) {
    const pts = Array.isArray(s?.points) ? s.points : [];
    const points = [];
    for (const p of pts) {
      if (points.length >= REPORT_LIMITS.points) { trimmed = true; break; }
      if (!Array.isArray(p) || p.length < 2) continue;
      const y = _num(p[1]); if (y == null) continue;
      points.push([_str(p[0], 80), y]);
    }
    if (points.length) series.push({ name: _str(s?.name, 60) || _str(ch.title, 60) || "value", points });
  }
  return { series, trimmed };
}

export function normalizeReport(r) {
  if (!r || typeof r !== "object") return null;
  const dropped = [];
  const kpis = [];
  for (const k of (Array.isArray(r.kpis) ? r.kpis : [])) {
    if (!k || typeof k !== "object") continue;
    const value = _num(k.value); if (value == null) continue;
    if (kpis.length >= REPORT_LIMITS.kpis) { dropped.push("figures"); break; }
    const d = k.delta && typeof k.delta === "object" ? k.delta : null;
    const pct = d ? _num(d.pct ?? d.value) : null;
    kpis.push({ label: _str(k.label, 60) || "Value", value, unit: _str(k.unit, 12) || undefined,
      delta: pct != null ? { pct, vs: _str(d.vs ?? d.label, 40) } : undefined, agent: _sanitizeAgentName(k.agent) || undefined });
  }
  const charts = [];
  for (const c of (Array.isArray(r.charts) ? r.charts : [])) {
    if (!c || typeof c !== "object") continue;
    const kind = _str(c.kind, 12).toLowerCase();
    if (!["bar", "line", "stacked"].includes(kind)) { dropped.push("a chart of an unknown kind"); continue; }
    const { series, trimmed } = _normalizeSeries(c);
    if (!series.length) continue;
    if (charts.length >= REPORT_LIMITS.charts) { dropped.push("charts"); break; }
    if (trimmed) dropped.push(`points beyond ${REPORT_LIMITS.points} in "${_str(c.title, 40)}"`);
    const marks = [];
    for (const m of (Array.isArray(c.marks) ? c.marks.slice(0, 6) : [])) {
      if (m && typeof m === "object") marks.push({ from: _str(m.from, 40), to: _str(m.to ?? m.from, 40), label: _str(m.label, 30) });
    }
    charts.push({ kind, title: _str(c.title, 80) || "Chart", unit: _str(c.unit, 12) || undefined, x: _str(c.x, 30) || undefined,
      series, marks, agent: _sanitizeAgentName(c.agent) || undefined });
  }
  const tables = [];
  for (const t of (Array.isArray(r.tables) ? r.tables : [])) {
    if (!t || typeof t !== "object" || !Array.isArray(t.rows)) continue;
    if (tables.length >= REPORT_LIMITS.tables) { dropped.push("tables"); break; }
    const columns = (Array.isArray(t.columns) ? t.columns : []).slice(0, REPORT_LIMITS.columns).map((c) => _str(c, 60));
    const width = columns.length || Math.max(0, ...t.rows.map((row) => (Array.isArray(row) ? row.length : 0)));
    const rows = [];
    for (const row of t.rows) {
      if (!Array.isArray(row)) continue;
      if (rows.length >= REPORT_LIMITS.rows) { dropped.push(`rows beyond ${REPORT_LIMITS.rows} in "${_str(t.title, 40)}"`); break; }
      rows.push(Array.from({ length: Math.min(width, REPORT_LIMITS.columns) }, (_, i) => _cell(row[i])));
    }
    if (!rows.length) continue;
    const units = (Array.isArray(t.units) ? t.units : []).slice(0, REPORT_LIMITS.columns).map((u) => _str(u, 12) || undefined);
    tables.push({ title: _str(t.title, 80) || "Table", columns, rows, units, agent: _sanitizeAgentName(t.agent) || undefined });
  }
  const notes = (Array.isArray(r.notes) ? r.notes : []).slice(0, REPORT_LIMITS.notes).map((n) => _str(n, 400)).filter(Boolean);
  if (!kpis.length && !charts.length && !tables.length) return null;
  // decision 0006: "brief" = at most 3 tiles and ONE chart or table, drawn inside the answer; "report" = the full card.
  // A report without a mode is an older reply and renders as the full card.
  const modeRaw = _str(r.mode, 12).toLowerCase();
  const mode = modeRaw === "brief" || modeRaw === "report" ? modeRaw : undefined;
  if (mode === "brief") {
    if (kpis.length > 3) { kpis.length = 3; dropped.push("figures beyond three"); }
    if (charts.length) {
      if (charts.length > 1 || tables.length) dropped.push("visuals beyond the first");
      charts.length = 1; tables.length = 0;
    } else if (tables.length > 1) { tables.length = 1; dropped.push("tables beyond the first"); }
  }
  return { mode, title: _str(r.title, 120) || "Report", period: _str(r.period, 40), source: _str(r.source, 160),
    kpis, charts, tables, notes, dropped: [...new Set(dropped)] };
}

// steps: [{agent, text}] — one line per step the agents took ("How it worked"). Plain strings are accepted.
export function normalizeSteps(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, 12)) {
    if (typeof s === "string") { const text = _str(s, 300); if (text) out.push({ agent: undefined, text }); continue; }
    if (!s || typeof s !== "object") continue;
    const text = _str(s.text ?? s.step ?? s.summary, 300);
    if (text) out.push({ agent: _sanitizeAgentName(s.agent ?? s.name) || undefined, text });
  }
  return out;
}

function _extendedFields(...objs) {
  const pick = (k) => { for (const o of objs) if (o && typeof o === "object" && o[k] !== undefined) return o[k]; return undefined; };
  const kindRaw = _str(pick("kind"), 20).toLowerCase();
  return {
    kind: REPLY_KINDS.has(kindRaw) ? kindRaw : "answer",
    agents: normalizeAgents(pick("agents")),
    report: normalizeReport(pick("report")),
    suggestions: (Array.isArray(pick("suggestions")) ? pick("suggestions") : []).slice(0, 8).map((s) => _str(s, 160)).filter(Boolean),
    steps: normalizeSteps(pick("steps")),
  };
}

function _normalizePayload(rawPayload) {
  const { obj: payload, plainText } = _normalizeInboundPayload(rawPayload);
  const base = { kind: "answer", agents: [], report: null, suggestions: [], steps: [] };
  if (plainText && (!payload || Object.keys(payload).length === 0)) return { ...base, reply: plainText.trim(), actions: [] };
  if (!payload || typeof payload !== "object") return { ...base, reply: plainText?.trim() || "SAM response received.", actions: [] };

  const inner = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const inner2 = inner.result && typeof inner.result === "object" ? inner.result : inner;
  const ext = _extendedFields(inner2, inner, payload);

  let reply =
    _pickReplyText(inner2) ?? _pickReplyText(inner) ?? _pickReplyText(payload) ??
    (typeof payload.data === "string" && payload.data.trim() ? payload.data : undefined) ??
    (typeof inner2.output === "object" && typeof inner2.output?.text === "string" ? inner2.output.text : undefined);
  if (!reply && inner2.choices?.[0]?.message?.content) reply = inner2.choices[0].message.content;
  if (!reply && typeof plainText === "string" && plainText.trim()) reply = plainText;
  if (!reply) { const deep = _deepLongestString(payload); if (deep) reply = deep; }

  // The route forwards only a parsed object with a `reply` (chat-bridge "A reply is checked…"), so the old
  // prose-shaped-JSON salvage is gone (change chat-through-backend, design D5).
  const actions = Array.isArray(inner2.actions) ? inner2.actions
    : Array.isArray(inner.actions) ? inner.actions
    : Array.isArray(payload.actions) ? payload.actions : [];
  return { ...ext, reply: reply ? String(reply).trim() : "SAM response received.", actions };
}
/** Normalise a raw reply payload (a captured message, for replay / debugging) exactly as a live one. */
export function normalizeReply(rawPayload) { return _normalizePayload(rawPayload); }

export function initSam() {
  if (!API_BASE) console.warn("[sam] VITE_SB_API_URL not set — the chat has no route to ask (offline)");
}

// The structured context the route rebuilds its hint from (chat-bridge, "The question is checked and its context
// rebuilt"): only these fields are sent; the route drops any that fail its patterns.
function _contextFields(context) {
  const c = context && typeof context === "object" ? context : {};
  const v = c.viewing || {};
  const month = typeof c.month === "string" ? c.month : String(c.scope ?? "").match(/\d{4}-\d{2}/)?.[0];
  const out = { month, role: c.role, school: v.school ?? c.school, stall: v.stall ?? c.stall, terminal: v.terminal ?? c.terminal,
    retryOnly: c.retryOnly ? _sanitizeAgentName(c.retryOnly) : undefined };
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === "") delete out[k];
  return out;
}

/**
 * Ask the chat route.
 * @param {string} text  Natural-language question
 * @param {object} context  Dashboard state snapshot (+ retryOnly: an agent name to re-ask alone)
 * @param {{onProgress?: (agents: object[]) => void, onReceipt?: () => void}} [opts]
 * @returns {Promise<{reply?: string; actions?: object[]; kind?: string; agents?: object[]; report?: object|null; suggestions?: string[]; steps?: object[]; failure?: {code: string, message: string}}>}
 */
export async function chat(text, context = {}, opts = {}) {
  if (!API_BASE) return failure("unreachable");
  const ctl = new AbortController();
  let silence = null;
  const quiet = () => { clearTimeout(silence); silence = setTimeout(() => ctl.abort(), SILENCE_MS); };
  try {
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    const t = await validToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    quiet();
    const res = await fetch(`${API_BASE}/api/sam/ask`, {
      method: "POST", headers, signal: ctl.signal,
      body: JSON.stringify({ text: String(text ?? ""), context: _contextFields(context) }),
    });
    if (!res.ok || !String(res.headers.get("content-type") || "").startsWith("text/event-stream")) {
      const body = await res.json().catch(() => ({}));
      const code = res.status === 401 ? "unauthorized" : body?.error && FAILURES[body.error] ? body.error
        : res.status === 429 ? "one_at_a_time" : res.status === 503 ? "busy" : res.status === 400 ? "bad_request" : "unreachable";
      return failure(code);
    }
    let outcome = null;
    const parser = createSseParser((ev) => {
      if (outcome || ev.comment !== undefined) return;
      let data = null;
      try { data = JSON.parse(ev.data || "null"); } catch { /* a malformed event is skipped */ }
      if (ev.event === "received") { try { opts.onReceipt?.(); } catch (e) { console.warn("[sam] onReceipt failed:", e); } }
      else if (ev.event === "progress") { try { opts.onProgress?.(normalizeAgents(data?.agents)); } catch (e) { console.warn("[sam] onProgress failed:", e); } }
      else if (ev.event === "answer") outcome = _normalizePayload(data);
      else if (ev.event === "error") outcome = failure(data?.code, data?.message);
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      quiet();                                   // any bytes, keep-alives included, mean the route is alive
      parser.push(dec.decode(value, { stream: true }));
      if (outcome) { ctl.abort(); break; }
    }
    if (!outcome) { parser.push(dec.decode()); parser.end(); }
    return outcome ?? failure("unreachable");
  } catch (err) {
    if (err?.name !== "AbortError") console.warn("[sam] chat route unreachable:", err?.message);
    return failure("unreachable");
  } finally {
    clearTimeout(silence);
  }
}
