/**
 * samPanel.js — the SMART Buddy chat (self-contained vanilla JS DOM widget; styles in src/styles/chat.css).
 *
 * Renders central-specs design/agent-chat on the live wire (capabilities sam-chat + agent-system, decision 0006):
 *  - placement: one card anchored to the map's lower right, left of the drawer, opened from Ask in the top bar,
 *    widened by Expand; a full-screen sheet below 720 px; below 1100 px the chat and the drawer replace each other
 *    (smartbuddy:chat → windowing.js). Closing keeps the conversation until New or a reload.
 *  - while a question waits: the steps Sent → Received → Answered with the seconds elapsed, until a progress
 *    message names the agents and the routing card (one row per specialist) replaces them;
 *  - the answer: its text from a safe Markdown subset (markdown.js — elements only, never innerHTML), a brief
 *    visual (≤3 tiles + one chart or table) inside the bubble, or the full report card; "How it worked · N steps";
 *    attribution on every answer; school names in table cells, KPI labels and bold runs become buttons that open
 *    the school (resolvePlace / onPlace from main.js); refusals with tappable suggestions; partial answers with
 *    Retry; the offline state.
 * Every string from a reply enters the DOM through textContent, so model output can never inject markup.
 * getContext() is folded into the outgoing envelope by samClient.
 *
 * replay() renders a captured exchange without the broker (debugging, the design's conversations):
 *   import('/src/sam/samPanel.js').then(m => m.replay({ question, progress: [...], reply }))
 * A progress entry that is the gateway's receipt ("Request received by gateway…") marks "Received".
 */

import { chat, normalizeReply, normalizeAgents, isReceipt } from "./samClient.js";
import { renderAnswer } from "./markdown.js";

const AVATAR = "/icon.png";                 // branded avatar (public/icon.png) — header and empty state
const PHONE = matchMedia("(max-width: 719px)");
let _getContext = () => ({});
let _resolvePlace = () => null;
let _onPlace = () => {};
let _ui = null;                             // { panel, thread, input, sendBtn, askBtn, expandBtn } once initialised
let isOpen = false;

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

// ── small DOM + number helpers (labels are untrusted data: textContent only) ────────────────────
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
// The few icons the chat draws (static path data, not reply text).
const ICON = {
  close: "m6 6 12 12M18 6 6 18",
  expand: "M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5 14 10M3.5 20.5 10 14",
  narrow: "M20.5 3.5 14 10M14 4.5V10h5.5M3.5 20.5 10 14M10 19.5V14H4.5",
  send: "M12 19V5.5M6.5 11 12 5.5l5.5 5.5",
};
const icon = (name) => { const s = svgEl("svg", { class: "ic", viewBox: "0 0 24 24", "aria-hidden": "true" }); s.append(svgEl("path", { d: ICON[name] })); return s; };
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
function seriesColour(i) { return i === 0 ? "var(--c)" : `color-mix(in srgb, var(--c) ${Math.round(SERIES_ALPHA[Math.min(i, SERIES_ALPHA.length - 1)] * 100)}%, var(--surface))`; }

