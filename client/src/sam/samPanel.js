/**
 * samPanel.js — SMART Buddy SAM chat panel (self-contained vanilla JS DOM widget).
 *
 * Text-in / text-out assistant. Replies render as light markdown (bold, `code`, bullet/numbered
 * lists, line breaks) — the SAM answer text is HTML-ESCAPED first, then a small whitelist of safe
 * transforms is applied, so untrusted model output can never inject markup. getContext() is folded
 * into the outgoing text by samClient. Styling uses the app's design tokens (theme.css :root vars).
 */

import { chat } from "./samClient.js";

const MOBILE_BREAKPOINT = 720;
const AVATAR = "/icon.png";                 // branded assistant avatar (public/icon.png)
let panelExpanded = true;
let _getContext = () => ({});

const isMobilePanel = () => window.innerWidth <= MOBILE_BREAKPOINT;
const isDesktopPanel = () => !isMobilePanel();

// ── markdown-lite: escape, then apply a safe whitelist (bold, code, lists, line breaks) ──────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function mdInline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}
function mdLite(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = []; let list = null;   // list = 'ul' | 'ol' | null
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    const o = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b) { if (list !== "ul") { closeList(); html.push("<ul>"); list = "ul"; } html.push(`<li>${mdInline(b[1])}</li>`); }
    else if (o) { if (list !== "ol") { closeList(); html.push("<ol>"); list = "ol"; } html.push(`<li>${mdInline(o[1])}</li>`); }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); html.push(`<div class="sam-p">${mdInline(line)}</div>`); }
  }
  closeList();
  return html.join("");
}

function focusSamInput({ preserveValue = true } = {}) {
  const input = document.getElementById("sam-input");
  if (!input || !panelExpanded || !isDesktopPanel()) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  if (preserveValue) input.setSelectionRange(end, end); else input.select();
}
function autoGrow(input) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function updateEmptyState(thread) {
  const emptyState = thread?.querySelector(".sam-empty-state");
  if (emptyState) emptyState.hidden = Boolean(thread.querySelector(".sam-msg-row"));
}
function resetChatThread(thread, input) {
  thread.querySelectorAll(".sam-msg-row").forEach((n) => n.remove());
  updateEmptyState(thread);
  if (input) { input.value = ""; autoGrow(input); }
  thread.scrollTop = 0;
}

function addMessage(thread, role, text) {
  const row = document.createElement("div");
  row.className = `sam-msg-row sam-msg-row-${role}`;
  if (role === "sam") {
    const av = document.createElement("img");
    av.className = "sam-av-img"; av.src = AVATAR; av.alt = "SAM";
    row.appendChild(av);
  }
  const col = document.createElement("div");
  col.className = "sam-msg-col";
  const msg = document.createElement("div");
  msg.className = "sam-msg sam-msg-" + role;
  if (role === "sam") msg.innerHTML = mdLite(text); else msg.textContent = text;
  col.appendChild(msg);
  if (role === "sam") {
    const copy = document.createElement("button");
    copy.className = "sam-copy"; copy.type = "button"; copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(text).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1200); });
    });
    col.appendChild(copy);
  }
  row.appendChild(col);
  thread.appendChild(row);
  updateEmptyState(thread);
  thread.scrollTop = thread.scrollHeight;
}

function setOffline(isOffline, input) {
  const badge = document.getElementById("sam-offline-badge");
  if (badge) badge.style.display = isOffline ? "inline-flex" : "none";
  if (input) input.style.opacity = isOffline ? "0.85" : "1";
}

function panelWidthPx() { return Math.min(400, Math.max(320, Math.round(window.innerWidth * 0.26))); }
function mobilePanelHeightPx() { return Math.min(Math.round(window.innerHeight * 0.68), 520); }

function applyPanelState(panel) {
  const mobile = isMobilePanel();
  panel.classList.toggle("sam-collapsed", !panelExpanded);
  panel.classList.toggle("sam-mobile", mobile);
  const body = document.getElementById("sam-body");
  if (mobile) {
    const h = panelExpanded ? mobilePanelHeightPx() : 56;
    Object.assign(panel.style, { width: "100%", height: `${h}px`, top: "auto", bottom: "0", left: "0", right: "0" });
    if (body) body.style.width = "";
  } else {
    const w = panelExpanded ? panelWidthPx() : 48;
    Object.assign(panel.style, { width: `${w}px`, height: "auto", top: "44px", bottom: "0", left: "auto", right: "0" });
    // content keeps its EXPANDED width even while collapsed (it's clipped) → no reflow on toggle
    if (body) body.style.width = `${panelWidthPx()}px`;
  }
  if (panelExpanded && isDesktopPanel()) requestAnimationFrame(() => focusSamInput());
}

