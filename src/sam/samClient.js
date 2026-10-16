/**
 * samClient.js — SAM (Solace Agent Mesh) client for the SMART Buddy frontend.
 * Adapted from htx-pilot/front-end/src/sam/samClient.js — topic base and ids
 * rebased htx → smartbuddy; transport/normalizer logic unchanged.
 *
 * Two transports (first match wins):
 *  1) Solace Event Gateway (default): ONE set of shared request/response/error topics (SAM_TOPICS,
 *     central-specs capability sam-chat). The payload carries a correlationId the agent echoes; an
 *     id-less reply falls back to the sole in-flight request.
 *  2) HTTP: VITE_SAM_ENDPOINT → POST {base}/chat with optional Bearer VITE_SAM_API_KEY.
 *
 * The reply (central-specs capability agent-system, docs/sb_helper_agent_system.md §5) is
 * {correlationId, reply, actions, kind?, agents?, report?, suggestions?}; a message with the same id,
 * status "working" and no reply is progress — it re-arms the question's timeout and reaches the
 * panel through onProgress without resolving. Everything is normalised here; the panel never reads
 * the raw payload.
 */

import { publish, subscribe } from "../solace/solace.js";

const SAM_ENDPOINT = (import.meta.env.VITE_SAM_ENDPOINT || "").replace(/\/$/, "");
const SAM_API_KEY = import.meta.env.VITE_SAM_API_KEY || "";
const SAM_SINGLE_PENDING_FALLBACK = import.meta.env.VITE_SAM_SINGLE_PENDING_FALLBACK !== "false";

const EXPLICIT_SAM_QUERY = (import.meta.env.VITE_SAM_QUERY_TOPIC || "").trim();
const EXPLICIT_SAM_RESPONSE = (import.meta.env.VITE_SAM_RESPONSE_TOPIC || "").trim();
const EXPLICIT_SAM_ERROR = (import.meta.env.VITE_SAM_ERROR_TOPIC || "").trim();

function _sanitizeTopicSegment(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 128) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return "";
  return s;
}

const SESSION_TOPIC_KEY = "smartbuddy_sam_topic_segment";

function _newSamTopicSegment() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sb-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

let _samTopicSegmentMemory = "";

function _getSamTopicSegment() {
  const forced = _sanitizeTopicSegment(
    (import.meta.env.VITE_SAM_FIXED_TOPIC_SEGMENT || "").trim() ||
      (import.meta.env.VITE_SAM_SYSTEM_ID || "").trim(),
  );
  if (forced) return forced;
  try {
    if (typeof sessionStorage !== "undefined") {
      let id = sessionStorage.getItem(SESSION_TOPIC_KEY);
      if (!id || !_sanitizeTopicSegment(id)) {
        id = _newSamTopicSegment();
        sessionStorage.setItem(SESSION_TOPIC_KEY, id);
      }
      return id;
    }
  } catch { /* private / blocked */ }
  if (!_samTopicSegmentMemory) _samTopicSegmentMemory = _newSamTopicSegment();
  return _samTopicSegmentMemory;
}

const SAM_TOPIC_SEGMENT = _getSamTopicSegment();

// ONE set of SHARED request/response/error topics (central-specs change single-mode-over-postgres,
// capability sam-chat) — the styl-office-uwb convention and exactly what the SAM gateway rule
// subscribes to. Replies are correlated by the `correlationId` in the JSON payload. Precedence: the
// older VITE_SAM_QUERY_TOPIC / VITE_SAM_RESPONSE_TOPIC / VITE_SAM_ERROR_TOPIC (and the
// VITE_SAM_SOLACE_TOPIC_* aliases) → VITE_SAM_TOPIC_REQUEST / _RESPONSE / _ERROR → the default, which
// is the topic set the Redshift agent's gateway rule answers on today (decision 0002).
const _trim = (v) => (v || "").trim();
const TOPIC_BASE = "STYL/iot/smartbuddy-live/system/shared/v1/sam/chat";
export const SAM_TOPICS = Object.freeze({
  request:  EXPLICIT_SAM_QUERY    || _trim(import.meta.env.VITE_SAM_SOLACE_TOPIC_REQUEST)  || _trim(import.meta.env.VITE_SAM_TOPIC_REQUEST)  || `${TOPIC_BASE}/request`,
  response: EXPLICIT_SAM_RESPONSE || _trim(import.meta.env.VITE_SAM_SOLACE_TOPIC_RESPONSE) || _trim(import.meta.env.VITE_SAM_TOPIC_RESPONSE) || `${TOPIC_BASE}/response`,
  error:    EXPLICIT_SAM_ERROR    || _trim(import.meta.env.VITE_SAM_SOLACE_TOPIC_ERROR)    || _trim(import.meta.env.VITE_SAM_TOPIC_ERROR)    || `${TOPIC_BASE}/error`,
});
export function samTopics() { return { ...SAM_TOPICS }; }
const SAM_SOLACE_MODE = "solace";   // transport always attempted (times out → offline if Solace unconfigured)
const SAM_USE_SOLACE_FIFO = false;  // replies carry correlationId, matched in _takePendingForPayload

