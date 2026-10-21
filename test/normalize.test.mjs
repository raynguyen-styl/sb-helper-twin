// The reply normalisers (src/sam/normalize.js). First block: today's behaviour, pinned before the variant shapes
// (change agents-on-live-ischool-data, task 4.1). Later blocks: the variant shapes (task 4.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReply, normalizeReport, normalizeAgents, normalizeSteps, isReceipt } from "../src/sam/normalize.js";

const reply = (extra = {}) => ({ correlationId: "c-1", reply: "**S$7.57M** was spent.", actions: [], kind: "answer",
  agents: [{ name: "sb_orchestrator", role: "orchestrator", status: "done" }, { name: "sb_spend", status: "done", source: "ischool.transaction", ms: 1200 }],
  ...extra });

// ── today's behaviour, pinned ─────────────────────────────────────────────────────────────────────
test("a full envelope: kind, agents with roles, steps, suggestions, actions", () => {
  const r = normalizeReply(reply({ steps: [{ agent: "sb_spend", text: "Read the taps." }, "A plain step"], suggestions: ["Spend by level"] }));
  assert.equal(r.kind, "answer");
  assert.equal(r.reply, "**S$7.57M** was spent.");
  assert.deepEqual(r.agents.map((a) => [a.name, a.role, a.status]), [["sb_orchestrator", "orchestrator", "done"], ["sb_spend", "specialist", "done"]]);
  assert.equal(r.agents[1].source, "ischool.transaction");
  assert.deepEqual(r.steps, [{ agent: "sb_spend", text: "Read the taps." }, { agent: undefined, text: "A plain step" }]);
  assert.deepEqual(r.suggestions, ["Spend by level"]);
  assert.deepEqual(r.actions, []);
  assert.equal(r.report, null);
});

test("a JSON string holding the object (the gateway's encoding) is read as the object", () => {
  const r = normalizeReply(JSON.stringify(JSON.stringify(reply())));
  assert.equal(r.reply, "**S$7.57M** was spent.");
  assert.equal(r.agents.length, 2);
});

test("plain text is the reply; an unknown kind is an answer; an unknown status is done", () => {
  assert.equal(normalizeReply("Just words.").reply, "Just words.");
  assert.equal(normalizeReply(reply({ kind: "banter" })).kind, "answer");
  assert.equal(normalizeAgents([{ name: "sb_x", status: "pondering" }])[0].status, "done");
  assert.deepEqual(normalizeAgents([{ status: "done" }, null, "x"]), []);
});

test("the gateway's receipt is recognised, in plain text or inside an object", () => {
  assert.equal(isReceipt("Request received by gateway, processing…"), true);
  assert.equal(isReceipt({ text: "Request received by gateway" }), true);
  assert.equal(isReceipt(reply()), false);
});

test("a report with the documented shapes", () => {
  const r = normalizeReport({ mode: "report", title: "Spend · September 2026", period: "2026-09", source: "iSchool",
    kpis: [{ label: "Spend", value: 7571234.5, unit: "SGD", delta: { pct: 4.2, vs: "August" }, agent: "sb_spend" }],
    charts: [{ kind: "bar", title: "By level", unit: "SGD", series: [{ name: "Spend", points: [["Primary", 5100000], ["Secondary", 2471234]] }], agent: "sb_spend" }],
    tables: [{ title: "Stalls", columns: ["Stall", "Taps"], rows: [["Drinks", 42]], units: [null, "count"], agent: "sb_spend" }],
    notes: ["Student traffic only."] });
  assert.equal(r.mode, "report");
  assert.deepEqual(r.kpis[0], { label: "Spend", value: 7571234.5, unit: "SGD", delta: { pct: 4.2, vs: "August" }, agent: "sb_spend" });
  assert.deepEqual(r.charts[0].series[0].points, [["Primary", 5100000], ["Secondary", 2471234]]);
  assert.deepEqual(r.tables[0].rows, [["Drinks", 42]]);
  assert.deepEqual(r.notes, ["Student traffic only."]);
  assert.deepEqual(r.dropped, []);
});

test("limits: 6 kpis, 4 charts, 3 tables, 50 rows, 400 points — the excess is noted", () => {
  const kpi = (i) => ({ label: `K${i}`, value: i });
  const chart = (i) => ({ kind: "line", title: `C${i}`, series: [{ name: "s", points: Array.from({ length: i === 0 ? 450 : 3 }, (_, j) => [String(j), j]) }] });
  const r = normalizeReport({ kpis: Array.from({ length: 8 }, (_, i) => kpi(i)), charts: Array.from({ length: 5 }, (_, i) => chart(i)),
    tables: [{ title: "T", columns: ["a"], rows: Array.from({ length: 60 }, (_, i) => [i]) }] });
  assert.equal(r.kpis.length, 6);
  assert.equal(r.charts.length, 4);
  assert.equal(r.charts[0].series[0].points.length, 400);
  assert.equal(r.tables[0].rows.length, 50);
  assert.ok(r.dropped.includes("figures beyond 6") && r.dropped.includes("charts beyond 4"));
  assert.ok(r.dropped.some((d) => d.startsWith("points beyond 400")));
  assert.ok(r.dropped.some((d) => d.startsWith("rows beyond 50")));
});

