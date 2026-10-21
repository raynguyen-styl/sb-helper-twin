/**
 * normalize.js — the chat's reply normalisers (central-specs capability sam-chat; change agents-on-live-ischool-data
 * D7). They coerce a reply from the agents into bounded plain values the panel renders with textContent: strings
 * clipped, numbers finite, unknown kinds and shapes dropped with a note. Pure — no DOM, no import.meta, no network —
 * so `node --test` covers them (test/normalize.test.mjs). samClient.js re-exports them; samPanel.js imports from there.
 */

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
// A number as models write it (sam-chat, "A visual in a common variant shape still draws"): a JSON number, or a
// string with thousands separators, a currency prefix (S$, SGD, $) or a trailing %, which also names the unit.
// → { n: number | null, unit: "SGD" | "%" | undefined }. null, blanks and words are not numbers.
function _parseNum(v) {
  if (typeof v === "number") return { n: Number.isFinite(v) ? v : null, unit: undefined };
  if (typeof v !== "string") return { n: null, unit: undefined };
  let s = v.trim(), unit;
  if (/^(S\$|SGD\s*|\$)/i.test(s)) { unit = "SGD"; s = s.replace(/^(S\$|SGD\s*|\$)/i, ""); }
  if (/%$/.test(s)) { unit = "%"; s = s.slice(0, -1); }
  s = s.replace(/[,\s]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { n: null, unit: undefined };
  const n = Number(s);
  return { n: Number.isFinite(n) ? n : null, unit };
}
const _num = (v) => _parseNum(v).n;
const _cell = (v) => (typeof v === "number" ? (Number.isFinite(v) ? v : "") : _str(v, 160));
// Chart kinds models use for the three the chat draws: a pie or donut reads as a bar chart of the same values.
const KIND = Object.freeze({ bar: "bar", line: "line", stacked: "stacked", column: "bar", columns: "bar", hbar: "bar", barh: "bar",
  horizontal_bar: "bar", "horizontal bar": "bar", pie: "bar", donut: "bar", doughnut: "bar", area: "line", stacked_bar: "stacked", "stacked bar": "stacked" });
// A chart point: [x, y], or {x, y} / {label, value} / {name, value}.
const _point = (p) => (Array.isArray(p) ? (p.length >= 2 ? [p[0], p[1]] : null)
  : p && typeof p === "object" ? [p.x ?? p.label ?? p.name, p.y ?? p.value] : null);
// A table row as an array of cells: an array as is, or an object read by the column names (case-insensitively).
function _rowCells(row, columns) {
  if (Array.isArray(row)) return row;
  if (!row || typeof row !== "object") return null;
  const keys = Object.keys(row);
  return columns.map((c) => { const k = keys.find((x) => x === c) ?? keys.find((x) => x.toLowerCase() === String(c).toLowerCase()); return k === undefined ? "" : row[k]; });
}
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
  const units = new Set();
  let trimmed = false;
  for (const s of raw.slice(0, REPORT_LIMITS.series)) {
    const pts = Array.isArray(s?.points) ? s.points : [];
    const points = [];
    for (const p of pts) {
      if (points.length >= REPORT_LIMITS.points) { trimmed = true; break; }
      const xy = _point(p); if (!xy) continue;
      const { n: y, unit } = _parseNum(xy[1]); if (y == null) continue;
      if (unit) units.add(unit);
      points.push([_str(xy[0], 80), y]);
    }
    if (points.length) series.push({ name: _str(s?.name, 60) || _str(ch.title, 60) || "value", points });
  }
  return { series, trimmed, unit: units.size === 1 ? [...units][0] : undefined };
}

