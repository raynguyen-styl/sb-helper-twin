import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseParser } from "../src/sam/sse.js";

const collect = (chunks) => {
  const out = [];
  const p = createSseParser((e) => out.push(e));
  for (const c of chunks) p.push(c);
  p.end();
  return out;
};
const STREAM = ": open\n\nevent: received\ndata: {}\n\n: keep-alive\n\nevent: progress\ndata: {\"agents\":[{\"name\":\"sb_spend\"}]}\n\nevent: answer\ndata: {\"reply\":\"**S$7.57M**\"}\n\n";
const EXPECTED = [
  { comment: "open" },
  { event: "received", data: "{}" },
  { comment: "keep-alive" },
  { event: "progress", data: "{\"agents\":[{\"name\":\"sb_spend\"}]}" },
  { event: "answer", data: "{\"reply\":\"**S$7.57M**\"}" },
];

test("a whole stream gives its events and comments in order", () => {
  assert.deepEqual(collect([STREAM]), EXPECTED);
});

test("a stream split anywhere — every single-character cut — gives the same events", () => {
  for (let i = 1; i < STREAM.length; i++) assert.deepEqual(collect([STREAM.slice(0, i), STREAM.slice(i)]), EXPECTED, `cut at ${i}`);
  assert.deepEqual(collect([...STREAM]), EXPECTED);
});

test("CRLF line ends, split between CR and LF", () => {
  const crlf = STREAM.replace(/\n/g, "\r\n");
  const cut = crlf.indexOf("\r\n") + 1;
  assert.deepEqual(collect([crlf.slice(0, cut), crlf.slice(cut)]), EXPECTED);
});

test("multi-line data joins with newlines; a missing event name is \"message\"", () => {
  assert.deepEqual(collect(["data: a\ndata: b\n\n"]), [{ event: "message", data: "a\nb" }]);
});

test("a final event without its blank line is still delivered at end()", () => {
  assert.deepEqual(collect(["event: error\ndata: {\"code\":\"timeout\"}"]), [{ event: "error", data: "{\"code\":\"timeout\"}" }]);
});

test("UTF-8 text survives (the decoder runs before the parser)", () => {
  assert.deepEqual(collect(["event: answer\ndata: {\"reply\":\"Café ✓\"}\n\n"]), [{ event: "answer", data: "{\"reply\":\"Café ✓\"}" }]);
});
