/**
 * samPanel.js — the SMART Buddy chat panel (self-contained vanilla JS DOM widget).
 *
 * Renders central-specs design/agent-chat on the live wire (capabilities sam-chat + agent-system): the
 * orchestrator's routing card with one row per specialist (progress when the mesh forwards it, the final
 * statuses otherwise), attribution on every answer, reports drawn from numbers (inline SVG, a "Numbers"
 * table under each chart), refusals with tappable suggestions, partial answers with Retry, and the
 * offline state. Every string from a reply enters the DOM through textContent — the reply text through
 * an escape-then-whitelist markdown-lite — so model output can never inject markup. getContext() is
 * folded into the outgoing envelope by samClient. Styling uses the app's design tokens (theme.css).
 *
 * replay() renders a captured exchange without the broker (debugging, the design's six conversations):
 *   import('/src/sam/samPanel.js').then(m => m.replay({ question, progress: [...], reply }))
 */

import { chat, normalizeReply, normalizeAgents } from "./samClient.js";

const MOBILE_BREAKPOINT = 720;
const AVATAR = "/icon.png";                 // branded avatar (public/icon.png) — header, rail and empty state
let panelExpanded = true;
let _getContext = () => ({});
let _ui = null;                             // { panel, thread, input, sendBtn } once initialised

// The roster (docs/sb_helper_agent_system.md §3): mesh agent name → what the chat shows. Colours are the
// --agent-N tokens in roster order (design/agent-chat: categorical slots 1–5, the orchestrator neutral). An
// agent the twin does not know is neutral and keeps the display the wire sent; a name always sits beside
// the swatch, so colour never carries identity alone.
const ORCHESTRATOR = "sb_orchestrator";
const ROSTER = {
  sb_orchestrator: { display: "SMART Buddy", slot: 0 },
  sb_spend:        { display: "Spend & Schools", slot: 1 },
  sb_terminals:    { display: "Terminals & Network", slot: 2 },
  sb_purchases:    { display: "Purchases & Nutrition", slot: 3 },
  sb_savings:      { display: "Savings & Wallet", slot: 4 },
  sb_wearables:    { display: "Wearables", slot: 5 },
};
function agentView(a) {
  const r = ROSTER[a?.name];
  const slot = r?.slot ?? 0;
  return { name: a?.name || ORCHESTRATOR, display: r?.display || a?.display || a?.name || "Agent",
    colour: `var(--agent-${slot})`, role: a?.role || (slot === 0 ? "orchestrator" : "specialist"),
    status: a?.status, source: a?.source, ms: a?.ms };
}
const ORCH = agentView({ name: ORCHESTRATOR });
const isSpecialist = (a) => a.role !== "orchestrator" && a.name !== ORCHESTRATOR;

const isMobilePanel = () => window.innerWidth <= MOBILE_BREAKPOINT;
const isDesktopPanel = () => !isMobilePanel();

// ── markdown-lite: escape, then apply a safe whitelist (bold, code, lists, line breaks) ──────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function mdInline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}
function mdLite(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = []; let list = null;   // list = 'ul' | 'ol' | null
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    const o = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b) { if (list !== "ul") { closeList(); html.push("<ul>"); list = "ul"; } html.push(`<li>${mdInline(b[1])}</li>`); }
    else if (o) { if (list !== "ol") { closeList(); html.push("<ol>"); list = "ol"; } html.push(`<li>${mdInline(o[1])}</li>`); }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); html.push(`<div class="sam-p">${mdInline(line)}</div>`); }
  }
  closeList();
  return html.join("");
}

// ── small DOM + number helpers (labels are untrusted data: textContent only) ────────────────────
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const fmtInt = (v) => Math.round(v).toLocaleString("en-SG");
const compact = (v) => { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : fmtInt(v); };
// Numbers come as numbers (SGD in dollars, percentages 0–100); the unit decides how they read.
function fmtValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return "–";
  const u = (unit || "").toUpperCase();
  const a = Math.abs(v);
  if (u === "SGD" || u === "S$" || u === "$") return `S$${a >= 1e4 ? compact(v) : v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (u === "%" || u === "PCT" || u === "PERCENT") return `${v.toFixed(1)}%`;
  if (u === "PT") return `${v.toFixed(1)} pt`;
  if (u === "MS") return a >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
  if (u === "S") return `${v.toFixed(1)} s`;
  if (u === "KM") return `${v.toFixed(1)} km`;
  if (u === "BPM") return `${Math.round(v)} bpm`;
  if (!u || u === "COUNT" || u === "N") return Number.isInteger(v) || a >= 100 ? compact(v) : v.toFixed(2);
  return `${a >= 1e4 || Number.isInteger(v) ? compact(v) : v.toFixed(1)} ${unit}`;
}
const r1 = (x) => Math.round(x * 10) / 10;
function tickFmt(v, unit) {
  const u = (unit || "").toUpperCase();
  if (u === "SGD" || u === "S$" || u === "$") return v >= 1e6 ? `${r1(v / 1e6)}M` : v >= 1e3 ? `${r1(v / 1e3)}K` : `${Math.round(v)}`;
  if (u === "%" || u === "PCT" || u === "PERCENT") return `${r1(v)}%`;
  return v >= 1e6 ? `${r1(v / 1e6)}M` : v >= 1e3 ? `${r1(v / 1e3)}K` : `${r1(v)}`;
}
const nice = (max) => { if (!(max > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; const step = m <= 2 ? 0.5 : m <= 5 ? 1 : 2; return Math.ceil(m / step) * step * p; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function xLabel(x, max = 16) {
  const s = String(x);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${+m[3]} ${MONTHS[+m[2] - 1] || m[2]}`;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[+m[2] - 1] || m[2]} ${m[1]}`;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
const periodLabel = (p) => { const m = String(p || "").match(/^(\d{4})-(\d{2})$/); return m ? `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][+m[2] - 1]} ${m[1]}` : String(p || ""); };

// ── tooltip (one for every chart) ───────────────────────────────────────────────────────────────
let _tip = null;
function tipEl() { if (!_tip) { _tip = el("div", "sam-tip"); _tip.setAttribute("role", "tooltip"); document.body.appendChild(_tip); } return _tip; }
function showTip(x, y, title, rows, colour) {
  const t = tipEl(); t.replaceChildren(); t.style.setProperty("--c", colour);
  t.append(el("b", null, title));
  for (const [k, v] of rows) { const d = el("div"); d.append(el("span", "k"), el("strong", null, v), el("span", "m", ` ${k}`)); t.append(d); }
  t.classList.add("on");
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`; t.style.top = `${Math.max(8, y - h - 12)}px`;
}
const hideTip = () => _tip?.classList.remove("on");