function _parseTimeoutMs(fallback) {
  const raw = import.meta.env.VITE_SAM_TIMEOUT_MS;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const SAM_TIMEOUT_HTTP_MS = _parseTimeoutMs(8000);
const SAM_TIMEOUT_SOLACE_MS = _parseTimeoutMs(60000); // SAM + LLM often exceeds 8s
const SAM_LOG_MAX_CHARS = 20000;

function _logSam(label, value) {
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    console.log(label, str.length > SAM_LOG_MAX_CHARS ? str.slice(0, SAM_LOG_MAX_CHARS) + `\n... [truncated, total ${str.length} chars]` : str);
  } catch { console.log(label, value); }
}

// ── text-only wire ────────────────────────────────────────────────────────────
// The SAM agent is text-in / text-out, so we publish a plain string (not a JSON
// envelope). Dashboard context is folded into the text as a short preamble so the
// agent still knows what the user is looking at.
function _contextPreamble(context) {
  if (!context || typeof context !== "object") return "";
  const bits = [];
  if (context.scope) bits.push(context.scope);   // e.g. "month 2026-03" — tells the agent which month
  if (context.role && context.role !== "all") bits.push(`role ${context.role}`);
  const v = context.viewing || {};
  if (v.school) bits.push(`viewing school ${v.school}`);
  if (v.stall) bits.push(`viewing stall ${v.stall}`);
  if (v.terminal) bits.push(`viewing terminal ${v.terminal}`);
  // Retry of one specialist (sam-chat spec): the hint ends in "retry: ask only <agent_name>" and the
  // orchestrator delegates to that agent only. A hint, not a new envelope field — the gateway rule
  // maps payload.context and nothing else would reach the agent.
  if (context.retryOnly) bits.push(`retry: ask only ${_sanitizeAgentName(context.retryOnly)}`);
  return bits.length ? `(Context: ${bits.join("; ")}.)` : "";
}
const _sanitizeAgentName = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);

// A question that asks for a report waits twice as long (the specialists build several queries).
const REPORT_LIKE = /\b(report|summar(y|ise|ize)|statistic|breakdown|break down|compar(e|ison)|trend|overview)\b/i;
export function isReportLike(text) { return REPORT_LIKE.test(String(text ?? "")); }
function _composeTextMessage(text, context) {
  const pre = _contextPreamble(context);
  return pre ? `${pre}\n\n${String(text ?? "")}` : String(text ?? "");
}

const _pending = new Map();
const _pendingFifo = [];
let _solaceHandlersRegistered = false;

function useSolaceSam() { return SAM_SOLACE_MODE !== "none"; }
function useHttpSam() { return Boolean(SAM_ENDPOINT); }

function _extractCorrelationId(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  const direct = payload.correlationId ?? payload.correlation_id ?? payload.requestId ?? payload.request_id;
  if (typeof direct === "string" && direct.length > 0) return direct;
  return [payload.data, payload.payload, payload.event, payload.body]
    .filter((x) => x && typeof x === "object")
    .map((x) => x.correlationId ?? x.correlation_id)
    .find((id) => typeof id === "string" && id.length > 0);
}

