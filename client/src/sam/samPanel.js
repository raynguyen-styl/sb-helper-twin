/**
 * samPanel.js — SMART Buddy SAM chat panel (self-contained vanilla JS DOM widget).
 * Adapted from htx-pilot/front-end/src/sam/samPanel.js: light theme to match the
 * SMART Buddy app, and decoupled from app internals — the caller passes a
 * getContext() provider instead of the panel importing dashboard modules.
 *
 * The SAM agent is text-in / text-out, so replies render as plain text (no action
 * cards). getContext() is folded into the outgoing text as a short preamble by samClient.
 */

import { chat } from "./samClient.js";

const MOBILE_BREAKPOINT = 720;
let panelExpanded = true;
let _getContext = () => ({});

const isMobilePanel = () => window.innerWidth <= MOBILE_BREAKPOINT;
const isDesktopPanel = () => !isMobilePanel();

function focusSamInput({ preserveValue = true } = {}) {
  const input = document.getElementById("sam-input");
  if (!(input instanceof HTMLInputElement)) return;
  if (!panelExpanded || !isDesktopPanel()) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  if (preserveValue) input.setSelectionRange(end, end); else input.select();
}

function updateEmptyState(thread) {
  const emptyState = thread?.querySelector(".sam-empty-state");
  if (!emptyState) return;
  emptyState.hidden = Boolean(thread.querySelector(".sam-msg-row, .sam-action-card"));
}

function resetChatThread(thread, input) {
  thread.querySelectorAll(".sam-msg-row, .sam-action-card").forEach((n) => n.remove());
  updateEmptyState(thread);
  if (input instanceof HTMLInputElement) input.value = "";
  thread.scrollTop = 0;
}

function addMessage(thread, role, text) {
  const row = document.createElement("div");
  row.className = `sam-msg-row sam-msg-row-${role}`;
  const avatar = document.createElement("div");
  avatar.className = `sam-msg-avatar sam-msg-avatar-${role}`;
  avatar.textContent = role === "user" ? "You" : "AI";
  const msg = document.createElement("div");
  msg.className = "sam-msg sam-msg-" + role;
  msg.textContent = text;
  row.append(avatar, msg);
  thread.appendChild(row);
  updateEmptyState(thread);
  thread.scrollTop = thread.scrollHeight;
}

function setOffline(isOffline, input) {
  const badge = document.getElementById("sam-offline-badge");
  if (badge) badge.style.display = isOffline ? "inline-flex" : "none";
  if (input) input.style.opacity = isOffline ? "0.85" : "1";
}

function panelWidthPx() { return Math.min(400, Math.max(300, Math.round(window.innerWidth * 0.26))); }
function mobilePanelHeightPx() { return Math.min(Math.round(window.innerHeight * 0.68), 520); }

function applyPanelState(panel) {
  const mobile = isMobilePanel();
  const toggleBtn = document.getElementById("sam-toggle");
  panel.classList.toggle("sam-collapsed", !panelExpanded);
  panel.classList.toggle("sam-mobile", mobile);
  if (mobile) {
    const h = panelExpanded ? mobilePanelHeightPx() : 52;
    Object.assign(panel.style, { width: "100%", height: `${h}px`, top: "auto", bottom: "0", left: "0", right: "0" });
    if (toggleBtn) toggleBtn.textContent = panelExpanded ? "–" : "+";
    return;
  }
  const w = panelExpanded ? panelWidthPx() : 44;
  Object.assign(panel.style, { width: `${w}px`, height: "auto", top: "52px", bottom: "0", left: "auto", right: "0" });
  if (toggleBtn) toggleBtn.textContent = panelExpanded ? "–" : "+";
  if (panelExpanded && isDesktopPanel()) requestAnimationFrame(() => focusSamInput());
}

/**
 * Create the SAM panel and wire events.
 * @param {() => object} getContext  Returns a snapshot of dashboard state to send with each query.
 */