test("brief mode: at most 3 kpis and one chart or one table", () => {
  const r = normalizeReport({ mode: "brief", kpis: [1, 2, 3, 4].map((v) => ({ label: `K${v}`, value: v })),
    charts: [{ kind: "bar", title: "A", series: [{ points: [["x", 1]] }] }],
    tables: [{ title: "T", rows: [["a", 1]] }] });
  assert.equal(r.kpis.length, 3);
  assert.equal(r.charts.length, 1);
  assert.equal(r.tables.length, 0);
  assert.ok(r.dropped.includes("figures beyond three") && r.dropped.includes("visuals beyond the first"));
});

test("no usable visual: the report is null; a report without mode keeps mode undefined (the full card)", () => {
  assert.equal(normalizeReport({ kpis: [{ label: "x", value: "not a number" }] }), null);
  assert.equal(normalizeReport(null), null);
  assert.equal(normalizeReport({ kpis: [{ label: "x", value: 1 }] }).mode, undefined);
});

test("strings are clipped and steps are capped", () => {
  const r = normalizeReply(reply({ suggestions: Array.from({ length: 10 }, (_, i) => `S${i} ${"x".repeat(200)}`) }));
  assert.equal(r.suggestions.length, 8);
  assert.ok(r.suggestions.every((s) => s.length <= 160));
  assert.equal(normalizeSteps(Array.from({ length: 20 }, (_, i) => `step ${i}`)).length, 12);
});

// ── the variant shapes (sam-chat, "A visual in a common variant shape still draws") ───────────────
test("Rows as objects: read by the column names, numbers kept as numbers", () => {
  const r = normalizeReport({ mode: "brief", tables: [{ title: "Stalls", columns: ["Stall", "School", "Taps"], agent: "sb_spend",
    rows: [{ Stall: "Drinks", School: "Fixture Primary", Taps: 42 }, { stall: "Noodles", school: "Fixture Secondary", taps: 17 }] }] });
  assert.deepEqual(r.tables[0].columns, ["Stall", "School", "Taps"]);
  assert.deepEqual(r.tables[0].rows, [["Drinks", "Fixture Primary", 42], ["Noodles", "Fixture Secondary", 17]]);
  assert.deepEqual(r.dropped, []);
});

test("Rows as objects without columns: the first row's keys become the columns", () => {
  const r = normalizeReport({ tables: [{ title: "T", rows: [{ School: "MGSP", Spend: 101474 }, { School: "RGPS", Spend: 26281 }] }] });
  assert.deepEqual(r.tables[0].columns, ["School", "Spend"]);
  assert.deepEqual(r.tables[0].rows[1], ["RGPS", 26281]);
});

test("Points as objects: {label, value}, {x, y} and {name, value}", () => {
  const r = normalizeReport({ charts: [{ kind: "bar", title: "Spend", series: [{ name: "Spend", points: [{ label: "MGSP", value: 101474 }, { x: "RGPS", y: 26281 }, { name: "TKGS", value: "21,002" }] }] }] });
  assert.deepEqual(r.charts[0].series[0].points, [["MGSP", 101474], ["RGPS", 26281], ["TKGS", 21002]]);
});

test("Formatted numbers: S$ with separators and a trailing % give the value and the unit", () => {
  const r = normalizeReport({ kpis: [{ label: "Spend", value: "S$7,571,234.50" }, { label: "SSS share", value: "33.4%" }, { label: "Kept", value: "1,234", unit: "count" }] });
  assert.deepEqual(r.kpis.map((k) => [k.value, k.unit]), [[7571234.5, "SGD"], [33.4, "%"], [1234, "count"]]);
});

test("Words, blanks and null are not numbers", () => {
  const r = normalizeReport({ kpis: [{ label: "a", value: "n/a" }, { label: "b", value: "" }, { label: "c", value: null }, { label: "d", value: 5 }] });
  assert.deepEqual(r.kpis.map((k) => k.label), ["d"]);
});

test("A pie chart: drawn as a bar chart of the same values, nothing dropped", () => {
  const r = normalizeReport({ charts: [{ kind: "pie", title: "Payment types", series: [{ name: "Share", points: [["SSS", "33.4%"], ["EZ-Link", 41.2], ["Wallet", 20.1], ["Other", 5.3]] }] }] });
  assert.equal(r.charts[0].kind, "bar");
  assert.equal(r.charts[0].series[0].points.length, 4);
  assert.deepEqual(r.dropped, []);
});

test("Kind synonyms: column, horizontal_bar and hbar are bars; area is a line; stacked_bar is stacked", () => {
  const kinds = ["column", "horizontal_bar", "hbar", "area", "stacked_bar", "Bar"].map((kind) =>
    normalizeReport({ charts: [{ kind, title: kind, series: [{ points: [["a", 1]] }] }] }).charts[0].kind);
  assert.deepEqual(kinds, ["bar", "bar", "bar", "line", "stacked", "bar"]);
});

test("A chart's unit comes from formatted points when it has none", () => {
  const r = normalizeReport({ charts: [{ kind: "bar", title: "Spend", series: [{ points: [["a", "S$1,000"], ["b", "S$2,000"]] }] }] });
  assert.equal(r.charts[0].unit, "SGD");
});

test("A shape still unusable: the table is dropped and the notes say a table could not be drawn", () => {
  const r = normalizeReport({ kpis: [{ label: "Taps", value: 41230 }], tables: [{ title: "T", columns: ["a"], rows: ["just", "strings"] }],
    charts: [{ kind: "radar", title: "R", series: [{ points: [["a", 1]] }] }] });
  assert.equal(r.tables.length, 0);
  assert.ok(r.dropped.includes("a table that could not be drawn"));
  assert.ok(r.dropped.includes("a chart of an unknown kind"));
});