function _takePendingForPayload(payload) {
  const id = _extractCorrelationId(payload);
  if (id) {
    if (_pending.has(id)) { const p = _pending.get(id); _pending.delete(id); return p; }
    return null;
  }
  if (_pending.size === 0) return null;
  const oldestId = _pending.keys().next().value;
  console.warn("[sam] response had no usable correlationId — matching oldest in-flight request (FIFO).");
  const p = _pending.get(oldestId);
  _pending.delete(oldestId);
  return p;
}
// Progress keeps the question in flight: look the request up without taking it. An id-less working
// message is only trusted when exactly one question is pending (same rule as replies).
function _peekPendingForPayload(payload) {
  const id = _extractCorrelationId(payload);
  if (id) return _pending.get(id) ?? null;
  return SAM_SINGLE_PENDING_FALLBACK && _pending.size === 1 ? _pending.values().next().value : null;
}
// A streamed chunk of the agent's JSON (an agent with streaming on): starts with "{" but its braces do
// not balance. Never a reply — the agents emit exactly one whole object — so it is dropped, not shown.
function _looksLikeFragment(obj) {
  if (!obj || typeof obj !== "object" || typeof obj.text !== "string" || Object.keys(obj).length !== 1) return false;
  const s = obj.text.trim();
  if (!s.startsWith("{")) return false;
  let depth = 0;
  for (const ch of s) { if (ch === "{") depth++; else if (ch === "}") depth--; }
  return depth !== 0;
}
// {correlationId, status: "working", agents: [...]} and no answer text → progress, not a reply.
function _isProgress(obj) {
  if (!obj || typeof obj !== "object") return false;
  const st = typeof obj.status === "string" ? obj.status.toLowerCase() : "";
  if (!/^(working|progress|routing|running|querying)$/.test(st)) return false;
  return !_pickReplyText(obj) && obj.report == null;
}

function _removePendingFifoEntry(entry) {
  const i = _pendingFifo.indexOf(entry);
  if (i !== -1) _pendingFifo.splice(i, 1);
}
function _takePendingFifo() { return _pendingFifo.length === 0 ? null : (_pendingFifo.shift() ?? null); }

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

