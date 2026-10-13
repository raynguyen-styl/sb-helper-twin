/**
 * solace.js — Solace PubSub+ session module for the SMART Buddy frontend.
 *
 * Manages a single Web-Messaging (SMF over wss) session and exposes
 * subscribe / publish. Auto-reconnects with exponential backoff.
 * Adapted from htx-pilot/front-end/src/solace/solace.js (topic/event names
 * rebased htx → smartbuddy). The broker creds in the built bundle are PUBLIC —
 * use low-privilege demo creds scoped to the smartbuddy chat topics only.
 */

import solace from "solclientjs";

const SOLACE_HOST =
  import.meta.env.VITE_SOLACE_URL ||
  import.meta.env.VITE_SOLACE_HOST ||
  "";
const SOLACE_VPN = import.meta.env.VITE_SOLACE_VPN || "default";
const SOLACE_USER = import.meta.env.VITE_SOLACE_USER || "";
const SOLACE_PASS =
  import.meta.env.VITE_SOLACE_PASSWORD ||
  import.meta.env.VITE_SOLACE_PASS ||
  "";

/** @type {solace.Session | null} */
let _session = null;
/** True only after SessionEventCode.UP_NOTICE — required before subscribe/send */
let _sessionUp = false;
/** topic → handler[] */
const _subscriptions = new Map();

let _reconnectDelay = 1000;
let _reconnectTimer = null;
const MAX_RECONNECT_DELAY = 30000;

function dispatchSolaceStatus(connected) {
  document.dispatchEvent(new CustomEvent("smartbuddy:solace-status", { detail: { connected } }));
}

function createSession() {
  const factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;
  factoryProps.logLevel = solace.LogLevel.WARN;
  solace.SolclientFactory.init(factoryProps);

  _session = solace.SolclientFactory.createSession({
    url: SOLACE_HOST,
    vpnName: SOLACE_VPN,
    userName: SOLACE_USER,
    password: SOLACE_PASS,
    clientName: `smartbuddy-frontend-${Date.now()}`.slice(0, 160),
    reconnectRetries: 0, // we manage reconnect ourselves
    keepAliveIntervalInMsecs: 3000,
    keepAliveIntervalsLimit: 3,
  });

  _session.on(solace.SessionEventCode.UP_NOTICE, () => {
    _sessionUp = true;
    console.log(`[solace] connected ${SOLACE_HOST} vpn=${SOLACE_VPN}`);
    dispatchSolaceStatus(true);
    _reconnectDelay = 1000;
    for (const topic of _subscriptions.keys()) _doSubscribe(topic);
  });

  _session.on(solace.SessionEventCode.MESSAGE, (message) => {
    const topicName = message.getDestination()?.getName?.() || "";
    const payload = _tryParsePayload(message);
    if (payload === null) return;
    for (const [topic, handlers] of _subscriptions) {
      if (_topicMatches(topic, topicName)) {
        for (const handler of handlers) {
          try { handler(topicName, payload); } catch (e) { console.warn("[solace] handler error:", e); }
        }
      }
    }
  });

  _session.on(solace.SessionEventCode.DISCONNECTED, () => {
    _sessionUp = false;
    console.warn("[solace] disconnected — scheduling reconnect");
    dispatchSolaceStatus(false);
    _scheduleReconnect();
  });

  _session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (ev) => {
    console.error("[solace] connect failed:", ev?.infoStr || ev);
    dispatchSolaceStatus(false);
    _scheduleReconnect();
  });

  _session.on(solace.SessionEventCode.DOWN_ERROR, (ev) => {
    _sessionUp = false;
    console.warn("[solace] down error — scheduling reconnect:", ev?.infoStr || ev);
    dispatchSolaceStatus(false);
    _scheduleReconnect();
  });

  _session.connect();
}

function _scheduleReconnect() {
  if (!SOLACE_HOST || _reconnectTimer) return;
  const delay = _reconnectDelay;
  _reconnectDelay = Math.min(_reconnectDelay * 2, MAX_RECONNECT_DELAY);
  console.log(`[solace] reconnecting in ${delay}ms`);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    try { _session?.dispose(); } catch { /* ignore */ }
    _session = null;
    createSession();
  }, delay);
}

/** Force an immediate fresh reconnect (tab foreground / network back). */
export function reconnectNow() {
  if (!SOLACE_HOST) return;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _reconnectDelay = 1000;
  _sessionUp = false;
  dispatchSolaceStatus(false);
  try { _session?.dispose(); } catch { /* ignore */ }
  _session = null;
  createSession();
}

function _tryParsePayload(message) {
  try {
    const raw = message.getBinaryAttachment();
    if (!raw) return null;
    const str = typeof raw === "string"
      ? raw
      : new TextDecoder("utf-8").decode(raw instanceof ArrayBuffer ? raw : new Uint8Array(raw));
    const trimmed = str.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch { return { text: str }; }
  } catch { return null; }
}

/** '>' matches everything after prefix; '*' matches one level. */
function _topicMatches(pattern, topic) {
  if (pattern === topic) return true;
  if (pattern.endsWith(">")) return topic.startsWith(pattern.slice(0, -1));
  const p = pattern.split("/"), t = topic.split("/");
  if (p.length !== t.length) return false;
  return p.every((seg, i) => seg === "*" || seg === t[i]);
}

function _doSubscribe(topic) {
  if (!_session || !_sessionUp) return;
  try {
    _session.subscribe(solace.SolclientFactory.createTopic(topic), true, topic, 10000);
  } catch (e) { console.warn(`[solace] subscribe failed for ${topic}:`, e.message); }
}

// ── Public API ───────────────────────────────────────────────────
export function initSolace() {
  if (!SOLACE_HOST) {
    console.warn("[solace] VITE_SOLACE_URL not set — running offline (chat disabled)");
    dispatchSolaceStatus(false);
    return;
  }
  dispatchSolaceStatus(false);
  createSession();
}

export function subscribe(topic, handler) {
  if (!_subscriptions.has(topic)) {
    _subscriptions.set(topic, []);
    if (_sessionUp) _doSubscribe(topic);
  }
  _subscriptions.get(topic).push(handler);
}

export function publish(topic, payload) {
  if (!_session || !_sessionUp) {
    console.warn("[solace] session not ready — cannot publish; scheduling reconnect");
    _scheduleReconnect();
    return;
  }
  try {
    const msg = solace.SolclientFactory.createMessage();
    msg.setDestination(solace.SolclientFactory.createTopic(topic));
    // A string payload goes on the wire as-is (text-only agents get clean text,
    // not a JSON-quoted string); objects are JSON-serialized.
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    msg.setBinaryAttachment(body);
    msg.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
    _session.send(msg);
  } catch (e) { console.warn("[solace] publish error:", e.message); }
}