// ── charts: inline SVG per the data-viz rules (≤24px bars rounded at the data end, hairline grid, 2px
//    lines with an end dot, selective direct labels, a tooltip, a focusable mark per bar) ───────────
const SERIES_ALPHA = [1, 0.62, 0.38, 0.24, 0.16, 0.1];   // further series of the same agent fade, never change hue
function seriesColour(i) { return i === 0 ? "var(--c)" : `color-mix(in srgb, var(--c) ${Math.round(SERIES_ALPHA[Math.min(i, SERIES_ALPHA.length - 1)] * 100)}%, var(--canvas))`; }

function barChart(ch, colour) {
  const cats = ch.series[0].points.map((p) => p[0]);
  const stacked = ch.kind === "stacked" || ch.series.length > 1;
  const byCat = cats.map((c, i) => ch.series.map((s) => (s.points[i]?.[0] === c ? s.points[i][1] : (s.points.find((p) => p[0] === c)?.[1] ?? 0))));
  const totals = byCat.map((vals) => stacked ? vals.reduce((a, b) => a + Math.max(0, b), 0) : vals[0]);
  const W = 360, rowH = 30, padL = 118, padR = 48, top = 6; const H = top + cats.length * rowH + 16;
  const max = nice(Math.max(...totals));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": ch.title });
  const grid = svgEl("g", { class: "grid ax" });
  for (let i = 0; i <= 4; i++) { const x = padL + (W - padL - padR) * i / 4; grid.append(svgEl("line", { x1: x, x2: x, y1: top, y2: H - 16 })); const t = svgEl("text", { x, y: H - 2, "text-anchor": "middle" }); t.textContent = tickFmt(max * i / 4, ch.unit); grid.append(t); }
  svg.append(grid, svgEl("line", { class: "base", x1: padL, x2: padL, y1: top, y2: H - 16 }));
  const maxIdx = totals.reduce((b, v, i, a) => (v > a[b] ? i : b), 0);
  cats.forEach((cat, i) => {
    const y = top + i * rowH + 4, h = 22;
    const lab = svgEl("text", { x: padL - 8, y: y + h / 2, "text-anchor": "end", dy: 4 }); lab.textContent = xLabel(cat); svg.append(lab);
    let x0 = padL;
    const bars = [];
    byCat[i].forEach((v, si) => {
      if (!stacked && si > 0) return;
      const w = Math.max(0, (W - padL - padR) * Math.max(0, v) / max);
      const last = si === byCat[i].length - 1 || !stacked;
      const d = last ? `M${x0},${y} h${Math.max(w - 4, 0)} a4,4 0 0 1 4,4 v${h - 8} a4,4 0 0 1 -4,4 h${-Math.max(w - 4, 0)} z` : `M${x0},${y} h${w} v${h} h${-w} z`;
      const bar = svgEl("path", { class: "bar", d, fill: seriesColour(si) }); svg.append(bar); bars.push(bar);
      x0 += w + (last ? 0 : 1);
    });
    if (i === maxIdx) { const v = svgEl("text", { class: "val", x: Math.min(x0 + 6, W - 4), y: y + h / 2, dy: 4 }); v.textContent = fmtValue(totals[i], ch.unit); svg.append(v); }
    const rows = stacked ? ch.series.map((s, si) => [s.name, fmtValue(byCat[i][si], ch.unit)]) : [[ch.title.toLowerCase(), fmtValue(totals[i], ch.unit)]];
    const hit = svgEl("rect", { class: "hit", x: 0, y: y - 2, width: W, height: h + 4, tabindex: 0, role: "img", "aria-label": `${cat}: ${rows.map((r) => `${r[0]} ${r[1]}`).join(", ")}` });
    const on = (e) => { bars.forEach((b) => b.classList.add("hl")); const r = hit.getBoundingClientRect(); showTip(e?.clientX ?? r.left + 60, e?.clientY ?? r.top, String(cat), rows, colour); };
    const off = () => { bars.forEach((b) => b.classList.remove("hl")); hideTip(); };
    hit.addEventListener("pointermove", on); hit.addEventListener("pointerleave", off); hit.addEventListener("focus", () => on()); hit.addEventListener("blur", off);
    svg.append(hit);
  });
  return svg;
}

function lineChart(ch, colour) {
  const xs = ch.series[0].points.map((p) => p[0]);
  const n = xs.length;
  const W = 360, H = 150, padL = 36, padR = 14, top = 10, bottom = 24;
  const max = nice(Math.max(...ch.series.flatMap((s) => s.points.map((p) => p[1]))));
  const X = (i) => padL + (W - padL - padR) * (n > 1 ? i / (n - 1) : 0.5), Y = (v) => top + (H - top - bottom) * (1 - Math.max(0, v) / max);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": ch.title });
  const grid = svgEl("g", { class: "grid ax" });
  for (let i = 0; i <= 4; i += 2) { const y = Y(max * i / 4); grid.append(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y })); const t = svgEl("text", { x: padL - 6, y, "text-anchor": "end", dy: 3 }); t.textContent = tickFmt(max * i / 4, ch.unit); grid.append(t); }
  const ticks = n <= 4 ? xs.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
  for (const i of ticks) { const t = svgEl("text", { x: X(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }); t.textContent = xLabel(xs[i], 10); grid.append(t); }
  svg.append(grid);
  for (const m of ch.marks) {   // shaded x-ranges (holidays) — from the agent's marks, drawn by the chat
    const a = xs.indexOf(m.from), b = xs.indexOf(m.to);
    if (a < 0 || b < 0) continue;
    const x1 = X(Math.min(a, b)) - 3, x2 = X(Math.max(a, b)) + 3;
    svg.append(svgEl("rect", { x: x1, y: top, width: x2 - x1, height: H - top - bottom, fill: "var(--divider-soft)" }));
    if (m.label) { const t = svgEl("text", { class: "mark", x: (x1 + x2) / 2, y: H - bottom - 4, "text-anchor": "middle" }); t.textContent = m.label; svg.append(t); }
  }
  ch.series.forEach((s, si) => {
    const pts = xs.map((x, i) => [i, s.points[i]?.[0] === x ? s.points[i][1] : (s.points.find((p) => p[0] === x)?.[1] ?? null)]).filter((p) => p[1] != null);
    if (!pts.length) return;
    const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    if (si === 0) svg.append(svgEl("path", { class: "ar", d: `${d} L${X(pts.at(-1)[0])},${Y(0)} L${X(pts[0][0])},${Y(0)} z` }));
    svg.append(svgEl("path", { class: "ln", d, stroke: seriesColour(si), "stroke-dasharray": si > 0 ? "4 3" : "none" }));
    const [li, lv] = pts.at(-1);
    svg.append(svgEl("circle", { class: "dot", cx: X(li), cy: Y(lv), r: 4, fill: seriesColour(si) }));
    if (si === 0) { const v = svgEl("text", { class: "val", x: X(li) - 6, y: Y(lv) - 8, "text-anchor": "end" }); v.textContent = fmtValue(lv, ch.unit); svg.append(v); }
  });
  svg.append(svgEl("line", { class: "base", x1: padL, x2: W - padR, y1: Y(0), y2: Y(0) }));
  const xh = svgEl("line", { class: "xh", x1: 0, x2: 0, y1: top, y2: Y(0), visibility: "hidden" }); svg.append(xh);
  const dot = svgEl("circle", { class: "dot", r: 4, visibility: "hidden" }); svg.append(dot);
  const hit = svgEl("rect", { class: "hit", x: padL, y: top, width: W - padL - padR, height: H - top - bottom + 8 });
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - padL) / (W - padL - padR) * (n - 1))));
    const v0 = ch.series[0].points[i]?.[1];
    xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
    if (v0 != null) { dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(v0)); dot.setAttribute("visibility", "visible"); }
    showTip(e.clientX, e.clientY, xLabel(xs[i], 40), ch.series.map((s) => [s.name, fmtValue(s.points[i]?.[1], ch.unit)]), colour);
  });
  hit.addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); });
  svg.append(hit);
  return svg;
}