function barChart(ch, colour) {
  const cats = ch.series[0].points.map((p) => p[0]);
  const stacked = ch.kind === "stacked" || ch.series.length > 1;
  const byCat = cats.map((c, i) => ch.series.map((s) => (s.points[i]?.[0] === c ? s.points[i][1] : (s.points.find((p) => p[0] === c)?.[1] ?? 0))));
  const totals = byCat.map((vals) => stacked ? vals.reduce((a, b) => a + Math.max(0, b), 0) : vals[0]);
  const W = 360, rowH = 30, padL = 128, padR = 52, top = 6; const H = top + cats.length * rowH + 16;
  const max = nice(Math.max(...totals));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": ch.title });
  const grid = svgEl("g", { class: "grid ax" });
  for (let i = 0; i <= 4; i++) { const x = padL + (W - padL - padR) * i / 4; grid.append(svgEl("line", { x1: x, x2: x, y1: top, y2: H - 16 })); const t = svgEl("text", { x, y: H - 2, "text-anchor": "middle" }); t.textContent = tickFmt(max * i / 4, ch.unit); grid.append(t); }
  svg.append(grid, svgEl("line", { class: "base", x1: padL, x2: padL, y1: top, y2: H - 16 }));
  cats.forEach((cat, i) => {
    const y = top + i * rowH + 4, h = 22;
    const lab = svgEl("text", { x: padL - 8, y: y + h / 2, "text-anchor": "end", dy: 4 }); lab.textContent = xLabel(cat, 20); svg.append(lab);
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
    // every bar carries its value when there are few bars (a ranking reads at a glance); else only the top one
    if (cats.length <= 8 || i === totals.indexOf(Math.max(...totals))) { const v = svgEl("text", { class: "val", x: Math.min(x0 + 6, W - 4), y: y + h / 2, dy: 4 }); v.textContent = fmtValue(totals[i], ch.unit); svg.append(v); }
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
    svg.append(svgEl("rect", { class: "shade", x: x1, y: top, width: x2 - x1, height: H - top - bottom }));
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
  const wrap = el("div", "sam-table");
  const t = el("table", "sam-mini"); const tr = el("tr");
  columns.forEach((c, i) => tr.append(el("th", i ? "num" : "", c))); t.append(tr);
  for (const r of rows) {
    const tr2 = el("tr");
    r.forEach((v, i) => tr2.append(el("td", typeof v === "number" || i ? "num" : "", typeof v === "number" ? fmtValue(v, units[i]) : String(v ?? ""))));
    t.append(tr2);
  }
  wrap.append(t);
  return wrap;
}
function chartTable(ch) {
  const xs = ch.series[0].points.map((p) => p[0]);
  const rows = xs.map((x, i) => [xLabel(x, 40), ...ch.series.map((s) => s.points[i]?.[0] === x ? s.points[i][1] : (s.points.find((p) => p[0] === x)?.[1] ?? ""))]);
  return numbersTable([ch.x ? xLabel(ch.x, 20) : (ch.kind === "line" ? "Date" : "Category"), ...ch.series.map((s) => s.name)], rows, [undefined, ...ch.series.map(() => ch.unit)]);
}

// ── the visuals: KPI tiles, a chart section, a table section (shared by the brief and the full report) ──────
function fromTag(agentName) {
  const a = agentView({ name: agentName });
  const f = el("span", "sam-from"); f.style.setProperty("--c", a.colour); f.append(el("span", "sam-sw"), el("span", null, a.display)); return f;
}
function kpiTiles(list) {
  const k = el("div", "sam-kpis");
  for (const x of list) {
    const t = el("div", "sam-kpi"); if (x.agent) t.style.setProperty("--c", agentView({ name: x.agent }).colour);
    const l = el("div", "l"); if (x.agent) l.append(el("span", "sam-sw")); l.append(el("span", null, x.label)); t.append(l, el("div", "v", fmtValue(x.value, x.unit)));
    if (x.delta) t.append(el("div", `d ${x.delta.pct > 0.05 ? "up" : x.delta.pct < -0.05 ? "down" : "flat"}`, `${x.delta.pct >= 0 ? "+" : ""}${x.delta.pct.toFixed(1)}%${x.delta.vs ? ` vs ${x.delta.vs}` : ""}`));
    k.append(t);
  }
  return k;
}
function chartSection(ch, withFrom = true) {
  const a = agentView({ name: ch.agent });
  const sec = el("div", "sam-sec"); const h = el("div", "sam-sec-h"); h.append(el("h4", null, `${ch.title}${ch.unit ? ` (${ch.unit})` : ""}`));
  if (ch.agent && withFrom) h.append(fromTag(ch.agent)); sec.append(h);
  const c = el("div", "sam-chart"); c.style.setProperty("--c", a.colour);
  c.append(ch.kind === "line" ? lineChart(ch, a.colour) : barChart(ch, a.colour)); sec.append(c);
  if (ch.series.length > 1) { const lg = el("div", "sam-legend"); lg.style.setProperty("--c", a.colour); ch.series.forEach((s, i) => { const d = el("span"); const sw = el("i"); sw.style.background = seriesColour(i); d.append(sw, el("span", null, s.name)); lg.append(d); }); sec.append(lg); }
  const det = el("details", "sam-numbers"); det.append(el("summary", null, "Numbers"), chartTable(ch)); sec.append(det);
  return sec;
}
function tableSection(tb, withFrom = true) {
  const sec = el("div", "sam-sec"); const h = el("div", "sam-sec-h"); h.append(el("h4", null, tb.title));
  if (tb.agent && withFrom) h.append(fromTag(tb.agent));
  sec.append(h, numbersTable(tb.columns.length ? tb.columns : tb.rows[0].map((_, i) => `Column ${i + 1}`), tb.rows, tb.units));
  return sec;
}
// A brief visual (decision 0006): no title row — the tiles, then its one chart or one table, inside the bubble.
function briefVisual(rp) {
  const box = el("div", "sam-brief");
  if (rp.kpis.length) box.append(kpiTiles(rp.kpis));
  for (const ch of rp.charts) box.append(chartSection(ch, false));
  for (const tb of rp.tables) box.append(tableSection(tb, false));
  if (rp.dropped.length) box.append(el("div", "sam-foot", `Not shown (beyond the chat's limits): ${rp.dropped.join(", ")}.`));
  return box;
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
  if (rp.kpis.length) body.append(kpiTiles(rp.kpis));
  for (const ch of rp.charts) body.append(chartSection(ch));
  for (const tb of rp.tables) body.append(tableSection(tb));
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

// "How it worked · N steps": one line per step with its agent's swatch and name, folded.
function stepsBlock(steps) {
  const d = el("details", "sam-steps");
  d.append(el("summary", null, `How it worked · ${steps.length} step${steps.length === 1 ? "" : "s"}`));
  const ol = el("ol");
  for (const s of steps) {
    const a = agentView({ name: s.agent || ORCHESTRATOR });
    const li = el("li"); li.style.setProperty("--c", a.colour);
    li.append(el("span", "sam-sw"), el("b", null, a.display), el("span", null, s.text));
    ol.append(li);
  }
  d.append(ol);
  return d;
}

// School names that exactly match a school of the selected month (main.js resolvePlace) become buttons — in table
// cells, KPI labels and bold runs only. Nothing else in an answer is ever a link.
function linkPlaces(root) {
  const cands = root.querySelectorAll(".sam-table td, .sam-table th:first-child, .sam-kpi .l > span:last-child, .sam-msg-sam strong");
  for (const node of cands) {
    if (node.children.length) continue;                 // text only (a bold run inside a cell is reached on its own)
    const text = node.textContent.trim();
    if (!text || text.length > 120) continue;
    const sid = _resolvePlace(text);
    if (!sid) continue;
    const b = el("button", "sam-place", text);
    b.type = "button"; b.dataset.sid = sid; b.title = "Open this school and show it on the map";
    b.addEventListener("click", () => _onPlace(sid));
    node.replaceChildren(b);
  }
}

// ── thread rows ─────────────────────────────────────────────────────────────────────────────────
function focusInput() {
  if (!_ui || !isOpen || PHONE.matches) return;
  _ui.input.focus({ preventScroll: true });
  const end = _ui.input.value.length;
  _ui.input.setSelectionRange(end, end);
}
function autoGrow(input) {
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
// The pending bubble: Sent ✓ → Received → Answered, with the seconds elapsed on the current step (a 1 s ticker that
// runs only while the question waits).
function pendingRow() {
  const row = el("div", "sam-msg-row sam-msg-row-orch"); row.append(who(ORCH, "working"));
  const box = el("div", "sam-pending");
  const step = (key, label) => { const s = el("div", "sam-step"); s.dataset.step = key; s.append(el("span", "m"), el("span", null, label)); box.append(s); return s; };
  const sent = step("sent", "Sent"), recv = step("received", "Received"), ans = step("answered", "Answered");
  const elapsed = el("span", "el", "0 s");
  const mark = (s, state) => { s.className = `sam-step ${state}`; s.querySelector(".m").textContent = state === "done" ? "✓" : ""; if (state === "now") s.append(elapsed); };
  mark(sent, "done"); mark(recv, "now"); mark(ans, "");
  row.append(box); addRow(row);
  const t0 = Date.now();
  const timer = setInterval(() => { if (!row.isConnected) return clearInterval(timer); elapsed.textContent = `${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
  return { received() { mark(recv, "done"); mark(ans, "now"); }, remove() { clearInterval(timer); row.remove(); } };
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
// An answer bubble: the Markdown text, then (a brief) its visual inside; a full report card goes under the bubble.
function bubble(text, brief) {
  const b = el("div", "sam-msg sam-msg-sam");
  b.append(renderAnswer(document, text));
  if (brief) b.append(briefVisual(brief));
  return b;
}
function agentRow(a, text, { brief, steps } = {}) {
  const row = el("div", `sam-msg-row sam-msg-row-agent${brief ? " full" : ""}`); row.style.setProperty("--c", a.colour);
  row.append(who(a, "answered"), bubble(text, brief));
  if (steps?.length) row.append(stepsBlock(steps));
  const f = el("div", "sam-foot");
  if (brief?.period) f.append(el("span", null, `period ${periodLabel(brief.period)}`));
  if (a.source || brief?.source) f.append(el("span", null, `source: ${a.source || brief.source}`));
  f.append(copyBtn(text)); row.append(f);
  return addRow(row);
}
function orchRow(text, { kind = "answer", status, report, brief, steps, specialists = 0 } = {}) {
  const row = el("div", `sam-msg-row sam-msg-row-orch${kind === "refusal" ? " sam-msg-row-refusal" : ""}${report || brief ? " full" : ""}`);
  row.append(who(ORCH, status), bubble(text, brief));
  if (report) row.append(reportCard(report, text));
  if (steps?.length) row.append(stepsBlock(steps));
  const f = el("div", "sam-foot");
  const rp = report || brief;
  if (rp?.period) f.append(el("span", null, `period ${periodLabel(rp.period)}`));
  if (rp?.source) f.append(el("span", null, `source: ${rp.source}`));
  else if (specialists) f.append(el("span", null, "source: Redshift, smartbuddy_agent"));
  if (!report) f.append(copyBtn(text));
  row.append(f);
  return addRow(row);
}
function setOffline(isOffline) {
  const badge = document.getElementById("sam-offline-badge");
  if (badge) badge.hidden = !isOffline;
}

// ── one exchange: the question, progress while the agents work, the answer ──────────────────────
// Design A (the mesh forwards status): the routing card appears on the first progress message and its rows
// update. Design B (final reply only): the card is built from the final agents[] right before the answer.
function startExchange(text, { note, ask } = {}) {
  userRow(text, note);
  let pending = pendingRow();
  let card = null;
  const onReceipt = () => pending?.received();
  const onProgress = (agents) => {
    const specialists = agents.map(agentView).filter(isSpecialist);
    if (!specialists.length) return;
    if (!card) { pending?.remove(); pending = null; card = routeCard(specialists); }
    else updateCard(card, specialists);
  };
  const finish = (res) => {
    pending?.remove(); pending = null;
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
    // Attribution (sam-chat): a reply whose report is null or brief, with exactly one specialist done, is that
    // specialist's bubble; any other reply is the orchestrator's.
    const brief = res.report?.mode === "brief" ? res.report : null;
    const full = res.report && !brief ? res.report : null;
    let last;
    if (full) last = orchRow(reply, { status: `report · ${specialists.length || 1} agent${specialists.length > 1 ? "s" : ""}`, report: full, steps: res.steps, specialists: specialists.length });
    else if (res.kind !== "refusal" && done.length === 1) last = agentRow(done[0], reply, { brief, steps: res.steps });
    else last = orchRow(reply, { kind: res.kind, brief, steps: res.steps, specialists: specialists.length });
    if (res.suggestions?.length) chips(last, res.suggestions, (l) => ask(l));
    linkPlaces(last);
  };
  return { onReceipt, onProgress, finish };
}

/**
 * Render a captured exchange without the broker: {question, progress: [raw working messages or the gateway's receipt],
 * reply: raw reply | null (offline)}. Without `reply` the question is left waiting, to inspect its progress.
 */
export function replay({ question = "(replayed question)", progress = [], reply, note } = {}) {
  if (!_ui) throw new Error("samPanel: not initialised");
  setChatOpen(true);
  const ex = startExchange(question, { note, ask: (t, o) => replay({ question: t, note: o?.note, reply: null }) });
  for (const p of progress) { if (isReceipt(p)) ex.onReceipt(); else ex.onProgress(normalizeAgents(p?.agents ?? p)); }
  if (reply !== undefined) ex.finish(reply ? normalizeReply(reply) : null);
}

// ── open / close (Ask in the top bar; Esc and ✕ close; the conversation stays) ──────────────────
export function setChatOpen(on) {
  if (!_ui || isOpen === !!on) return;
  isOpen = !!on;
  _ui.panel.hidden = !isOpen;
  _ui.askBtn?.setAttribute("aria-pressed", isOpen);
  document.dispatchEvent(new CustomEvent("smartbuddy:chat", { detail: { open: isOpen } }));
  if (isOpen) requestAnimationFrame(focusInput);
  else if (_ui.panel.contains(document.activeElement) || document.activeElement === document.body) _ui.askBtn?.focus();
}
export const isChatOpen = () => isOpen;
export const toggleChat = () => setChatOpen(!isOpen);

export function initSamPanel(getContext, { askButton, resolvePlace, onPlace } = {}) {
  if (typeof getContext === "function") _getContext = getContext;
  if (typeof resolvePlace === "function") _resolvePlace = resolvePlace;
  if (typeof onPlace === "function") _onPlace = onPlace;

  const panel = el("section", "chat");
  panel.id = "sam-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "SMART Buddy, the data assistant");

  // static markup only (no reply text): the header, the empty state and the input
  panel.innerHTML = `
    <header class="chat-head">
      <img class="chat-av" src="${AVATAR}" alt="" />
      <div class="chat-title"><b>SMART Buddy</b><span>Data assistant · aggregates only</span></div>
      <span id="sam-offline-badge" class="chat-offline" hidden>Offline</span>
      <button type="button" id="sam-new-chat" class="btn">New</button>
      <button type="button" id="sam-expand" class="icon-btn sam-expand" aria-pressed="false" aria-label="Widen the chat"></button>
      <button type="button" id="sam-close" class="icon-btn" aria-label="Close the chat"></button>
    </header>
    <div id="sam-thread" class="sam-thread" role="log" aria-live="polite" aria-relevant="additions">
      <div class="sam-empty-state">
        <div class="sam-empty-inner">
          <img class="sam-empty-av" src="${AVATAR}" alt="" />
          <div class="sam-empty-title">Ask about the data</div>
          <div class="sam-empty-copy">SMART Buddy hands your question to the specialist for it — spend &amp; schools, terminals &amp; network, purchases &amp; nutrition, savings &amp; wallet or wearables — and answers with real numbers, with a chart or a table where it helps. Add “as a report” for a full report. Say which month or school you mean.</div>
          <div class="sam-empty-prompts">
            <button type="button" class="sam-empty-chip" data-prompt="Top 5 schools by spend">Top 5 schools by spend</button>
            <button type="button" class="sam-empty-chip" data-prompt="Which terminals are the slowest?">Slowest terminals</button>
            <button type="button" class="sam-empty-chip" data-prompt="10 most recent transactions">10 most recent transactions</button>
            <button type="button" class="sam-empty-chip" data-prompt="Spend by school level, as a report">Spend by level, as a report</button>
          </div>
        </div>
      </div>
    </div>
    <div id="sam-footer" class="sam-footer">
      <div class="sam-inputwrap">
        <textarea id="sam-input" rows="1" placeholder="Ask about the data…" class="sam-input" aria-label="Message to SMART Buddy"></textarea>
        <button type="button" id="sam-send" class="sam-send" aria-label="Send"></button>
      </div>
      <div class="sam-hint">Enter to send · Shift+Enter for a new line · Esc closes</div>
    </div>`;
  (document.getElementById("stage") || document.body).appendChild(panel);

  const thread = panel.querySelector("#sam-thread");
  const input = panel.querySelector("#sam-input");
  const sendBtn = panel.querySelector("#sam-send");
  const expandBtn = panel.querySelector("#sam-expand");
  sendBtn.append(icon("send"));
  expandBtn.append(icon("expand"));
  panel.querySelector("#sam-close").append(icon("close"));
  _ui = { panel, thread, input, sendBtn, askBtn: askButton, expandBtn };

  updateEmptyState(thread);
  askButton?.addEventListener("click", toggleChat);
  panel.querySelector("#sam-close").addEventListener("click", () => setChatOpen(false));
  expandBtn.addEventListener("click", () => {
    const wide = panel.classList.toggle("wide");
    expandBtn.setAttribute("aria-pressed", wide);
    expandBtn.setAttribute("aria-label", wide ? "Narrow the chat" : "Widen the chat");
    expandBtn.replaceChildren(icon(wide ? "narrow" : "expand"));
  });
  panel.querySelector("#sam-new-chat").addEventListener("click", () => { resetChatThread(thread, input); setOffline(false); focusInput(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setChatOpen(false); } });
  document.addEventListener("smartbuddy:solace-status", (e) => { if (!e.detail?.connected) setOffline(true); });

  async function handleSend(forcedText = "", { retryOnly, note } = {}) {
    const text = String((typeof forcedText === "string" ? forcedText : "") || input.value).trim();
    if (!text) return;
    document.dispatchEvent(new CustomEvent("smartbuddy:sam-ask"));   // onboarding checklist (main.js)
    setOffline(false);
    setChatOpen(true);
    input.value = ""; autoGrow(input);
    sendBtn.disabled = true;

    let context = {};
    try { context = _getContext() || {}; } catch (e) { console.warn("[sam] getContext failed:", e); }
    if (retryOnly) context = { ...context, retryOnly };

    const ex = startExchange(text, { note, ask: (t, o) => handleSend(t, o) });
    const response = await chat(text, context, { onProgress: ex.onProgress, onReceipt: ex.onReceipt });
    sendBtn.disabled = false;
    ex.finish(response);
    focusInput();
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
