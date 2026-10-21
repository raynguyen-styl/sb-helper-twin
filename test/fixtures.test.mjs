// Every display fixture (test/fixtures/replies, change agents-on-live-ischool-data D9) normalised as a live reply is:
// its kind, its report mode, its counts of tiles, charts, tables, rows and points, and its suggestions. The bubble,
// the school links and the Retry chip are checked in the browser (SB.chatReplay with the same files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeReply } from "../src/sam/normalize.js";

const DIR = new URL("./fixtures/replies/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", DIR), "utf8"));

for (const { name, about, expect: e } of index) {
  test(`${name}: ${about}`, () => {
    const f = JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8"));
    const r = normalizeReply(f.reply);
    if (e.kind) assert.equal(r.kind, e.kind);
    if (e.report === null) assert.equal(r.report, null);
    if (typeof e.report === "string") assert.equal(r.report?.mode, e.report);
    if (e.kpis != null) assert.equal(r.report.kpis.length, e.kpis);
    if (e.charts != null) assert.equal(r.report.charts.length, e.charts);
    if (e.tables != null) assert.equal(r.report.tables.length, e.tables);
    if (e.rows != null) assert.equal(r.report.tables[0].rows.length, e.rows);
    if (e.points != null) assert.equal(r.report.charts[0].series[0].points.length, e.points);
    if (e.suggestions != null) assert.equal(r.suggestions.length, e.suggestions);
    if (r.report) assert.deepEqual(r.report.dropped, [], "nothing dropped");
    assert.ok(r.reply && !r.reply.includes("\\n"), "no escaped line break left in the reply");
  });
}