function numbersTable(columns, rows, units = []) {
  const t = el("table", "sam-mini"); const tr = el("tr");
  columns.forEach((c, i) => tr.append(el("th", i ? "num" : "", c))); t.append(tr);
  for (const r of rows) {
    const tr2 = el("tr");
    r.forEach((v, i) => tr2.append(el("td", typeof v === "number" || i ? "num" : "", typeof v === "number" ? fmtValue(v, units[i]) : String(v ?? ""))));
    t.append(tr2);
  }
  return t;
}
function chartTable(ch) {
  const xs = ch.series[0].points.map((p) => p[0]);
  const rows = xs.map((x, i) => [xLabel(x, 40), ...ch.series.map((s) => s.points[i]?.[0] === x ? s.points[i][1] : (s.points.find((p) => p[0] === x)?.[1] ?? ""))]);
  return numbersTable([ch.x ? xLabel(ch.x, 20) : (ch.kind === "line" ? "Date" : "Category"), ...ch.series.map((s) => s.name)], rows, [undefined, ...ch.series.map(() => ch.unit)]);
}

// ── the report card ─────────────────────────────────────────────────────────────────────────────
function fromTag(agentName) {
  const a = agentView({ name: agentName });
  const f = el("span", "sam-from"); f.style.setProperty("--c", a.colour); f.append(el("span", "sam-sw"), el("span", null, a.display)); return f;
}
function reportToText(rp, reply) {
  const out = [rp.title, [rp.period && `period ${rp.period}`, rp.source].filter(Boolean).join(" · "), "", reply, ""];
  for (const k of rp.kpis) out.push(`${k.label}: ${fmtValue(k.value, k.unit)}${k.delta ? ` (${k.delta.pct >= 0 ? "+" : ""}${k.delta.pct.toFixed(1)}% vs ${k.delta.vs})` : ""}`);
  for (const ch of rp.charts) { out.push("", `${ch.title}${ch.unit ? ` (${ch.unit})` : ""}`); for (const s of ch.series) out.push(`  ${s.name}: ${s.points.map((p) => `${xLabel(p[0], 40)} ${fmtValue(p[1], ch.unit)}`).join("; ")}`); }
  for (const tb of rp.tables) { out.push("", tb.title, `  ${tb.columns.join(" | ")}`); for (const r of tb.rows) out.push(`  ${r.map((v, i) => typeof v === "number" ? fmtValue(v, tb.units[i]) : v).join(" | ")}`); }
  if (rp.notes.length) out.push("", ...rp.notes.map((n) => `- ${n}`));
  return out.join("\n");
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function reportToCsv(rp) {
  const lines = [];
  for (const ch of rp.charts) {
    lines.push(`# ${ch.title}${ch.unit ? ` (${ch.unit})` : ""}`, [ch.x || (ch.kind === "line" ? "date" : "category"), ...ch.series.map((s) => s.name)].map(csvCell).join(","));
    const xs = ch.series[0].points.map((p) => p[0]);
    xs.forEach((x, i) => lines.push([x, ...ch.series.map((s) => s.points[i]?.[0] === x ? s.points[i][1] : (s.points.find((p) => p[0] === x)?.[1] ?? ""))].map(csvCell).join(",")));
    lines.push("");
  }
  for (const tb of rp.tables) { lines.push(`# ${tb.title}`, tb.columns.map(csvCell).join(",")); for (const r of tb.rows) lines.push(r.map(csvCell).join(",")); lines.push(""); }
  return lines.join("\n");
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function reportCard(rp, reply) {
  const card = el("div", "sam-report");
  const head = el("div", "sam-rp-head"); head.append(el("h3", null, rp.title));
  const meta = el("div", "meta");
  if (rp.period) meta.append(el("span", null, `period ${periodLabel(rp.period)}`));
  if (rp.source) meta.append(el("span", null, rp.source));
  head.append(meta); card.append(head);
  const body = el("div", "sam-rp-body");
  if (rp.kpis.length) {
    const k = el("div", "sam-kpis");
    for (const x of rp.kpis) {
      const t = el("div", "sam-kpi"); if (x.agent) t.style.setProperty("--c", agentView({ name: x.agent }).colour);
      const l = el("div", "l"); if (x.agent) l.append(el("span", "sam-sw")); l.append(el("span", null, x.label)); t.append(l, el("div", "v", fmtValue(x.value, x.unit)));
      if (x.delta) t.append(el("div", `d ${x.delta.pct > 0.05 ? "up" : x.delta.pct < -0.05 ? "down" : "flat"}`, `${x.delta.pct >= 0 ? "+" : ""}${x.delta.pct.toFixed(1)}%${x.delta.vs ? ` vs ${x.delta.vs}` : ""}`));
      k.append(t);
    }
    body.append(k);
  }
  for (const ch of rp.charts) {
    const a = agentView({ name: ch.agent });
    const sec = el("div", "sam-sec"); const h = el("div", "sam-sec-h"); h.append(el("h4", null, `${ch.title}${ch.unit ? ` (${ch.unit})` : ""}`));
    if (ch.agent) h.append(fromTag(ch.agent)); sec.append(h);
    const c = el("div", "sam-chart"); c.style.setProperty("--c", a.colour);
    c.append(ch.kind === "line" ? lineChart(ch, a.colour) : barChart(ch, a.colour)); sec.append(c);
    if (ch.series.length > 1) { const lg = el("div", "sam-legend"); lg.style.setProperty("--c", a.colour); ch.series.forEach((s, i) => { const d = el("span"); const sw = el("i"); sw.style.background = seriesColour(i); d.append(sw, el("span", null, s.name)); lg.append(d); }); sec.append(lg); }
    const det = el("details", "sam-numbers"); det.append(el("summary", null, "Numbers"), chartTable(ch)); sec.append(det);
    body.append(sec);
  }
  for (const tb of rp.tables) {
    const sec = el("div", "sam-sec"); const h = el("div", "sam-sec-h"); h.append(el("h4", null, tb.title));
    if (tb.agent) h.append(fromTag(tb.agent)); sec.append(h, numbersTable(tb.columns.length ? tb.columns : tb.rows[0].map((_, i) => `Column ${i + 1}`), tb.rows, tb.units)); body.append(sec);
  }
  const notes = [...rp.notes];
  if (rp.dropped.length) notes.push(`Not shown (beyond the chat's limits): ${rp.dropped.join(", ")}.`);
  if (notes.length) { const ul = el("ul", "sam-notes"); for (const n of notes) ul.append(el("li", null, n)); body.append(ul); }
  card.append(body);
  const foot = el("div", "sam-rp-foot"); foot.append(el("span", "src", "Figures from the agents named above · aggregates only"));
  const copy = el("button", "sam-chip", "Copy as text"); copy.type = "button";
  copy.addEventListener("click", () => navigator.clipboard?.writeText(reportToText(rp, reply)).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy as text"), 1200); }));
  const csv = el("button", "sam-chip", "CSV"); csv.type = "button";
  csv.addEventListener("click", () => download(`${rp.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "report"}.csv`, reportToCsv(rp), "text/csv"));
  foot.append(copy, csv); card.append(foot);
  return card;
}

// ── thread rows ─────────────────────────────────────────────────────────────────────────────────
function focusSamInput({ preserveValue = true } = {}) {
  const input = _ui?.input;
  if (!input || !panelExpanded || !isDesktopPanel()) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  if (preserveValue) input.setSelectionRange(end, end); else input.select();
}
function autoGrow(input) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}
function updateEmptyState(thread) {
  const emptyState = thread?.querySelector(".sam-empty-state");
  if (emptyState) emptyState.hidden = Boolean(thread.querySelector(".sam-msg-row"));
}
function resetChatThread(thread, input) {
  thread.querySelectorAll(".sam-msg-row").forEach((n) => n.remove());
  updateEmptyState(thread);
  if (input) { input.value = ""; autoGrow(input); }
  thread.scrollTop = 0;
}
function addRow(row) { const { thread } = _ui; thread.appendChild(row); updateEmptyState(thread); thread.scrollTop = thread.scrollHeight; return row; }
function who(a, status) {
  const w = el("div", "sam-who"); w.style.setProperty("--c", a.colour); w.append(el("span", "sam-sw"), el("b", null, a.display));
  if (status) w.append(el("span", "t", `· ${status}`)); return w;
}
function copyBtn(text) {
  const b = el("button", "sam-copy", "Copy"); b.type = "button";
  b.addEventListener("click", () => navigator.clipboard?.writeText(text).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); }));
  return b;
}
function chips(parent, labels, onPick) {
  const c = el("div", "sam-chips");
  for (const l of labels) { const b = el("button", "sam-chip", l); b.type = "button"; b.addEventListener("click", () => onPick(l)); c.append(b); }
  parent.append(c);
}
function userRow(text, note) {
  const row = el("div", "sam-msg-row sam-msg-row-user");
  row.append(el("div", "sam-msg sam-msg-user", text));
  if (note) row.append(el("div", "sam-foot", note));
  return addRow(row);
}
function workingRow() {
  const row = el("div", "sam-msg-row sam-msg-row-orch"); row.append(who(ORCH));
  const b = el("div", "sam-msg sam-msg-sam sam-working"); const d = el("span", "sam-dots"); d.append(el("i"), el("i"), el("i"));
  b.append(el("span", null, "Working… "), d); row.append(b); return addRow(row);
}
function routeCard(specialists) {
  const names = specialists.map((a) => a.display);
  const row = el("div", "sam-msg-row sam-msg-row-orch"); row.append(who(ORCH));
  const card = el("div", "sam-route");
  card.append(el("div", "lead", names.length > 1 ? `This spans ${names.length} areas — asking ${names.slice(0, -1).join(", ")} and ${names.at(-1)} in parallel.` : `Asking ${names[0]}.`));
  row.append(card); addRow(row);
  updateCard(row, specialists);
  return row;
}
function updateCard(row, specialists, final = false) {
  const card = row.querySelector(".sam-route");
  for (const a of specialists) {
    let r = card.querySelector(`.sam-arow[data-agent="${CSS.escape(a.name)}"]`);
    if (!r) { r = el("div", "sam-arow"); r.dataset.agent = a.name; r.style.setProperty("--c", a.colour); r.append(el("span", "sam-sw"), el("span", "name", a.display), el("span", "st"), el("span", "ms")); card.append(r); }
    const st = a.status === "working" ? "querying" : (a.status || (final ? "done" : "routing"));
    r.className = `sam-arow ${st}`;
    const s = r.querySelector(".st"); s.replaceChildren();
    if (st === "querying") { s.append(el("span", null, "querying Redshift")); const d = el("span", "sam-dots"); d.append(el("i"), el("i"), el("i")); s.append(d); }
    else if (st === "done") s.append(el("span", "tick", "✓"), el("span", null, "done"));
    else if (st === "timeout") s.append(el("span", "cross", "!"), el("span", null, "no reply in time"));
    else if (st === "failed") s.append(el("span", "cross", "!"), el("span", null, "failed"));
    else s.append(el("span", null, st));
    r.querySelector(".ms").textContent = a.ms != null ? `${(a.ms / 1000).toFixed(1)} s` : "";
  }
  _ui.thread.scrollTop = _ui.thread.scrollHeight;
}
function agentRow(a, text) {
  const row = el("div", "sam-msg-row sam-msg-row-agent"); row.style.setProperty("--c", a.colour);
  row.append(who(a, "answered"));
  const b = el("div", "sam-msg sam-msg-sam"); b.innerHTML = mdLite(text); row.append(b);
  const f = el("div", "sam-foot"); if (a.source) f.append(el("span", null, `source: ${a.source}`)); f.append(copyBtn(text)); row.append(f);
  return addRow(row);
}
function orchRow(text, { kind = "answer", status, report, specialists = 0 } = {}) {
  const row = el("div", `sam-msg-row sam-msg-row-orch${kind === "refusal" ? " sam-msg-row-refusal" : ""}`);
  row.append(who(ORCH, status));
  const b = el("div", "sam-msg sam-msg-sam"); b.innerHTML = mdLite(text); row.append(b);
  if (report) row.append(reportCard(report, text));
  const f = el("div", "sam-foot");
  if (report?.period) f.append(el("span", null, `period ${periodLabel(report.period)}`));
  if (report?.source) f.append(el("span", null, `source: ${report.source}`));
  else if (specialists) f.append(el("span", null, "source: Redshift, smartbuddy_agent"));
  if (!report) f.append(copyBtn(text));
  row.append(f);
  return addRow(row);
}
function setOffline(isOffline) {
  const badge = document.getElementById("sam-offline-badge");
  if (badge) badge.style.display = isOffline ? "inline-flex" : "none";
  if (_ui?.input) _ui.input.style.opacity = isOffline ? "0.85" : "1";
}

