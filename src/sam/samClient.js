/**
 * samClient.js — the SMART Buddy chat's client for the backend's chat route (central-specs decision 0007,
 * capabilities chat-bridge and sam-chat). The browser holds no broker login and opens no broker connection:
 * each question is one `POST {VITE_SB_API_URL}/api/sam/ask` with the viewer's CIAM token and the body
 * {text, context}, answered as an event stream —
 *   `received`  the mesh has the question (marks "Received");
 *   `progress`  {agents} while the agents work (the routing card);
 *   `answer`    the reply object, then the stream ends;
 *   `error`     {code, message}, then the stream ends.
 * The route owns the wait (150 s, 300 s for a report question) and the matching; the chat keeps no wait of its
 * own beyond ending a stream that carries nothing — not even a keep-alive — for 30 s.
 *
 * The reply (capability agent-system, decision 0006) is {correlationId, reply (Markdown subset), actions, kind?,
 * agents?, report? (mode "brief" | "report"), suggestions?, steps? [{agent, text}]}. The route checks its shape;
 * everything is still normalised (normalize.js) into bounded plain values, and the panel never reads the raw payload.
 */

import { validToken } from "../auth.js";
import { createSseParser } from "./sse.js";
import { isReceipt, normalizeAgents, normalizeReport, normalizeSteps, normalizeReply, sanitizeAgentName } from "./normalize.js";

const API_BASE = (import.meta.env.VITE_SB_API_URL || "").replace(/\/$/, "");
const SILENCE_MS = 30000;                      // twice the route's 15 s keep-alive

// What the panel says for each way a question can fail (sam-chat, "The viewer sees when no agent answers").
// `offline` drives the offline badge; `retry` whether a Retry chip is offered.
export const FAILURES = Object.freeze({
  timeout:          { offline: false, retry: true,  text: "No answer came within the wait. The agents may be busy; try again, or ask a narrower question." },
  broker_down:      { offline: true,  retry: true,  text: "SMART Buddy is offline: the message broker is not reachable. The rest of the dashboard still works; try again in a minute." },
  unreachable:      { offline: true,  retry: true,  text: "SMART Buddy is offline: the chat service did not answer. The rest of the dashboard still works; try again in a minute." },
  reply_unmatched:  { offline: false, retry: true,  text: "The agents answered, but not this question: they did not see it. This is a setup fault on the agents' side, not your question; it has been logged." },
  wrong_question:   { offline: false, retry: true,  text: "The agents answered without seeing this question. This is a setup fault on the agents' side, not your question; it has been logged." },
  invalid_reply:    { offline: false, retry: true,  text: "The agents replied, but their answer could not be read. Try again." },
  mesh_error:       { offline: false, retry: true,  text: "The agents reported an error" },
  unauthorized:     { offline: false, retry: false, text: "Your sign-in has expired. Reload the page to sign in again." },
  auth_unavailable: { offline: false, retry: true,  text: "The sign-in service could not be reached to check your session. Try again in a minute." },
  one_at_a_time:    { offline: false, retry: true,  text: "One question at a time: wait for the current answer, then ask again." },
  too_many:         { offline: false, retry: true,  text: "That is a lot of questions in a minute. Wait a moment, then ask again." },
  busy:             { offline: false, retry: true,  text: "SMART Buddy is busy answering other people. Try again in a minute." },
  bad_request:      { offline: false, retry: false, text: "That question could not be sent: it is empty or longer than 1,000 characters." },
});
const failure = (code, message) => ({ failure: { code: FAILURES[code] ? code : "invalid_reply", message: String(message ?? "").slice(0, 300) } });

// The reply normalisers live in normalize.js (pure, tested under node); re-exported for the panel and replay.
export { isReceipt, normalizeAgents, normalizeReport, normalizeSteps, normalizeReply };

export function initSam() {
  if (!API_BASE) console.warn("[sam] VITE_SB_API_URL not set — the chat has no route to ask (offline)");
}

// The structured context the route rebuilds its hint from (chat-bridge, "The question is checked and its context
// rebuilt"): only these fields are sent; the route drops any that fail its patterns.
function _contextFields(context) {
  const c = context && typeof context === "object" ? context : {};
  const v = c.viewing || {};
  const month = typeof c.month === "string" ? c.month : String(c.scope ?? "").match(/\d{4}-\d{2}/)?.[0];
  const out = { month, role: c.role, school: v.school ?? c.school, stall: v.stall ?? c.stall, terminal: v.terminal ?? c.terminal,
    retryOnly: c.retryOnly ? sanitizeAgentName(c.retryOnly) : undefined };
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === "") delete out[k];
  return out;
}

/**
 * Ask the chat route.
 * @param {string} text  Natural-language question
 * @param {object} context  Dashboard state snapshot (+ retryOnly: an agent name to re-ask alone)
 * @param {{onProgress?: (agents: object[]) => void, onReceipt?: () => void}} [opts]
 * @returns {Promise<{reply?: string; actions?: object[]; kind?: string; agents?: object[]; report?: object|null; suggestions?: string[]; steps?: object[]; failure?: {code: string, message: string}}>}
 */
export async function chat(text, context = {}, opts = {}) {
  if (!API_BASE) return failure("unreachable");
  const ctl = new AbortController();
  let silence = null;
  const quiet = () => { clearTimeout(silence); silence = setTimeout(() => ctl.abort(), SILENCE_MS); };
  try {
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    const t = await validToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    quiet();
    const res = await fetch(`${API_BASE}/api/sam/ask`, {
      method: "POST", headers, signal: ctl.signal,
      body: JSON.stringify({ text: String(text ?? ""), context: _contextFields(context) }),
    });
    if (!res.ok || !String(res.headers.get("content-type") || "").startsWith("text/event-stream")) {
      const body = await res.json().catch(() => ({}));
      const code = res.status === 401 ? "unauthorized" : body?.error && FAILURES[body.error] ? body.error
        : res.status === 429 ? "one_at_a_time" : res.status === 503 ? "busy" : res.status === 400 ? "bad_request" : "unreachable";
      return failure(code);
    }
    let outcome = null;
    const parser = createSseParser((ev) => {
      if (outcome || ev.comment !== undefined) return;
      let data = null;
      try { data = JSON.parse(ev.data || "null"); } catch { /* a malformed event is skipped */ }
      if (ev.event === "received") { try { opts.onReceipt?.(); } catch (e) { console.warn("[sam] onReceipt failed:", e); } }
      else if (ev.event === "progress") { try { opts.onProgress?.(normalizeAgents(data?.agents)); } catch (e) { console.warn("[sam] onProgress failed:", e); } }
      else if (ev.event === "answer") outcome = normalizeReply(data);
      else if (ev.event === "error") outcome = failure(data?.code, data?.message);
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      quiet();                                   // any bytes, keep-alives included, mean the route is alive
      parser.push(dec.decode(value, { stream: true }));
      if (outcome) { ctl.abort(); break; }
    }
    if (!outcome) { parser.push(dec.decode()); parser.end(); }
    return outcome ?? failure("unreachable");
  } catch (err) {
    if (err?.name !== "AbortError") console.warn("[sam] chat route unreachable:", err?.message);
    return failure("unreachable");
  } finally {
    clearTimeout(silence);
  }
}
