// How the chat writes a number (src/sam/format.js). Found by the display audit (change agents-on-live-ischool-data,
// task 4.4): one bar chart read "S$12.4k", "S$8,100.00", "S$3,900.00".
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtValue, tickFmt, compact } from "../src/sam/format.js";

test("S$: compact from 10k, whole dollars without cents, real cents kept", () => {
  assert.equal(fmtValue(12400, "SGD"), "S$12.4k");
  assert.equal(fmtValue(8100, "SGD"), "S$8,100");
  assert.equal(fmtValue(3900, "SGD"), "S$3,900");
  assert.equal(fmtValue(7571234.5, "SGD"), "S$7.57M");
  assert.equal(fmtValue(3.5, "SGD"), "S$3.50");
  assert.equal(fmtValue(112.5, "SGD"), "S$112.50");
  assert.equal(fmtValue(48, "SGD"), "S$48.00");             // under S$100 a price keeps its cents
});

test("percentages, counts, milliseconds and the dash for nothing", () => {
  assert.equal(fmtValue(33.4, "%"), "33.4%");
  assert.equal(fmtValue(1240, "count"), "1,240");
  assert.equal(fmtValue(41230, "count"), "41.2k");
  assert.equal(fmtValue(1240, "ms"), "1.2 s");
  assert.equal(fmtValue(380, "ms"), "380 ms");
  assert.equal(fmtValue(null, "SGD"), "–");
  assert.equal(fmtValue(NaN), "–");
});

test("ticks and compact", () => {
  assert.equal(tickFmt(15000, "SGD"), "15K");
  assert.equal(tickFmt(2.5, "%"), "2.5%");
  assert.equal(compact(1_250_000), "1.25M");
});

test("table columns: only figure columns are right-aligned", async () => {
  const { numericColumns } = await import("../src/sam/format.js");
  // the latest-activity table: Stall, School, Last tap are text; Taps and Spend are figures
  assert.deepEqual(numericColumns([["Fixture Drinks Stall", "Fixture Primary School", "17:42", 64, 112.5], ["Noodles", "FXSS", "17:31", 88, 301.2]], 5),
    [false, false, false, true, true]);
  // a chart's Numbers table: the label, then values
  assert.deepEqual(numericColumns([["Primary", 12400], ["Secondary", 8100]], 2), [false, true]);
  // figures written as text, and empty cells, still count as a figure column
  assert.deepEqual(numericColumns([["MGSP", "S$101,474", "33.4%"], ["RGPS", "", "12%"]], 3), [false, true, true]);
});