// ── one exchange: the question, progress while the agents work, the answer ──────────────────────
// Design A (the mesh forwards status): the routing card appears on the first progress message and its rows
// update. Design B (final reply only): the card is built from the final agents[] right before the answer.
function startExchange(text, { note, ask } = {}) {
  userRow(text, note);
  let working = workingRow();
  let card = null;
  const onProgress = (agents) => {
    const specialists = agents.map(agentView).filter(isSpecialist);
    if (!specialists.length) return;
    if (!card) { working?.remove(); working = null; card = routeCard(specialists); }
    else updateCard(card, specialists);
  };
  const finish = (res) => {
    working?.remove(); working = null;
    if (!res || res.offline) {
      setOffline(true);
      const r = orchRow("No reply in time. SMART Buddy may be offline: the broker or the agents are not answering. Your question was not lost on the dashboard side; try again in a minute.");
      chips(r, ["Retry"], () => ask(text));
      return;
    }
    setOffline(false);
    const specialists = (res.agents || []).map(agentView).filter(isSpecialist);
    const reply = String(res.reply ?? "").trim() || "[Empty reply]";
    if (res.kind !== "refusal" && specialists.length) {
      if (!card) card = routeCard(specialists);
      updateCard(card, specialists, true);
    }
    const missing = specialists.filter((a) => a.status === "failed" || a.status === "timeout");
    const done = specialists.filter((a) => a.status === "done");
    for (const m of missing) {
      const why = m.status === "timeout" ? "no reply within the wait" : "its query failed";
      const r = orchRow(`${m.display} did not answer: ${why}.${done.length ? " Here is what the others found." : ""}`);
      chips(r, [`Retry ${m.display}`], () => ask(text, { retryOnly: m.name, note: `retry · ${m.display} only` }));
    }
    let last;
    if (res.report) last = orchRow(reply, { status: `report · ${specialists.length || 1} agent${specialists.length > 1 ? "s" : ""}`, report: res.report, specialists: specialists.length });
    else if (res.kind === "answer" && specialists.length === 1 && done.length === 1) last = agentRow(done[0], reply);
    else last = orchRow(reply, { kind: res.kind, specialists: specialists.length });
    if (res.suggestions?.length) chips(last, res.suggestions, (l) => ask(l));
  };
  return { onProgress, finish };
}