export function initSamPanel(getContext) {
  if (typeof getContext === "function") _getContext = getContext;
  if (isMobilePanel()) panelExpanded = false;

  const panel = document.createElement("div");
  panel.id = "sam-panel";

  panel.innerHTML = `
    <button type="button" class="sam-rail" id="sam-rail" aria-label="Open SAM assistant" title="Open SAM">
      <img class="sam-rail-av" src="${AVATAR}" alt="" />
      <span class="sam-rail-label">SAM</span>
      <span class="sam-rail-chev" aria-hidden="true">‹</span>
    </button>
    <div class="sam-body" id="sam-body">
    <div id="sam-header" class="sam-header">
      <div class="sam-header-left">
        <img class="sam-brand-av" src="${AVATAR}" alt="" />
        <div class="sam-header-txt">
          <span class="sam-title">SAM</span>
          <span class="sam-sub">Data assistant</span>
        </div>
      </div>
      <div class="sam-header-right">
        <span id="sam-offline-badge" class="sam-offline-badge" style="display:none">offline</span>
        <button type="button" id="sam-new-chat" class="sam-new-chat" title="New chat">New</button>
        <button type="button" id="sam-toggle" class="sam-toggle" aria-label="Toggle assistant">›</button>
      </div>
    </div>
    <div id="sam-thread" class="sam-thread">
      <div class="sam-empty-state">
        <div class="sam-empty-inner">
          <img class="sam-empty-av" src="${AVATAR}" alt="" />
          <div class="sam-empty-title">Ask about the data</div>
          <div class="sam-empty-copy">Spending, stalls, network health or wearables — in plain English. SAM writes SQL and answers with real numbers.</div>
          <div class="sam-empty-prompts">
            <button type="button" class="sam-empty-chip" data-prompt="Which schools spent the most?">Top-spending schools</button>
            <button type="button" class="sam-empty-chip" data-prompt="Which terminals are the slowest?">Slowest terminals</button>
            <button type="button" class="sam-empty-chip" data-prompt="Which day had the most transactions?">Busiest day</button>
            <button type="button" class="sam-empty-chip" data-prompt="What is the food category breakdown?">Food category mix</button>
          </div>
        </div>
      </div>
    </div>
    <div id="sam-footer" class="sam-footer">
      <div class="sam-inputwrap">
        <textarea id="sam-input" rows="1" placeholder="Ask SAM…" class="sam-input" aria-label="Message to SAM"></textarea>
        <button type="button" id="sam-send" class="sam-send" aria-label="Send" title="Send">↑</button>
      </div>
      <div class="sam-hint">Enter to send · Shift+Enter for a new line</div>
    </div>
    </div>`;

  const style = document.createElement("style");
  style.id = "sam-panel-styles";
  style.textContent = `
    #sam-panel { position: fixed; right: 0; top: 44px; bottom: 0; height: auto; z-index: 50;
      background: var(--canvas); border-left: 1px solid var(--hairline); display: flex; flex-direction: column;
      font-family: var(--font-text); overflow: hidden; box-shadow: -8px 0 30px rgba(0,0,0,.07);
      transition: width .2s ease, height .2s ease; }
    #sam-panel * { box-sizing: border-box; }
    .sam-header { padding: 10px 12px; border-bottom: 1px solid var(--divider-soft); display: flex;
      justify-content: space-between; align-items: center; gap: 8px; flex: none; background: var(--parchment); }
    .sam-header-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .sam-brand-av { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; flex: none; }
    .sam-header-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .sam-title { color: var(--ink); font-family: var(--font-display); font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
    .sam-sub { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--ink-muted-48); text-transform: uppercase; }
    .sam-header-right { display: flex; align-items: center; gap: 6px; flex: none; }
    .sam-new-chat { border: 1px solid var(--hairline); background: var(--canvas); color: var(--primary);
      border-radius: var(--r-pill); padding: 4px 11px; font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .sam-new-chat:hover { background: #f0f6ff; border-color: var(--primary); }
    .sam-offline-badge { background: rgba(255,59,48,.12); color: var(--bad); font-size: 10px; font-weight: 700;
      letter-spacing: .04em; padding: 3px 8px; border-radius: var(--r-pill); text-transform: uppercase; }
    .sam-toggle { background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink-muted-48);
      cursor: pointer; border-radius: var(--r-pill); font-size: 16px; line-height: 1; width: 30px; height: 30px; flex: none; }
    .sam-toggle:hover { background: #f0f6ff; color: var(--primary); }

    .sam-thread { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; }
    .sam-empty-state { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px 4px; }
    .sam-empty-state[hidden] { display: none; }   /* the explicit display:flex above would otherwise override [hidden] */
    .sam-empty-inner { max-width: 280px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .sam-empty-av { width: 46px; height: 46px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
    .sam-empty-title { color: var(--ink); font-family: var(--font-display); font-size: 15px; font-weight: 650; }
    .sam-empty-copy { color: var(--ink-muted-48); font-size: 12.5px; line-height: 1.5; }
    .sam-empty-prompts { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-top: 4px; }
    .sam-empty-chip { border: 1px solid #d6e3fb; background: #f5f9ff; color: #1f5fb0; border-radius: var(--r-pill);
      padding: 7px 12px; font-size: 12px; line-height: 1.2; font-family: inherit; cursor: pointer; transition: .14s; }
    .sam-empty-chip:hover { background: #e7f0ff; transform: translateY(-1px); }

    .sam-msg-row { display: flex; align-items: flex-start; gap: 8px; max-width: 100%; animation: sam-in .2s ease-out; }
    .sam-msg-row-user { flex-direction: row-reverse; }
    .sam-av-img { width: 26px; height: 26px; border-radius: 7px; object-fit: cover; flex: none; margin-top: 2px; }
    .sam-msg-col { display: flex; flex-direction: column; gap: 3px; min-width: 0; max-width: 84%; }
    .sam-msg-row-user .sam-msg-col { align-items: flex-end; }
    .sam-msg { padding: 9px 13px; font-size: 13px; line-height: 1.55; word-break: break-word; }
    .sam-msg-user { background: var(--primary); color: #fff; border-radius: 14px 14px 4px 14px; white-space: pre-wrap; }
    .sam-msg-sam { background: var(--parchment); color: var(--ink); border-radius: 14px 14px 14px 4px; }
    .sam-msg-sam .sam-p { margin: 0; }
    .sam-msg-sam .sam-p + .sam-p { margin-top: 6px; }
    .sam-msg-sam ul, .sam-msg-sam ol { margin: 6px 0; padding-left: 20px; }
    .sam-msg-sam li { margin: 2px 0; }
    .sam-msg-sam code { background: rgba(0,0,0,.06); border-radius: 5px; padding: 1px 5px; font-size: 12px;
      font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
    .sam-msg-sam strong { font-weight: 680; }
    .sam-copy { align-self: flex-start; border: none; background: none; color: var(--ink-muted-48);
      font-size: 11px; padding: 0 2px; cursor: pointer; font-family: inherit; }
    .sam-copy:hover { color: var(--primary); }
    .sam-thinking-wrap { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-muted-48); font-weight: 600; }
    .sam-thinking-dots { display: inline-flex; gap: 4px; }
    .sam-thinking-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--lv-sec); animation: sam-bounce 1.05s ease-in-out infinite; opacity: .4; }
    .sam-thinking-dot:nth-child(2) { animation-delay: .14s; }
    .sam-thinking-dot:nth-child(3) { animation-delay: .28s; }
    @keyframes sam-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes sam-bounce { 0%,80%,100% { transform: translateY(0) scale(.82); opacity: .35; } 40% { transform: translateY(-4px) scale(1); opacity: 1; } }

    .sam-footer { padding: 10px 12px 12px; border-top: 1px solid var(--divider-soft); flex: none; background: var(--parchment); }
    .sam-inputwrap { display: flex; align-items: flex-end; gap: 8px; background: var(--canvas);
      border: 1px solid var(--hairline); border-radius: 16px; padding: 6px 6px 6px 12px; transition: border-color .15s, box-shadow .15s; }
    .sam-inputwrap:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0,102,204,.12); }
    .sam-input { flex: 1; border: none; outline: none; resize: none; background: transparent; color: var(--ink);
      font-family: inherit; font-size: 13px; line-height: 1.45; max-height: 120px; padding: 4px 0; }
    .sam-input::placeholder { color: var(--ink-muted-48); }
    .sam-send { flex: none; width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--primary);
      color: #fff; font-size: 16px; line-height: 1; cursor: pointer; }
    .sam-send:hover { background: var(--primary-focus); }
    .sam-send:disabled { opacity: .45; cursor: not-allowed; }
    .sam-hint { font-size: 10.5px; color: var(--ink-muted-48); text-align: center; margin-top: 6px; }

    /* content block keeps a FIXED width (set by JS) so nothing reflows when the panel
       collapses/expands — only the panel's own width animates (content is just clipped). */
    .sam-body { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; }
    #sam-panel.sam-collapsed .sam-body { display: none; }
    #sam-panel.sam-collapsed .sam-rail { display: flex; }

    /* collapsed rail — the WHOLE strip is the open button */
    .sam-rail { display: none; flex: 1 1 auto; width: 100%; flex-direction: column; align-items: center;
      gap: 12px; padding: 14px 0; border: none; background: var(--canvas); cursor: pointer;
      font-family: inherit; transition: background .14s; }
    .sam-rail:hover { background: #f0f6ff; }
    .sam-rail-av { width: 26px; height: 26px; border-radius: 7px; object-fit: cover; flex: none; }
    .sam-rail-label { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 2px; flex: 1;
      display: flex; align-items: center; font-family: var(--font-display); font-weight: 650;
      font-size: 12px; color: var(--ink-muted-48); }
    .sam-rail-chev { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
      background: var(--parchment); color: var(--primary); font-size: 16px; line-height: 1; flex: none; transition: background .14s; }
    .sam-rail:hover .sam-rail-chev { background: #e2edff; }

    #sam-panel.sam-mobile { border-left: none; border-top: 1px solid var(--hairline); border-radius: 16px 16px 0 0; box-shadow: 0 -12px 34px rgba(0,0,0,.14); }
    #sam-panel.sam-mobile .sam-input { font-size: 16px; }
    #sam-panel.sam-mobile .sam-rail { flex-direction: row; justify-content: center; gap: 10px; padding: 0 16px; }
    #sam-panel.sam-mobile .sam-rail-label { writing-mode: horizontal-tb; text-orientation: mixed; flex: none; }
    #sam-panel.sam-mobile .sam-rail-chev { transform: rotate(90deg); }
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
  document.getElementById("sam-rail")?.addEventListener("click", () => { panelExpanded = true; applyPanelState(panel); });
  newChatBtn?.addEventListener("click", () => { resetChatThread(thread, input); setOffline(false, input); focusSamInput(); });
  document.addEventListener("smartbuddy:solace-status", (e) => { if (!e.detail?.connected) setOffline(true, input); });
  if (panelExpanded && isDesktopPanel()) requestAnimationFrame(() => focusSamInput());

  async function handleSend(forcedText = "") {
    const text = String((typeof forcedText === "string" ? forcedText : "") || input.value).trim();
    if (!text) return;
    setOffline(false, input);
    if (!panelExpanded) { panelExpanded = true; applyPanelState(panel); }

    addMessage(thread, "user", text);
    input.value = ""; autoGrow(input);
    sendBtn.disabled = true;

    const thinkingRow = document.createElement("div");
    thinkingRow.className = "sam-msg-row sam-msg-row-sam";
    thinkingRow.innerHTML = `<img class="sam-av-img" src="${AVATAR}" alt="SAM" /><div class="sam-msg-col"><div class="sam-msg sam-msg-sam"><span class="sam-thinking-wrap"><span>Thinking</span><span class="sam-thinking-dots" aria-hidden="true"><span class="sam-thinking-dot"></span><span class="sam-thinking-dot"></span><span class="sam-thinking-dot"></span></span></span></div></div>`;
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
  input.addEventListener("input", () => autoGrow(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }   // Enter sends, Shift+Enter = newline
  });
  // delegated click handling for the starter chips
  thread.addEventListener("click", (e) => {
    const b = e.target.closest("[data-prompt]");
    if (b) void handleSend(b.getAttribute("data-prompt") || "");
  });
}
