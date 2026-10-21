// The reply's Markdown (src/sam/markdown.js) under a minimal document stub: sam-chat, "The reply text renders a safe
// Markdown subset" and "Markdown tables render in their common forms" (change agents-on-live-ischool-data, task 4.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAnswer } from "../src/sam/markdown.js";
import { normalizeReply } from "../src/sam/normalize.js";

// Just enough of the DOM for renderAnswer: elements, text nodes and a fragment.
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.className = ""; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  set textContent(t) { this.children = [{ text: String(t) }]; }
  get textContent() { return this.children.map((c) => (c instanceof El ? c.textContent : c.text)).join(""); }
}
const doc = { createDocumentFragment: () => new El("#fragment"), createElement: (t) => new El(t), createTextNode: (t) => ({ text: String(t) }) };
const all = (node, tag) => (node instanceof El ? [...(node.tagName === tag ? [node] : []), ...node.children.flatMap((c) => all(c, tag))] : []);
const render = (md) => renderAnswer(doc, md);

test("a classic pipe table still renders", () => {
  const out = render("| School | Spend |\n|---|---:|\n| MGSP | S$101,474 |");
  assert.equal(all(out, "table").length, 1);
  assert.deepEqual(all(out, "th").map((th) => th.textContent), ["School", "Spend"]);
  assert.deepEqual(all(out, "td").map((td) => [td.textContent, td.className]), [["MGSP", ""], ["S$101,474", "num"]]);
});

test("A table without outer pipes", () => {
  const out = render("The top schools:\n\nSchool | Spend\n--- | ---\nMGSP | S$101,474\nRGPS | S$26,281\n\n(fake mesh)");
  assert.equal(all(out, "table").length, 1);
  assert.deepEqual(all(out, "th").map((th) => th.textContent), ["School", "Spend"]);
  assert.equal(all(out, "tr").length, 3);                         // the header row and two body rows
  assert.equal(all(out, "p").length, 2);                          // the lead line and the trailing note stay paragraphs
});

test("A short separator", () => {
  const out = render("| a | b |\n|-|-|\n| 1 | 2 |");
  assert.equal(all(out, "table").length, 1);
  assert.deepEqual(all(out, "td").map((td) => td.textContent), ["1", "2"]);
});

test("a lone --- or a pipe in a sentence is not a table", () => {
  assert.equal(all(render("Spend went up\n---\nthen down"), "table").length, 0);
  assert.equal(all(render("Either A | B, both fine.\nNext line."), "table").length, 0);
  assert.equal(all(render("| a | b |\n|---|\n| 1 | 2 |"), "table").length, 0);   // separator cells must match the header
});

test("Escaped line breaks: the two characters \\n become line breaks when the reply has no real one", () => {
  const r = normalizeReply({ reply: "**Top schools**\\n- MGSP\\n- RGPS" });
  const out = render(r.reply);
  assert.equal(all(out, "strong")[0].textContent, "Top schools");
  assert.deepEqual(all(out, "li").map((li) => li.textContent), ["MGSP", "RGPS"]);
  assert.ok(!out.textContent.includes("\\"));
});

test("a reply with real line breaks keeps a quoted backslash-n as text", () => {
  const r = normalizeReply({ reply: "Line one\nThe path is C:\\new" });
  assert.ok(r.reply.includes("C:\\new"));
});

test("links and markup show as literal text", () => {
  const out = render("See [link](http://example.com) and <img src=x onerror=alert(1)>");
  assert.equal(all(out, "a").length, 0);
  assert.equal(all(out, "img").length, 0);
  assert.ok(out.textContent.includes("[link](http://example.com)"));
});