/** Render a captured exchange without the broker: {question, progress: [raw working messages], reply: raw reply | null}. */
export function replay({ question = "(replayed question)", progress = [], reply = null, note } = {}) {
  if (!_ui) throw new Error("samPanel: not initialised");
  const ex = startExchange(question, { note, ask: (t, o) => replay({ question: t, note: o?.note, reply: null }) });
  for (const p of progress) ex.onProgress(normalizeAgents(p?.agents ?? p));
  ex.finish(reply ? normalizeReply(reply) : null);
}

// ── the panel ───────────────────────────────────────────────────────────────────────────────────
function panelWidthPx() { return Math.min(400, Math.max(320, Math.round(window.innerWidth * 0.26))); }
function mobilePanelHeightPx() { return Math.min(Math.round(window.innerHeight * 0.68), 520); }

function applyPanelState(panel) {
  const mobile = isMobilePanel();
  panel.classList.toggle("sam-collapsed", !panelExpanded);
  panel.classList.toggle("sam-mobile", mobile);
  const body = document.getElementById("sam-body");
  if (mobile) {
    const h = panelExpanded ? mobilePanelHeightPx() : 56;
    Object.assign(panel.style, { width: "100%", height: `${h}px`, top: "auto", bottom: "0", left: "0", right: "0" });
    if (body) body.style.width = "";
  } else {
    const w = panelExpanded ? panelWidthPx() : 48;
    Object.assign(panel.style, { width: `${w}px`, height: "auto", top: "44px", bottom: "0", left: "auto", right: "0" });
    // content keeps its EXPANDED width even while collapsed (it's clipped) → no reflow on toggle
    if (body) body.style.width = `${panelWidthPx()}px`;
  }
  if (panelExpanded && isDesktopPanel()) requestAnimationFrame(() => focusSamInput());
}

// main.js folds the chat to its rail when the docked drawer opens a view (they share the right edge).
export function setSamExpanded(on) {
  const panel = document.getElementById("sam-panel");
  if (!panel || panelExpanded === on) return;
  panelExpanded = on;
  applyPanelState(panel);
}