function _salvageProseShapedJson(text) {
  if (typeof text !== "string") return null;
  if (!/\bcorrelationId\b/i.test(text)) return null;
  const m = text.match(/correlationId[^A-Za-z0-9_-]+([A-Za-z0-9_-]+)[\s\S]*?\breply\s*[:=][\s\S]*?(?:["']?([\s\S]*?)["']?)\s+(?:\.|\s)*\bactions\s*[:=]\s*([\s\S]*)$/i);
  if (!m) {
    const replyIdx = text.search(/\breply\s*[:=]/i);
    const actionsIdx = text.search(/\bactions\s*[:=]/i);
    if (replyIdx < 0) return null;
    const after = text.slice(replyIdx).replace(/^\s*reply\s*[:=]\s*/i, "");
    const cutAt = actionsIdx > replyIdx ? text.search(/\bactions\s*[:=]/i) - replyIdx : after.length;
    const reply = after.slice(0, cutAt).trim().replace(/^["']|["']$/g, "");
    const actionsRaw = actionsIdx > replyIdx ? text.slice(actionsIdx).replace(/^\s*actions\s*[:=]\s*/i, "") : "[]";
    let actions = [];
    try { const parsed = JSON.parse(actionsRaw.trim()); if (Array.isArray(parsed)) actions = parsed; } catch { /* keep [] */ }
    return reply ? { reply, actions } : null;
  }
  const reply = (m[2] || "").trim().replace(/[.,;]\s*$/, "");
  let actions = [];
  try { const parsed = JSON.parse((m[3] || "[]").trim()); if (Array.isArray(parsed)) actions = parsed; } catch { /* keep [] */ }
  return reply ? { reply, actions } : null;
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
  return { title: _str(r.title, 120) || "Report", period: _str(r.period, 40), source: _str(r.source, 160),
    kpis, charts, tables, notes, dropped: [...new Set(dropped)] };
}

function _extendedFields(...objs) {
  const pick = (k) => { for (const o of objs) if (o && typeof o === "object" && o[k] !== undefined) return o[k]; return undefined; };
  const kindRaw = _str(pick("kind"), 20).toLowerCase();
  return {
    kind: REPLY_KINDS.has(kindRaw) ? kindRaw : "answer",
    agents: normalizeAgents(pick("agents")),
    report: normalizeReport(pick("report")),
    suggestions: (Array.isArray(pick("suggestions")) ? pick("suggestions") : []).slice(0, 8).map((s) => _str(s, 160)).filter(Boolean),
  };
}

function _normalizePayload(rawPayload) {
  const { obj: payload, plainText } = _normalizeInboundPayload(rawPayload);
  const base = { kind: "answer", agents: [], report: null, suggestions: [] };
  if (plainText && (!payload || Object.keys(payload).length === 0)) {
    const salvaged = _salvageProseShapedJson(plainText);
    if (salvaged) { console.warn("[sam] agent returned prose — salvaged via regex."); return { ...base, ...salvaged }; }
    return { ...base, reply: plainText.trim(), actions: [] };
  }
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

  let actions = Array.isArray(inner2.actions) ? inner2.actions
    : Array.isArray(inner.actions) ? inner.actions
    : Array.isArray(payload.actions) ? payload.actions : [];

  if (typeof reply === "string" && /\bcorrelationId\b/i.test(reply) && /\breply\s*[:=]/i.test(reply)) {
    const salvaged = _salvageProseShapedJson(reply);
    if (salvaged) { console.warn("[sam] agent returned prose — salvaged via regex."); reply = salvaged.reply; if (!actions.length) actions = salvaged.actions; }
  }
  return { ...ext, reply: reply ? String(reply).trim() : "SAM response received.", actions };
}
/** Normalise a raw reply payload (a captured message, for replay / debugging) exactly as a live one. */
export function normalizeReply(rawPayload) { return _normalizePayload(rawPayload); }

function _registerSolaceHandlers() {
  if (_solaceHandlersRegistered || !useSolaceSam()) return;
  _solaceHandlersRegistered = true;

  const onResponse = (topicName, payload) => {
    _logSam(`[sam] received ← ${topicName}`, payload);
    if (SAM_USE_SOLACE_FIFO) {
      const p = _takePendingFifo();
      if (!p) { console.warn("[sam] unexpected response (no in-flight request). Per-tab mode uses FIFO."); return; }
      clearTimeout(p.timer);
      p.resolve(_normalizePayload(payload));
      return;
    }
    const { obj } = _normalizeInboundPayload(payload);
    const parsed = obj && typeof obj === "object" ? obj : (typeof payload === "object" && payload !== null ? payload : { text: String(payload ?? "") });
    if (_looksLikeFragment(payload)) { console.warn("[sam] streamed fragment ignored (not a whole reply)."); return; }
    if (_isProgress(parsed)) {
      const pp = _peekPendingForPayload(parsed);
      if (!pp) { console.warn("[sam] progress for no in-flight request — ignored."); return; }
      pp.arm();                                   // the agents are alive: restart the wait
      try { pp.onProgress?.(normalizeAgents(parsed.agents)); } catch (e) { console.warn("[sam] onProgress failed:", e); }
      return;
    }
    const p = _takePendingForPayload(parsed);
    if (!p) {
      const id = _extractCorrelationId(parsed);
      // Fallback ONLY for a reply with no correlationId (an agent that doesn't echo it). A reply carrying
      // someone else's id — another tab, another client on the shared topic — is never ours.
      if (SAM_SINGLE_PENDING_FALLBACK && !id && _pending.size === 1) {
        const fallbackId = _pending.keys().next().value;
        const fp = _pending.get(fallbackId);
        _pending.delete(fallbackId);
        clearTimeout(fp.timer);
        console.warn("[sam] correlationId mismatch — delivering to sole in-flight request.");
        fp.resolve(_normalizePayload(payload));
        return;
      }
      console.warn("[sam] could not match response to a request.", id ? `id=${id}` : "no correlationId");
      return;
    }
    clearTimeout(p.timer);
    p.resolve(_normalizePayload(payload));
  };

  const onError = (topicName, payload) => {
    _logSam(`[sam] received ← ${topicName} (error)`, payload);
    let p = null;
    if (SAM_USE_SOLACE_FIFO) p = _takePendingFifo();
    else {
      const errObj = _normalizeInboundPayload(payload).obj ?? payload;
      p = _takePendingForPayload(errObj);
      if (!p && SAM_SINGLE_PENDING_FALLBACK && !_extractCorrelationId(errObj) && _pending.size === 1) {   // id-less only
        const fallbackId = _pending.keys().next().value;
        p = _pending.get(fallbackId) ?? null;
        if (p) _pending.delete(fallbackId);
      }
    }
    if (!p) return;
    clearTimeout(p.timer);
    const normalized = _normalizePayload(payload);
    const err = normalized.reply ?? payload?.message ?? payload?.error ?? payload?.text ?? JSON.stringify(payload);
    p.resolve({ kind: "answer", agents: [], report: null, suggestions: [], reply: `SAM error: ${err}`, actions: [] });
  };

  subscribe(SAM_TOPICS.response, onResponse);
  if (SAM_TOPICS.error) subscribe(SAM_TOPICS.error, onError);
}

export function initSam() {
  if (useSolaceSam()) {
    _registerSolaceHandlers();
    const segInfo = SAM_SOLACE_MODE === "per-tab" ? ` topicSegment=${SAM_TOPIC_SEGMENT}` : "";
    console.log(`[sam] Solace (${SAM_SOLACE_MODE})${segInfo} query=${SAM_TOPICS.request} response=${SAM_TOPICS.response}` + (SAM_TOPICS.error ? ` error=${SAM_TOPICS.error}` : ""));
    return;
  }
  if (useHttpSam()) { console.log(`[sam] HTTP endpoint: ${SAM_ENDPOINT}`); return; }
  console.warn("[sam] Not configured — set VITE_SOLACE_* (per-tab topics) or VITE_SAM_QUERY_TOPIC/RESPONSE, or VITE_SAM_ENDPOINT");
}

/**
 * Send a chat message to SAM.
 * @param {string} text  Natural-language question
 * @param {object} context  Dashboard state snapshot (+ retryOnly: an agent name to re-ask alone)
 * @param {{onProgress?: (agents: object[]) => void}} [opts]  progress rows while the agents work
 * @returns {Promise<{reply?: string; actions?: object[]; kind?: string; agents?: object[]; report?: object|null; suggestions?: string[]; offline?: boolean}>}
 */
export async function chat(text, context = {}, opts = {}) {
  if (useSolaceSam()) {
    _registerSolaceHandlers();
    const correlationId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // One build-time wait (VITE_SAM_TIMEOUT_MS); a report question starts with twice it, and every
    // progress message restarts it — a dead mesh still times out, a busy one does not.
    const wait = isReportLike(text) ? SAM_TIMEOUT_SOLACE_MS * 2 : SAM_TIMEOUT_SOLACE_MS;
    return new Promise((resolve) => {
      const entry = { resolve, timer: null, onProgress: opts.onProgress, arm: null };
      entry.arm = () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          if (_pending.has(correlationId)) { _pending.delete(correlationId); console.warn("[sam] Solace reply timeout"); resolve({ offline: true }); }
        }, wait);
      };
      entry.arm();
      _pending.set(correlationId, entry);
      // JSON envelope {correlationId, text, context, ts} — matches the styl-office-uwb wire + the SAM
      // gateway rule ({payload.text}/{payload.correlationId}/{payload.context}/{payload.ts}).
      const body = JSON.stringify({ correlationId, text: String(text ?? ""), context: _contextPreamble(context), ts: Date.now() });
      const topic = SAM_TOPICS.request;
      console.log(`[sam] publish → ${topic} (corr ${correlationId}, wait ${wait} ms)`);
      publish(topic, body);
    });
  }

  if (!useHttpSam()) { console.warn("[sam] offline — no Solace topics or HTTP endpoint"); return { offline: true }; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAM_TIMEOUT_HTTP_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    if (SAM_API_KEY) headers["Authorization"] = `Bearer ${SAM_API_KEY}`;
    const res = await fetch(`${SAM_ENDPOINT}/chat`, { method: "POST", headers, body: JSON.stringify({ text, context }), signal: controller.signal });
    if (!res.ok) { console.warn(`[sam] non-OK response: ${res.status}`); return { offline: true }; }
    const data = await res.json().catch(() => null);
    if (!data) return { offline: true };
    return _normalizePayload(data);
  } catch (err) {
    console.warn("[sam] offline:", err.message);
    return { offline: true };
  } finally { clearTimeout(timer); }
}