export function normalizeReport(r) {
  if (!r || typeof r !== "object") return null;
  const dropped = [];
  const kpis = [];
  for (const k of (Array.isArray(r.kpis) ? r.kpis : [])) {
    if (!k || typeof k !== "object") continue;
    const { n: value, unit: seenUnit } = _parseNum(k.value); if (value == null) continue;
    if (kpis.length >= REPORT_LIMITS.kpis) { dropped.push(`figures beyond ${REPORT_LIMITS.kpis}`); break; }
    const d = k.delta && typeof k.delta === "object" ? k.delta : null;
    const pct = d ? _num(d.pct ?? d.value) : null;
    kpis.push({ label: _str(k.label, 60) || "Value", value, unit: _str(k.unit, 12) || seenUnit || undefined,
      delta: pct != null ? { pct, vs: _str(d.vs ?? d.label, 40) } : undefined, agent: _sanitizeAgentName(k.agent) || undefined });
  }
  const charts = [];
  for (const c of (Array.isArray(r.charts) ? r.charts : [])) {
    if (!c || typeof c !== "object") continue;
    const kind = KIND[_str(c.kind, 24).toLowerCase()];
    if (!kind) { dropped.push("a chart of an unknown kind"); continue; }
    const { series, trimmed, unit: seenUnit } = _normalizeSeries(c);
    if (!series.length) { dropped.push("a chart that could not be drawn"); continue; }
    if (charts.length >= REPORT_LIMITS.charts) { dropped.push(`charts beyond ${REPORT_LIMITS.charts}`); break; }
    if (trimmed) dropped.push(`points beyond ${REPORT_LIMITS.points} in "${_str(c.title, 40)}"`);
    const marks = [];
    for (const m of (Array.isArray(c.marks) ? c.marks.slice(0, 6) : [])) {
      if (m && typeof m === "object") marks.push({ from: _str(m.from, 40), to: _str(m.to ?? m.from, 40), label: _str(m.label, 30) });
    }
    charts.push({ kind, title: _str(c.title, 80) || "Chart", unit: _str(c.unit, 12) || seenUnit || undefined, x: _str(c.x, 30) || undefined,
      series, marks, agent: _sanitizeAgentName(c.agent) || undefined });
  }
  const tables = [];
  for (const t of (Array.isArray(r.tables) ? r.tables : [])) {
    if (!t || typeof t !== "object" || !Array.isArray(t.rows)) continue;
    if (tables.length >= REPORT_LIMITS.tables) { dropped.push(`tables beyond ${REPORT_LIMITS.tables}`); break; }
    // Rows given as objects take their columns from `columns`, or from the first object's keys when there are none.
    const firstObj = t.rows.find((row) => row && typeof row === "object" && !Array.isArray(row));
    const colsRaw = Array.isArray(t.columns) && t.columns.length ? t.columns : (firstObj ? Object.keys(firstObj) : []);
    const columns = colsRaw.slice(0, REPORT_LIMITS.columns).map((c) => _str(c, 60));
    const cellRows = t.rows.map((row) => _rowCells(row, colsRaw.slice(0, REPORT_LIMITS.columns)));
    const width = columns.length || Math.max(0, ...cellRows.map((row) => (row ? row.length : 0)));
    const rows = [];
    for (const row of cellRows) {
      if (!row) continue;
      if (rows.length >= REPORT_LIMITS.rows) { dropped.push(`rows beyond ${REPORT_LIMITS.rows} in "${_str(t.title, 40)}"`); break; }
      rows.push(Array.from({ length: Math.min(width, REPORT_LIMITS.columns) }, (_, i) => _cell(row[i])));
    }
    if (!rows.length) { dropped.push("a table that could not be drawn"); continue; }
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

// A model that escapes its line breaks twice sends the two characters \n instead of a line break. Read them as line
// breaks only when the reply has no real one, so a reply that quotes a backslash on purpose is left alone
// (sam-chat, "Markdown tables render in their common forms").
const _lineBreaks = (s) => (!s.includes("\n") && s.includes("\\n") ? s.replace(/\\r\\n|\\n/g, "\n") : s);

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
  return { ...ext, reply: reply ? _lineBreaks(String(reply).trim()) : "SAM response received.", actions };
}
/** Normalise a raw reply payload (a captured message, for replay / debugging) exactly as a live one. */
export function normalizeReply(rawPayload) { return _normalizePayload(rawPayload); }

export const sanitizeAgentName = _sanitizeAgentName;
