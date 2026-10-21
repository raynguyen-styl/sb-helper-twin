/**
 * sse.js — a parser for the chat route's event stream (central-specs capability chat-bridge: `received`,
 * `progress`, `answer`, `error`, and keep-alive comments). The browser's EventSource cannot POST or send a
 * bearer token, so samClient reads the stream with fetch and feeds its text here, chunk by chunk; a chunk may
 * end anywhere, even mid-line. Pure: no DOM, no Vite, so `node --test` covers it.
 *
 *   const p = createSseParser((ev) => …);   // ev: { event, data } for an event, { comment } for a ":" line
 *   p.push(text); … p.end();
 */
export function createSseParser(onEvent) {
  let buf = "";
  let event = "", data = [];

  const dispatch = () => {
    if (data.length || event) onEvent({ event: event || "message", data: data.join("\n") });
    event = ""; data = [];
  };
  const line = (l) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return onEvent({ comment: l.slice(1).trim() });
    const i = l.indexOf(":");
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    // id and retry are not used by the chat route
  };

  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.search(/\r\n|\n|\r/)) >= 0) {
        // a lone "\r" at the very end may be the first half of "\r\n": wait for the next chunk
        if (buf[i] === "\r" && i === buf.length - 1) break;
        const nl = buf[i] === "\r" && buf[i + 1] === "\n" ? 2 : 1;
        line(buf.slice(0, i));
        buf = buf.slice(i + nl);
      }
    },
    end() {
      if (buf) { line(buf); buf = ""; }
      dispatch();
    },
  };
}