export function initSamPanel(getContext) {
  if (typeof getContext === "function") _getContext = getContext;
  if (isMobilePanel()) panelExpanded = false;

  const panel = document.createElement("div");
  panel.id = "sam-panel";

  panel.innerHTML = `
    <button type="button" class="sam-rail" id="sam-rail" aria-label="Open the data assistant" title="Open the data assistant">
      <img class="sam-rail-av" src="${AVATAR}" alt="" />
      <span class="sam-rail-label">CHAT</span>
      <span class="sam-rail-chev" aria-hidden="true">‹</span>
    </button>
    <div class="sam-body" id="sam-body">
    <div id="sam-header" class="sam-header">
      <div class="sam-header-left">
        <img class="sam-brand-av" src="${AVATAR}" alt="" />
        <div class="sam-header-txt">
          <span class="sam-title">SMART Buddy</span>
          <span class="sam-sub">Data assistant</span>
        </div>
      </div>
      <div class="sam-header-right">
        <span id="sam-offline-badge" class="sam-offline-badge" style="display:none">offline</span>
        <button type="button" id="sam-new-chat" class="sam-new-chat" title="New chat">New</button>
        <button type="button" id="sam-toggle" class="sam-toggle" aria-label="Toggle assistant">›</button>
      </div>
    </div>
    <div id="sam-thread" class="sam-thread" role="log" aria-live="polite" aria-relevant="additions">
      <div class="sam-empty-state">
        <div class="sam-empty-inner">
          <img class="sam-empty-av" src="${AVATAR}" alt="" />
          <div class="sam-empty-title">Ask about the data</div>
          <div class="sam-empty-copy">SMART Buddy hands your question to the specialist for it — spend &amp; schools, terminals &amp; network, purchases &amp; nutrition, savings &amp; wallet or wearables — and answers with real numbers. Add “as a report” for figures and charts. Every question stands alone: say which month or school you mean.</div>
          <div class="sam-empty-prompts">
            <button type="button" class="sam-empty-chip" data-prompt="Which schools spent the most?">Top-spending schools</button>
            <button type="button" class="sam-empty-chip" data-prompt="Which terminals are the slowest?">Slowest terminals</button>
            <button type="button" class="sam-empty-chip" data-prompt="Spend by school level, as a report">Spend by level, as a report</button>
            <button type="button" class="sam-empty-chip" data-prompt="How many wearable users were active?">Active wearable users</button>
          </div>
        </div>
      </div>
    </div>
    <div id="sam-footer" class="sam-footer">
      <div class="sam-inputwrap">
        <textarea id="sam-input" rows="1" placeholder="Ask about the data…" class="sam-input" aria-label="Message to SMART Buddy"></textarea>
        <button type="button" id="sam-send" class="sam-send" aria-label="Send" title="Send">↑</button>
      </div>
      <div class="sam-hint">Enter to send · Shift+Enter for a new line · “as a report” for figures and charts</div>
    </div>
    </div>`;

  const style = document.createElement("style");
  style.id = "sam-panel-styles";
  style.textContent = `
    #sam-panel { position: fixed; right: 0; top: 44px; bottom: 0; height: auto; z-index: 1100;
      background: var(--canvas); border-left: 1px solid var(--hairline); display: flex; flex-direction: column;
      font-family: var(--font-text); overflow: hidden; box-shadow: -8px 0 30px rgba(0,0,0,.07);
      transition: width .2s ease, height .2s ease; }
    #sam-panel * { box-sizing: border-box; }
    .sam-header { padding: 10px 12px; border-bottom: 1px solid var(--divider-soft); display: flex;
      justify-content: space-between; align-items: center; gap: 8px; flex: none; background: var(--parchment); }
    .sam-header-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .sam-brand-av { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; flex: none; }
    .sam-header-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .sam-title { color: var(--ink); font-family: var(--font-display); font-size: 14px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }
    .sam-sub { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--ink-muted-48); text-transform: uppercase; }
    .sam-header-right { display: flex; align-items: center; gap: 6px; flex: none; }
    .sam-new-chat { border: 1px solid var(--hairline); background: var(--canvas); color: var(--primary);
      border-radius: var(--r-pill); padding: 4px 11px; font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .sam-new-chat:hover { background: #f0f6ff; border-color: var(--primary); }
    .sam-offline-badge { background: rgba(255,59,48,.12); color: var(--bad); font-size: 10px; font-weight: 700;
      letter-spacing: .04em; padding: 3px 8px; border-radius: var(--r-pill); text-transform: uppercase; }
    .sam-toggle { background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink-muted-48);
      cursor: pointer; border-radius: var(--r-pill); font-size: 16px; line-height: 1; width: 30px; height: 30px; flex: none; }
    .sam-toggle:hover { background: #f0f6ff; color: var(--primary); }

    .sam-thread { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 14px 12px 16px; display: flex; flex-direction: column; gap: 12px; }
    .sam-empty-state { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px 4px; }
    .sam-empty-state[hidden] { display: none; }   /* the explicit display:flex above would otherwise override [hidden] */
    .sam-empty-inner { max-width: 300px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .sam-empty-av { width: 46px; height: 46px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
    .sam-empty-title { color: var(--ink); font-family: var(--font-display); font-size: 15px; font-weight: 650; }
    .sam-empty-copy { color: var(--ink-muted-80); font-size: 12.5px; line-height: 1.5; }
    .sam-empty-prompts { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-top: 4px; }
    .sam-empty-chip { border: 1px solid #d6e3fb; background: #f5f9ff; color: #1f5fb0; border-radius: var(--r-pill);
      padding: 7px 12px; font-size: 12px; line-height: 1.2; font-family: inherit; cursor: pointer; transition: .14s; }
    .sam-empty-chip:hover { background: #e7f0ff; transform: translateY(-1px); }

    /* rows: the viewer's bubble on the right; the agents' on the left with a who-line (swatch + name) */
    .sam-msg-row { display: flex; flex-direction: column; gap: 4px; max-width: 92%; animation: sam-in .2s ease-out; min-width: 0; }
    .sam-msg-row-user { align-self: flex-end; align-items: flex-end; }
    .sam-msg-row:has(.sam-report) { max-width: 100%; width: 100%; }
    .sam-msg { padding: 9px 13px; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
    .sam-msg-user { background: var(--primary); color: #fff; border-radius: 14px 14px 4px 14px; white-space: pre-wrap; }
    .sam-msg-sam { background: var(--parchment); color: var(--ink); border-radius: 14px 14px 14px 4px; }
    .sam-msg-row-agent .sam-msg-sam { border-left: 3px solid var(--c, var(--agent-0)); border-radius: 4px 14px 14px 4px; }
    .sam-msg-row-refusal .sam-msg-sam { border-left: 3px solid var(--bad); border-radius: 4px 14px 14px 4px; }
    .sam-msg-sam .sam-p { margin: 0; }
    .sam-msg-sam .sam-p + .sam-p { margin-top: 6px; }
    .sam-msg-sam ul, .sam-msg-sam ol { margin: 6px 0; padding-left: 20px; }
    .sam-msg-sam li { margin: 2px 0; }
    .sam-msg-sam code { background: rgba(0,0,0,.06); border-radius: 5px; padding: 1px 5px; font-size: 12px;
      font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
    .sam-msg-sam strong { font-weight: 680; }
    .sam-who { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-muted-80); padding-left: 2px; }
    .sam-who b { font-weight: 650; } .sam-who .t { color: var(--ink-muted-48); }
    .sam-sw { width: 9px; height: 9px; border-radius: 50%; background: var(--c, var(--agent-0)); flex: none; box-shadow: 0 0 0 2px var(--canvas); display: inline-block; }
    .sam-foot { display: flex; align-items: center; gap: 10px; font-size: 10.5px; color: var(--ink-muted-48); padding-left: 2px; flex-wrap: wrap; }
    .sam-copy { border: none; background: none; color: var(--ink-muted-48); font-size: 10.5px; padding: 0 2px; cursor: pointer; font-family: inherit; }
    .sam-copy:hover { color: var(--primary); }
    .sam-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .sam-chip { border: 1px solid var(--hairline); background: var(--canvas); color: var(--primary); border-radius: var(--r-pill);
      padding: 5px 11px; font-size: 12px; line-height: 1.2; font-family: inherit; cursor: pointer; }
    .sam-chip:hover { background: #f0f6ff; border-color: var(--primary); }
    .sam-working { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-muted-80); font-weight: 600; }
    .sam-dots { display: inline-flex; gap: 3px; }
    .sam-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--c, var(--agent-0)); animation: sam-bounce 1.05s ease-in-out infinite; opacity: .4; }
    .sam-dots i:nth-child(2) { animation-delay: .14s; } .sam-dots i:nth-child(3) { animation-delay: .28s; }

    /* the hand-off: the orchestrator's routing card, one row per specialist */
    .sam-route { display: grid; gap: 6px; padding: 9px 12px; background: var(--parchment); border-radius: 4px 14px 14px 4px; border-left: 3px solid var(--agent-0); font-size: 12.5px; color: var(--ink); }
    .sam-arow { display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 22px; }
    .sam-arow .name { font-weight: 650; }
    .sam-arow .st { color: var(--ink-muted-48); display: inline-flex; align-items: center; gap: 6px; }
    .sam-arow .ms { margin-left: auto; color: var(--ink-muted-48); font-size: 11px; font-variant-numeric: tabular-nums; }
    .sam-arow.failed .st, .sam-arow.timeout .st { color: var(--bad); }
    .sam-arow.done .st { color: var(--ink-muted-80); }
    .sam-arow .tick { width: 14px; height: 14px; border-radius: 50%; background: var(--c, var(--agent-0)); color: #fff; display: inline-grid; place-items: center; font-size: 10px; font-weight: 700; }
    .sam-arow .cross { width: 14px; height: 14px; border-radius: 50%; background: var(--bad); color: #fff; display: inline-grid; place-items: center; font-size: 10px; font-weight: 700; }

    /* the report card */
    .sam-report { background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--r-md); box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.07); overflow: hidden; min-width: 0; }
    .sam-rp-head { padding: 12px 14px 10px; border-bottom: 1px solid var(--divider-soft); display: grid; gap: 2px; }
    .sam-rp-head h3 { font-size: 14px; font-weight: 650; letter-spacing: -.1px; font-family: var(--font-display); margin: 0; }
    .sam-rp-head .meta { font-size: 11px; color: var(--ink-muted-48); display: flex; flex-wrap: wrap; gap: 4px 10px; }
    .sam-rp-body { padding: 12px 14px 10px; display: grid; gap: 14px; min-width: 0; }
    .sam-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 8px; }
    .sam-kpi { background: var(--parchment); border-radius: var(--r-sm); padding: 9px 10px 8px; min-width: 0; }
    .sam-kpi .l { font-size: 11px; color: var(--ink-muted-80); font-weight: 550; display: flex; align-items: center; gap: 5px; }
    .sam-kpi .v { font-size: 19px; font-weight: 650; letter-spacing: -.4px; margin-top: 1px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .sam-kpi .d { font-size: 11px; font-weight: 600; margin-top: 1px; }
    .sam-kpi .d.up { color: var(--good); } .sam-kpi .d.down { color: var(--bad); } .sam-kpi .d.flat { color: var(--ink-muted-48); }
    .sam-sec { display: grid; gap: 6px; min-width: 0; }
    .sam-sec-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .sam-sec-h h4 { font-size: 12.5px; font-weight: 650; margin: 0; font-family: var(--font-display); }
    .sam-from { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--ink-muted-48); white-space: nowrap; }
    .sam-chart { position: relative; min-width: 0; }
    .sam-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
    .sam-chart text { font-family: var(--font-text); fill: var(--ink-muted-80); font-size: 11px; }
    .sam-chart .ax text { fill: var(--ink-muted-48); font-size: 10.5px; }
    .sam-chart .grid line { stroke: #ececec; stroke-width: 1; }
    .sam-chart .base { stroke: #d0d0d0; stroke-width: 1; }
    .sam-chart .bar.hl { filter: brightness(1.12); }
    .sam-chart .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .sam-chart .ar { fill: var(--c); opacity: .1; }
    .sam-chart .dot { fill: var(--c); stroke: var(--canvas); stroke-width: 2; }
    .sam-chart .hit { fill: transparent; cursor: crosshair; outline: none; }
    .sam-chart .hit:focus-visible { stroke: var(--primary); stroke-width: 1.5; }
    .sam-chart .xh { stroke: #d0d0d0; stroke-width: 1; pointer-events: none; }
    .sam-chart .val { fill: var(--ink); font-weight: 600; }
    .sam-chart .mark { fill: var(--ink-muted-48); font-size: 10px; }
    .sam-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--ink-muted-80); }
    .sam-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .sam-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .sam-tip { position: fixed; z-index: 1200; pointer-events: none; background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--r-sm);
      box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.1); padding: 6px 9px; font-size: 12px; display: none; max-width: 240px; font-family: var(--font-text); color: var(--ink); }
    .sam-tip.on { display: block; }
    .sam-tip b { display: block; font-size: 13px; }
    .sam-tip .k { display: inline-block; width: 10px; height: 2px; background: var(--c); vertical-align: middle; margin-right: 6px; }
    .sam-tip .m { color: var(--ink-muted-48); }
    .sam-numbers summary { font-size: 11.5px; color: var(--primary); cursor: pointer; width: fit-content; margin-top: 2px; }
    table.sam-mini { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; table-layout: auto; }
    table.sam-mini th { text-align: left; color: var(--ink-muted-48); font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; padding: 5px 6px; border-bottom: 1px solid var(--hairline); }
    table.sam-mini td { padding: 5px 6px; border-bottom: 1px solid var(--divider-soft); overflow-wrap: anywhere; }
    table.sam-mini td.num, table.sam-mini th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.sam-mini tr:last-child td { border-bottom: 0; }
    .sam-notes { font-size: 11.5px; color: var(--ink-muted-80); padding-left: 16px; display: grid; gap: 3px; margin: 0; }
    .sam-rp-foot { padding: 10px 14px 12px; border-top: 1px solid var(--divider-soft); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .sam-rp-foot .src { font-size: 11px; color: var(--ink-muted-48); margin-right: auto; }
    @keyframes sam-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes sam-bounce { 0%,80%,100% { transform: translateY(0) scale(.82); opacity: .35; } 40% { transform: translateY(-4px) scale(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .sam-msg-row { animation: none; } .sam-dots i { animation: none; opacity: .8; } }

    .sam-footer { padding: 10px 12px 12px; border-top: 1px solid var(--divider-soft); flex: none; background: var(--parchment); }
    .sam-inputwrap { display: flex; align-items: flex-end; gap: 8px; background: var(--canvas);
      border: 1px solid var(--hairline); border-radius: 16px; padding: 6px 6px 6px 12px; transition: border-color .15s, box-shadow .15s; }
    .sam-inputwrap:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0,102,204,.12); }
    .sam-input { flex: 1; border: none; outline: none; resize: none; background: transparent; color: var(--ink);
      font-family: inherit; font-size: 13px; line-height: 1.45; max-height: 120px; padding: 4px 0; }
    .sam-input::placeholder { color: var(--ink-muted-48); }
    .sam-send { flex: none; width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--primary);
      color: #fff; font-size: 16px; line-height: 1; cursor: pointer; }
    .sam-send:hover { background: var(--primary-focus); }
    .sam-send:disabled { opacity: .45; cursor: not-allowed; }
    .sam-hint { font-size: 10.5px; color: var(--ink-muted-48); text-align: center; margin-top: 6px; }

    /* content block keeps a FIXED width (set by JS) so nothing reflows when the panel
       collapses/expands — only the panel's own width animates (content is just clipped). */
    .sam-body { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; }
    #sam-panel.sam-collapsed .sam-body { display: none; }
    #sam-panel.sam-collapsed .sam-rail { display: flex; }

    /* collapsed rail — the WHOLE strip is the open button */
    .sam-rail { display: none; flex: 1 1 auto; width: 100%; flex-direction: column; align-items: center;
      gap: 12px; padding: 14px 0; border: none; background: var(--canvas); cursor: pointer;
      font-family: inherit; transition: background .14s; }
    .sam-rail:hover { background: #f0f6ff; }
    .sam-rail-av { width: 26px; height: 26px; border-radius: 7px; object-fit: cover; flex: none; }
    .sam-rail-label { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 2px; flex: 1;
      display: flex; align-items: center; font-family: var(--font-display); font-weight: 650;
      font-size: 12px; color: var(--ink-muted-48); }
    .sam-rail-chev { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
      background: var(--parchment); color: var(--primary); font-size: 16px; line-height: 1; flex: none; transition: background .14s; }
    .sam-rail:hover .sam-rail-chev { background: #e2edff; }

    #sam-panel.sam-mobile { border-left: none; border-top: 1px solid var(--hairline); border-radius: 16px 16px 0 0; box-shadow: 0 -12px 34px rgba(0,0,0,.14); }
    #sam-panel.sam-mobile .sam-input { font-size: 16px; }
    #sam-panel.sam-mobile .sam-rail { flex-direction: row; justify-content: center; gap: 10px; padding: 0 16px; }
    #sam-panel.sam-mobile .sam-rail-label { writing-mode: horizontal-tb; text-orientation: mixed; flex: none; }
    #sam-panel.sam-mobile .sam-rail-chev { transform: rotate(90deg); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  const thread = document.getElementById("sam-thread");
  const input = document.getElementById("sam-input");
  const sendBtn = document.getElementById("sam-send");
  const toggleBtn = document.getElementById("sam-toggle");
  const newChatBtn = document.getElementById("sam-new-chat");
  _ui = { panel, thread, input, sendBtn };

  applyPanelState(panel);
  updateEmptyState(thread);
  window.addEventListener("resize", () => applyPanelState(panel));
  toggleBtn.addEventListener("click", () => { panelExpanded = !panelExpanded; applyPanelState(panel); });
  document.getElementById("sam-rail")?.addEventListener("click", () => { panelExpanded = true; applyPanelState(panel); });
  newChatBtn?.addEventListener("click", () => { resetChatThread(thread, input); setOffline(false); focusSamInput(); });
  document.addEventListener("smartbuddy:solace-status", (e) => { if (!e.detail?.connected) setOffline(true); });
  if (panelExpanded && isDesktopPanel()) requestAnimationFrame(() => focusSamInput());

  async function handleSend(forcedText = "", { retryOnly, note } = {}) {
    const text = String((typeof forcedText === "string" ? forcedText : "") || input.value).trim();
    if (!text) return;
    document.dispatchEvent(new CustomEvent("smartbuddy:sam-ask"));   // onboarding checklist (main.js)
    setOffline(false);
    if (!panelExpanded) { panelExpanded = true; applyPanelState(panel); }
    input.value = ""; autoGrow(input);
    sendBtn.disabled = true;

    let context = {};
    try { context = _getContext() || {}; } catch (e) { console.warn("[sam] getContext failed:", e); }
    if (retryOnly) context = { ...context, retryOnly };

    const ex = startExchange(text, { note, ask: (t, o) => handleSend(t, o) });
    const response = await chat(text, context, { onProgress: ex.onProgress });
    sendBtn.disabled = false;
    ex.finish(response);
    focusSamInput();
  }

  sendBtn.addEventListener("click", () => handleSend());
  input.addEventListener("input", () => autoGrow(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }   // Enter sends, Shift+Enter = newline
  });
  // delegated click handling for the starter chips
  thread.addEventListener("click", (e) => {
    const b = e.target.closest("[data-prompt]");
    if (b) void handleSend(b.getAttribute("data-prompt") || "");
  });
}