export function initSamPanel(getContext) {
  if (typeof getContext === "function") _getContext = getContext;
  if (isMobilePanel()) panelExpanded = false;

  const panel = document.createElement("div");
  panel.id = "sam-panel";
  panel.style.cssText = [
    "position:fixed", "right:0", "top:52px", "bottom:0", "height:auto",
    "background:#ffffff", "border-left:1px solid #e5e5ea",
    "display:flex", "flex-direction:column", "z-index:50",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif",
    "transition:width 0.2s ease,height 0.2s ease", "overflow:hidden",
    "box-shadow:-6px 0 24px rgba(0,0,0,0.08)",
  ].join(";");

  panel.innerHTML = `
    <div id="sam-header" class="sam-header">
      <div class="sam-header-left">
        <span class="sam-title">SAM · Data Assistant</span>
        <span class="sam-sub">February 2026 data</span>
      </div>
      <div class="sam-header-right">
        <button type="button" id="sam-new-chat" class="sam-new-chat">New</button>
        <span id="sam-offline-badge" class="sam-offline-badge" style="display:none">OFFLINE</span>
        <button type="button" id="sam-toggle" class="sam-toggle" aria-label="Toggle assistant">–</button>
      </div>
    </div>
    <div id="sam-thread" class="sam-thread">
      <div class="sam-empty-state">
        <div class="sam-empty-inner">
          <div class="sam-empty-kicker">Ask the data</div>
          <div class="sam-empty-title">Ask about spending, stalls, network health or wearables — in plain English.</div>
          <div class="sam-empty-copy">SAM writes SQL over the February 2026 dataset and answers with real numbers.</div>
          <div class="sam-empty-prompts">
            <button type="button" class="sam-empty-chip" data-prompt="Which schools spent the most in February?">Top-spending schools</button>
            <button type="button" class="sam-empty-chip" data-prompt="How did Chinese New Year affect revenue?">CNY revenue impact</button>
            <button type="button" class="sam-empty-chip" data-prompt="Which terminals are the slowest?">Slowest terminals</button>
            <button type="button" class="sam-empty-chip" data-prompt="What is the average heart rate, excluding the 255 sensor errors?">Average heart rate</button>
          </div>
        </div>
      </div>
    </div>
    <div id="sam-footer" class="sam-footer">
      <input id="sam-input" type="text" placeholder="Ask about February 2026…" class="sam-input" aria-label="Message to SAM" />
      <button type="button" id="sam-send" class="sam-send">Send</button>
    </div>
  `;

  const style = document.createElement("style");
  style.id = "sam-panel-styles";
  style.textContent = `
    #sam-panel * { box-sizing: border-box; }
    .sam-header { padding: 12px 14px; border-bottom: 1px solid #e5e5ea; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: #fafafa; }
    .sam-header-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sam-title { color: #1c1c1e; font-size: 0.9rem; font-weight: 650; letter-spacing: -0.01em; }
    .sam-sub { font-size: 0.62rem; font-weight: 600; letter-spacing: 0.06em; color: #2a78d6; text-transform: uppercase; }
    .sam-header-right { display: flex; align-items: center; gap: 8px; }
    .sam-new-chat { border: 1px solid #d1d1d6; background: #fff; color: #2a78d6; border-radius: 999px; padding: 5px 10px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; font-family: inherit; }
    .sam-new-chat:hover { background: #f0f6ff; border-color: #2a78d6; }
    .sam-offline-badge { background: #ffe5e5; color: #c0271f; font-size: 0.58rem; font-weight: 700; letter-spacing: 0.05em; padding: 3px 7px; border-radius: 5px; text-transform: uppercase; }
    .sam-toggle { background: #fff; border: 1px solid #d1d1d6; color: #6b6b70; cursor: pointer; border-radius: 999px; font-size: 18px; line-height: 1; min-width: 32px; min-height: 32px; }
    .sam-toggle:hover { background: #f0f6ff; color: #2a78d6; }
    .sam-thread { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: #ffffff; }
    .sam-empty-state { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px 8px; }
    .sam-empty-inner { max-width: 260px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .sam-empty-kicker { padding: 5px 10px; border-radius: 999px; border: 1px solid #cfe0ff; background: #f0f6ff; color: #2a78d6; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; }
    .sam-empty-title { color: #1c1c1e; font-size: 0.95rem; font-weight: 650; line-height: 1.35; }
    .sam-empty-copy { color: #6b6b70; font-size: 0.78rem; line-height: 1.5; }
    .sam-empty-prompts { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-top: 4px; }
    .sam-empty-chip { border: 1px solid #d6e3fb; background: #f5f9ff; color: #1f5fb0; border-radius: 999px; padding: 7px 11px; font-size: 0.7rem; line-height: 1.2; font-family: inherit; cursor: pointer; transition: background 0.14s ease, transform 0.14s ease; }
    .sam-empty-chip:hover { background: #e7f0ff; transform: translateY(-1px); }
    .sam-msg-row { display: flex; align-items: flex-start; gap: 8px; max-width: 100%; animation: sam-msg-in 0.2s ease-out; }
    .sam-msg-row-user { align-self: flex-end; flex-direction: row-reverse; }
    .sam-msg-row-sam { align-self: flex-start; }
    .sam-msg-avatar { flex: 0 0 auto; min-width: 32px; height: 24px; padding: 0 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-top: 3px; }
    .sam-msg-avatar-user { background: #e7f0ff; color: #2a78d6; }
    .sam-msg-avatar-sam { background: #eef7f1; color: #1baf7a; }
    .sam-msg { padding: 9px 12px; font-size: 0.82rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .sam-msg-user { background: #2a78d6; color: #fff; border-radius: 12px 12px 4px 12px; max-width: min(88%, 260px); }
    .sam-msg-sam { background: #f2f2f7; color: #1c1c1e; border-radius: 12px 12px 12px 4px; max-width: min(90%, 300px); border-left: 2px solid #1baf7a; }
    .sam-msg-sam.sam-thinking { min-width: 84px; }
    .sam-thinking-wrap { display: inline-flex; align-items: center; gap: 9px; color: #6b6b70; font-weight: 600; }
    .sam-thinking-dots { display: inline-flex; gap: 4px; }
    .sam-thinking-dot { width: 6px; height: 6px; border-radius: 999px; background: #1baf7a; animation: sam-bounce 1.05s ease-in-out infinite; opacity: 0.4; }
    .sam-thinking-dot:nth-child(2) { animation-delay: 0.14s; }
    .sam-thinking-dot:nth-child(3) { animation-delay: 0.28s; }
    .sam-action-card { align-self: flex-start; background: #f5f9ff; border: 1px solid #d6e3fb; color: #1f5fb0; padding: 8px 11px; border-radius: 10px; font-size: 0.72rem; font-weight: 650; cursor: pointer; font-family: inherit; text-align: left; }
    .sam-action-card:hover:not(:disabled) { background: #e7f0ff; }
    .sam-action-card:disabled { opacity: 0.6; cursor: default; }
    @keyframes sam-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes sam-bounce { 0%,80%,100% { transform: translateY(0) scale(0.82); opacity: 0.35; } 40% { transform: translateY(-4px) scale(1); opacity: 1; } }
    .sam-footer { padding: 11px 14px; border-top: 1px solid #e5e5ea; display: flex; gap: 8px; flex-shrink: 0; background: #fafafa; }
    .sam-input { flex: 1; background: #fff; border: 1px solid #d1d1d6; color: #1c1c1e; padding: 9px 11px; border-radius: 10px; font-family: inherit; font-size: 0.82rem; }
    .sam-input:focus { outline: none; border-color: #2a78d6; box-shadow: 0 0 0 3px rgba(42,120,214,0.12); }
    .sam-send { background: #2a78d6; color: #fff; border: none; font-weight: 700; font-size: 0.72rem; letter-spacing: 0.03em; text-transform: uppercase; padding: 9px 15px; border-radius: 10px; cursor: pointer; font-family: inherit; }
    .sam-send:hover { background: #1f66bd; }
    .sam-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #sam-panel.sam-collapsed .sam-header-left, #sam-panel.sam-collapsed .sam-offline-badge, #sam-panel.sam-collapsed .sam-new-chat, #sam-panel.sam-collapsed .sam-thread, #sam-panel.sam-collapsed .sam-footer { display: none !important; }
    #sam-panel.sam-collapsed .sam-header { justify-content: center; padding: 10px 4px; }
    #sam-panel.sam-collapsed .sam-header-right { width: 100%; justify-content: center; }
    #sam-panel.sam-mobile { border-left: none; border-top: 1px solid #e5e5ea; border-radius: 14px 14px 0 0; box-shadow: 0 -10px 30px rgba(0,0,0,0.12); }
    #sam-panel.sam-mobile .sam-input { font-size: 16px; }
    @media (max-width: 420px) { #sam-panel.sam-mobile .sam-footer { flex-direction: column; } #sam-panel.sam-mobile .sam-send { width: 100%; } }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  const thread = document.getElementById("sam-thread");
  const input = document.getElementById("sam-input");
  const sendBtn = document.getElementById("sam-send");
  const toggleBtn = document.getElementById("sam-toggle");
  const newChatBtn = document.getElementById("sam-new-chat");

  applyPanelState(panel);
  updateEmptyState(thread);
  window.addEventListener("resize", () => applyPanelState(panel));
  toggleBtn.addEventListener("click", () => { panelExpanded = !panelExpanded; applyPanelState(panel); });
  newChatBtn?.addEventListener("click", () => { resetChatThread(thread, input); setOffline(false, input); focusSamInput({ preserveValue: true }); });

  // reflect Solace connection status on the offline badge
  document.addEventListener("smartbuddy:solace-status", (e) => {
    if (!e.detail?.connected) setOffline(true, input);
  });

  if (panelExpanded && isDesktopPanel()) requestAnimationFrame(() => focusSamInput());

  async function handleSend(forcedText = "") {
    const text = String((typeof forcedText === "string" ? forcedText : "") || input.value).trim();
    if (!text) return;
    setOffline(false, input);
    if (!panelExpanded) { panelExpanded = true; applyPanelState(panel); }

    addMessage(thread, "user", text);
    input.value = "";
    sendBtn.disabled = true;

    const thinkingRow = document.createElement("div");
    thinkingRow.className = "sam-msg-row sam-msg-row-sam";
    thinkingRow.innerHTML = `<div class="sam-msg-avatar sam-msg-avatar-sam">AI</div><div class="sam-msg sam-msg-sam sam-thinking"><span class="sam-thinking-wrap"><span>Thinking</span><span class="sam-thinking-dots" aria-hidden="true"><span class="sam-thinking-dot"></span><span class="sam-thinking-dot"></span><span class="sam-thinking-dot"></span></span></span></div>`;
    thread.appendChild(thinkingRow);
    thread.scrollTop = thread.scrollHeight;

    let context = {};
    try { context = _getContext() || {}; } catch (e) { console.warn("[sam] getContext failed:", e); }

    const response = await chat(text, context);
    thinkingRow.remove();
    sendBtn.disabled = false;

    if (response.offline) {
      setOffline(true, input);
      addMessage(thread, "sam", "SAM is offline — no response. Check that the Solace/agent connection is configured.");
      focusSamInput();
      return;
    }
    setOffline(false, input);
    const replyText = response.reply || response.text || response.message || JSON.stringify(response);
    addMessage(thread, "sam", String(replyText ?? "").trim() || "[Empty reply]");
    focusSamInput();
  }

  sendBtn.addEventListener("click", () => handleSend());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSend(); });
  thread.querySelectorAll("[data-prompt]").forEach((b) => b.addEventListener("click", () => void handleSend(b.getAttribute("data-prompt") || "")));
}
