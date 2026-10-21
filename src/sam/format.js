/**
 * format.js — how the chat writes a number (tiles, chart labels, ticks, the Numbers tables, Copy as text). Pure, so
 * `node --test` covers it (test/format.test.mjs); samPanel.js imports it.
 */
export const fmtInt = (v) => Math.round(v).toLocaleString("en-SG");
export const compact = (v) => { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : fmtInt(v); };
// Numbers come as numbers (SGD in dollars, percentages 0–100); the unit decides how they read.
export function fmtValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return "–";
  const u = (unit || "").toUpperCase();
  const a = Math.abs(v);
  // whole dollars from S$100 read without cents, so one chart's labels agree ("S$12.4k", "S$8,100", "S$3,900")
  if (u === "SGD" || u === "S$" || u === "$") return `S$${a >= 1e4 ? compact(v) : Number.isInteger(v) && a >= 100 ? fmtInt(v) : v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (u === "%" || u === "PCT" || u === "PERCENT") return `${v.toFixed(1)}%`;
  if (u === "PT") return `${v.toFixed(1)} pt`;
  if (u === "MS") return a >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
  if (u === "S") return `${v.toFixed(1)} s`;
  if (u === "KM") return `${v.toFixed(1)} km`;
  if (u === "BPM") return `${Math.round(v)} bpm`;
  if (!u || u === "COUNT" || u === "N") return Number.isInteger(v) || a >= 100 ? compact(v) : v.toFixed(2);
  return `${a >= 1e4 || Number.isInteger(v) ? compact(v) : v.toFixed(1)} ${unit}`;
}
export const r1 = (x) => Math.round(x * 10) / 10;
export function tickFmt(v, unit) {
  const u = (unit || "").toUpperCase();
  if (u === "SGD" || u === "S$" || u === "$") return v >= 1e6 ? `${r1(v / 1e6)}M` : v >= 1e3 ? `${r1(v / 1e3)}K` : `${Math.round(v)}`;
  if (u === "%" || u === "PCT" || u === "PERCENT") return `${r1(v)}%`;
  return v >= 1e6 ? `${r1(v / 1e6)}M` : v >= 1e3 ? `${r1(v / 1e3)}K` : `${r1(v)}`;
}
// Which table columns hold figures (right-aligned, like every table on the dashboard): a column whose non-empty cells
// are all numbers or read as figures ("S$1,234", "33.4%", "1.2 s"). A chart's Numbers table (a label, then values)
// gets [false, true, …]; an agent's table keeps its text columns (School, Last tap) left-aligned.
const FIGURE = /^[-+]?(S?\$)?[\d,.]+\s*(%|k|K|M|s|ms|km|bpm)?$/;
export function numericColumns(rows, width) {
  return Array.from({ length: width }, (_, i) => {
    const cells = rows.map((r) => r?.[i]).filter((v) => v != null && v !== "");
    return cells.length > 0 && cells.every((v) => typeof v === "number" || FIGURE.test(String(v).trim()));
  });
}
export const nice = (max) => { if (!(max > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; const step = m <= 2 ? 0.5 : m <= 5 ? 1 : 2; return Math.ceil(m / step) * step * p; };
